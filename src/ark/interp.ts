import fs from 'fs'
import assert from 'assert'
import {CompiledArk, Namespace} from './compiler.js'
import {ArkFromJsError, fromJs, toJs} from './ffi.js'

export class RuntimeStack {
  // Each stack frame consists of a pair of local vars and captures
  public stack: [Val[], Ref[]][]

  constructor(outerStack: [Val[], Ref[]][] = [[[], []]]) {
    assert(outerStack.length > 0)
    this.stack = outerStack
  }

  push(items: Val[]) {
    return new (this.constructor as any)(
      [[[...this.stack[0][0].slice(), ...items], this.stack[0][1]], ...this.stack.slice(1)],
    )
  }

  pushFrame(frame: [Val[], Ref[]]) {
    return new (this.constructor as any)([frame, ...this.stack.slice()])
  }
}

export type FreeVarsMap = Map<string, Ref[]>

export class ArkState {
  constructor() {
    this.debug.set('sourceStack', [])
    this.debug.set('callStack', [])
    this.debug.set('fnSymStack', [])
  }

  stack = new RuntimeStack()

  debug: Map<string, any> = new Map()

  captureFreeVars(cl: Fexpr): Ref[] {
    const frame: Ref[] = []
    for (const loc of cl.boundFreeVars) {
      const ref = new ValRef(this.stack.pushFrame([[], []]).stack[loc.level][0][loc.index])
      frame.push(ref)
    }
    return frame
  }

  evaluateArgs(...args: Val[]) {
    const evaluatedArgs: Val[] = []
    for (const arg of args) {
      evaluatedArgs.push(arg.eval(this))
    }
    return evaluatedArgs
  }

  run(compiledVal: CompiledArk): Val {
    if (compiledVal.freeVars.size !== 0) {
      throw new ArkRuntimeError(
        `Undefined symbols ${[...compiledVal.freeVars.keys()].join(', ')}`,
        compiledVal.value,
      )
    }
    return compiledVal.value.eval(this)
  }
}

export class ArkRuntimeError extends Error {
  constructor(public message: string, public val: Val) {
    super()
  }
}

// Base class for compiled code.
export class Val {
  static nextId = 0

  constructor() {
    this.debug.set('uid', Val.nextId)
    Val.nextId += 1
  }

  children: Val[] = []

  static parentRef: WeakMap<Val, [Val, number]> = new WeakMap()

  debug: Map<string, any> = new Map()

  _eval(_ark: ArkState): Val {
    return this
  }

  eval(ark: ArkState): Val {
    const sourceLoc = this.debug.get('source')
    if (sourceLoc !== undefined) {
      ark.debug.get('sourceStack').unshift(sourceLoc)
    }
    const res = this._eval(ark)
    if (sourceLoc !== undefined) {
      ark.debug.get('sourceStack').shift()
    }
    return res
  }

  protected addChild(child: Val) {
    Val.parentRef.set(child, [this, this.children.length])
    this.children.push(child)
  }

  setSelf(val: Val) {
    const [parent, index] = Val.parentRef.get(this)!
    parent.children[index] = val
  }
}

export class ConcreteVal<T> extends Val {
  constructor(public val: T) {
    super()
  }
}

class ConcreteInterned {
  constructor() {
    throw new Error('use ConcreteInterned.create, not constructor')
  }

  private static intern: Map<any, WeakRef<ConcreteVal<any>>> = new Map()

  private static registry: FinalizationRegistry<any> = new FinalizationRegistry(
    (key) => this.intern.delete(key),
  )

  static value<T>(rawVal: T): ConcreteVal<T> {
    let ref = ConcreteInterned.intern.get(rawVal)
    let val: ConcreteVal<T>
    if (ref === undefined || ref.deref() === undefined) {
      val = new ConcreteVal(rawVal)
      ref = new WeakRef(val)
      ConcreteInterned.intern.set(rawVal, ref)
      ConcreteInterned.registry.register(val, rawVal, val)
    } else {
      val = ref.deref()!
    }
    return val
  }
}

