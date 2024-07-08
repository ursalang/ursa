// Ark interpreter.
// © Reuben Thomas 2023-2024
// Released under the MIT license.

import assert from 'assert'
import util from 'util'
import {Interval} from 'ohm-js'

import programVersion from '../version.js'
import {FsMap} from './fsmap.js'

// Each stack frame consists of a tuple of local vars, captures, and
// debug info.
export class ArkFrame {
  constructor(
    public locals: ArkRef[] = [],
    public captures: ArkRef[] = [],
    public debug = new ArkFrameDebugInfo(),
  ) {}
}

class ArkFrameDebugInfo {
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
  constructor(public ark: ArkState, public message: string, public sourceLoc: unknown) {
    super()
  }
}

// Base class for compiled code.
export class Ark {}

class ArkDebugInfo {
  uid: number | undefined

  name: string | undefined

  env: string | undefined
}

export class ArkVal extends Ark {}

export abstract class ArkExp extends Ark {
  static nextId = 0

  static debugEnumerable = process.env.DEBUG_ARK !== undefined

  constructor() {
    super()
    Object.defineProperty(this, 'debug', {enumerable: ArkExp.debugEnumerable})
    Object.defineProperty(this, 'sourceLoc', {enumerable: ArkExp.debugEnumerable})
    this.debug.uid = ArkExp.nextId
    ArkExp.nextId += 1
  }

  debug = new ArkDebugInfo()

  sourceLoc?: Interval
}

export class ArkLiteral extends ArkExp {
  constructor(public val: ArkVal = ArkNull()) {
    super()
  }
}

