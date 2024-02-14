// Ark interpreter.
// © Reuben Thomas 2023-2024
// Released under the MIT license.

import assert from 'assert'
import util from 'util'

import programVersion from '../version.js'
import {fromJs, toJs} from './ffi.js'
import {FsMap} from './fsmap.js'
import {evalArk} from './eval.js'

// Each stack frame consists of a tuple of local vars, captures, and
// debug info.
export class ArkFrame {
  constructor(
    public locals: ArkRef[] = [],
    public captures: ArkRef[] = [],
    public debug = new ArkFrameDebugInfo(),
  ) {}
}

export class ArkFrameDebugInfo {
  constructor(
    public name: ArkRef | undefined = undefined,
    public source: ArkCall | undefined = undefined,
  ) {}
}

export class ArkState {
  constructor(
    public readonly frame = new ArkFrame(),
    public readonly outerState?: ArkState,
  ) {}

  push(items: ArkRef[]) {
    this.frame.locals.push(...items)
    return this
  }

  pop(nItems: number) {
    for (let i = 0; i < nItems; i += 1) {
      this.frame.locals.pop()
    }
  }

  async run(compiledVal: ArkExp): Promise<ArkVal> {
    return evalArk(this, compiledVal)
  }
}

export class ArkRuntimeError extends Error {
  sourceLoc: unknown

  constructor(public ark: ArkState, public message: string, public val: Ark) {
    super()
    this.sourceLoc = val.debug.sourceLoc
  }
}

// Base class for compiled code.
export class Ark {
  static nextId = 0

  static debugEnumerable = process.env.DEBUG_ARK !== undefined

  constructor() {
    Object.defineProperty(this, 'debug', {enumerable: Ark.debugEnumerable})
    this.debug.uid = Ark.nextId
    Ark.nextId += 1
  }

  debug = new ArkDebugInfo()
}

class ArkDebugInfo {
  uid: number | undefined

  name: string | undefined

  sourceLoc: unknown

  env: string | undefined
}

export class ArkVal extends Ark {
  constructor() {
    super()
    // Make this class incompatible with ArkExp.
    Object.defineProperty(this, '_arkval', {enumerable: false})
  }

  _arkval: undefined
}

export abstract class ArkExp extends Ark {}

export class ArkLiteral extends ArkExp {
  constructor(public val: ArkVal = ArkNull()) {
    super()
  }
}

export abstract class ArkAbstractObjectBase extends ArkVal {
  abstract get(prop: string): ArkVal

  abstract set(prop: string, val: ArkVal): ArkVal
}

