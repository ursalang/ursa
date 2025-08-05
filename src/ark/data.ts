// Compiled Ark values.
// © Reuben Thomas 2023-2025
// Released under the MIT license.

import {
  action, call, Operation, Reject, Resolve, run, sleep,
} from 'effection'

import {
  ArkFnType, ArkType, ArkTraitType, ArkUnionType,
  ArkMethodType, ArkAnyType, ArkSelfType, ArkUnknownType,
  ArkMemberType,
} from './type.js'
import {FsMap} from './fsmap.js'
import programVersion from '../version.js'
import {debug} from './util.js'
import {type ArkState} from './interpreter.js'

// A hack that works for us, as browsers do not have util/types library, and
// is-generator-function doesn't play nice with rollup.
function isGeneratorFunction(obj: object) {
  const constructor = obj.constructor
  return constructor !== undefined && constructor.name === 'GeneratorFunction'
}

export class ArkTypedId {
  constructor(public name: string, public type: ArkType) {}
}

export class ArkVal {
  type: ArkType = ArkAnyType
}

export abstract class ArkAbstractStructBase extends ArkVal {
  abstract getMethod(prop: string): ArkCallable | undefined

  abstract get(prop: string): ArkVal

  abstract set(prop: string, val: ArkVal): ArkVal
}

export abstract class ArkCallable extends ArkVal {
  constructor(
    isGenerator: boolean,
    public params: ArkTypedId[] | undefined,
    public returnType: ArkType,
  ) {
    super()
    this.type = new ArkFnType(isGenerator, this.params, this.returnType)
  }
}

export class ArkContinuation extends ArkCallable {
  public done = false

  constructor(public state: ArkState) {
    super(false, [new ArkTypedId('x', ArkAnyType)], ArkAnyType) // FIXME: correct type
  }
}

export class NativeFn<T extends ArkVal[]> extends ArkCallable {
  public body: (...args: [...T]) => Operation<ArkVal>

  constructor(
    params: ArkTypedId[] | undefined,
    returnType: ArkType,
    innerBody: (...args: [...T]) => ArkVal | Operation<ArkVal>,
  ) {
    super(false, params, returnType)
    if (isGeneratorFunction(innerBody)) {
      this.body = innerBody as (...args: [...T]) => Operation<ArkVal>
    } else {
      // eslint-disable-next-line require-yield
      this.body = function* gen(...args: [...T]) {
        return innerBody(...args)
      } as (...args: [...T]) => Operation<ArkVal>
    }
    this.type = new ArkFnType(false, params, returnType)
  }
}

export const ArkStructTraitType = new ArkTraitType('Struct')
// Need to define ArkBooleanTraitType before setting methods

export class ArkStructBase extends ArkAbstractStructBase {
  type: ArkType = ArkStructTraitType

  public members: Map<string, ArkVal> = new Map()

  public static methods = new Map<string, ArkCallable>()

  static addMethods(methods: [string, ArkCallable][]) {
    methods.forEach(([name, val]) => this.methods.set(name, val))
  }

  getMethod(prop: string): ArkCallable | undefined {
    return (this.constructor as typeof ArkStructBase).methods.get(prop)
  }

  get(prop: string) {
    return this.members.get(prop) ?? ArkUndefined()
  }

  set(prop: string, val: ArkVal) {
    this.members.set(prop, val)
    return val
  }
}

export abstract class ArkConcreteVal<T> extends ArkStructBase {
  constructor(public val: T) {
    super()
  }
}

export const ArkNullTraitType = new ArkTraitType('Null', new Map(), new Set([ArkStructTraitType]))

export class ArkNullVal extends ArkConcreteVal<null> {
  type = ArkNullTraitType

  constructor() {
    super(null)
  }
}

export const ArkBooleanTraitType = new ArkTraitType('Bool', new Map(), new Set([ArkStructTraitType]))
ArkBooleanTraitType.methods = new Map([
  ['not', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType)], ArkBooleanTraitType))],
])

export class ArkBooleanVal extends ArkConcreteVal<boolean> {
  type = ArkBooleanTraitType
}

ArkStructTraitType.methods = new Map([
  ['equals', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkBooleanTraitType))],
  ['notEquals', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkBooleanTraitType))],
])