abstract class ArkAbstractObjectBase extends ArkVal {
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
      ['pos', new NativeFn([], () => ArkNumber(+this.val))],
      ['neg', new NativeFn([], () => ArkNumber(-this.val))],
      ['bitwiseNot', new NativeFn([], () => ArkNumber(~this.val))],
      ['equals', new NativeFn(['right'], (right: ArkVal) => ArkBoolean(this.val === toJs(right)))],
      ['notEquals', new NativeFn(['right'], (right: ArkVal) => ArkBoolean(this.val !== toJs(right)))],
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

class ArkNonLocalReturn extends Error {
  constructor(public readonly val: ArkVal = ArkNull()) {
    super()
  }
}

export class ArkBreakException extends ArkNonLocalReturn {}
// ts-unused-exports:disable-next-line
export class ArkContinueException extends ArkNonLocalReturn {}
// ts-unused-exports:disable-next-line
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

function makeLocals(names: string[], vals: ArkVal[]): ArkRef[] {
  const locals: ArkValRef[] = names.map((_val, index) => new ArkValRef(vals[index] ?? ArkUndefined))
  if (vals.length > names.length) {
    locals.push(...vals.slice(names.length).map((val) => new ArkValRef(val)))
  }
  return locals
}

abstract class ArkCallable extends ArkVal {
  constructor(public params: string[], public captures: ArkRef[]) {
    super()
  }
}

// ts-unused-exports:disable-next-line
export class ArkClosure extends ArkCallable {
  constructor(params: string[], captures: ArkRef[], public body: ArkExp) {
    super(params, captures)
  }
}

export class NativeFn extends ArkCallable {
  constructor(params: string[], public body: (...args: ArkVal[]) => ArkVal) {
    super(params, [])
  }
}

// ts-unused-exports:disable-next-line
export class NativeAsyncFn extends ArkCallable {
  constructor(params: string[], public body: (...args: ArkVal[]) => Promise<ArkVal>) {
    super(params, [])
  }
}

export class ArkFn extends ArkExp {
  constructor(public params: string[], public capturedVars: ArkNamedLoc[], public body: ArkExp) {
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

export abstract class ArkLvalue extends ArkExp {}

export abstract class ArkNamedLoc extends ArkLvalue {
  constructor(public index: number, public name: string) {
    super()
  }
}
export class ArkLocal extends ArkNamedLoc {}
export class ArkCapture extends ArkNamedLoc {}

export class ArkSet extends ArkExp {
  constructor(public lexp: ArkLvalue, public exp: ArkExp) {
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

export class ArkProperty extends ArkLvalue {
  constructor(public obj: ArkExp, public prop: string) {
    super()
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
    vals.push(await evalArk(ark, bv[1]))
  }
  for (let i = 0; i < lets.length; i += 1) {
    lets[i].set(vals[i])
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

export async function evalArk(ark: ArkState, exp: ArkExp): Promise<ArkVal> {
  if (exp instanceof ArkLiteral) {
    return Promise.resolve(exp.val)
  } else if (exp instanceof ArkLaunch) {
    return Promise.resolve(new ArkPromise(evalArk(ark, exp.exp)))
  } else if (exp instanceof ArkAwait) {
    const promise = await evalArk(ark, exp.exp)
    if (!(promise instanceof ArkPromise)) {
      throw new ArkRuntimeError(ark, "Attempt to 'await' non-Promise", exp.sourceLoc)
    }
    const res = await promise.promise
    return res
  } else if (exp instanceof ArkBreak) {
    throw new ArkBreakException(await evalArk(ark, exp.exp))
  } else if (exp instanceof ArkContinue) {
    throw new ArkContinueException()
  } else if (exp instanceof ArkReturn) {
    throw new ArkReturnException(await evalArk(ark, exp.exp))
  } else if (exp instanceof ArkFn) {
    const captures = []
    for (const v of exp.capturedVars) {
      captures.push(await evalRef(ark, v))
    }
    return new ArkClosure(exp.params, captures, exp.body)
  } else if (exp instanceof ArkCall) {
    const fn = exp.fn
    let sym: ArkRef | undefined
    if (fn instanceof ArkLocal || fn instanceof ArkCapture) {
      sym = await evalRef(ark, fn)
    }
    const fnVal = await evalArk(ark, fn)
    if (!(fnVal instanceof ArkCallable)) {
      throw new ArkRuntimeError(ark, 'Invalid call', exp.sourceLoc)
    }
    const evaluatedArgs = []
    for (const arg of exp.args) {
      evaluatedArgs.push(await evalArk(ark, arg))
    }
    const locals = makeLocals(fnVal.params, evaluatedArgs)
    const debugInfo = new ArkFrameDebugInfo(sym, exp)
    return call(new ArkState(new ArkFrame(locals, fnVal.captures, debugInfo), ark), fnVal)
  } else if (exp instanceof ArkSet) {
    const ref = await evalRef(ark, exp.lexp)
    const res = await evalArk(ark, exp.exp)
    const oldVal = ref.get()
    if (oldVal !== ArkUndefined
      && oldVal.constructor !== ArkNullVal
      && res.constructor !== oldVal.constructor) {
      throw new ArkRuntimeError(ark, 'Assignment to different type', exp.sourceLoc)
    }
    ref.set(res)
    return res
  } else if (exp instanceof ArkObjectLiteral) {
    const inits = new Map<string, ArkVal>()
    for (const [k, v] of exp.properties) {
      inits.set(k, await evalArk(ark, v))
    }
    return new ArkObject(inits)
  } else if (exp instanceof ArkListLiteral) {
    const evaluatedList = []
    for (const e of exp.list) {
      evaluatedList.push(await evalArk(ark, e))
    }
    return new ArkList(evaluatedList)
  } else if (exp instanceof ArkMapLiteral) {
    const evaluatedMap = new Map<ArkVal, ArkVal>()
    for (const [k, v] of exp.map) {
      evaluatedMap.set(await evalArk(ark, k), await evalArk(ark, v))
    }
    return new ArkMap(evaluatedMap)
  } else if (exp instanceof ArkLet) {
    const nLets = await pushLets(ark, exp.boundVars)
    let res: ArkVal
    try {
      res = await evalArk(ark, exp.body)
    } catch (e) {
      if (e instanceof ArkNonLocalReturn) {
        ark.pop(nLets)
      }
      throw e
    }
    ark.pop(nLets)
    return res
  } else if (exp instanceof ArkSequence) {
    let res: ArkVal = ArkNull()
    for (const e of exp.exps) {
      res = await evalArk(ark, e)
    }
    return res
  } else if (exp instanceof ArkIf) {
    const condVal = await evalArk(ark, exp.cond)
    let res: ArkVal
    if (toJs(condVal)) {
      res = await evalArk(ark, exp.thenExp)
    } else {
      res = exp.elseExp ? await evalArk(ark, exp.elseExp) : ArkNull()
    }
    return res
  } else if (exp instanceof ArkAnd) {
    const leftVal = await evalArk(ark, exp.left)
    if (toJs(leftVal)) {
      return evalArk(ark, exp.right)
    }
    return leftVal
  } else if (exp instanceof ArkOr) {
    const leftVal = await evalArk(ark, exp.left)
    if (toJs(leftVal)) {
      return leftVal
    }
    return evalArk(ark, exp.right)
  } else if (exp instanceof ArkLoop) {
    for (; ;) {
      try {
        await evalArk(ark, exp.body)
      } catch (e) {
        if (e instanceof ArkBreakException) {
          return e.val
        }
        if (!(e instanceof ArkContinueException)) {
          throw e
        }
      }
    }
  } else if (exp instanceof ArkLvalue) {
    return (await evalRef(ark, exp)).get()
  }
  throw new Error('invalid ArkExp')
}

async function evalRef(ark: ArkState, lexp: ArkLvalue): Promise<ArkRef> {
  if (lexp instanceof ArkLocal) {
    return Promise.resolve(ark.frame.locals[lexp.index])
  } else if (lexp instanceof ArkCapture) {
    return Promise.resolve(ark.frame.captures[lexp.index])
  } else if (lexp instanceof ArkProperty) {
    const obj = await evalArk(ark, lexp.obj)
    if (!(obj instanceof ArkAbstractObjectBase)) {
      throw new ArkRuntimeError(ark, 'Attempt to read property of non-object', lexp.sourceLoc)
    }
    try {
      return new ArkPropertyRef(obj, lexp.prop)
    } catch (e) {
      if (e instanceof ArkPropertyRefError) {
        throw new ArkRuntimeError(ark, e.message, lexp.sourceLoc)
      }
    }
  }
  throw new Error('invalid ArkLvalue')
}

async function call(ark: ArkState, callable: ArkCallable): Promise<ArkVal> {
  if (callable instanceof ArkClosure) {
    try {
      return await evalArk(ark, callable.body)
    } catch (e) {
      if (e instanceof ArkReturnException) {
        return e.val
      }
      throw e
    }
  } else if (callable instanceof NativeFn) {
    const args = ark.frame.locals.map((ref) => ref.get())
    return Promise.resolve(callable.body(...args))
  } else if (callable instanceof NativeAsyncFn) {
    const args = ark.frame.locals.map((ref) => ref.get())
    return callable.body(...args)
  }
  throw new Error('invalid ArkCallable')
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
      return call(new ArkState(new ArkFrame(locals, val.captures)), val)
    }
  } else if (val instanceof NativeFn || val instanceof NativeAsyncFn) {
    return (...args: unknown[]) => toJs(val.body(...args.map((arg) => fromJs(arg))))
  }
  return val
}
