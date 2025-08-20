// Compiled Ark values.
// © Reuben Thomas 2023-2025
// Released under the MIT license.

import {
  action, call, Operation, Reject, Resolve, run, sleep,
} from 'effection'

import {
  ArkFnType, ArkType, ArkTypedId, ArkTrait, ArkUnionType,
  ArkMethodType, ArkAnyType, ArkSelfType, ArkUnknownType,
  ArkStructType, ArkTypeVariable, ArkEnumType, ArkUndefinedType,
  ArkImpl, ArkTypeConstant,
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

export class ArkVal {
  type: ArkType = ArkAnyType
}

export abstract class ArkAbstractStruct extends ArkVal {
  abstract get(prop: string): ArkVal

  abstract set(prop: string, val: ArkVal): ArkVal

  getMethod(name: string): ArkCallable | undefined {
    return this.type.getMethod(name)
  }
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

export abstract class ArkConcreteVal<T> extends ArkAbstractStruct {
  constructor(public val: T) {
    super()
  }

  public get(_prop: string) {
    return ArkUndefined()
  }

  public set(_prop: string, val: ArkVal) {
    return val
  }
}

export const ArkBooleanType = new ArkStructType('Bool', new Map())

const EqTrait = new ArkTrait('Eq', new Map([
  ['equals', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkBooleanType))],
  ['notEquals', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkBooleanType))],
]))

export const ArkNullType = new ArkStructType('Null', new Map())

export class ArkNullVal extends ArkConcreteVal<null> {
  type = ArkNullType

  constructor() {
    super(null)
  }
}

export class ArkBooleanVal extends ArkConcreteVal<boolean> {
  type = ArkBooleanType
}

const EqImpl = new ArkImpl(new Map(
  [
    ['equals', new NativeFn([new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkBooleanType, (thisVal, right) => ArkBoolean(thisVal === right))],
    ['notEquals', new NativeFn([new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkBooleanType, (thisVal, right) => ArkBoolean(thisVal !== right))],
  ],
))
const ConcreteEqImpl = new ArkImpl(new Map(
  [
    ['equals', new NativeFn([new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkBooleanType, (thisVal: ArkConcreteVal<unknown>, right: ArkVal) => ArkBoolean(thisVal.val === toJs(right)))],
    ['notEquals', new NativeFn([new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkBooleanType, (thisVal: ArkConcreteVal<unknown>, right: ArkVal) => ArkBoolean(thisVal.val !== toJs(right)))],
  ],
))

// Now we have set up super-class methods, wire up ArkNull & ArkBoolean
ArkNullType.implement(EqTrait, ConcreteEqImpl)
ArkBooleanType.implement(EqTrait, ConcreteEqImpl)
ArkBooleanType.implement(
  new ArkTrait('BooleanTrait', new Map([
    ['not', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType)], ArkBooleanType))],
  ])),
  new ArkImpl(new Map([
    ['not', new NativeFn([new ArkTypedId('self', ArkSelfType)], ArkBooleanType, (thisVal: ArkBooleanVal) => ArkBoolean(!thisVal.val))],
  ])),
)

// ts-unused-exports:disable-next-line
export class ArkUndefinedVal extends ArkConcreteVal<undefined> {
  type = ArkUnknownType

  constructor() {
    super(undefined)
  }
}

export const ArkOptionType = new ArkEnumType(
  'Option',
  new Map([
    ['None', ArkUndefinedType],
    ['Some', new ArkTypeVariable('T')],
  ]),
  undefined,
  new Map([['T', ArkUnknownType]]),
)

export const ArkStringType = new ArkStructType('Str', new Map())

export const ArkNumberType = new ArkStructType('Num', new Map())
ArkNumberType.implement(EqTrait, ConcreteEqImpl)

export class ArkNumberVal extends ArkConcreteVal<number> {
  type = ArkNumberType
}