export const Undefined = new Val()
Undefined.debug.set('name', 'Undefined')
export const Null = () => ConcreteInterned.value(null)
export const Bool = (b: boolean) => ConcreteInterned.value(b)
export const Num = (n: number) => ConcreteInterned.value(n)
export const Str = (s: string) => ConcreteInterned.value(s)

export class NonLocalReturn extends Error {
  constructor(public readonly val: Val = Null()) {
    super()
  }
}

export class BreakException extends NonLocalReturn {}

export class ReturnException extends NonLocalReturn {}

export class ContinueException extends NonLocalReturn {}

export function bindArgsToParams(params: string[], args: Val[]): Ref[] {
  const frame: ValRef[] = params.map(
    (_key, index) => new ValRef(args[index] ?? Undefined),
  )
  if (args.length > params.length) {
    // FIXME: Support '...' as an identifier
    frame.push(new ValRef(new List(args.slice(params.length))))
  }
  return frame
}

class FexprClosure extends Val {
  constructor(public params: string[], public freeVars: Ref[], body: Val) {
    super()
    this.addChild(body)
  }

  call(ark: ArkState, ...args: Val[]): Val {
    let res: Val = Null()
    try {
      const frame = bindArgsToParams(this.params, args)
      const oldStack = ark.stack
      ark.stack = ark.stack.pushFrame([frame, this.freeVars])
      res = this.children[0].eval(ark)
      ark.stack = oldStack
    } catch (e) {
      if (!(e instanceof ReturnException)) {
        throw e
      }
      res = e.val
    }
    return res
  }
}

class FnClosure extends FexprClosure {
  call(ark: ArkState, ...args: Val[]): Val {
    return super.call(ark, ...ark.evaluateArgs(...args))
  }
}

export class Fexpr extends Val {
  boundFreeVars: StackRef[] = []

  constructor(public params: string[], protected freeVars: FreeVarsMap, body: Val) {
    super()
    this.addChild(body)
    let numStackFreeVars = 0
    for (const [, refs] of this.freeVars) {
      let isStackFreeVar = false
      for (const ref of refs) {
        if (ref instanceof StackRef) {
          assert(ref.level > 0)
          if (!isStackFreeVar) {
            isStackFreeVar = true
            this.boundFreeVars.push(ref)
            numStackFreeVars += 1
          }
          const captureRef = new CaptureRef(numStackFreeVars - 1)
          captureRef.debug.set('name', ref.debug.get('name'))
          ref.setSelf(captureRef)
        }
      }
    }
  }

  _eval(ark: ArkState): Val {
    return new FexprClosure(this.params, ark.captureFreeVars(this), this.children[0])
  }
}

export class Fn extends Fexpr {
  _eval(ark: ArkState): Val {
    return new FnClosure(this.params, ark.captureFreeVars(this), this.children[0])
  }
}

export class NativeFexpr extends Val {
  constructor(public body: (ark: ArkState, ...args: Val[]) => Val) {
    super()
  }

  call(ark: ArkState, ...args: Val[]) {
    return this.body(ark, ...args)
  }
}

export class NativeFn extends NativeFexpr {
  call(ark: ArkState, ...args: Val[]) {
    return this.body(ark, ...ark.evaluateArgs(...args))
  }
}

export class Call extends Val {
  constructor(fn: Val, args: Val[]) {
    super()
    this.addChild(fn)
    for (const arg of args) {
      this.addChild(arg)
    }
  }

  _eval(ark: ArkState): Val {
    const fn = this.children[0]
    let sym: Ref | undefined
    if (fn instanceof Get && fn.children[0] instanceof Ref) {
      sym = fn.children[0]
    }
    const fnVal = fn.eval(ark)
    if (!(fnVal instanceof FexprClosure || fnVal instanceof NativeFexpr)) {
      throw new ArkRuntimeError('Invalid call', this)
    }
    const callStack = ark.debug.get('callStack')
    const fnSymStack = ark.debug.get('fnSymStack')
    callStack.unshift(this)
    fnSymStack.unshift(sym)
    const args = this.children.slice(1)
    const res = fnVal.call(ark, ...args)
    callStack.shift()
    fnSymStack.pop()
    return res
  }
}

