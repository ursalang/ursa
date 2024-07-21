// Interpreter for flattened Ark.
// © Reuben Thomas 2023-2024
// Released under the MIT license.

import assert from 'assert'
import util from 'util'
import {Interval} from 'ohm-js'

import {
  ArkAwaitInst, ArkBlockCloseInst, ArkBlockOpenInst, ArkBreakInst, ArkCallInst,
  ArkCaptureInst, ArkContinueInst, ArkElseBlockCloseInst, ArkElseBlockInst,
  ArkFnBlockOpenInst, ArkGeneratorBlockOpenInst, ArkIfBlockOpenInst, ArkInst,
  ArkLaunchBlockCloseInst, ArkLaunchBlockOpenInst, ArkLetBlockCloseInst, ArkLetBlockOpenInst,
  ArkLetCopyInst, ArkListLiteralInst, ArkLiteralInst, ArkLocalInst, ArkLoopBlockCloseInst,
  ArkLoopBlockOpenInst, ArkMapLiteralInst, ArkObjectLiteralInst, ArkPropertyInst, ArkReturnInst,
  ArkSetCaptureInst, ArkSetLocalInst, ArkSetPropertyInst, ArkYieldInst,
} from './flatten.js'
import programVersion from '../version.js'
import {FsMap} from './fsmap.js'

// Each stack frame consists of a tuple of local vars, captures, and
// debug info.
class ArkFrame {
  constructor(
    public locals: ArkRef[] = [],
    public captures: ArkRef[] = [],
    public memory: Map<symbol, ArkVal> = new Map(),
    public debug = new ArkFrameDebugInfo(),
  ) {}
}

class ArkFrameDebugInfo {
  constructor(
    public callerName?: string,

    public sourceLoc?: Interval,
  ) {}
}

export class ArkState {
  public continuation?: ArkContinuation

  public loopStack: ArkBlockOpenInst[] = []