ArkNumberType.implement(
  new ArkTrait('NumberTrait',
    new Map([
      ['toString', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType)], ArkStringType))],
      ['pos', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType)], ArkNumberType))],
      ['neg', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType)], ArkNumberType))],
      ['bitwiseNot', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType)], ArkNumberType))],
      ['lt', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkBooleanType))],
      ['leq', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkBooleanType))],
      ['gt', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkBooleanType))],
      ['geq', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkBooleanType))],
      ['add', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkNumberType))],
      ['sub', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkNumberType))],
      ['mul', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkNumberType))],
      ['div', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkNumberType))],
      ['mod', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkNumberType))],
      ['exp', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkNumberType))],
      ['bitwiseAnd', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkNumberType))],
      ['bitwiseOr', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkNumberType))],
      ['bitwiseXor', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkNumberType))],
      ['shiftLeft', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkNumberType))],
      ['shiftRight', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkNumberType))],
      ['shiftRightArith', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkSelfType)], ArkNumberType))],
    ])
  ),
  new ArkImpl(new Map([
    ['toString', new NativeFn([new ArkTypedId('self', ArkSelfType)], ArkNumberType, (thisVal: ArkNumberVal) => ArkString(thisVal.val.toString()))],
    ['pos', new NativeFn([new ArkTypedId('self', ArkSelfType)], ArkNumberType, (thisVal: ArkNumberVal) => ArkNumber(+thisVal.val))],
    ['neg', new NativeFn([new ArkTypedId('self', ArkSelfType)], ArkNumberType, (thisVal: ArkNumberVal) => ArkNumber(-thisVal.val))],
    ['bitwiseNot', new NativeFn([new ArkTypedId('self', ArkSelfType)], ArkNumberType, (thisVal: ArkNumberVal) => ArkNumber(~thisVal.val))],
    ['lt', new NativeFn([new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkNumberType)], ArkBooleanType, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkBoolean(thisVal.val < right.val))],
    ['leq', new NativeFn([new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkNumberType)], ArkBooleanType, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkBoolean(thisVal.val <= right.val))],
    ['gt', new NativeFn([new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkNumberType)], ArkBooleanType, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkBoolean(thisVal.val > right.val))],
    ['geq', new NativeFn([new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkNumberType)], ArkBooleanType, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkBoolean(thisVal.val >= right.val))],
    ['add', new NativeFn([new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkNumberType)], ArkNumberType, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkNumber(thisVal.val + right.val))],
    ['sub', new NativeFn([new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkNumberType)], ArkNumberType, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkNumber(thisVal.val - right.val))],
    ['mul', new NativeFn([new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkNumberType)], ArkNumberType, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkNumber(thisVal.val * right.val))],
    ['div', new NativeFn([new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkNumberType)], ArkNumberType, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkNumber(thisVal.val / right.val))],
    ['mod', new NativeFn([new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkNumberType)], ArkNumberType, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkNumber(thisVal.val % right.val))],
    ['exp', new NativeFn([new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkNumberType)], ArkNumberType, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkNumber(thisVal.val ** right.val))],
    ['bitwiseAnd', new NativeFn([new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkNumberType)], ArkNumberType, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkNumber(thisVal.val & right.val))],
    ['bitwiseOr', new NativeFn([new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkNumberType)], ArkNumberType, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkNumber(thisVal.val | right.val))],
    ['bitwiseXor', new NativeFn([new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkNumberType)], ArkNumberType, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkNumber(thisVal.val ^ right.val))],
    ['shiftLeft', new NativeFn([new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkNumberType)], ArkNumberType, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkNumber(thisVal.val << right.val))],
    ['shiftRight', new NativeFn([new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkNumberType)], ArkNumberType, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkNumber(thisVal.val >> right.val))],
    ['shiftRightArith', new NativeFn([new ArkTypedId('self', ArkSelfType), new ArkTypedId('right', ArkNumberType)], ArkNumberType, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkNumber(thisVal.val >>> right.val))],
  ])),
)


export class ArkStringVal extends ArkConcreteVal<string> {
  type = ArkStringType
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

  abstract call(locals: ArkRef[]): Promise<ArkVal>
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

export class ArkStruct extends ArkAbstractStruct {
  constructor(public type: ArkStructType | ArkTypeConstant, public members: Map<string, ArkVal> = new Map()) {
    super()
    const memberTypes = new Map<string, ArkType>()
    for (const [name, ty] of members) {
      memberTypes.set(name, ty.type)
    }
  }

  get(prop: string) {
    return this.members.get(prop) ?? ArkUndefined()
  }

  set(prop: string, val: ArkVal) {
    this.members.set(prop, val)
    return val
  }

}

export class NativeStruct extends ArkAbstractStruct {
  constructor(public obj: object) {
    super()
  }