// Avoid forward reference to ArkBooleanTrait
ArkStructBase.methods = new Map(
  [
    // FIXME: ArkAnyType below should be some ur-trait ArkStructTrait
    ['equals', new NativeFn([new ArkTypedId('right', ArkSelfType), new ArkTypedId('right', ArkAnyType)], ArkBooleanTraitType, (thisVal, right) => ArkBoolean(thisVal === right))],
    ['notEquals', new NativeFn([new ArkTypedId('right', ArkAnyType)], ArkBooleanTraitType, (thisVal, right) => ArkBoolean(thisVal !== right))],
  ],
)
ArkConcreteVal.methods = new Map(
  [
    ['equals', new NativeFn([new ArkTypedId('right', ArkSelfType)], ArkBooleanTraitType, (thisVal: ArkConcreteVal<unknown>, right: ArkVal) => ArkBoolean(thisVal.val === toJs(right)))],
    ['notEquals', new NativeFn([new ArkTypedId('right', ArkSelfType)], ArkBooleanTraitType, (thisVal: ArkConcreteVal<unknown>, right: ArkVal) => ArkBoolean(thisVal.val !== toJs(right)))],
  ],
)

// Now we have set up super-class methods, wire up ArkBoolean
ArkBooleanVal.methods = new Map([
  ...ArkConcreteVal.methods,
  ['not', new NativeFn([], ArkBooleanTraitType, (thisVal: ArkBooleanVal) => ArkBoolean(!thisVal.val))],
])

// ts-unused-exports:disable-next-line
export class ArkUndefinedVal extends ArkConcreteVal<undefined> {
  type = ArkUnknownType

  static methods: Map<string, ArkCallable> = new Map([...ArkConcreteVal.methods])

  constructor() {
    super(undefined)
  }
}

export const ArkStringTraitType = new ArkTraitType('Str', new Map(), new Set([ArkStructTraitType]))

export const ArkNumberTraitType = new ArkTraitType('Number')

ArkStringTraitType.methods = new Map([
  ['get', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('index', ArkNumberTraitType)], ArkStringTraitType))],
  ['iter', new ArkMethodType(new ArkFnType(true, [new ArkTypedId('self', ArkSelfType)], ArkStringTraitType))],
])

ArkNumberTraitType.methods = new Map([
  ['toString', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType)], ArkStringTraitType))],
  ['pos', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType)], ArkNumberTraitType))],
  ['neg', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType)], ArkNumberTraitType))],
  ['bitwiseNot', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType)], ArkNumberTraitType))],
  ['lt', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkBooleanTraitType))],
  ['leq', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkBooleanTraitType))],
  ['gt', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkBooleanTraitType))],
  ['geq', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkBooleanTraitType))],
  ['add', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkNumberTraitType))],
  ['add', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkNumberTraitType))],
  ['sub', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkNumberTraitType))],
  ['mul', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkNumberTraitType))],
  ['div', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkNumberTraitType))],
  ['mod', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkNumberTraitType))],
  ['exp', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkNumberTraitType))],
  ['bitwiseAnd', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkNumberTraitType))],
  ['bitwiseOr', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkNumberTraitType))],
  ['bitwiseXor', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkNumberTraitType))],
  ['shiftLeft', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkNumberTraitType))],
  ['shiftRight', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkNumberTraitType))],
  ['shiftRightArith', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkNumberTraitType))],
])
ArkNumberTraitType.superTraits = new Set([ArkStructTraitType])

export class ArkNumberVal extends ArkConcreteVal<number> {
  type = ArkNumberTraitType

  static methods: Map<string, ArkCallable> = new Map([...ArkConcreteVal.methods])