export abstract class Ref extends Val {
  abstract get(stack: RuntimeStack): Val

  abstract set(stack: RuntimeStack, val: Val): Val

  eval(ark: ArkState): Val {
    return this.get(ark.stack)
  }
}

export class ValRef extends Ref {
  constructor(val: Val = Null()) {
    super()
    this.addChild(val)
  }

  get(_stack: RuntimeStack): Val {
    return this.children[0]
  }

  set(_stack: RuntimeStack, val: Val): Val {
    this.children[0] = val
    return val
  }
}

export class StackRef extends Ref {
  constructor(public level: number, public index: number) {
    super()
  }

  get(stack: RuntimeStack): Val {
    return stack.stack[this.level][0][this.index]
  }

  set(stack: RuntimeStack, val: Val) {
    stack.stack[this.level][0][this.index] = val
    return val
  }
}

export class CaptureRef extends Ref {
  constructor(public index: number) {
    super()
  }

  get(stack: RuntimeStack): Val {
    return stack.stack[0][1][this.index].get(stack)
  }

  set(stack: RuntimeStack, val: Val) {
    const ref = stack.stack[0][1][this.index]
    ref.set(stack, val)
    return val
  }
}

export class Get extends Val {
  constructor(val: Val) {
    super()
    this.addChild(val)
  }

  _eval(ark: ArkState): Val {
    const ref = (this.children[0].eval(ark) as Ref)
    const val = ref.get(ark.stack)
    if (val === Undefined) {
      throw new ArkRuntimeError(`Uninitialized symbol ${this.children[0].debug.get('name')}`, this)
    }
    return val
  }
}

export class Ass extends Val {
  constructor(ref: Val, val: Val) {
    super()
    this.addChild(ref)
    this.addChild(val)
  }

  _eval(ark: ArkState): Val {
    const ref = this.children[0].eval(ark)
    const res = this.children[1].eval(ark)
    if (!(ref instanceof Ref)) {
      throw new ArkRuntimeError('Invalid assignment', this)
    }
    ref.set(ark.stack, res)
    return res
  }
}

export class Class extends Val {
  public val: Map<string, Val>

  constructor(obj: Map<string, Val>) {
    super()
    this.val = obj
  }

  get(prop: string): Val | undefined {
    return this.val.get(prop)
  }

  set(prop: string, val: Val) {
    this.val.set(prop, val)
    return val
  }
}

export class Obj extends Class {}

export class ObjLiteral extends Obj {
  _eval(ark: ArkState): Val {
    const inits = new Map<string, Val>()
    for (const [k, v] of this.val) {
      inits.set(k, v.eval(ark))
    }
    return new Obj(inits)
  }
}

export class NativeObj extends Val {
  constructor(public obj: Object) {
    super()
  }

  get(prop: string): Val | undefined {
    try {
      return fromJs((this.obj as any)[prop], this.obj)
    } catch (e) {
      if (e instanceof ArkFromJsError) {
        throw new ArkRuntimeError(e.message, this)
      }
      throw e
    }
  }

  set(prop: string, val: Val) {
    (this.obj as any)[prop] = toJs(val)
    return val
  }
}

export class Prop extends Val {
  constructor(public prop: string, obj: Val) {
    super()
    this.addChild(obj)
  }

  _eval(ark: ArkState): Val {
    const obj = this.children[0].eval(ark)
    return new PropRef(obj as Obj, this.prop)
  }
}

export class PropRef extends Ref {
  constructor(obj: Obj, public prop: string) {
    super()
    this.addChild(obj)
  }