  // FIXME: return type could be undefined
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

export const ArkListType = new ArkStructType('List', new Map(), new Map([['T', ArkUnknownType]]))
ArkListType.implement(EqTrait, EqImpl)

export class ArkList extends ArkStruct {
  constructor(public list: ArkVal[]) {
    let elemType: ArkType = ArkAnyType // FIXME ArkUnknownType
    if (list.length > 0) {
      elemType = list[0].type
    }
    super(ArkListType.instantiate(new Map([['T', elemType]])))
  }
}

// Avoid a forward reference to ArkList
ArkStringType.implement(
  new ArkTrait('StringTrait',
    new Map([
      ['get', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('index', ArkNumberType)], ArkStringType))],
      ['iter', new ArkMethodType(
        new ArkFnType(
          true,
          [new ArkTypedId('self', ArkSelfType)],
          ArkOptionType.instantiate(new Map([['T', ArkStringType]])),
        ),
      )],
      // FIXME: List<Str> in next line
      ['split', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType)], ArkListType))]
    ])
  ),
  new ArkImpl(new Map<string, ArkCallable>([
    ['get', new NativeFn([new ArkTypedId('self', ArkSelfType), new ArkTypedId('index', ArkNumberType)], ArkStringType, (thisVal: ArkStringVal, index: ArkNumberVal) => ArkString(thisVal.val[index.val]))],
    ['iter', new NativeFn([new ArkTypedId('self', ArkSelfType),], ArkStringType, (thisVal: ArkStringVal) => {
      const str = thisVal.val
      const generator = (function* stringGenerator() {
        for (const elem of str) {
          yield ArkString(elem)
        }
        return ArkNull()
      }())
      return new NativeFn([], ArkStringType, () => generator.next().value)
    })],
    // FIXME: List<Str> type in next line
    ['split', new NativeFn([new ArkTypedId('self', ArkSelfType), new ArkTypedId('sep', ArkStringType)], ArkListType, (thisVal: ArkStringVal, sep: ArkStringVal) => new ArkList(thisVal.val.split(sep.val).map((s) => ArkString(s))))],
  ])),
)

ArkListType.implement(
  new ArkTrait(
    'ListTrait',
    new Map([
      ['len', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType)], ArkNumberType))],
      ['get', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('index', ArkNumberType)], new ArkTypeVariable('T'), new Map([['T', ArkUnknownType]])))],
      ['set', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('index', ArkNumberType), new ArkTypedId('val', new ArkTypeVariable('T'))], ArkSelfType, new Map([['T', ArkUnknownType]])))],
      ['push', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('item', new ArkTypeVariable('T'))], ArkSelfType, new Map([['T', ArkUnknownType]])))],
      ['pop', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType)], ArkSelfType))],
      ['slice', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('from', ArkNumberType), new ArkTypedId('to', ArkNumberType)], ArkSelfType))],
      ['iter', new ArkMethodType(
        new ArkFnType(
          false,
          [new ArkTypedId('self', ArkSelfType)],
          new ArkFnType(
            true,
            undefined,
            ArkOptionType.instantiate(new Map([['T', new ArkTypeVariable('T')]])),
            new Map([['T', ArkUnknownType]]),
          ),
          new Map([['T', ArkUnknownType]]),
        ),
      )],
      ['sorted', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType)], ArkSelfType))],
      // FIXME: This should only work for List<Str>
      ['join', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('sep', ArkStringType)], ArkStringType))],
    ]),
  ),
  new ArkImpl(new Map<string, ArkCallable>([
    ['len', new NativeFn([new ArkTypedId('self', ArkSelfType),], ArkNumberType, (thisVal: ArkList) => ArkNumber(thisVal.list.length))],
    ['get', new NativeFn([new ArkTypedId('self', ArkSelfType), new ArkTypedId('index', ArkNumberType)], new ArkTypeVariable('T'), (thisVal: ArkList, index: ArkNumberVal) => (thisVal.list[index.val]))],
    ['set', new NativeFn(
      [new ArkTypedId('self', ArkSelfType), new ArkTypedId('index', ArkNumberType), new ArkTypedId('val', new ArkTypeVariable('T'))],
      ArkSelfType,
      (thisVal: ArkList, index: ArkNumberVal, val: ArkVal) => {
        thisVal.list[index.val] = val
        return thisVal
      },
    )],
    ['push', new NativeFn([new ArkTypedId('self', ArkSelfType), new ArkTypedId('item', new ArkTypeVariable('T'))], ArkSelfType, (thisVal: ArkList, item: ArkVal) => {
      thisVal.list.push(item)
      return thisVal
    })],
    ['pop', new NativeFn([new ArkTypedId('self', ArkSelfType),], ArkSelfType, (thisVal: ArkList) => {
      thisVal.list.pop()
      return thisVal
    })],
    ['slice', new NativeFn([new ArkTypedId('self', ArkSelfType), new ArkTypedId('from', ArkNumberType), new ArkTypedId('to', ArkNumberType)], ArkSelfType, (thisVal: ArkList, from: ArkNumberVal, to: ArkNumberVal) => new ArkList(
      // FIXME: type of from and to is Maybe<Num>
      thisVal.list.slice(
        from instanceof ArkNumberVal ? from.val : 0,
        to instanceof ArkNumberVal ? to.val : undefined,
      ),
    ))],
    ['iter', new NativeFn([new ArkTypedId('self', ArkSelfType),], new ArkFnType(true, undefined, new ArkTypeVariable('T')), (thisVal: ArkList) => {
      const list = thisVal.list
      const generator = (function* listGenerator() {
        for (const elem of list) {
          yield elem
        }
        return ArkNull()
      }())
      return new NativeFn([], new ArkTypeVariable('T'), () => generator.next().value)
    })],
    ['sorted', new NativeFn([new ArkTypedId('self', ArkSelfType),], ArkSelfType, (thisVal: ArkList) => new ArkList(thisVal.list.map(toJs).toSorted().map((v) => fromJs(v))))],
    // FIXME: This should only work for List<Str>
    ['join', new NativeFn([new ArkTypedId('self', ArkSelfType), new ArkTypedId('sep', ArkStringType)], ArkStringType, (thisVal: ArkList, sep: ArkStringVal) => ArkString(thisVal.list.map(toJs).join(sep.val)))],
  ])))