  static {
    ArkNumberVal.addMethods(
      [
        ['toString', new NativeFn([], ArkNumberTraitType, (thisVal: ArkNumberVal) => ArkString(thisVal.val.toString()))],
        ['pos', new NativeFn([], ArkNumberTraitType, (thisVal: ArkNumberVal) => ArkNumber(+thisVal.val))],
        ['neg', new NativeFn([], ArkNumberTraitType, (thisVal: ArkNumberVal) => ArkNumber(-thisVal.val))],
        ['bitwiseNot', new NativeFn([], ArkNumberTraitType, (thisVal: ArkNumberVal) => ArkNumber(~thisVal.val))],
        ['lt', new NativeFn([new ArkTypedId('right', ArkNumberTraitType)], ArkBooleanTraitType, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkBoolean(thisVal.val < right.val))],
        ['leq', new NativeFn([new ArkTypedId('right', ArkNumberTraitType)], ArkBooleanTraitType, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkBoolean(thisVal.val <= right.val))],
        ['gt', new NativeFn([new ArkTypedId('right', ArkNumberTraitType)], ArkBooleanTraitType, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkBoolean(thisVal.val > right.val))],
        ['geq', new NativeFn([new ArkTypedId('right', ArkNumberTraitType)], ArkBooleanTraitType, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkBoolean(thisVal.val >= right.val))],
        ['add', new NativeFn([new ArkTypedId('right', ArkNumberTraitType)], ArkNumberTraitType, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkNumber(thisVal.val + right.val))],
        ['sub', new NativeFn([new ArkTypedId('right', ArkNumberTraitType)], ArkNumberTraitType, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkNumber(thisVal.val - right.val))],
        ['mul', new NativeFn([new ArkTypedId('right', ArkNumberTraitType)], ArkNumberTraitType, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkNumber(thisVal.val * right.val))],
        ['div', new NativeFn([new ArkTypedId('right', ArkNumberTraitType)], ArkNumberTraitType, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkNumber(thisVal.val / right.val))],
        ['mod', new NativeFn([new ArkTypedId('right', ArkNumberTraitType)], ArkNumberTraitType, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkNumber(thisVal.val % right.val))],
        ['exp', new NativeFn([new ArkTypedId('right', ArkNumberTraitType)], ArkNumberTraitType, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkNumber(thisVal.val ** right.val))],
        ['bitwiseAnd', new NativeFn([new ArkTypedId('right', ArkNumberTraitType)], ArkNumberTraitType, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkNumber(thisVal.val & right.val))],
        ['bitwiseOr', new NativeFn([new ArkTypedId('right', ArkNumberTraitType)], ArkNumberTraitType, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkNumber(thisVal.val | right.val))],
        ['bitwiseXor', new NativeFn([new ArkTypedId('right', ArkNumberTraitType)], ArkNumberTraitType, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkNumber(thisVal.val ^ right.val))],
        ['shiftLeft', new NativeFn([new ArkTypedId('right', ArkNumberTraitType)], ArkNumberTraitType, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkNumber(thisVal.val << right.val))],
        ['shiftRight', new NativeFn([new ArkTypedId('right', ArkNumberTraitType)], ArkNumberTraitType, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkNumber(thisVal.val >> right.val))],
        ['shiftRightArith', new NativeFn([new ArkTypedId('right', ArkNumberTraitType)], ArkNumberTraitType, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkNumber(thisVal.val >>> right.val))],
      ],
    )
  }
}

export class ArkStringVal extends ArkConcreteVal<string> {
  type = ArkStringTraitType

  static methods: Map<string, ArkCallable> = new Map([...ArkConcreteVal.methods])

  static {
    ArkStringVal.addMethods(
      [
        ['get', new NativeFn([new ArkTypedId('index', ArkNumberTraitType)], ArkStringTraitType, (thisVal: ArkStringVal, index: ArkNumberVal) => ArkString(thisVal.val[index.val]))],
        ['iter', new NativeFn([], ArkStringTraitType, (thisVal: ArkStringVal) => {
          const str = thisVal.val
          const generator = (function* stringGenerator() {
            for (const elem of str) {
              yield ArkString(elem)
            }
            return ArkNull()
          }())
          return new NativeFn([], ArkStringTraitType, () => generator.next().value)
        })],
      ],
    )
  }
}

class ConcreteInterned {
  constructor() {
    throw new Error('use ConcreteInterned.value, not constructor')
  }

  private static intern: Map<unknown, WeakRef<ArkConcreteVal<unknown>>> = new Map()

  private static registry: FinalizationRegistry<unknown> = new FinalizationRegistry(
    (key) => this.intern.delete(key),
  )

  static value<T extends ArkConcreteVal<U>, U>(TConstructor: new (val: U) => T, rawVal: U): T {
    let ref = ConcreteInterned.intern.get(rawVal)
    let val: T
    if (ref === undefined || ref.deref() === undefined) {
      val = new TConstructor(rawVal)
      ref = new WeakRef(val)
      ConcreteInterned.intern.set(rawVal, ref)
      ConcreteInterned.registry.register(val, rawVal, val)
    } else {
      val = ref.deref()! as T
    }
    return val
  }
}

