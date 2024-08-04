// Compiled Ark values.
// © Reuben Thomas 2023-2024
// Released under the MIT license.

import assert from 'assert'
import {isGeneratorFunction} from 'util/types'

import {
  action, call, Operation, Reject, Resolve, sleep,
} from 'effection'

import {FsMap} from './fsmap.js'
import programVersion from '../version.js'
import {debug} from './util.js'

export class ArkVal {}

export abstract class ArkAbstractObjectBase extends ArkVal {
  abstract get(prop: string): ArkVal

  abstract set(prop: string, val: ArkVal): ArkVal
}

class ArkObjectBase extends ArkAbstractObjectBase {
  constructor(public properties: Map<string, ArkVal> = new Map()) {
    super()
    this.addDefaults([
      ['equals', new NativeFn(['right'], (right: ArkVal) => ArkBoolean(this === right))],
      ['notEquals', new NativeFn(['right'], (right: ArkVal) => ArkBoolean(this !== right))],
    ])
  }

  get(prop: string) {
    return this.properties.get(prop) ?? ArkUndefined
  }

  set(prop: string, val: ArkVal) {
    this.properties.set(prop, val)
    return val
  }

  addDefaults(defaults: [string, ArkVal][]) {
    defaults.forEach(([name, val]) => {
      if (this.get(name) === ArkUndefined) {
        this.set(name, val)
      }
    })
  }
}

export abstract class ArkConcreteVal<T> extends ArkObjectBase {
  constructor(public val: T) {
    super()
    this.addDefaults([
      ['equals', new NativeFn(['right'], (right: ArkVal) => ArkBoolean(this.val === toJs(right)))],
      ['notEquals', new NativeFn(['right'], (right: ArkVal) => ArkBoolean(this.val !== toJs(right)))],
    ])
  }
}

