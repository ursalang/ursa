// Compiled Ark values.
// © Reuben Thomas 2023-2025
// Released under the MIT license.

import {
  action, call, Operation, Reject, Resolve, run, sleep,
} from 'effection'

import {ArkFnType, ArkType, ArkUnionType} from './type.js'
import {FsMap} from './fsmap.js'
import programVersion from '../version.js'
import {Class, debug} from './util.js'
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
  type: ArkType = this.constructor as Class<ArkVal>
}

export abstract class ArkAbstractObjectBase extends ArkVal {
  abstract getMethod(prop: string): ArkCallable | undefined

  abstract get(prop: string): ArkVal

  abstract set(prop: string, val: ArkVal): ArkVal
}

export abstract class ArkCallable extends ArkVal {
  constructor(public params: ArkTypedId[] | undefined, public returnType: ArkType) {
    super()
    this.type = new ArkFnType(this.constructor as Class<ArkCallable>, this.params, this.returnType)
  }
}

export class ArkContinuation extends ArkCallable {
  public done = false

  constructor(public state: ArkState) {
    super([new ArkTypedId('x', ArkVal)], ArkVal) // FIXME: correct type
  }
}

export class NativeFn<T extends ArkVal[]> extends ArkCallable {
  public body: (...args: [...T]) => Operation<ArkVal>

  constructor(
    params: ArkTypedId[] | undefined,
    returnType: ArkType,
    innerBody: (...args: [...T]) => ArkVal | Operation<ArkVal>,
  ) {
    super(params, returnType)
    if (isGeneratorFunction(innerBody)) {
      this.body = innerBody as (...args: [...T]) => Operation<ArkVal>
    } else {
      // eslint-disable-next-line require-yield
      this.body = function* gen(...args: [...T]) {
        return innerBody(...args)
      } as (...args: [...T]) => Operation<ArkVal>
    }
    this.type = new ArkFnType(NativeFn, params, returnType)
  }
}

export class ArkObjectBase extends ArkAbstractObjectBase {
  public properties: Map<string, ArkVal> = new Map()

  public static methods = new Map<string, ArkCallable>()

  static addMethods(methods: [string, ArkCallable][]) {
    methods.forEach(([name, val]) => this.methods.set(name, val))
  }

  getMethod(prop: string): ArkCallable | undefined {
    return (this.constructor as typeof ArkObjectBase).methods.get(prop)
  }

  get(prop: string) {
    return this.properties.get(prop) ?? ArkUndefined()
  }

  set(prop: string, val: ArkVal) {
    this.properties.set(prop, val)
    return val
  }
}

export abstract class ArkConcreteVal<T> extends ArkObjectBase {
  constructor(public val: T) {
    super()
  }
}

export class ArkNullVal extends ArkConcreteVal<null> {
  constructor() {
    super(null)
  }
}

export class ArkBooleanVal extends ArkConcreteVal<boolean> {}

// Avoid forward reference to ArkBooleanVal
ArkObjectBase.methods = new Map<string, ArkCallable>(
  [
    ['equals', new NativeFn([new ArkTypedId('right', ArkObjectBase)], ArkBooleanVal, (thisVal, right) => ArkBoolean(thisVal === right))],
    ['notEquals', new NativeFn([new ArkTypedId('right', ArkObjectBase)], ArkBooleanVal, (thisVal, right) => ArkBoolean(thisVal !== right))],
  ],
)
ArkConcreteVal.methods = new Map<string, ArkCallable>(
  [
    ['equals', new NativeFn([new ArkTypedId('right', ArkConcreteVal<unknown>)], ArkBooleanVal, (thisVal: ArkConcreteVal<unknown>, right: ArkVal) => ArkBoolean(thisVal.val === toJs(right)))],
    ['notEquals', new NativeFn([new ArkTypedId('right', ArkConcreteVal<unknown>)], ArkBooleanVal, (thisVal: ArkConcreteVal<unknown>, right: ArkVal) => ArkBoolean(thisVal.val !== toJs(right)))],
  ],
)

// Now we have set up super-class methods, wire up ArkBoolean
ArkBooleanVal.methods = new Map([...ArkConcreteVal.methods, ['not', new NativeFn([], ArkBooleanVal, (thisVal: ArkBooleanVal) => ArkBoolean(!thisVal.val))]])

export class ArkUndefinedVal extends ArkConcreteVal<undefined> {
  static methods: Map<string, ArkCallable> = new Map([...ArkConcreteVal.methods])