export function ArkUndefined() {
  return ConcreteInterned.value<ArkUndefinedVal, undefined>(ArkUndefinedVal, undefined)
}
export function ArkNull() {
  return ConcreteInterned.value<ArkNullVal, null>(ArkNullVal, null)
}
export function ArkBoolean(b: boolean) {
  return ConcreteInterned.value<ArkBooleanVal, boolean>(ArkBooleanVal, b)
}
export function ArkNumber(n: number) {
  return ConcreteInterned.value<ArkNumberVal, number>(ArkNumberVal, n)
}
export function ArkString(s: string) {
  return ConcreteInterned.value<ArkStringVal, string>(ArkStringVal, s)
}

export class ArkOperation extends ArkVal {
  constructor(public operation: Operation<ArkVal>) {
    super()
  }
}

export abstract class ArkClosure extends ArkCallable {
  constructor(
    isGenerator: boolean,
    params: ArkTypedId[],
    returnType: ArkType,
    public captures: ArkRef[],
  ) {
    super(isGenerator, params, returnType)
  }

  abstract call(locals: ArkValRef[]): Promise<ArkVal>
}

// ts-unused-exports:disable-next-line
export abstract class ArkGeneratorClosure extends ArkClosure {
  constructor(params: ArkTypedId[], returnType: ArkType, public captures: ArkRef[]) {
    super(true, params, returnType, captures)
  }
}

export class NativeOperation extends ArkCallable {
  constructor(
    params: ArkTypedId[],
    returnType: ArkType,
    public body: (...args: ArkVal[]) => Operation<ArkVal>,
  ) {
    super(false, params, returnType)
  }
}

// ts-unused-exports:disable-next-line
export class NativeAsyncFn<T extends ArkVal[]> extends ArkCallable {
  public body: (...args: [...T]) => Operation<ArkVal>

  constructor(
    params: ArkTypedId[] | undefined,
    returnType: ArkType,
    innerBody: (...args: [...T]) => Promise<ArkVal>,
  ) {
    super(false, params, returnType)
    this.body = (...args: [...T]) => call(() => innerBody(...args))
  }
}

export class ArkStruct extends ArkStructBase {
  static members: Map<string, ArkVal> = new Map()

  constructor(type: ArkType /* FIXME: ArkStructType */, members: Map<string, ArkVal>) {
    super()
    this.members = members
    const memberTypes = new Map<string, ArkMemberType>()
    for (const [k, v] of members) {
      memberTypes.set(k, new ArkMemberType(v.type))
    }
    this.type = type
  }
}

export class NativeStruct extends ArkAbstractStructBase {
  constructor(public obj: object) {
    super()
  }

  getMethod(prop: string): ArkCallable {
    return fromJs((this.obj as {[key: string]: unknown})[prop], this.obj, true) as ArkCallable
  }

  get(prop: string): ArkVal {
    return fromJs((this.obj as {[key: string]: unknown})[prop], this.obj) ?? ArkUndefined()
  }

  set(prop: string, val: ArkVal) {
    (this.obj as {[key: string]: unknown})[prop] = toJs(val)
    return val
  }
}

export const ArkListTraitType = new ArkTraitType('List')
ArkListTraitType.methods = new Map([
  ['len', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType)], ArkNumberTraitType))],
  ['get', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('index', ArkNumberTraitType)], ArkAnyType))],
  ['set', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('index', ArkNumberTraitType), new ArkTypedId('val', ArkAnyType)], ArkListTraitType))],
  ['push', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('item', ArkAnyType)], ArkListTraitType))],
  ['pop', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType)], ArkListTraitType))],
  ['slice', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('from', ArkNumberTraitType), new ArkTypedId('to', ArkNumberTraitType)], ArkListTraitType))],
  ['iter', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType)], new ArkFnType(true, undefined, ArkAnyType)))],
  ['sorted', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType)], ArkListTraitType))],
  // FIXME: This should only work for List<Str>
  ['join', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('sep', ArkStringTraitType)], ArkStringTraitType))],
])
ArkListTraitType.superTraits = new Set([ArkStructTraitType])

