// Ark interpreter.
// © Reuben Thomas 2023
// Released under the GPL version 3, or (at your option) any later version.

import assert from 'assert'
import util from 'util'

import programVersion from '../version.js'
import {CompiledArk, Namespace} from './parser.js'
import {ArkFromJsError, fromJs, toJs} from './ffi.js'

// Each stack frame consists of a pair of local vars and captures, plus
// debug info.
type ArkFrame = [ArkRef[], ArkRef[], FrameDebugInfo]

class FrameDebugInfo {
  public name: ArkRef | undefined

  public source: ArkVal | undefined
}

export class RuntimeStack {
  constructor(public readonly stack: ArkFrame[] = [[[], [], new FrameDebugInfo()]]) {
    assert(stack.length > 0)
  }

  push(items: ArkRef[]) {
    this.stack[0][0].push(...items)
    return this
  }

  pop(nItems: number) {
    for (let i = 0; i < nItems; i += 1) {
      this.stack[0][0].pop()
    }
  }

  pushFrame(frame: ArkFrame) {
    this.stack.unshift(frame)
    return this
  }

  popFrame() {
    this.stack.shift()
    return this
  }
}

export class ArkState {
  readonly stack = new RuntimeStack()

  async run(compiledVal: CompiledArk): Promise<ArkVal> {
    if (compiledVal.freeVars.size !== 0) {
      throw new ArkRuntimeError(
        `Undefined symbols ${[...compiledVal.freeVars.keys()].join(', ')}`,
        compiledVal.value,
      )
    }
    const res = await compiledVal.value.eval(this)
    return res
  }
}

export class ArkRuntimeError extends Error {
  sourceLoc: unknown

  constructor(public message: string, public val: ArkVal) {
    super()
    this.sourceLoc = val.debug.sourceLoc
  }
}

// Base class for compiled code.
export class Ark {
  static nextId = 0

  constructor() {
    Object.defineProperty(this, 'debug', {enumerable: false})
    this.debug.uid = Ark.nextId
    Ark.nextId += 1
  }

  debug: ArkDebugInfo = new ArkDebugInfo()
}

class ArkDebugInfo {
  uid: number | undefined

  name: string | undefined

  sourceLoc: unknown

  env: string | undefined
}

export class ArkVal extends Ark {}

export class ArkExp extends Ark {
  constructor() {
    super()
    // Make this class incompatible with ArkVal.
    Object.defineProperty(this, '_arkexp', {enumerable: false})
  }

  _arkexp: undefined

  eval(_ark: ArkState): Promise<ArkVal> {
    return Promise.resolve(this)
  }
}

export class ArkLiteral extends ArkExp {
  constructor(public val: ArkVal = ArkNull()) {
    super()
  }

  eval(_ark: ArkState): Promise<ArkVal> {
    return Promise.resolve(this.val)
  }
}

// FIXME: Need to differentiate "indexable" (List, string) from "has
// properties" (List, Object).
abstract class ArkAbstractClass extends ArkVal {
  abstract get(prop: string): ArkVal | undefined

  abstract set(prop: string, val: ArkVal): ArkVal
}

export class ArkClass extends ArkAbstractClass {
  constructor(public properties: Map<string, ArkVal> = new Map()) {
    super()
  }

  get(prop: string): ArkVal | undefined {
    return this.properties.get(prop)
  }

  set(prop: string, val: ArkVal) {
    this.properties.set(prop, val)
    return val
  }
}

export abstract class ArkConcreteVal<T> extends ArkClass {
  constructor(public val: T) {
    super()
  }
}