export class ArkNullVal extends ArkConcreteVal<null> {}
export class ArkBooleanVal extends ArkConcreteVal<boolean> {
  constructor(val: boolean) {
    super(val)
    this.addDefaults([['not', new NativeFn([], () => ArkBoolean(!this.val))]])
  }
}
export class ArkNumberVal extends ArkConcreteVal<number> {
  constructor(val: number) {
    super(val)
    this.addDefaults([
      ['toString', new NativeFn([], () => ArkString(this.val.toString()))],
      ['pos', new NativeFn([], () => ArkNumber(+this.val))],
      ['neg', new NativeFn([], () => ArkNumber(-this.val))],
      ['bitwiseNot', new NativeFn([], () => ArkNumber(~this.val))],
      ['lt', new NativeFn(['right'], (right: ArkVal) => ArkBoolean(this.val < (right as ArkNumberVal).val))],
      ['leq', new NativeFn(['right'], (right: ArkVal) => ArkBoolean(this.val <= (right as ArkNumberVal).val))],
      ['gt', new NativeFn(['right'], (right: ArkVal) => ArkBoolean(this.val > (right as ArkNumberVal).val))],
      ['geq', new NativeFn(['right'], (right: ArkVal) => ArkBoolean(this.val >= (right as ArkNumberVal).val))],
      ['add', new NativeFn(['right'], (right: ArkVal) => ArkNumber(this.val + (right as ArkNumberVal).val))],
      ['sub', new NativeFn(['right'], (right: ArkVal) => ArkNumber(this.val - (right as ArkNumberVal).val))],
      ['mul', new NativeFn(['right'], (right: ArkVal) => ArkNumber(this.val * (right as ArkNumberVal).val))],
      ['div', new NativeFn(['right'], (right: ArkVal) => ArkNumber(this.val / (right as ArkNumberVal).val))],
      ['mod', new NativeFn(['right'], (right: ArkVal) => ArkNumber(this.val % (right as ArkNumberVal).val))],
      ['exp', new NativeFn(['right'], (right: ArkVal) => ArkNumber(this.val ** (right as ArkNumberVal).val))],
      ['bitwiseAnd', new NativeFn(['right'], (right: ArkVal) => ArkNumber(this.val & (right as ArkNumberVal).val))],
      ['bitwiseOr', new NativeFn(['right'], (right: ArkVal) => ArkNumber(this.val | (right as ArkNumberVal).val))],
      ['bitwiseXor', new NativeFn(['right'], (right: ArkVal) => ArkNumber(this.val ^ (right as ArkNumberVal).val))],
      ['shiftLeft', new NativeFn(['right'], (right: ArkVal) => ArkNumber(this.val << (right as ArkNumberVal).val))],
      ['shiftRight', new NativeFn(['right'], (right: ArkVal) => ArkNumber(this.val >> (right as ArkNumberVal).val))],
      ['shiftRightArith', new NativeFn(['right'], (right: ArkVal) => ArkNumber(this.val >>> (right as ArkNumberVal).val))],
    ])
  }
}
export class ArkStringVal extends ArkConcreteVal<string> {
  constructor(val: string) {
    super(val)
    this.addDefaults([
      ['get', new NativeFn(['index'], (index: ArkVal) => ArkString(this.val[toJs(index) as number]))],
      ['iter', new NativeFn([], () => {
        const str = this.val
        const generator = (function* stringGenerator() {
          for (const elem of str) {
            yield ArkString(elem)
          }
          return ArkNull()
        }())
        return new NativeFn([], () => generator.next().value)
      })],
      ['split', new NativeFn(['sep'], (sep: ArkVal) => new ArkList(this.val.split((sep as ArkStringVal).val).map((s) => ArkString(s))))],
    ])
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

export const ArkUndefined = new ArkVal()
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

export abstract class ArkCallable extends ArkVal {
  constructor(public params: string[]) {
    super()
  }
}

export abstract class ArkClosure extends ArkCallable {
  constructor(params: string[], public captures: ArkRef[]) {
    super(params)
  }

  abstract call(locals: ArkValRef[]): Promise<ArkVal>
}
// ts-unused-exports:disable-next-line
export abstract class ArkGeneratorClosure extends ArkClosure {}

export class NativeFn extends ArkCallable {
  public body: (...args: ArkVal[]) => Operation<ArkVal>

  constructor(
    params: string[],
    innerBody: (...args: ArkVal[]) => ArkVal | Operation<ArkVal>,
  ) {
    super(params)
    if (isGeneratorFunction(innerBody)) {
      this.body = innerBody as (...args: ArkVal[]) => Operation<ArkVal>
    } else {
      // eslint-disable-next-line require-yield
      this.body = function* gen(...args: ArkVal[]) { return innerBody(...args) }
    }
  }
}

export class NativeOperation extends ArkCallable {
  constructor(params: string[], public body: (...args: ArkVal[]) => Operation<ArkVal>) {
    super(params)
  }
}

// ts-unused-exports:disable-next-line
export class NativeAsyncFn extends ArkCallable {
  public body: (...args: ArkVal[]) => Operation<ArkVal>

  constructor(params: string[], innerBody: (...args: ArkVal[]) => Promise<ArkVal>) {
    super(params)
    this.body = (...args: ArkVal[]) => call(() => innerBody(...args))
  }
}

// export class ArkType extends Ark {
//   constructor(
//   public superTraits: ArkType[],
//   public members: Map<string, ArkFieldType | ArkMethodType>,
//   ) {
//   super()
//   }
// }

// export class ArkFieldType extends Ark {
//   constructor(public isVar: boolean, public type: ArkType) {
//   super()
//   }
// }

// export class ArkMethodType extends Ark {
//   constructor(public params: [string, ArkType][], public returnType: ArkType) {
//   super()
//   }
// }

export class ArkObject extends ArkObjectBase {}

export class NativeObject extends ArkAbstractObjectBase {
  constructor(public obj: object) {
    super()
  }

  get(prop: string): ArkVal {
    return fromJs((this.obj as {[key: string]: unknown})[prop], this.obj) ?? ArkUndefined
  }

  set(prop: string, val: ArkVal) {
    (this.obj as {[key: string]: unknown})[prop] = toJs(val)
    return val
  }
}

export class ArkList extends ArkObjectBase {
  constructor(public list: ArkVal[]) {
    super(new Map([
      ['len', new NativeFn(['len'], () => ArkNumber(this.list.length))],
      ['get', new NativeFn(['index'], (index: ArkVal) => this.list[toJs(index) as number])],
      ['set', new NativeFn(
        ['index', 'val'],
        (index: ArkVal, val: ArkVal) => {
          this.list[toJs(index) as number] = val
          return this
        },
      )],
      ['push', new NativeFn(['item'], (item: ArkVal) => {
        this.list.push(item)
        return this
      })],
      ['pop', new NativeFn([], () => {
        this.list.pop()
        return this
      })],
      ['slice', new NativeFn(['from', 'to'], (from, to) => new ArkList(
        this.list.slice(
          from instanceof ArkNumberVal ? from.val : 0,
          to instanceof ArkNumberVal ? to.val : undefined,
        ),
      ))],
      ['iter', new NativeFn([], () => {
        const list = this.list
        const generator = (function* listGenerator() {
          for (const elem of list) {
            yield elem
          }
          return ArkNull()
        }())
        return new NativeFn([], () => generator.next().value)
      })],
      ['sorted', new NativeFn([], () => new ArkList(this.list.map(toJs).toSorted().map((v) => fromJs(v))))],
      ['join', new NativeFn(['sep'], (sep) => ArkString(this.list.map(toJs).join((sep as ArkStringVal).val)))],
    ]))
  }
}

export class ArkMap extends ArkObjectBase {
  constructor(public map: Map<ArkVal, ArkVal>) {
    super(new Map([
      ['get', new NativeFn(['index'], (index: ArkVal) => this.map.get(index) ?? ArkNull())],
      ['set', new NativeFn(
        ['index', 'val'],
        (index: ArkVal, val: ArkVal) => {
          this.map.set(index, val)
          return this
        },
      )],
      ['delete', new NativeFn(['index'], (index: ArkVal) => {
        this.map.delete(index)
        return this
      })],
      ['has', new NativeFn(['index'], (index: ArkVal) => ArkBoolean(this.map.has(index)))],
      ['iter', new NativeFn([], () => {
        const map = this.map
        const generator = (function* mapEntriesGenerator() {
          for (const [key, value] of map.entries()) {
            yield new ArkList([key, value])
          }
          return ArkNull()
        }())
        return new NativeFn([], () => generator.next().value)
      })],
      ['keys', new NativeFn([], () => {
        const map = this.map
        const generator = (function* mapKeysGenerator() {
          for (const key of map.keys()) {
            yield key
          }
          return ArkNull()
        }())
        return new NativeFn([], () => generator.next().value)
      })],
      ['values', new NativeFn([], () => {
        const map = this.map
        const generator = (function* mapValuesGenerator() {
          for (const value of map.values()) {
            yield value
          }
          return ArkNull()
        }())
        return new NativeFn([], () => generator.next().value)
      })],
    ]))
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

class ArkPropertyRefError extends Error {}

// ts-unused-exports:disable-next-line
export class ArkPropertyRef extends ArkRef {
  constructor(public obj: ArkAbstractObjectBase, public prop: string) {
    super()
    if (obj.get(prop) === ArkUndefined) {
      throw new ArkPropertyRefError('Invalid property')
    }
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

export const globals = new ArkObject(new Map<string, ArkVal>([
  // Placeholder (will be set at start-up).
  ['argv', new ArkList([])],

  // Ursa's prelude (see also prelude.ursa).
  ['version', ArkString(programVersion)],
  ['debug', new NativeFn(['obj'], (obj: ArkVal) => {
    debug(obj)
    return ArkNull()
  })],
  ['fs', new NativeFn(['path'], (path: ArkVal) => new NativeObject(new FsMap((path as ArkStringVal).val)))],
  ['sleep', new NativeOperation(['ms'], function* gen(ms: ArkVal) {
    yield* sleep((ms as ArkNumberVal).val)
    return ArkNull()
  })],
  ['action', new NativeFn(
    ['resolve', 'reject'],
    function* gen(fn: ArkVal) {
      const result = yield* action(
        toJs(fn) as (resolve: Resolve<unknown>, reject: Reject) => Operation<void>,
      )
      return fromJs(result)
    },
  )],

  // JavaScript bindings—globals (with "use").
  ['js', new ArkObject(new Map([[
    'use', new NativeFn([], (arg: ArkVal) => {
      const name = toJs(arg) as string
      // eslint-disable-next-line max-len
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      return fromJs((globalThis as any)[name])
    }),
  ]]))],

  // JavaScript bindings—imported libraries (with "use").
  ['jslib', new ArkObject(new Map([[
    'use', new NativeAsyncFn([], async (...args: ArkVal[]) => {
      const importPath = (args.map(toJs).join('.'))
      const module: unknown = await import(importPath)
      assert(typeof module === 'object')
      const wrappedModule = new Map<string, ArkVal>()
      // eslint-disable-next-line guard-for-in
      for (const key in module) {
        wrappedModule.set(key, fromJs((module as {[key: string]: unknown})[key]))
      }
      return new ArkObject(wrappedModule)
    }),
  ]]))],
]))

// Clone interpreter globals
export const jsGlobals = new ArkObject(new Map())
for (const [k, v] of globals.properties.entries()) {
  jsGlobals.set(k, v)
}

// FFI
class ArkFromJsError extends Error {}

function fromJs(x: unknown, thisObj?: object): ArkVal {
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
    const nativeFn = new NativeAsyncFn(
      [],
      async (...args: ArkVal[]) => fromJs(await fn(...args.map(toJs))),
    )
    return nativeFn
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
    return (...args: unknown[]) => toJs(val.body(...args.map((arg) => fromJs(arg))))
  }
  return val
}