export class ArkList extends ArkStructBase {
  static methods: Map<string, ArkCallable> = new Map([...ArkStructBase.methods])

  static {
    ArkList.addMethods([
      ['len', new NativeFn([], ArkNumberTraitType, (thisVal: ArkList) => ArkNumber(thisVal.list.length))],
      ['get', new NativeFn([new ArkTypedId('index', ArkNumberTraitType)], ArkAnyType, (thisVal: ArkList, index: ArkNumberVal) => (thisVal.list[index.val]))],
      ['set', new NativeFn(
        [new ArkTypedId('index', ArkNumberTraitType), new ArkTypedId('val', ArkAnyType)],
        ArkListTraitType,
        (thisVal: ArkList, index: ArkNumberVal, val: ArkVal) => {
          thisVal.list[index.val] = val
          return thisVal
        },
      )],
      ['push', new NativeFn([new ArkTypedId('item', ArkAnyType)], ArkListTraitType, (thisVal: ArkList, item: ArkVal) => {
        thisVal.list.push(item)
        return thisVal
      })],
      ['pop', new NativeFn([], ArkListTraitType, (thisVal: ArkList) => {
        thisVal.list.pop()
        return thisVal
      })],
      ['slice', new NativeFn([new ArkTypedId('from', ArkNumberTraitType), new ArkTypedId('to', ArkNumberTraitType)], ArkListTraitType, (thisVal: ArkList, from: ArkNumberVal, to: ArkNumberVal) => new ArkList(
        // FIXME: type of from and to is Maybe<Num>
        thisVal.list.slice(
          from instanceof ArkNumberVal ? from.val : 0,
          to instanceof ArkNumberVal ? to.val : undefined,
        ),
      ))],
      ['iter', new NativeFn([], new ArkFnType(true, undefined, ArkAnyType), (thisVal: ArkList) => {
        const list = thisVal.list
        const generator = (function* listGenerator() {
          for (const elem of list) {
            yield elem
          }
          return ArkNull()
        }())
        return new NativeFn([], ArkAnyType, () => generator.next().value)
      })],
      ['sorted', new NativeFn([], ArkListTraitType, (thisVal: ArkList) => new ArkList(thisVal.list.map(toJs).toSorted().map((v) => fromJs(v))))],
      // FIXME: This should only work for List<Str>
      ['join', new NativeFn([new ArkTypedId('sep', ArkStringTraitType)], ArkStringTraitType, (thisVal: ArkList, sep: ArkStringVal) => ArkString(thisVal.list.map(toJs).join(sep.val)))],
    ])
  }

  constructor(public list: ArkVal[]) {
    super()
    this.type = ArkListTraitType
  }
}

// Avoid a forward reference to ArkList
ArkStringVal.addMethods([
  ['split', new NativeFn([new ArkTypedId('sep', ArkStringTraitType)], ArkListTraitType, (thisVal: ArkStringVal, sep: ArkStringVal) => new ArkList(thisVal.val.split(sep.val).map((s) => ArkString(s))))],
])

export const ArkMapTraitType = new ArkTraitType('Map')
ArkMapTraitType.methods = new Map([
  ['get', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('index', ArkAnyType)], ArkAnyType))],
  ['set', new ArkMethodType(new ArkFnType(
    false,
    [new ArkTypedId('self', ArkSelfType), new ArkTypedId('index', ArkAnyType), new ArkTypedId('val', ArkAnyType)],
    ArkMapTraitType,
  ))],
  ['delete', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('index', ArkAnyType)], ArkMapTraitType))],
  ['has', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('index', ArkAnyType)], ArkBooleanTraitType))],
  ['iter', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType)], new ArkFnType(true, undefined, ArkAnyType)))],
  ['keys', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType)], new ArkFnType(true, undefined, ArkAnyType)))],
  ['values', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType)], new ArkFnType(true, undefined, ArkAnyType)))],
])
ArkMapTraitType.superTraits = new Set([ArkStructTraitType])

export class ArkMap extends ArkStructBase {
  static methods: Map<string, ArkCallable> = new Map([...ArkStructBase.methods])