export class ArkNullClass extends ArkConcreteVal<null> {}
export class ArkBooleanClass extends ArkConcreteVal<boolean> {}
export class ArkNumberClass extends ArkConcreteVal<number> {}
export class ArkStringClass extends ArkConcreteVal<string> {
  constructor(val: string) {
    super(val)
    this.properties = new Map([
      ['get', new NativeFn(['index'], (index: ArkVal) => ArkString(this.val[toJs(index) as number]))],
      ['iterator', new NativeFn([], () => {
        const str = this.val
        const generator = (function* listGenerator() {
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
    throw new Error('use ConcreteInterned.create, not constructor')
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
  return ConcreteInterned.value<ArkNullClass, null>(ArkNullClass, null)
}
export function ArkBoolean(b: boolean) {
  return ConcreteInterned.value<ArkBooleanClass, boolean>(ArkBooleanClass, b)
}
export function ArkNumber(n: number) {
  return ConcreteInterned.value<ArkNumberClass, number>(ArkNumberClass, n)
}
export function ArkString(s: string) {
  return ConcreteInterned.value<ArkStringClass, string>(ArkStringClass, s)
}

export class ArkNonLocalReturn extends Error {
  constructor(public readonly val: ArkVal = ArkNull()) {
    super()
  }
}

export class ArkBreakException extends ArkNonLocalReturn {}

export class ArkReturnException extends ArkNonLocalReturn {}

export class ArkContinueException extends ArkNonLocalReturn {}

function bindArgsToParams(params: string[], args: ArkVal[]): ArkRef[] {
  const frame: ArkValRef[] = params.map((_val, index) => new ArkValRef(args[index] ?? ArkUndefined))
  if (args.length > params.length) {
    frame.push(...args.slice(params.length).map((val) => new ArkValRef(val)))
  }
  return frame
}

abstract class ArkCallable extends ArkVal {
  constructor(public params: string[], public freeVars: ArkRef[]) {
    super()
  }

  abstract call(ark: ArkState): Promise<ArkVal>
}

class ArkClosure extends ArkCallable {
  constructor(params: string[], freeVars: ArkRef[], public body: ArkExp) {
    super(params, freeVars)
  }

  async call(ark: ArkState): Promise<ArkVal> {
    try {
      return await this.body.eval(ark)
    } catch (e) {
      if (!(e instanceof ArkReturnException)) {
        throw e
      }
      // Pop intrinsics.return's call frame
      ark.stack.popFrame()
      return e.val
    }
  }
}

export class NativeFn extends ArkCallable {
  constructor(params: string[], public body: (...args: ArkVal[]) => ArkVal) {
    super(params, [])
  }

  async call(ark: ArkState): Promise<ArkVal> {
    const args = ark.stack.stack[0][0].map((ref) => ref.get(ark.stack))
    return Promise.resolve(this.body(...args))
  }
}

export class NativeAsyncFn extends ArkCallable {
  constructor(params: string[], public body: (...args: ArkVal[]) => Promise<ArkVal>) {
    super(params, [])
  }

  async call(ark: ArkState): Promise<ArkVal> {
    const args = ark.stack.stack[0][0].map((ref) => ref.get(ark.stack))
    return this.body(...args)
  }
}

export class ArkFn extends ArkExp {
  constructor(public params: string[], public boundFreeVars: ArkStackRef[], public body: ArkExp) {
    super()
  }

  eval(ark: ArkState): Promise<ArkVal> {
    const freeVarsFrame: ArkRef[] = []
    for (const loc of this.boundFreeVars) {
      const ref = ark.stack.stack[loc.level - 1][0][loc.index]
      freeVarsFrame.push(ref)
    }
    return Promise.resolve(new ArkClosure(this.params, freeVarsFrame, this.body))
  }
}

export class ArkCall extends ArkExp {
  constructor(public fn: ArkExp, public args: ArkExp[]) {
    super()
  }

  async eval(ark: ArkState): Promise<ArkVal> {
    const fn = this.fn
    let sym: ArkRef | undefined
    if (fn instanceof ArkGet && fn.val instanceof ArkLiteral && fn.val.val instanceof ArkRef) {
      sym = fn.val.val
    }
    const fnVal = await fn.eval(ark)
    if (!(fnVal instanceof ArkCallable)) {
      throw new ArkRuntimeError('Invalid call', this)
    }
    const evaluatedArgs = []
    for (const arg of this.args) {
      // eslint-disable-next-line no-await-in-loop
      evaluatedArgs.push(await arg.eval(ark))
    }
    const frame = bindArgsToParams(fnVal.params, evaluatedArgs)
    const debugInfo = new FrameDebugInfo()
    debugInfo.source = this
    debugInfo.name = sym
    ark.stack.pushFrame([frame, fnVal.freeVars, debugInfo])
    const res = await fnVal.call(ark)
    ark.stack.popFrame()
    return res
  }
}

export abstract class ArkRef extends ArkVal {
  abstract get(stack: RuntimeStack): ArkVal

  abstract set(stack: RuntimeStack, val: ArkVal): ArkVal
}

export class ArkValRef extends ArkRef {
  constructor(public val: ArkVal = ArkNull()) {
    super()
  }

  get(_stack: RuntimeStack): ArkVal {
    return this.val
  }

  set(_stack: RuntimeStack, val: ArkVal): ArkVal {
    this.val = val
    return val
  }
}

export class ArkStackRef extends ArkRef {
  constructor(public level: number, public index: number) {
    super()
  }

  get(stack: RuntimeStack): ArkVal {
    return stack.stack[this.level][0][this.index].get(stack)
  }

  set(stack: RuntimeStack, val: ArkVal) {
    stack.stack[this.level][0][this.index].set(stack, val)
    return val
  }
}

export class ArkCaptureRef extends ArkRef {
  constructor(public index: number) {
    super()
  }

  get(stack: RuntimeStack): ArkVal {
    return stack.stack[0][1][this.index].get(stack)
  }

  set(stack: RuntimeStack, val: ArkVal) {
    const ref = stack.stack[0][1][this.index]
    ref.set(stack, val)
    return val
  }
}

export class ArkGet extends ArkExp {
  constructor(public val: ArkExp) {
    super()
  }

  async eval(ark: ArkState): Promise<ArkVal> {
    const ref = await (this.val.eval(ark) as Promise<ArkRef>)
    const val = ref.get(ark.stack)
    if (val === ArkUndefined) {
      throw new ArkRuntimeError(`Uninitialized symbol ${this.val.debug.name}`, this)
    }
    return val
  }
}

export class ArkSet extends ArkExp {
  constructor(public ref: ArkExp, public val: ArkExp) {
    super()
  }

  async eval(ark: ArkState): Promise<ArkVal> {
    const ref = await this.ref.eval(ark)
    const res = await this.val.eval(ark)
    if (!(ref instanceof ArkRef)) {
      throw new ArkRuntimeError('Assignment to non-reference', this)
    }
    const oldVal = ref.get(ark.stack)
    if (oldVal !== ArkUndefined
      && oldVal.constructor !== ArkNullClass
      && res.constructor !== oldVal.constructor) {
      throw new ArkRuntimeError('Assignment to different type', this)
    }
    ref.set(ark.stack, res)
    return res
  }
}

export class ArkObject extends ArkClass {}

export class ArkObjectLiteral extends ArkExp {
  constructor(public properties: Map<string, ArkExp>) {
    super()
  }

  async eval(ark: ArkState): Promise<ArkVal> {
    const inits = new Map<string, ArkVal>()
    for (const [k, v] of this.properties) {
      // eslint-disable-next-line no-await-in-loop
      inits.set(k, await v.eval(ark))
    }
    return new ArkObject(inits)
  }
}

export class NativeObject extends ArkAbstractClass {
  constructor(public obj: object) {
    super()
  }

  get(prop: string): ArkVal | undefined {
    try {
      return fromJs((this.obj as {[key: string]: unknown})[prop], this.obj)
    } catch (e) {
      if (e instanceof ArkFromJsError) {
        throw new ArkRuntimeError(e.message, this)
      }
      throw e
    }
  }

  set(prop: string, val: ArkVal) {
    (this.obj as {[key: string]: unknown})[prop] = toJs(val)
    return val
  }
}

export class ArkProperty extends ArkExp {
  constructor(public prop: string, public obj: ArkExp) {
    super()
  }

  async eval(ark: ArkState): Promise<ArkVal> {
    const obj = await this.obj.eval(ark)
    // FIXME: This is ad-hoc. See ArkAbstractClass.
    if (!(obj instanceof ArkAbstractClass) || obj instanceof ArkNullClass) {
      throw new ArkRuntimeError('Attempt to read property of non-object', this)
    }
    return new ArkPropertyRef(obj, this.prop)
  }
}

export class ArkPropertyRef extends ArkRef {
  constructor(public obj: ArkAbstractClass, public prop: string) {
    super()
  }

  get(_stack: RuntimeStack) {
    return this.obj.get(this.prop) ?? ArkNull()
  }

  set(_stack: RuntimeStack, val: ArkVal) {
    this.obj.set(this.prop, val)
    return val
  }
}

export class ArkList extends ArkClass {
  constructor(public list: ArkVal[]) {
    super(new Map([
      ['get', new NativeFn(['index'], (index: ArkVal) => this.list[toJs(index) as number])],
      ['set', new NativeFn(
        ['index', 'val'],
        (index: ArkVal, val: ArkVal) => {
          this.list[toJs(index) as number] = val
          return val
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
      ['iterator', new NativeFn([], () => {
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
    this.properties.set('length', ArkNumber(this.list.length))
  }
}

export class ArkListLiteral extends ArkExp {
  constructor(public list: ArkExp[]) {
    super()
  }

  async eval(ark: ArkState): Promise<ArkVal> {
    const evaluatedList = []
    for (const e of this.list) {
      // eslint-disable-next-line no-await-in-loop
      evaluatedList.push(await e.eval(ark))
    }
    return new ArkList(evaluatedList)
  }
}

export class ArkMap extends ArkClass {
  constructor(public map: Map<ArkVal, ArkVal>) {
    super(new Map([
      ['set', new NativeFn(
        ['index', 'val'],
        (index: ArkVal, val: ArkVal) => {
          this.map.set(index, val)
          return val
        },
      )],
      ['get', new NativeFn(['index'], (index: ArkVal) => this.map.get(index) ?? ArkNull())],
      ['delete', new NativeFn(['index'], (index: ArkVal) => {
        this.map.delete(index)
        return this
      })],
      ['has', new NativeFn(['index'], (index: ArkVal) => ArkBoolean(this.map.has(index)))],
      ['iterator', new NativeFn([], () => {
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

  async eval(ark: ArkState): Promise<ArkVal> {
    const evaluatedMap = new Map<ArkVal, ArkVal>()
    for (const [k, v] of this.map) {
      // eslint-disable-next-line no-await-in-loop
      evaluatedMap.set(await k.eval(ark), await v.eval(ark))
    }
    return new ArkMap(evaluatedMap)
  }
}

export class ArkLet extends ArkExp {
  constructor(public boundVars: string[], public body: ArkExp) {
    super()
  }

  async eval(ark: ArkState): Promise<ArkVal> {
    const lets = bindArgsToParams(this.boundVars, [])
    ark.stack.push(lets)
    let res: ArkVal
    try {
      res = await this.body.eval(ark)
    } catch (e) {
      if (e instanceof ArkNonLocalReturn) {
        ark.stack.pop(lets.length)
      }
      throw e
    }
    ark.stack.pop(lets.length)
    return res
  }
}

export class ArkSequence extends ArkExp {
  constructor(public exps: ArkExp[]) {
    super()
  }

  async eval(ark: ArkState): Promise<ArkVal> {
    let res: ArkVal = ArkNull()
    for (const exp of this.exps) {
      // eslint-disable-next-line no-await-in-loop
      res = await exp.eval(ark)
    }
    return res
  }
}

export class ArkIf extends ArkExp {
  constructor(public cond: ArkExp, public thenExp: ArkExp, public elseExp?: ArkExp) {
    super()
  }

  async eval(ark: ArkState): Promise<ArkVal> {
    const condVal = await this.cond.eval(ark)
    let res: ArkVal
    if (toJs(condVal)) {
      res = await this.thenExp.eval(ark)
    } else {
      res = this.elseExp ? await this.elseExp.eval(ark) : ArkNull()
    }
    return res
  }
}

export class ArkAnd extends ArkExp {
  constructor(public left: ArkExp, public right: ArkExp) {
    super()
  }

  async eval(ark: ArkState): Promise<ArkVal> {
    const leftVal = await this.left.eval(ark)
    if (toJs(leftVal)) {
      // eslint-disable-next-line @typescript-eslint/return-await
      return await this.right.eval(ark)
    }
    return leftVal
  }
}

export class ArkOr extends ArkExp {
  constructor(public left: ArkExp, public right: ArkExp) {
    super()
  }

  async eval(ark: ArkState): Promise<ArkVal> {
    const leftVal = await this.left.eval(ark)
    if (toJs(leftVal)) {
      return leftVal
    }
    // eslint-disable-next-line @typescript-eslint/return-await
    return await this.right.eval(ark)
  }
}

export class ArkLoop extends ArkExp {
  constructor(public body: ArkExp) {
    super()
  }

  async eval(ark: ArkState): Promise<ArkVal> {
    for (; ;) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await this.body.eval(ark)
      } catch (e) {
        if (e instanceof ArkBreakException) {
          // Pop intrinsics.break's call frame
          ark.stack.popFrame()
          return e.val
        }
        if (!(e instanceof ArkContinueException)) {
          throw e
        }
        // Pop intrinsics.continue's call frame
        ark.stack.popFrame()
      }
    }
  }
}

export const intrinsics = new Namespace([
  ['pos', new NativeFn(['val'], (val: ArkVal) => ArkNumber(+(toJs(val) as number)))],
  ['neg', new NativeFn(['val'], (val: ArkVal) => ArkNumber(-(toJs(val) as number)))],
  ['not', new NativeFn(['val'], (val: ArkVal) => ArkBoolean(!(toJs(val) as boolean)))],
  ['~', new NativeFn(['val'], (val: ArkVal) => ArkNumber(~(toJs(val) as number)))],
  ['break', new NativeFn(['val'], (val: ArkVal) => {
    throw new ArkBreakException(val === ArkUndefined ? ArkNull() : val)
  })],
  ['continue', new NativeFn([], () => {
    throw new ArkContinueException()
  })],
  ['return', new NativeFn(['val'], (val: ArkVal) => {
    throw new ArkReturnException(val)
  })],
  ['=', new NativeFn(['left', 'right'], (left: ArkVal, right: ArkVal) => ArkBoolean(toJs(left) === toJs(right)))],
  ['!=', new NativeFn(['left', 'right'], (left: ArkVal, right: ArkVal) => ArkBoolean(toJs(left) !== toJs(right)))],
  ['<', new NativeFn(['left', 'right'], (left: ArkVal, right: ArkVal) => ArkBoolean((toJs(left) as number) < (toJs(right) as number)))],
  ['<=', new NativeFn(['left', 'right'], (left: ArkVal, right: ArkVal) => ArkBoolean((toJs(left) as number) <= (toJs(right) as number)))],
  ['>', new NativeFn(['left', 'right'], (left: ArkVal, right: ArkVal) => ArkBoolean((toJs(left) as number) > (toJs(right) as number)))],
  ['>=', new NativeFn(['left', 'right'], (left: ArkVal, right: ArkVal) => ArkBoolean((toJs(left) as number) >= (toJs(right) as number)))],
  ['+', new NativeFn(['left', 'right'], (left: ArkVal, right: ArkVal) => ArkNumber((toJs(left) as number) + (toJs(right) as number)))],
  ['-', new NativeFn(['left', 'right'], (left: ArkVal, right: ArkVal) => ArkNumber((toJs(left) as number) - (toJs(right) as number)))],
  ['*', new NativeFn(['left', 'right'], (left: ArkVal, right: ArkVal) => ArkNumber((toJs(left) as number) * (toJs(right) as number)))],
  ['/', new NativeFn(['left', 'right'], (left: ArkVal, right: ArkVal) => ArkNumber((toJs(left) as number) / (toJs(right) as number)))],
  ['%', new NativeFn(['left', 'right'], (left: ArkVal, right: ArkVal) => ArkNumber((toJs(left) as number) % (toJs(right) as number)))],
  ['**', new NativeFn(['left', 'right'], (left: ArkVal, right: ArkVal) => ArkNumber((toJs(left) as number) ** (toJs(right) as number)))],
  ['&', new NativeFn(['left', 'right'], (left: ArkVal, right: ArkVal) => ArkNumber((toJs(left) as number) & (toJs(right) as number)))],
  ['|', new NativeFn(['left', 'right'], (left: ArkVal, right: ArkVal) => ArkNumber((toJs(left) as number) | (toJs(right) as number)))],
  ['^', new NativeFn(['left', 'right'], (left: ArkVal, right: ArkVal) => ArkNumber((toJs(left) as number) ^ (toJs(right) as number)))],
  ['<<', new NativeFn(['left', 'right'], (left: ArkVal, right: ArkVal) => ArkNumber((toJs(left) as number) << (toJs(right) as number)))],
  ['>>', new NativeFn(['left', 'right'], (left: ArkVal, right: ArkVal) => ArkNumber((toJs(left) as number) >> (toJs(right) as number)))],
  ['>>>', new NativeFn(['left', 'right'], (left: ArkVal, right: ArkVal) => ArkNumber((toJs(left) as number) >>> (toJs(right) as number)))],
])

export const globals = new ArkObject(new Map([
  ['version', new ArkValRef(ArkString(programVersion))],
  ['pi', new ArkValRef(ArkNumber(Math.PI))],
  ['e', new ArkValRef(ArkNumber(Math.E))],
  ['print', new ArkValRef(new NativeFn(['obj'], (obj: ArkVal) => {
    console.log(toJs(obj))
    return ArkNull()
  }))],
  ['debug', new ArkValRef(new NativeFn(['obj'], (obj: ArkVal) => {
    debug(obj)
    return ArkNull()
  }))],
  ['js', new ArkValRef(new ArkObject(new Map([[
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
  ]])))],
  ['JSON', new ArkValRef(new NativeObject(JSON))],
  ['process', new ArkValRef(new NativeObject(process))],
  ['RegExp', new ArkValRef(new NativeFn(['regex', 'options'], (regex: ArkVal, options: ArkVal) => new NativeObject(new RegExp(
    (regex as ArkConcreteVal<string>).val,
    ((options ?? ArkString('')) as ArkConcreteVal<string>).val,
  )))),
  ],
]))
if (globalThis.document !== undefined) {
  globals.set('document', new ArkValRef(new NativeObject(globalThis.document)))
}

export function debug(x: unknown, depth: number | null = 1) {
  console.log(util.inspect(x, {depth, colors: true, sorted: true}))
}