  constructor(
    public inst?: ArkInst,
    public readonly frame = new ArkFrame(),
    public outerState?: ArkState,
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

  async run(): Promise<ArkVal> {
    return evalFlat(this)
  }
}

export class ArkRuntimeError extends Error {
  constructor(
    public ark: ArkState,
    public message: string,
    public sourceLoc: unknown,
  ) {
    super()
  }
}

// Base class for compiled code.
export class Ark {}

export class ArkDebugInfo {
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
      ['toString', new NativeFn([], () => ArkString(this.val.toString()))],
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

export class ArkBreak extends ArkExp {
  constructor(public exp: ArkExp = new ArkLiteral(ArkNull())) {
    super()
  }
}

export class ArkContinue extends ArkExp {}

export class ArkReturn extends ArkExp {
  constructor(public exp: ArkExp = new ArkLiteral(ArkNull())) {
    super()
  }
}

export class ArkYield extends ArkReturn {}

function makeLocals(names: string[], vals: ArkVal[]): ArkRef[] {
  const locals: ArkValRef[] = names.map((_val, index) => new ArkValRef(vals[index] ?? ArkUndefined))
  if (vals.length > names.length) {
    locals.push(...vals.slice(names.length).map((val) => new ArkValRef(val)))
  }
  return locals
}

abstract class ArkCallable extends ArkVal {
  constructor(public params: string[]) {
    super()
  }
}

export class NativeFn extends ArkCallable {
  constructor(params: string[], public body: (...args: ArkVal[]) => ArkVal) {
    super(params)
  }
}

// ts-unused-exports:disable-next-line
export class NativeAsyncFn extends ArkCallable {
  constructor(params: string[], public body: (...args: ArkVal[]) => Promise<ArkVal>) {
    super(params)
  }
}

export class ArkFn extends ArkExp {
  constructor(public params: string[], public capturedVars: ArkCapture[], public body: ArkExp) {
    super()
  }
}
export class ArkGenerator extends ArkFn {}

export class ArkFnType {
  constructor(public Constructor: typeof ArkFn, public params: string[]) {}
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

abstract class ArkRef extends Ark {
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
      ['sorted', new NativeFn([], () => new ArkList(this.list.map(toJs).toSorted().map((v) => fromJs(v))))],
      ['join', new NativeFn(['sep'], (sep) => ArkString(this.list.map(toJs).join((sep as ArkStringVal).val)))],
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

export class ArkLet extends ArkExp {
  constructor(public boundVars: [string, number, ArkExp][], public body: ArkExp) {
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
  constructor(public body: ArkExp, public localsDepth: number) {
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
  ['fetch', new NativeAsyncFn(
    ['url', 'options'],
    async (url: ArkVal, options: ArkVal) => new NativeObject(
      await fetch((url as ArkStringVal).val, toJs(options as ArkObject) as RequestInit),
    ),
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

class ArkClosure extends ArkCallable {
  constructor(params: string[], public captures: ArkRef[], public body: ArkInst) {
    super(params)
  }
}
class ArkGeneratorClosure extends ArkClosure {}

class ArkContinuation extends ArkCallable {
  public done = false

  constructor(public state: ArkState) {
    super(['x'])
  }
}

function evalRef(frame: ArkFrame, lexp: ArkNamedLoc): ArkRef {
  if (lexp instanceof ArkLocal) {
    return frame.locals[lexp.index]
  } else if (lexp instanceof ArkCapture) {
    return frame.captures[lexp.index]
  }
  throw new Error('invalid ArkNamedLoc')
}

async function callFlat(ark: ArkState, callable: ArkCallable): Promise<ArkVal> {
  if (callable instanceof ArkClosure) {
    return evalFlat(ark)
  } else if (callable instanceof NativeFn) {
    const args = ark.frame.locals.map((ref) => ref.get())
    return Promise.resolve(callable.body(...args))
  } else if (callable instanceof NativeAsyncFn) {
    const args = ark.frame.locals.map((ref) => ref.get())
    return callable.body(...args)
  } else {
    throw new Error('Invalid ArkCallable')
  }
}

async function evalFlat(outerArk: ArkState): Promise<ArkVal> {
  let ark: ArkState | undefined = outerArk
  let inst = ark.inst
  let prevInst
  while (inst !== undefined) {
    prevInst = inst
    const mem: Map<symbol, ArkVal> = ark.frame.memory
    if (inst instanceof ArkLiteralInst) {
      mem.set(inst.id, inst.val)
      inst = inst.next
    } else if (inst instanceof ArkLetCopyInst) {
      mem.set(inst.id, mem.get(inst.argId)!)
      inst = inst.next
    } else if (inst instanceof ArkLaunchBlockCloseInst) {
      const result = mem.get(inst.blockId)!
      mem.set(inst.id, result)
      return result
    } else if (inst instanceof ArkElseBlockInst) {
      mem.set(inst.id, mem.get(inst.ifBlockId)!)
      inst = inst.matchingClose.next
    } else if (inst instanceof ArkLoopBlockCloseInst) {
      inst = inst.matchingOpen.next
    } else if (inst instanceof ArkElseBlockCloseInst) {
      const result = mem.get(inst.blockId)!
      mem.set(inst.matchingOpen.id, result)
      mem.set(inst.id, result)
      inst = inst.next
    } else if (inst instanceof ArkLetBlockCloseInst) {
      mem.set(inst.id, mem.get(inst.blockId)!)
      // Pop locals introduced in this block.
      ark.pop((inst.matchingOpen as ArkLetBlockOpenInst).vars.length)
      inst = inst.next
    } else if (inst instanceof ArkBlockCloseInst) {
      mem.set(inst.id, mem.get(inst.blockId)!)
      inst = inst.next
    } else if (inst instanceof ArkIfBlockOpenInst) {
      const result = mem.get(inst.condId)!
      mem.set(inst.id, result)
      if (result !== ArkBoolean(false)) {
        inst = inst.next
      } else {
        inst = inst.matchingClose.next
      }
    } else if (inst instanceof ArkLoopBlockOpenInst) {
      ark.loopStack.unshift(inst)
      inst = inst.next
    } else if (inst instanceof ArkLaunchBlockOpenInst) {
      const innerArk = new ArkState(
        inst.next,
        new ArkFrame(
          [...ark.frame.locals],
          [...ark.frame.captures],
          new Map(ark.frame.memory.entries()),
          ark.frame.debug,
        ),
        ark.outerState,
      )
      const result = Promise.resolve(new ArkPromise(evalFlat(innerArk)))
      mem.set(inst.id, result)
      // The Promise becomes the result of the entire block.
      mem.set(inst.matchingClose.id, result)
      inst = inst.matchingClose.next
    } else if (inst instanceof ArkFnBlockOpenInst) {
      const captures = []
      for (const v of inst.capturedVars) {
        captures.push(evalRef(ark.frame, v))
      }
      const Constructor = inst instanceof ArkGeneratorBlockOpenInst
        ? ArkGeneratorClosure : ArkClosure
      const result = new Constructor(inst.params, captures, inst.next!)
      mem.set(inst.matchingClose.id, result)
      inst = inst.matchingClose.next
    } else if (inst instanceof ArkLetBlockOpenInst) {
      ark.push(makeLocals(inst.vars, []))
      inst = inst.next
    } else if (inst instanceof ArkBlockOpenInst) {
      inst = inst.next
    } else if (inst instanceof ArkAwaitInst) {
      const promise = (mem.get(inst.argId)! as ArkPromise).promise
      mem.set(inst.id, await promise)
      inst = inst.next
    } else if (inst instanceof ArkBreakInst) {
      const result = mem.get(inst.argId)!
      mem.set(inst.id, result)
      mem.set(inst.loopInst.matchingClose.id, result)
      const nPops = ark.frame.locals.length - inst.loopInst.localsDepth
      ark.pop(nPops)
      inst = ark.loopStack.shift()!.matchingClose.next
    } else if (inst instanceof ArkContinueInst) {
      mem.set(inst.id, ArkNull())
      const nPops = ark.frame.locals.length - inst.loopInst.localsDepth
      ark.pop(nPops)
      inst = ark.loopStack[0]
    } else if (inst instanceof ArkYieldInst) {
      const result = mem.get(inst.argId)!
      ark.inst = inst
      if (ark.outerState === undefined || ark.outerState.continuation === undefined) {
        throw new ArkRuntimeError(ark, 'yield outside a generator', inst.sourceLoc)
      }
      ark = ark.outerState
      const caller = ark.inst!
      inst = caller.next
      prevInst = caller
      ark.frame.memory.set(caller.id, result)
    } else if (inst instanceof ArkReturnInst) {
      const result = mem.get(inst.argId)!
      ark = ark.outerState
      if (ark === undefined) {
        return result
      }
      if (ark.continuation !== undefined) {
        // If we're in a generator, end it.
        ark.continuation.done = true
      }
      const caller = ark.inst!
      inst = caller.next
      prevInst = caller
      ark.frame.memory.set(caller.id, result)
    } else if (inst instanceof ArkCallInst) {
      const args = inst.argIds.map((id) => mem.get(id)!)
      const callable: ArkVal = mem.get(inst.fnId)!
      if (callable instanceof ArkGeneratorClosure) {
        const result = new ArkContinuation(new ArkState(
          callable.body,
          new ArkFrame(
            makeLocals(callable.params, inst.argIds.map((id) => mem.get(id)!)),
            callable.captures,
            new Map(),
            new ArkFrameDebugInfo(inst.name, inst.sourceLoc),
          ),
          ark,
        ))
        mem.set(inst.id, result)
        inst = inst.next
      } else if (callable instanceof ArkClosure) {
        ark.inst = inst
        ark = new ArkState(
          callable.body,
          new ArkFrame(
            makeLocals(callable.params, inst.argIds.map((id) => mem.get(id)!)),
            callable.captures,
            new Map(),
            new ArkFrameDebugInfo(inst.name, inst.sourceLoc),
          ),
          ark,
        )
        inst = ark.inst
      } else if (callable instanceof ArkContinuation) {
        if (callable.done) {
          mem.set(inst.id, ArkNull())
          inst = inst.next
        } else {
          callable.state.frame.memory.set(callable.state.inst!.id, mem.get(inst.argIds[0])!)
          ark.inst = inst
          ark.continuation = callable
          callable.state.outerState = ark
          ark = callable.state
          inst = ark.inst
          // If we're resuming, 'inst' pointed to the ArkYieldInst so we can
          // set its result, so we need to advance to the next instruction.
          if (inst instanceof ArkYieldInst) {
            inst = inst.next
          }
        }
      } else if (callable instanceof NativeFn) {
        mem.set(inst.id, callable.body(...args))
        inst = inst.next
      } else if (callable instanceof NativeAsyncFn) {
        mem.set(inst.id, await callable.body(...args))
        inst = inst.next
      } else {
        throw new ArkRuntimeError(ark, 'Invalid call', inst.sourceLoc)
      }
    } else if (inst instanceof ArkSetLocalInst) {
      const result = mem.get(inst.valId)!
      let ref: ArkRef
      if (inst instanceof ArkSetCaptureInst) {
        ref = ark.frame.captures[inst.lexpIndex]
      } else {
        ref = ark.frame.locals[inst.lexpIndex]
      }
      const oldVal = ref.get()
      if (
        oldVal !== ArkUndefined
        && oldVal.constructor !== ArkNullVal
        && oldVal.constructor !== result.constructor) {
        throw new ArkRuntimeError(ark, 'Assignment to different type', inst.sourceLoc)
      }
      mem.set(inst.id, result)
      ref.set(result)
      inst = inst.next
    } else if (inst instanceof ArkSetPropertyInst) {
      const result = mem.get(inst.valId)!
      const obj = mem.get(inst.lexpId)! as ArkObject
      if (obj.get(inst.prop) === ArkUndefined) {
        throw new ArkRuntimeError(ark, 'Invalid property', inst.sourceLoc)
      }
      obj.set(inst.prop, result)
      mem.set(inst.id, result)
      inst = inst.next
    } else if (inst instanceof ArkObjectLiteralInst) {
      const properties = new Map<string, ArkVal>()
      for (const [k, v] of inst.properties) {
        properties.set(k, mem.get(v)!)
      }
      mem.set(inst.id, new ArkObject(properties))
      inst = inst.next
    } else if (inst instanceof ArkListLiteralInst) {
      mem.set(inst.id, new ArkList(inst.valIds.map((id) => mem.get(id)!)))
      inst = inst.next
    } else if (inst instanceof ArkMapLiteralInst) {
      const map = new Map<ArkVal, ArkVal>()
      for (const [k, v] of inst.map) {
        map.set(mem.get(k)!, mem.get(v)!)
      }
      mem.set(inst.id, new ArkMap(map))
      inst = inst.next
    } else if (inst instanceof ArkPropertyInst) {
      const obj = mem.get(inst.objId)!
      if (!(obj instanceof ArkAbstractObjectBase)) {
        throw new ArkRuntimeError(ark, 'Invalid object', inst.sourceLoc)
      }
      const result = obj.get(inst.prop)
      if (result === ArkUndefined) {
        throw new ArkRuntimeError(ark, 'Invalid property', inst.sourceLoc)
      }
      mem.set(inst.id, result)
      inst = inst.next
    } else if (inst instanceof ArkCaptureInst) {
      const capture = ark.frame.captures[inst.index].get()
      if (capture === undefined) {
        throw new Error('undefined capture')
      }
      mem.set(inst.id, capture)
      inst = inst.next
    } else if (inst instanceof ArkLocalInst) {
      const local = ark.frame.locals[inst.index].get()
      if (local === undefined) {
        throw new Error('undefined local')
      }
      mem.set(inst.id, local)
      inst = inst.next
    } else {
      throw new Error('invalid ArkInst')
    }
  }
  return prevInst ? ark.frame.memory.get(prevInst.id)! : ArkUndefined
}

export async function pushLets(ark: ArkState, boundVars: [string, ArkInst][]) {
  const lets = makeLocals(boundVars.map((bv) => bv[0]), [])
  ark.push(lets)
  const vals: ArkVal[] = []
  for (const bv of boundVars) {
    ark.inst = bv[1]
    vals.push(await evalFlat(ark))
  }
  for (let i = 0; i < lets.length; i += 1) {
    lets[i].set(vals[i])
  }
  return lets.length
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
      return callFlat(new ArkState(val.body, new ArkFrame(locals, val.captures)), val)
    }
  } else if (val instanceof NativeFn || val instanceof NativeAsyncFn) {
    return (...args: unknown[]) => toJs(val.body(...args.map((arg) => fromJs(arg))))
  }
  return val
}