  static {
    ArkMap.addMethods([
      ['get', new NativeFn([new ArkTypedId('index', ArkNumberTraitType)], ArkAnyType, (thisVal: ArkMap, index: ArkVal) => thisVal.map.get(index) ?? ArkNull())],
      ['set', new NativeFn(
        [new ArkTypedId('index', ArkAnyType), new ArkTypedId('val', ArkAnyType)],
        ArkMapTraitType,
        (thisVal: ArkMap, index: ArkVal, val: ArkVal) => {
          thisVal.map.set(index, val)
          return thisVal
        },
      )],
      ['delete', new NativeFn([new ArkTypedId('index', ArkAnyType)], ArkMapTraitType, (thisVal: ArkMap, index: ArkVal) => {
        thisVal.map.delete(index)
        return thisVal
      })],
      ['has', new NativeFn([new ArkTypedId('index', ArkAnyType)], ArkBooleanTraitType, (thisVal: ArkMap, index: ArkVal) => ArkBoolean(thisVal.map.has(index)))],
      ['iter', new NativeFn([new ArkTypedId('self', ArkSelfType)], new ArkFnType(false, undefined, ArkAnyType), (thisVal: ArkMap) => {
        const map = thisVal.map
        const generator = (function* mapEntriesGenerator() {
          for (const [key, value] of map.entries()) {
            yield new ArkList([key, value])
          }
          return ArkNull()
        }())
        return new NativeFn([], ArkAnyType, () => generator.next().value)
      })],
      ['keys', new NativeFn([], new ArkFnType(true, undefined, ArkAnyType), (thisVal: ArkMap) => {
        const map = thisVal.map
        const generator = (function* mapKeysGenerator() {
          for (const key of map.keys()) {
            yield key
          }
          return ArkNull()
        }())
        return new NativeFn([], ArkAnyType, () => generator.next().value)
      })],
      ['values', new NativeFn([], new ArkFnType(true, undefined, ArkAnyType), (thisVal: ArkMap) => {
        const map = thisVal.map
        const generator = (function* mapValuesGenerator() {
          for (const value of map.values()) {
            yield value
          }
          return ArkNull()
        }())
        return new NativeFn([], ArkAnyType, () => generator.next().value)
      })],
    ])
  }

  constructor(public map: Map<ArkVal, ArkVal>) {
    super()
    this.type = ArkMapTraitType
  }
}

export abstract class ArkRef {
  abstract get(): ArkVal

  abstract set(val: ArkVal): ArkVal
}

// ts-unused-exports:disable-next-line
export class ArkValRef extends ArkRef {
  constructor(public val: ArkVal = ArkNull()) {
    super()
  }

  get(): ArkVal {
    return this.val
  }

  set(val: ArkVal): ArkVal {
    this.val = val
    return val
  }
}

// ts-unused-exports:disable-next-line
export class ArkPropertyRef extends ArkRef {
  constructor(public obj: ArkAbstractStructBase, public prop: string) {
    super()
  }

  get() {
    const val = this.obj.get(this.prop)
    return val
  }

  set(val: ArkVal) {
    this.obj.set(this.prop, val)
    return val
  }
}

export const globals = new Map<string, ArkVal>([
  // Placeholder (will be set at start-up).
  ['argv', new ArkList([])],

  // Ursa's prelude (see also prelude.ursa).
  ['version', ArkString(programVersion)],
  ['debug', new NativeFn([new ArkTypedId('obj', ArkAnyType)], ArkNullTraitType, (obj) => {
    debug(obj)
    return ArkNull()
  })],
  ['fs', new NativeFn([new ArkTypedId('path', ArkStringTraitType)], ArkAnyType, (path: ArkStringVal) => new NativeStruct(new FsMap(path.val)))],
  // FIXME: type
  ['sleep', new NativeOperation([new ArkTypedId('ms', ArkNumberTraitType)], ArkNullTraitType, function* gen(ms) {
    yield* sleep((ms as ArkNumberVal).val)
    return ArkNull()
  })],
  ['action', new NativeFn(
    [new ArkTypedId('resolve', new ArkFnType(false, undefined, ArkAnyType)), new ArkTypedId('reject', new ArkFnType(false, undefined, ArkAnyType))],
    ArkAnyType,
    function* gen(fn) {
      const result = yield* action(
        toJs(fn) as (resolve: Resolve<unknown>, reject: Reject) => Operation<void>,
      )
      return fromJs(result)
    },
  )],

  // JavaScript bindings—globals (with "use").
  ['js', new ArkStruct(ArkAnyType, new Map([[
    'use', new NativeFn([new ArkTypedId('id', ArkStringTraitType)], ArkAnyType, (arg: ArkStringVal) => {
      const name = arg.val
      // eslint-disable-next-line max-len
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      return fromJs((globalThis as any)[name])
    }),
  ]]))],

  // JavaScript bindings—imported libraries (with "use").
  ['jslib', new ArkStruct(ArkAnyType, new Map([[
    'use', new NativeAsyncFn([new ArkTypedId('id', ArkStringTraitType)], ArkAnyType, async (arg: ArkStringVal) => {
      const importPath = arg.val
      const module: unknown = await import(importPath)
      return fromJs(module)
    }),
  ]]))],
])