  get(_stack: RuntimeStack) {
    return (this.children[0] as Obj).get(this.prop) ?? Null()
  }

  set(_stack: RuntimeStack, val: Val) {
    (this.children[0] as Obj).set(this.prop, val)
    return val
  }
}

export class Dict extends Class {
  constructor(public map: Map<Val, Val>) {
    super(new Namespace([
      ['set', new NativeFn(
        (_ark: ArkState, index: Val, val: Val) => {
          this.map.set(index, val)
          return val
        },
      )],
      ['get', new NativeFn((_ark: ArkState, index: Val) => this.map.get(index) ?? Null())],
    ]))
  }
}

export class DictLiteral extends Dict {
  eval(ark: ArkState): Val {
    const evaluatedMap = new Map<any, Val>()
    for (const [k, v] of this.map) {
      evaluatedMap.set(k.eval(ark), v.eval(ark))
    }
    return new Dict(evaluatedMap)
  }
}

export class List extends Class {
  constructor(public list: Val[]) {
    super(new Namespace([
      ['get', new NativeFn((_ark: ArkState, index: Val) => this.list[toJs(index)])],
      ['set', new NativeFn(
        (_ark: ArkState, index: Val, val: Val) => {
          this.list[toJs(index)] = val
          return val
        },
      )],
    ]))
    this.val.set('length', Num(this.list.length))
  }
}

export class ListLiteral extends List {
  eval(ark: ArkState): Val {
    return new List(this.list.map((e) => e.eval(ark)))
  }
}

export class Let extends Val {
  constructor(public boundVars: string[], public body: Val) {
    super()
  }

  _eval(ark: ArkState): Val {
    const lets = bindArgsToParams(this.boundVars, [])
    const oldStack = ark.stack
    ark.stack = ark.stack.push(lets)
    const res = this.body.eval(ark)
    ark.stack = oldStack
    return res
  }
}