export const ArkMapType = new ArkStructType('Map', new Map(), new Map([['K', ArkUnknownType], ['V', ArkUnknownType]]))
ArkMapType.implement(EqTrait, EqImpl)
ArkMapType.implement(
  new ArkTrait(
    'MapTrait',
    new Map([
      ['get', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('index', new ArkTypeVariable('K'))], new ArkTypeVariable('V')))],
      ['set', new ArkMethodType(new ArkFnType(
        false,
        [new ArkTypedId('self', ArkSelfType), new ArkTypedId('index', new ArkTypeVariable('K')), new ArkTypedId('val', new ArkTypeVariable('V'))],
        ArkMapType,
      ))],
      ['delete', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('index', new ArkTypeVariable('K'))], ArkMapType))],
      ['has', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType), new ArkTypedId('index', new ArkTypeVariable('K'))], ArkBooleanType))],
      ['iter', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType)], new ArkFnType(true, undefined, ArkAnyType)))],
      ['keys', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType)], new ArkFnType(true, undefined, ArkAnyType)))],
      ['values', new ArkMethodType(new ArkFnType(false, [new ArkTypedId('self', ArkSelfType)], new ArkFnType(true, undefined, ArkAnyType)))],
    ]),
  ),
  new ArkImpl(new Map([
    ['get', new NativeFn([new ArkTypedId('self', ArkSelfType), new ArkTypedId('index', new ArkTypeVariable('K'))], new ArkTypeVariable('V'), (thisVal: ArkMap, index: ArkVal) => thisVal.map.get(index) ?? ArkNull())],
    ['set', new NativeFn(
      [new ArkTypedId('self', ArkSelfType), new ArkTypedId('index', new ArkTypeVariable('K')), new ArkTypedId('val', new ArkTypeVariable('V'))],
      ArkMapType,
      (thisVal: ArkMap, index: ArkVal, val: ArkVal) => {
        thisVal.map.set(index, val)
        return thisVal
      },
    )],
    ['delete', new NativeFn([new ArkTypedId('self', ArkSelfType), new ArkTypedId('index', new ArkTypeVariable('K'))], ArkSelfType, (thisVal: ArkMap, index: ArkVal) => {
      thisVal.map.delete(index)
      return thisVal
    })],
    ['has', new NativeFn([new ArkTypedId('self', ArkSelfType), new ArkTypedId('index', new ArkTypeVariable('K'))], ArkBooleanType, (thisVal: ArkMap, index: ArkVal) => ArkBoolean(thisVal.map.has(index)))],
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
    ['keys', new NativeFn([new ArkTypedId('self', ArkSelfType),], new ArkFnType(true, undefined, ArkAnyType), (thisVal: ArkMap) => {
      const map = thisVal.map
      const generator = (function* mapKeysGenerator() {
        for (const key of map.keys()) {
          yield key
        }
        return ArkNull()
      }())
      return new NativeFn([], ArkAnyType, () => generator.next().value)
    })],
    ['values', new NativeFn([new ArkTypedId('self', ArkSelfType),], new ArkFnType(true, undefined, ArkAnyType), (thisVal: ArkMap) => {
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
  ))
ArkMapType.implement(EqTrait, EqImpl)

export class ArkMap extends ArkStruct {
  constructor(public map: Map<ArkVal, ArkVal>) {
    super(ArkMapType)
  }
}

export class ArkRef {
  constructor(public val: ArkVal = ArkNull()) {}

  get(): ArkVal {
    return this.val
  }

  set(val: ArkVal): ArkVal {
    this.val = val
    return val
  }
}

export const globals = new Map<string, ArkVal>([
  // Placeholder (will be set at start-up).
  ['argv', new ArkList([])],

  // Ursa's prelude (see also prelude.ursa).
  ['version', ArkString(programVersion)],
  ['debug', new NativeFn([new ArkTypedId('obj', ArkAnyType)], ArkNullType, (obj) => {
    debug(obj)
    return ArkNull()
  })],
  ['fs', new NativeFn([new ArkTypedId('path', ArkStringType)], ArkAnyType, (path: ArkStringVal) => new NativeStruct(new FsMap(path.val)))],
  // FIXME: type
  ['sleep', new NativeOperation([new ArkTypedId('ms', ArkNumberType)], ArkNullType, function* gen(ms) {
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
    'use', new NativeFn([new ArkTypedId('id', ArkStringType)], ArkAnyType, (arg: ArkStringVal) => {
      const name = arg.val
      // eslint-disable-next-line max-len
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      return fromJs((globalThis as any)[name])
    }),
  ]]))],

  // JavaScript bindings—imported libraries (with "use").
  ['jslib', new ArkStruct(ArkAnyType, new Map([[
    'use', new NativeAsyncFn([new ArkTypedId('id', ArkStringType)], ArkAnyType, async (arg: ArkStringVal) => {
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
  } else if (val instanceof ArkMap) {
    const jsMap = new Map<unknown, unknown>()
    for (const [k, v] of val.map) {
      jsMap.set(toJs(k), toJs(v))
    }
    return jsMap
  } else if (val instanceof ArkList) {
    return val.list.map(toJs)
  } else if (val instanceof ArkStruct) {
    const obj: {[key: string]: unknown} = {}
    for (const [_, impl] of val.type.impls) {
      for (const [name, method] of impl.methods) {
        obj[name] = toJs(method)
      }
    }
    for (const [k, v] of val.members) {
      obj[k] = toJs(v)
    }
    return obj
  } else if (val instanceof ArkClosure) {
    return async (...args: unknown[]) => {
      const locals = args.map((arg) => new ArkRef(fromJs(arg)))
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
  ['Null', ArkNullType],
  ['Bool', ArkBooleanType],
  ['Num', ArkNumberType],
  ['Str', ArkStringType],

  ['Struct', new ArkStructType('Struct', new Map())],
  ['List', ArkListType],
  ['Map', ArkMapType],
  ['Fn', new ArkFnType(false, undefined, ArkAnyType)],
  ['Union', new ArkUnionType(new Set())],
])

export function typeToStr(ty: ArkType) {
  switch (ty) {
    case ArkUnknownType:
      return 'Unknown'
    case ArkAnyType:
      return 'Any'
    default:
  }
  if (ty instanceof ArkFnType) {
    return 'Fn'
  } else if (ty instanceof ArkUnionType) {
    return 'Union'
  } else if (ty instanceof ArkStructType || ty instanceof ArkTrait) {
    return ty.name
  }
  debug(ty)
  throw new Error('unknown type')
}

// Re-export types from type.js for standalone scripts, which import only
// from this module.
// ts-unused-exports:disable-next-line
export {ArkUnknownType, ArkAnyType} from './type.js'