// Clone interpreter globals
export const jsGlobals = new ArkStruct(ArkAnyType, new Map())
for (const [k, v] of globals.entries()) {
  jsGlobals.set(k, v)
}

// FFI
class ArkFromJsError extends Error {}

function fromJs(x: unknown, thisObj?: object, asMethod: boolean = false): ArkVal {
  if (x === null || x === undefined) {
    return ArkNull()
  }
  if (typeof x === 'boolean') {
    return ArkBoolean(x)
  }
  if (typeof x === 'number') {
    return ArkNumber(x)
  }
  if (typeof x === 'string') {
    return ArkString(x)
  }
  if (typeof x === 'function') {
    // eslint-disable-next-line max-len
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/ban-types
    const fn: Function = thisObj ? x.bind(thisObj) : x
    if (asMethod) {
      return new NativeAsyncFn(
        undefined,
        ArkAnyType,
        async (_this, ...args) => fromJs(await fn(...args.map(toJs))),
      )
    }
    return new NativeAsyncFn(
      undefined,
      ArkAnyType,
      async (...args) => fromJs(await fn(...args.map(toJs))),
    )
  }
  if (x instanceof Array) {
    return new ArkList(x.map((e) => fromJs(e)))
  }
  if (x instanceof Map) {
    const map = new Map<ArkVal, ArkVal>()
    for (const [k, v] of x) {
      map.set(fromJs(k), fromJs(v))
    }
    return new ArkMap(map)
  }
  if (typeof x === 'object') {
    return new NativeStruct(x)
  }
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  throw new ArkFromJsError(`Cannot convert JavaScript value ${x}`)
}

export function toJs(val: ArkVal): unknown {
  if (val instanceof ArkConcreteVal) {
    return val.val
  } else if (val instanceof ArkStruct) {
    const obj: {[key: string]: unknown} = {}
    for (const [k, v] of (val.constructor as typeof ArkStructBase).methods) {
      obj[k] = toJs(v)
    }
    for (const [k, v] of val.members) {
      obj[k] = toJs(v)
    }
    return obj
  } else if (val instanceof ArkMap) {
    const jsMap = new Map<unknown, unknown>()
    for (const [k, v] of val.map) {
      jsMap.set(toJs(k), toJs(v))
    }
    return jsMap
  } else if (val instanceof ArkList) {
    return val.list.map(toJs)
  } else if (val instanceof ArkClosure) {
    return async (...args: unknown[]) => {
      const locals = args.map((arg) => new ArkValRef(fromJs(arg)))
      return val.call(locals)
    }
  } else if (val instanceof NativeFn || val instanceof NativeAsyncFn) {
    return async (...args: unknown[]) => toJs(
      await run(() => val.body(...args.map((arg) => fromJs(arg)))),
    )
  }
  return val
}

export const globalTypes = new Map<string, ArkType>([
  ['Unknown', ArkUnknownType],
  ['Any', ArkAnyType],
  ['Null', ArkNullTraitType],
  ['Bool', ArkBooleanTraitType],
  ['Num', ArkNumberTraitType],
  ['Str', ArkStringTraitType],

  ['Struct', ArkStructTraitType],
  ['List', ArkListTraitType],
  ['Map', ArkMapTraitType],
  ['Fn', new ArkFnType(false, undefined, ArkAnyType)],

  // TODO: implement union types.
  ['Union', new ArkUnionType(new Set())],
])

// Re-export types from type.js for standalone scripts, which import only
// from this module.
// ts-unused-exports:disable-next-line
export {ArkUnknownType, ArkAnyType} from './type.js'