export const intrinsics = new Namespace([
  ['pos', new NativeFn((_ark: ArkState, val: Val) => Num(+toJs(val)))],
  ['neg', new NativeFn((_ark: ArkState, val: Val) => Num(-toJs(val)))],
  ['not', new NativeFn((_ark: ArkState, val: Val) => Bool(!toJs(val)))],
  ['~', new NativeFn((_ark: ArkState, val: Val) => Num(~toJs(val)))],
  ['seq', new NativeFexpr((ark: ArkState, ...args: Val[]) => {
    let res: Val = Null()
    for (const exp of args) {
      res = exp.eval(ark)
    }
    return res
  })],
  ['if', new NativeFexpr((ark: ArkState, cond: Val, e_then: Val, e_else: Val) => {
    const condVal = cond.eval(ark)
    if (toJs(condVal)) {
      return e_then.eval(ark)
    }
    return e_else ? e_else.eval(ark) : Null()
  })],
  ['and', new NativeFexpr((ark: ArkState, left: Val, right: Val) => {
    const leftVal = left.eval(ark)
    if (toJs(leftVal)) {
      return right.eval(ark)
    }
    return leftVal
  })],
  ['or', new NativeFexpr((ark: ArkState, left: Val, right: Val) => {
    const leftVal = left.eval(ark)
    if (toJs(leftVal)) {
      return leftVal
    }
    return right.eval(ark)
  })],
  ['loop', new NativeFexpr((ark: ArkState, body: Val) => {
    for (; ;) {
      try {
        body.eval(ark)
      } catch (e) {
        if (e instanceof BreakException) {
          return e.val
        }
        if (!(e instanceof ContinueException)) {
          throw e
        }
      }
    }
  })],
  ['break', new NativeFn((_ark: ArkState, val: Val) => {
    throw new BreakException(val)
  })],
  ['continue', new NativeFn(() => {
    throw new ContinueException()
  })],
  ['return', new NativeFn((_ark: ArkState, val: Val) => {
    throw new ReturnException(val)
  })],
  ['=', new NativeFn((_ark: ArkState, left: Val, right: Val) => Bool(toJs(left) === toJs(right)))],
  ['!=', new NativeFn((_ark: ArkState, left: Val, right: Val) => Bool(toJs(left) !== toJs(right)))],
  ['<', new NativeFn((_ark: ArkState, left: Val, right: Val) => Bool(toJs(left) < toJs(right)))],
  ['<=', new NativeFn((_ark: ArkState, left: Val, right: Val) => Bool(toJs(left) <= toJs(right)))],
  ['>', new NativeFn((_ark: ArkState, left: Val, right: Val) => Bool(toJs(left) > toJs(right)))],
  ['>=', new NativeFn((_ark: ArkState, left: Val, right: Val) => Bool(toJs(left) >= toJs(right)))],
  ['+', new NativeFn((_ark: ArkState, left: Val, right: Val) => Num(toJs(left) + toJs(right)))],
  ['-', new NativeFn((_ark: ArkState, left: Val, right: Val) => Num(toJs(left) - toJs(right)))],
  ['*', new NativeFn((_ark: ArkState, left: Val, right: Val) => Num(toJs(left) * toJs(right)))],
  ['/', new NativeFn((_ark: ArkState, left: Val, right: Val) => Num(toJs(left) / toJs(right)))],
  ['%', new NativeFn((_ark: ArkState, left: Val, right: Val) => Num(toJs(left) % toJs(right)))],
  ['**', new NativeFn((_ark: ArkState, left: Val, right: Val) => Num(toJs(left) ** toJs(right)))],
  ['&', new NativeFn((_ark: ArkState, left: Val, right: Val) => Num(toJs(left) & toJs(right)))],
  ['|', new NativeFn((_ark: ArkState, left: Val, right: Val) => Num(toJs(left) | toJs(right)))],
  ['^', new NativeFn((_ark: ArkState, left: Val, right: Val) => Num(toJs(left) ^ toJs(right)))],
  ['<<', new NativeFn((_ark: ArkState, left: Val, right: Val) => Num(toJs(left) << toJs(right)))],
  ['>>', new NativeFn((_ark: ArkState, left: Val, right: Val) => Num(toJs(left) >> toJs(right)))],
  ['>>>', new NativeFn((_ark: ArkState, left: Val, right: Val) => Num(toJs(left) >>> toJs(right)))],
])

export const globals = new Map([
  ['pi', new ValRef(Num(Math.PI))],
  ['e', new ValRef(Num(Math.E))],
  ['print', new ValRef(new NativeFn((_ark: ArkState, obj: Val) => {
    console.log(toJs(obj))
    return Null()
  }))],
  ['debug', new ValRef(new NativeFn((_ark: ArkState, obj: Val) => {
    debug(obj)
    return Null()
  }))],
  ['fs', new ValRef(new NativeObj(fs))],
  // ['js', new ValRef(new Obj(new Map([[
  //   'use', new NativeFn('js', async (_ark: ArkState, ...args: Val[]) => {
  //     const importPath = (args.map(toJs).join('.'))
  //     const module = await import(requirePath)
  //     const wrappedModule = new Map()
  //     // eslint-disable-next-line guard-for-in
  //     for (const key in module) {
  //       wrappedModule.set(key, jsToVal(module[key]))
  //     }
  //     return new Obj(wrappedModule)
  //   }),
  // ]])))],
  ['JSON', new ValRef(new NativeObj(JSON))],
  ['process', new ValRef(new NativeObj(process))],
  ['RegExp', new ValRef(new NativeFn((_ark: ArkState, regex: Val, options: Val) => new NativeObj(new RegExp(
    (regex as ConcreteVal<string>).val,
    ((options ?? Str('')) as ConcreteVal<string>).val,
  )))),
  ],
])
if (globalThis.document !== undefined) {
  globals.set('document', new ValRef(new NativeObj(globalThis.document)))
}

export function debug(x: any, depth: number | null = 1) {
  console.dir(x, {depth, colors: true})
}