  constructor() {
    super(undefined)
  }
}

export class ArkNumberVal extends ArkConcreteVal<number> {
  static methods: Map<string, ArkCallable> = new Map([...ArkConcreteVal.methods])

  static {
    ArkNumberVal.addMethods(
      [
        ['toString', new NativeFn([], ArkNumberVal, (thisVal: ArkNumberVal) => ArkString(thisVal.val.toString()))],
        ['pos', new NativeFn([], ArkNumberVal, (thisVal: ArkNumberVal) => ArkNumber(+thisVal.val))],
        ['neg', new NativeFn([], ArkNumberVal, (thisVal: ArkNumberVal) => ArkNumber(-thisVal.val))],
        ['bitwiseNot', new NativeFn([], ArkNumberVal, (thisVal: ArkNumberVal) => ArkNumber(~thisVal.val))],
        ['lt', new NativeFn([new ArkTypedId('right', ArkNumberVal)], ArkBooleanVal, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkBoolean(thisVal.val < right.val))],
        ['leq', new NativeFn([new ArkTypedId('right', ArkNumberVal)], ArkBooleanVal, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkBoolean(thisVal.val <= right.val))],
        ['gt', new NativeFn([new ArkTypedId('right', ArkNumberVal)], ArkBooleanVal, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkBoolean(thisVal.val > right.val))],
        ['geq', new NativeFn([new ArkTypedId('right', ArkNumberVal)], ArkBooleanVal, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkBoolean(thisVal.val >= right.val))],
        ['add', new NativeFn([new ArkTypedId('right', ArkNumberVal)], ArkNumberVal, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkNumber(thisVal.val + right.val))],
        ['sub', new NativeFn([new ArkTypedId('right', ArkNumberVal)], ArkNumberVal, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkNumber(thisVal.val - right.val))],
        ['mul', new NativeFn([new ArkTypedId('right', ArkNumberVal)], ArkNumberVal, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkNumber(thisVal.val * right.val))],
        ['div', new NativeFn([new ArkTypedId('right', ArkNumberVal)], ArkNumberVal, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkNumber(thisVal.val / right.val))],
        ['mod', new NativeFn([new ArkTypedId('right', ArkNumberVal)], ArkNumberVal, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkNumber(thisVal.val % right.val))],
        ['exp', new NativeFn([new ArkTypedId('right', ArkNumberVal)], ArkNumberVal, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkNumber(thisVal.val ** right.val))],
        ['bitwiseAnd', new NativeFn([new ArkTypedId('right', ArkNumberVal)], ArkNumberVal, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkNumber(thisVal.val & right.val))],
        ['bitwiseOr', new NativeFn([new ArkTypedId('right', ArkNumberVal)], ArkNumberVal, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkNumber(thisVal.val | right.val))],
        ['bitwiseXor', new NativeFn([new ArkTypedId('right', ArkNumberVal)], ArkNumberVal, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkNumber(thisVal.val ^ right.val))],
        ['shiftLeft', new NativeFn([new ArkTypedId('right', ArkNumberVal)], ArkNumberVal, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkNumber(thisVal.val << right.val))],
        ['shiftRight', new NativeFn([new ArkTypedId('right', ArkNumberVal)], ArkNumberVal, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkNumber(thisVal.val >> right.val))],
        ['shiftRightArith', new NativeFn([new ArkTypedId('right', ArkNumberVal)], ArkNumberVal, (thisVal: ArkNumberVal, right: ArkNumberVal) => ArkNumber(thisVal.val >>> right.val))],
      ],
    )
  }
}
export class ArkStringVal extends ArkConcreteVal<string> {
  static methods: Map<string, ArkCallable> = new Map([...ArkConcreteVal.methods])