export class ArkObjectBase extends ArkAbstractObjectBase {
  constructor(public properties: Map<string, ArkVal> = new Map()) {
    super()
    this.addDefaults([
      ['=', new NativeFn(['right'], (right: ArkVal) => ArkBoolean(this === right))],
      ['!=', new NativeFn(['right'], (right: ArkVal) => ArkBoolean(this !== right))],
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
      ['=', new NativeFn(['right'], (right: ArkVal) => ArkBoolean(this.val === toJs(right)))],
      ['!=', new NativeFn(['right'], (right: ArkVal) => ArkBoolean(this.val !== toJs(right)))],
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
      ['pos', new NativeFn([], () => ArkNumber(+this.val))],
      ['neg', new NativeFn([], () => ArkNumber(-this.val))],
      ['~', new NativeFn([], () => ArkNumber(~this.val))],
      ['=', new NativeFn(['right'], (right: ArkVal) => ArkBoolean(this.val === toJs(right)))],
      ['!=', new NativeFn(['right'], (right: ArkVal) => ArkBoolean(this.val !== toJs(right)))],
      ['<', new NativeFn(['right'], (right: ArkVal) => ArkBoolean(this.val < (right as ArkNumberVal).val))],
      ['<=', new NativeFn(['right'], (right: ArkVal) => ArkBoolean(this.val <= (right as ArkNumberVal).val))],
      ['>', new NativeFn(['right'], (right: ArkVal) => ArkBoolean(this.val > (right as ArkNumberVal).val))],
      ['>=', new NativeFn(['right'], (right: ArkVal) => ArkBoolean(this.val >= (right as ArkNumberVal).val))],
      ['+', new NativeFn(['right'], (right: ArkVal) => ArkNumber(this.val + (right as ArkNumberVal).val))],
      ['-', new NativeFn(['right'], (right: ArkVal) => ArkNumber(this.val - (right as ArkNumberVal).val))],
      ['*', new NativeFn(['right'], (right: ArkVal) => ArkNumber(this.val * (right as ArkNumberVal).val))],
      ['/', new NativeFn(['right'], (right: ArkVal) => ArkNumber(this.val / (right as ArkNumberVal).val))],
      ['%', new NativeFn(['right'], (right: ArkVal) => ArkNumber(this.val % (right as ArkNumberVal).val))],
      ['**', new NativeFn(['right'], (right: ArkVal) => ArkNumber(this.val ** (right as ArkNumberVal).val))],
      ['&', new NativeFn(['right'], (right: ArkVal) => ArkNumber(this.val & (right as ArkNumberVal).val))],
      ['|', new NativeFn(['right'], (right: ArkVal) => ArkNumber(this.val | (right as ArkNumberVal).val))],
      ['^', new NativeFn(['right'], (right: ArkVal) => ArkNumber(this.val ^ (right as ArkNumberVal).val))],
      ['<<', new NativeFn(['right'], (right: ArkVal) => ArkNumber(this.val << (right as ArkNumberVal).val))],
      ['>>', new NativeFn(['right'], (right: ArkVal) => ArkNumber(this.val >> (right as ArkNumberVal).val))],
      ['>>>', new NativeFn(['right'], (right: ArkVal) => ArkNumber(this.val >>> (right as ArkNumberVal).val))],
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
ArkUndefined.debug.name = 'Undefined'
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

export class ArkPromise extends ArkVal {
  constructor(public promise: Promise<ArkVal>) {
    super()
  }
}

export class ArkLaunch extends ArkExp {
  constructor(public exp: ArkExp) {
    super()
  }
}

export class ArkAwait extends ArkExp {
  constructor(public exp: ArkExp) {
    super()
  }
}

export class ArkNonLocalReturn extends Error {
  constructor(public readonly val: ArkVal = ArkNull()) {
    super()
  }
}

export class ArkBreakException extends ArkNonLocalReturn {}
export class ArkContinueException extends ArkNonLocalReturn {}
export class ArkReturnException extends ArkNonLocalReturn {}

export class ArkBreak extends ArkExp {
  constructor(public exp: ArkExp = new ArkLiteral(ArkNull())) {
    super()
  }
}

export class ArkContinue extends ArkExp {
  // eslint-disable-next-line class-methods-use-this
  eval(_ark: ArkState): Promise<never> {
    throw new ArkContinueException()
  }
}

export class ArkReturn extends ArkExp {
  constructor(public exp: ArkExp = new ArkLiteral(ArkNull())) {
    super()
  }
}

export function makeLocals(names: string[], vals: ArkVal[]): ArkRef[] {
  const locals: ArkValRef[] = names.map((_val, index) => new ArkValRef(vals[index] ?? ArkUndefined))
  if (vals.length > names.length) {
    locals.push(...vals.slice(names.length).map((val) => new ArkValRef(val)))
  }
  return locals
}

export abstract class ArkCallable extends ArkVal {
  constructor(public params: string[], public captures: ArkRef[]) {
    super()
  }

  abstract call(ark: ArkState): Promise<ArkVal>
}

export class ArkClosure extends ArkCallable {
  constructor(params: string[], captures: ArkRef[], public body: ArkExp) {
    super(params, captures)
  }

  async call(ark: ArkState): Promise<ArkVal> {
    try {
      return await evalArk(ark, this.body)
    } catch (e) {
      if (e instanceof ArkReturnException) {
        return e.val
      }
      throw e
    }
  }
}

export class NativeFn extends ArkCallable {
  constructor(params: string[], public body: (...args: ArkVal[]) => ArkVal) {
    super(params, [])
  }

  async call(ark: ArkState): Promise<ArkVal> {
    const args = ark.frame.locals.map((ref) => ref.get(ark))
    return Promise.resolve(this.body(...args))
  }
}

export class NativeAsyncFn extends ArkCallable {
  constructor(params: string[], public body: (...args: ArkVal[]) => Promise<ArkVal>) {
    super(params, [])
  }

  async call(ark: ArkState): Promise<ArkVal> {
    const args = ark.frame.locals.map((ref) => ref.get(ark))
    return this.body(...args)
  }
}

export class ArkFn extends ArkExp {
  constructor(public params: string[], public capturedVars: ArkLexp[], public body: ArkExp) {
    super()
  }
}

// export class ArkType extends Ark {
//   constructor(
//     public superTraits: ArkType[],
//     public members: Map<string, ArkFieldType | ArkMethodType>,
//   ) {
//     super()
//   }
// }

// export class ArkFieldType extends Ark {
//   constructor(public var_: boolean, public type: ArkType) {
//     super()
//   }
// }

// export class ArkMethodType extends Ark {
//   constructor(public params: [string, ArkType][], public returnType: ArkType) {
//     super()
//   }
// }

export class ArkCall extends ArkExp {
  constructor(public fn: ArkExp, public args: ArkExp[]) {
    super()
  }
}

export abstract class ArkRef extends Ark {
  abstract get(ark: ArkState): ArkVal

  abstract set(ark: ArkState, val: ArkVal): ArkVal
}

export class ArkValRef extends ArkRef {
  constructor(public val: ArkVal = ArkNull()) {
    super()
  }

  get(_ark: ArkState): ArkVal {
    return this.val
  }

  set(_ark: ArkState, val: ArkVal): ArkVal {
    this.val = val
    return val
  }
}

export abstract class ArkLexp extends ArkExp {}

export class ArkLocal extends ArkLexp {
  constructor(public index: number) {
    super()
  }
}

export class ArkCapture extends ArkLexp {
  constructor(public index: number) {
    super()
  }
}

export class ArkSet extends ArkExp {
  constructor(public lexp: ArkLexp, public exp: ArkExp) {
    super()
  }
}

export class ArkObject extends ArkObjectBase {}

export class ArkObjectLiteral extends ArkExp {
  constructor(public properties: Map<string, ArkExp>) {
    super()
  }
}

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

export class ArkProperty extends ArkLexp {
  constructor(public obj: ArkExp, public prop: string) {
    super()
  }
}

export class ArkPropertyRef extends ArkRef {
  constructor(public obj: ArkAbstractObjectBase, public prop: string) {
    super()
  }

  get(ark: ArkState) {
    const val = this.obj.get(this.prop)
    if (val === ArkUndefined) {
      throw new ArkRuntimeError(ark, `Invalid property '${this.prop}'`, this)
    }
    return val
  }

  set(_ark: ArkState, val: ArkVal) {
    this.obj.set(this.prop, val)
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
    ]))
  }
}

export class ArkListLiteral extends ArkExp {
  constructor(public list: ArkExp[]) {
    super()
  }
}

export class ArkMap extends ArkObjectBase {
  constructor(public map: Map<ArkVal, ArkVal>) {
    super(new Map([
      ['set', new NativeFn(
        ['index', 'val'],
        (index: ArkVal, val: ArkVal) => {
          this.map.set(index, val)
          return this
        },
      )],
      ['get', new NativeFn(['index'], (index: ArkVal) => this.map.get(index) ?? ArkNull())],
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

export class ArkMapLiteral extends ArkExp {
  constructor(public map: Map<ArkExp, ArkExp>) {
    super()
  }
}

export async function pushLets(ark: ArkState, boundVars: [string, ArkExp][]) {
  const lets = makeLocals(boundVars.map((bv) => bv[0]), [])
  ark.push(lets)
  const vals: ArkVal[] = []
  for (const bv of boundVars) {
    // eslint-disable-next-line no-await-in-loop
    vals.push(await evalArk(ark, bv[1]))
  }
  for (let i = 0; i < lets.length; i += 1) {
    lets[i].set(ark, vals[i])
  }
  return lets.length
}

export class ArkLet extends ArkExp {
  constructor(public boundVars: [string, ArkExp][], public body: ArkExp) {
    super()
  }
}

export class ArkSequence extends ArkExp {
  constructor(public exps: ArkExp[]) {
    super()
  }
}

export class ArkIf extends ArkExp {
  constructor(public cond: ArkExp, public thenExp: ArkExp, public elseExp?: ArkExp) {
    super()
  }
}

export class ArkAnd extends ArkExp {
  constructor(public left: ArkExp, public right: ArkExp) {
    super()
  }
}

export class ArkOr extends ArkExp {
  constructor(public left: ArkExp, public right: ArkExp) {
    super()
  }
}

export class ArkLoop extends ArkExp {
  constructor(public body: ArkExp) {
    super()
  }
}

export const globals = new ArkObject(new Map<string, ArkVal>([
  // Ursa's prelude (see also prelude.ursa).
  ['version', ArkString(programVersion)],
  ['debug', new NativeFn(['obj'], (obj: ArkVal) => {
    debug(obj)
    return ArkNull()
  })],
  ['fs', new NativeFn(['path'], (path: ArkVal) => new NativeObject(new FsMap(toJs(path) as string)))],

  ['Promise', new NativeAsyncFn(
    ['resolve', 'reject'],
    (fn: ArkVal) => Promise.resolve(new ArkPromise(
      new Promise(
        toJs(fn) as
        (resolve: (value: unknown) => void, reject: (reason?: unknown) => void) => void,
      ).then((x) => fromJs(x)),
    )),
  )],

  // JavaScript bindings—globals (with "use").
  ['js', new ArkObject(new Map([[
    'use', new NativeFn([], (arg: ArkVal) => {
      const name = toJs(arg)
      // eslint-disable-next-line max-len
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      return fromJs((globalThis as any)[name as string])
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

export function valToString(x: unknown, depth: number | null = 1) {
  return util.inspect(
    x,
    {
      depth,
      colors: process.stdout && process.stdout.isTTY,
      sorted: true,
    },
  )
}

export function debug(x: unknown, depth?: number | null) {
  console.log(valToString(x, depth))
}