  static {
    ArkStringVal.addMethods(
      [
        ['get', new NativeFn([new ArkTypedId('index', ArkNumberVal)], ArkStringVal, (thisVal: ArkStringVal, index: ArkNumberVal) => ArkString(thisVal.val[index.val]))],
        ['iter', new NativeFn([], ArkStringVal, (thisVal: ArkStringVal) => {
          const str = thisVal.val
          const generator = (function* stringGenerator() {
            for (const elem of str) {
              yield ArkString(elem)
            }
            return ArkNull()
          }())
          return new NativeFn([], ArkStringVal, () => generator.next().value)
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
  constructor(params: ArkTypedId[], returnType: ArkType, public captures: ArkRef[]) {
    super(params, returnType)
  }

  abstract call(locals: ArkValRef[]): Promise<ArkVal>
}
// ts-unused-exports:disable-next-line
export abstract class ArkGeneratorClosure extends ArkClosure {}

export class NativeOperation extends ArkCallable {
  constructor(
    params: ArkTypedId[],
    returnType: ArkType,
    public body: (...args: ArkVal[]) => Operation<ArkVal>,
  ) {
    super(params, returnType)
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
    super(params, returnType)
    this.body = (...args: [...T]) => call(() => innerBody(...args))
  }
}

export class ArkObject extends ArkObjectBase {
  static properties: Map<string, ArkVal> = new Map()

  constructor(properties: Map<string, ArkVal>) {
    super()
    this.properties = properties
    this.type = ArkObject
  }
}

export class NativeObject extends ArkAbstractObjectBase {
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

export class ArkList extends ArkObjectBase {
  static methods: Map<string, ArkCallable> = new Map([...ArkObjectBase.methods])

  static {
    ArkList.addMethods([
      ['len', new NativeFn([new ArkTypedId('len', ArkNumberVal)], ArkNumberVal, (thisVal: ArkList) => ArkNumber(thisVal.list.length))],
      ['get', new NativeFn([new ArkTypedId('index', ArkNumberVal)], ArkVal, (thisVal: ArkList, index: ArkNumberVal) => (thisVal.list[index.val]))],
      ['set', new NativeFn(
        [new ArkTypedId('index', ArkNumberVal), new ArkTypedId('val', ArkVal)],
        ArkList,
        (thisVal: ArkList, index: ArkNumberVal, val: ArkVal) => {
          thisVal.list[index.val] = val
          return thisVal
        },
      )],
      ['push', new NativeFn([new ArkTypedId('item', ArkVal)], ArkList, (thisVal: ArkList, item: ArkVal) => {
        thisVal.list.push(item)
        return thisVal
      })],
      ['pop', new NativeFn([], ArkList, (thisVal: ArkList) => {
        thisVal.list.pop()
        return thisVal
      })],
      ['slice', new NativeFn([new ArkTypedId('from', ArkNumberVal), new ArkTypedId('to', ArkNumberVal)], ArkList, (thisVal: ArkList, from: ArkNumberVal, to: ArkNumberVal) => new ArkList(
        // FIXME: type of from and to is Maybe<Num>
        thisVal.list.slice(
          from instanceof ArkNumberVal ? from.val : 0,
          to instanceof ArkNumberVal ? to.val : undefined,
        ),
      ))],
      ['iter', new NativeFn([], ArkCallable, (thisVal: ArkList) => {
        const list = thisVal.list
        const generator = (function* listGenerator() {
          for (const elem of list) {
            yield elem
          }
          return ArkNull()
        }())
        return new NativeFn([], ArkVal, () => generator.next().value)
      })],
      ['sorted', new NativeFn([], ArkList, (thisVal: ArkList) => new ArkList(thisVal.list.map(toJs).toSorted().map((v) => fromJs(v))))],
      // FIXME: This should only work for List<Str>
      ['join', new NativeFn([new ArkTypedId('sep', ArkStringVal)], ArkStringVal, (thisVal: ArkList, sep: ArkStringVal) => ArkString(thisVal.list.map(toJs).join(sep.val)))],
    ])
  }

  constructor(public list: ArkVal[]) {
    super()
  }
}

// Avoid a forward reference to ArkList
ArkStringVal.addMethods([
  ['split', new NativeFn([new ArkTypedId('sep', ArkStringVal)], ArkList, (thisVal: ArkStringVal, sep: ArkStringVal) => new ArkList(thisVal.val.split(sep.val).map((s) => ArkString(s))))],
])

export class ArkMap extends ArkObjectBase {
  static methods: Map<string, ArkCallable> = new Map([...ArkObjectBase.methods])

  static {
    ArkMap.addMethods([
      ['get', new NativeFn([new ArkTypedId('index', ArkNumberVal)], ArkVal, (thisVal: ArkMap, index: ArkVal) => thisVal.map.get(index) ?? ArkNull())],
      ['set', new NativeFn(
        [new ArkTypedId('index', ArkVal), new ArkTypedId('val', ArkVal)],
        ArkMap,
        (thisVal: ArkMap, index: ArkVal, val: ArkVal) => {
          thisVal.map.set(index, val)
          return thisVal
        },
      )],
      ['delete', new NativeFn([new ArkTypedId('index', ArkVal)], ArkMap, (thisVal: ArkMap, index: ArkVal) => {
        thisVal.map.delete(index)
        return thisVal
      })],
      ['has', new NativeFn([new ArkTypedId('index', ArkVal)], ArkBooleanVal, (thisVal: ArkMap, index: ArkVal) => ArkBoolean(thisVal.map.has(index)))],
      ['iter', new NativeFn([], ArkCallable, (thisVal: ArkMap) => {
        const map = thisVal.map
        const generator = (function* mapEntriesGenerator() {
          for (const [key, value] of map.entries()) {
            yield new ArkList([key, value])
          }
          return ArkNull()
        }())
        return new NativeFn([], ArkVal, () => generator.next().value)
      })],
      ['keys', new NativeFn([], ArkCallable, (thisVal: ArkMap) => {
        const map = thisVal.map
        const generator = (function* mapKeysGenerator() {
          for (const key of map.keys()) {
            yield key
          }
          return ArkNull()
        }())
        return new NativeFn([], ArkVal, () => generator.next().value)
      })],
      ['values', new NativeFn([], ArkCallable, (thisVal: ArkMap) => {
        const map = thisVal.map
        const generator = (function* mapValuesGenerator() {
          for (const value of map.values()) {
            yield value
          }
          return ArkNull()
        }())
        return new NativeFn([], ArkVal, () => generator.next().value)
      })],
    ])
  }

  constructor(public map: Map<ArkVal, ArkVal>) {
    super()
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
  constructor(public obj: ArkAbstractObjectBase, public prop: string) {
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
  ['debug', new NativeFn([new ArkTypedId('obj', ArkVal)], ArkNullVal, (obj) => {
    debug(obj)
    return ArkNull()
  })],
  ['fs', new NativeFn([new ArkTypedId('path', ArkStringVal)], NativeObject, (path: ArkStringVal) => new NativeObject(new FsMap(path.val)))],
  // FIXME: type
  ['sleep', new NativeOperation([new ArkTypedId('ms', ArkNumberVal)], ArkNullVal, function* gen(ms) {
    yield* sleep((ms as ArkNumberVal).val)
    return ArkNull()
  })],
  ['action', new NativeFn(
    [new ArkTypedId('resolve', ArkCallable), new ArkTypedId('reject', ArkCallable)],
    ArkVal,
    function* gen(fn) {
      const result = yield* action(
        toJs(fn) as (resolve: Resolve<unknown>, reject: Reject) => Operation<void>,
      )
      return fromJs(result)
    },
  )],

  // JavaScript bindings—globals (with "use").
  ['js', new ArkObject(new Map([[
    'use', new NativeFn([new ArkTypedId('id', ArkStringVal)], ArkVal, (arg: ArkStringVal) => {
      const name = arg.val
      // eslint-disable-next-line max-len
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      return fromJs((globalThis as any)[name])
    }),
  ]]))],

  // JavaScript bindings—imported libraries (with "use").
  ['jslib', new ArkObject(new Map([[
    'use', new NativeAsyncFn([new ArkTypedId('id', ArkStringVal)], ArkVal, async (arg: ArkStringVal) => {
      const importPath = arg.val
      const module: unknown = await import(importPath)
      return fromJs(module)
    }),
  ]]))],
])

// Clone interpreter globals
export const jsGlobals = new ArkObject(new Map())
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
        ArkVal,
        async (_this, ...args) => fromJs(await fn(...args.map(toJs))),
      )
    }
    return new NativeAsyncFn(
      undefined,
      ArkVal,
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
    return new NativeObject(x)
  }
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  throw new ArkFromJsError(`Cannot convert JavaScript value ${x}`)
}

export function toJs(val: ArkVal): unknown {
  if (val instanceof ArkConcreteVal) {
    return val.val
  } else if (val instanceof ArkObject) {
    const obj: {[key: string]: unknown} = {}
    for (const [k, v] of (val.constructor as typeof ArkObjectBase).methods) {
      obj[k] = toJs(v)
    }
    for (const [k, v] of val.properties) {
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
  ['Unknown', ArkUndefinedVal],
  ['Any', ArkVal],
  ['Null', ArkNullVal],
  ['Bool', ArkBooleanVal],
  ['Num', ArkNumberVal],
  ['Str', ArkStringVal],

  ['Object', ArkObject],
  ['List', ArkList],
  ['Map', ArkMap],
  ['Fn', ArkCallable],

  // TODO: implement union types.
  ['Union', new ArkUnionType(ArkUndefinedVal)],
])
