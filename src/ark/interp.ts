import assert from 'assert'
import {
  CompiledArk, Environment, FreeVars, Namespace,
} from './compiler'

export class Stack<T> {
  public stack: T[][]

  constructor(outerStack: T[][] = [[]]) {
    assert(outerStack.length > 0)
    this.stack = outerStack
  }

  push(refs: T[]) {
    this.stack[0].unshift(...refs)
    return this
  }

  pop(items: number) {
    this.stack[0].splice(0, items)
    return this
  }

  pushFrame(frame: T[]) {
    this.stack.unshift(frame)
    return this
  }

  popFrame(): this {
    this.stack.shift()
    return this
  }
}

// A RuntimeStack holds Refs to Vals, so that the Vals can potentially be updated
// while being be referred to in multiple Frames.
export class RuntimeStack extends Stack<Ref> {
  get(location: StackLocation) {
    return this.stack[location.level][location.index]
  }

  set(val: Val, location: StackLocation) {
    const ref = this.stack[location.level][location.index]
    ref.set(this, val)
  }
}

// Base class for compiled code.
export class Val {
  // Uncomment the following for debug.
  static counter = 0

  _uid: number

  constructor() {
    this._uid = Val.counter
    Val.counter += 1
  }

  _debug: Map<string, any> = new Map()
}

class ConcreteVal extends Val {
  constructor(public val: any = null) {
    super()
  }
}

export class Null extends ConcreteVal {
  constructor() {
    super(null)
  }
}

export class Bool extends ConcreteVal {
  constructor(public val: boolean) {
    super(val)
  }
}

export class Num extends ConcreteVal {
  constructor(public val: number) {
    super(val)
  }
}

export class Str extends ConcreteVal {
  constructor(public val: string) {
    super(val)
  }
}

export class HakException extends Error {
  constructor(protected val: Val = new Null()) {
    super()
  }

  value(): Val {
    return this.val
  }
}

export class BreakException extends HakException {}

export class ReturnException extends HakException {}

export class ContinueException extends HakException {}

export class PropertyException extends Error {}

export function bindArgsToParams(params: string[], args: Val[]): Ref[] {
  const frame: Ref[] = params.map(
    (_key, index) => new Ref(args[index] ?? new Null()),
  )
  if (args.length > params.length) {
    // FIXME: Support '...' as an identifier
    frame.push(new Ref(new List(args.slice(params.length))))
  }
  return frame
}

class FexprClosure extends Val {
  constructor(protected params: string[], protected freeVars: Ref[], protected body: Val) {
    super()
  }

  call(stack: RuntimeStack, args: Val[]) {
    let res: Val = new Null()
    try {
      const frame = bindArgsToParams(this.params, args)
      res = evalArk(this.body, stack.pushFrame(this.freeVars).pushFrame(frame))
      stack.popFrame()
      stack.popFrame()
    } catch (e) {
      if (!(e instanceof ReturnException)) {
        throw e
      }
      res = e.value()
    }
    return res
  }
}

class FnClosure extends FexprClosure {
  call(stack: RuntimeStack, args: Val[]) {
    const evaluatedArgs = evaluateArgs(stack, args)
    return super.call(stack, evaluatedArgs)
  }
}

export class Fexpr extends Val {
  constructor(public params: string[], protected freeVars: FreeVars, public body: Val) {
    super()
  }

  captureFreeVars(stack: RuntimeStack): Ref[] {
    const frame: Ref[] = []
    for (const [, symrefs] of this.freeVars) {
      const ref = new Ref(symrefs[0].get(stack.pushFrame([])))
      stack.popFrame()
      frame.push(ref)
      for (const symref of symrefs) {
        const loc = symref.location
        assert(loc !== undefined)
        if (loc instanceof StackLocation) {
          assert(loc.level > 0)
          // FIXME: we shouldn't be rewriting code!
          symref.location = new StackRefLocation(1, frame.length - 1)
        }
      }
    }
    return frame
  }
}

export class NativeFexpr extends Val {
  constructor(
    public name: string,
    protected body: (stack: RuntimeStack, ...args: Val[]) => Val,
  ) {
    super()
  }

  call(stack: RuntimeStack, args: Val[]) {
    return this.body(stack, ...args)
  }
}

function evaluateArgs(stack: RuntimeStack, args: Val[]) {
  const evaluatedArgs: Val[] = []
  for (const arg of args) {
    evaluatedArgs.push(evalArk(arg, stack))
  }
  return evaluatedArgs
}

export class Fn extends Fexpr {}

class NativeFn extends Val {
  constructor(
    public name: string,
    protected body: (...args: Val[]) => Val,
  ) {
    super()
  }

  call(stack: RuntimeStack, args: Val[]) {
    return this.body(...evaluateArgs(stack, args))
  }
}

export class Ref extends Val {
  constructor(public val: Val = new Null()) {
    super()
  }

  set(_stack: RuntimeStack, val: Val) {
    this.val = val
    return val
  }
}

export class StackLocation {
  constructor(public level: number, public index: number) {}

  get(stack: RuntimeStack): Ref {
    return stack.get(this)
  }

  set(stack: RuntimeStack, val: Val) {
    stack.set(val, this)
    return val
  }
}

export class StackRefLocation {
  constructor(public level: number, public index: number) {}

  get(stack: RuntimeStack): Ref {
    return stack.get(this).val as Ref
  }

  set(stack: RuntimeStack, val: Val) {
    this.get(stack).val = val
    return val
  }
}

export class RefLocation {
  ref: Ref

  constructor(val: Val) {
    this.ref = new Ref(val)
  }

  get(_stack: RuntimeStack): Ref {
    return this.ref
  }

  set(stack: RuntimeStack, val: Val) {
    this.ref.set(stack, val)
    return val
  }
}

export class SymRef extends Val {
  location: StackLocation | RefLocation | undefined

  constructor(env: Environment, name: string) {
    super()
    this.location = env.getIndex(name)
    this._debug.set('name', name)
    this._debug.set('env', JSON.stringify(env))
  }

  get(stack: RuntimeStack): Ref {
    return this.location!.get(stack)
  }

  set(stack: RuntimeStack, val: Val) {
    return this.location!.set(stack, val)
  }
}

export class Obj extends Val {
  constructor(jsObj: Object) {
    super()
    for (const key in jsObj) {
      if (Object.hasOwn(jsObj, key)) {
        (this as any)[key] = (jsObj as any)[key]
      }
    }
  }
}

// Until we can evaluate a dict literal, we don't know the values of its
// keys.
export class DictLiteral extends Val {
  constructor(public map: Map<Val, Val>) {
    super()
  }
}

export class Dict extends Val {
  constructor(public map: Map<Val, Val>) {
    super()
  }

  set(_stack: RuntimeStack, index: Val, val: Val) {
    this.map.set(toJs(index), val)
    return val
  }

  get(_stack: RuntimeStack, index: Val) {
    return this.map.get(toJs(index)) ?? new Null()
  }
}

export class List extends Val {
  constructor(public val: Val[]) {
    super()
  }

  length(_stack: RuntimeStack) {
    return new Num(this.val.length)
  }

  get(_stack: RuntimeStack, index: Val) {
    return this.val[toJs(index as Num)]
  }

  set(_stack: RuntimeStack, index: Val, val: Val) {
    this.val[toJs(index)] = val
    return val
  }
}

export class Let extends Val {
  constructor(public boundVars: string[], public body: Val) {
    super()
  }
}

export class Call extends Val {
  constructor(public fn: Val, public args: Val[]) {
    super()
  }
}

export class Prop extends Val {
  constructor(public prop: string, public ref: Val, public args: Val[]) {
    super()
  }
}

function jsToVal(x: any): Val {
  if (x === null || x === undefined) {
    return new Null()
  }
  if (typeof x === 'boolean') {
    return new Bool(x)
  }
  if (typeof x === 'number') {
    return new Num(x)
  }
  if (typeof x === 'string') {
    return new Str(x)
  }
  if (typeof x === 'function') {
    return new NativeFn(x.name, (...args: Val[]) => jsToVal(x(...args.map(toJs))))
  }
  if (typeof x === 'object') {
    return new Obj(x)
  }
  throw new Error(`cannot convert JavaScript value ${x}`)
}

export const intrinsics: {[key: string]: Val} = {
  new: new NativeFn('new', (val: Val) => new Ref(val)),
  pos: new NativeFn('pos', (val: Val) => new Num(+toJs(val))),
  neg: new NativeFn('neg', (val: Val) => new Num(-toJs(val))),
  not: new NativeFn('not', (val: Val) => new Bool(!toJs(val))),
  seq: new NativeFexpr('seq', (stack: RuntimeStack, ...args: Val[]) => {
    let res: Val = new Null()
    for (const exp of args) {
      res = evalArk(exp, stack)
    }
    return res
  }),
  if: new NativeFexpr('if', (stack: RuntimeStack, cond: Val, e_then: Val, e_else: Val) => {
    const condVal = evalArk(cond, stack)
    if (toJs(condVal)) {
      return evalArk(e_then, stack)
    }
    return e_else ? evalArk(e_else, stack) : new Null()
  }),
  and: new NativeFexpr('and', (stack: RuntimeStack, left: Val, right: Val) => {
    const leftVal = evalArk(left, stack)
    if (toJs(leftVal)) {
      return evalArk(right, stack)
    }
    return leftVal
  }),
  or: new NativeFexpr('or', (stack: RuntimeStack, left: Val, right: Val) => {
    const leftVal = evalArk(left, stack)
    if (toJs(leftVal)) {
      return leftVal
    }
    return evalArk(right, stack)
  }),
  loop: new NativeFexpr('loop', (stack: RuntimeStack, body: Val) => {
    for (; ;) {
      try {
        evalArk(body, stack)
      } catch (e) {
        if (e instanceof BreakException) {
          return e.value()
        }
        if (!(e instanceof ContinueException)) {
          throw e
        }
      }
    }
  }),
  break: new NativeFn('break', (val: Val) => {
    throw new BreakException(val)
  }),
  continue: new NativeFn('continue', () => {
    throw new ContinueException()
  }),
  return: new NativeFn('return', (val: Val) => {
    throw new ReturnException(val)
  }),
  '=': new NativeFn('=', (left: Val, right: Val) => new Bool(toJs(left) === toJs(right))),
  '!=': new NativeFn('!=', (left: Val, right: Val) => new Bool(toJs(left) !== toJs(right))),
  '<': new NativeFn('<', (left: Val, right: Val) => new Bool(toJs(left) < toJs(right))),
  '<=': new NativeFn('<=', (left: Val, right: Val) => new Bool(toJs(left) <= toJs(right))),
  '>': new NativeFn('>', (left: Val, right: Val) => new Bool(toJs(left) > toJs(right))),
  '>=': new NativeFn('>=', (left: Val, right: Val) => new Bool(toJs(left) >= toJs(right))),
  '+': new NativeFn('+', (left: Val, right: Val) => new Num(toJs(left) + toJs(right))),
  '-': new NativeFn('-', (left: Val, right: Val) => new Num(toJs(left) - toJs(right))),
  '*': new NativeFn('*', (left: Val, right: Val) => new Num(toJs(left) * toJs(right))),
  '/': new NativeFn('/', (left: Val, right: Val) => new Num(toJs(left) / toJs(right))),
  '%': new NativeFn('%', (left: Val, right: Val) => new Num(toJs(left) % toJs(right))),
  '**': new NativeFn('**', (left: Val, right: Val) => new Num(toJs(left) ** toJs(right))),
}

export const globals = new Map([
  ['pi', new Ref(new Num(Math.PI))],
  ['e', new Ref(new Num(Math.E))],
  ['print', new Ref(new NativeFn('print', (obj: Val) => {
    console.log(toJs(obj))
    return new Null()
  }))],
  ['debug', new Ref(new NativeFn('debug', (obj: Val) => {
    debug(obj)
    return new Null()
  }))],
  ['js', new Ref(new Obj({
    use: (_stack: RuntimeStack, ...args: Val[]) => {
      const requirePath = (args.map(toJs).join('.'))
      // eslint-disable-next-line import/no-dynamic-require, global-require
      const module = require(requirePath)
      const wrappedModule = {}
      // eslint-disable-next-line guard-for-in
      for (const key in module) {
        (wrappedModule as any)[key] = () => jsToVal(module[key])
      }
      return new Obj(wrappedModule)
    },
  }))],
])

export function evalArk(val: Val, stack: RuntimeStack): Val {
  if (val instanceof SymRef) {
    const ref = val.get(stack)
    return evalArk(evalArk(ref, stack), stack)
  } else if (val instanceof Ref) {
    return val.val
  } else if (val instanceof Fn) {
    return new FnClosure(val.params, val.captureFreeVars(stack), val.body)
  } else if (val instanceof Fexpr) {
    return new FexprClosure(val.params, val.captureFreeVars(stack), val.body)
  } else if (val instanceof DictLiteral) {
    const evaluatedMap = new Map<any, Val>()
    for (const [k, v] of val.map) {
      evaluatedMap.set(toJs(evalArk(k, stack)), evalArk(v, stack))
    }
    return new Dict(evaluatedMap)
  } else if (val instanceof Dict) {
    const evaluatedMap = new Map<any, Val>()
    for (const [k, v] of val.map) {
      evaluatedMap.set(k, evalArk(v, stack) as Val)
    }
    // FIXME: Don't do this: need to be able to use ConcreteVal values as
    // keys by their underlying value.
    // eslint-disable-next-line no-param-reassign
    val.map = evaluatedMap
    return val
  } else if (val instanceof List) {
    // eslint-disable-next-line no-param-reassign
    val.val = val.val.map((e) => evalArk(e, stack))
    return val
  } else if (val instanceof Let) {
    const frame = bindArgsToParams(val.boundVars, [])
    const res = evalArk(val.body, stack.push(frame))
    stack.pop(frame.length)
    return res
  } else if (val instanceof Call) {
    const fn = evalArk(val.fn, stack) as FexprClosure
    return fn.call(stack, val.args)
  } else if (val instanceof Prop) {
    const obj = evalArk(val.ref, stack)
    if (!(val.prop in obj)) {
      throw new PropertyException(`no property '${val.prop}'`)
    }
    return (obj as any)[val.prop](stack, ...val.args.map((e) => evalArk(e, stack)))
  }
  return val
}

// FIXME: support partial linking.
export function link(compiledVal: CompiledArk, env: Namespace): Val {
  const [val, freeVars] = compiledVal
  for (const [name, symrefs] of freeVars) {
    if (!env.has(name)) {
      throw new Error(`undefined symbol ${name}`)
    }
    for (const symref of symrefs) {
      symref.location = new RefLocation(env.get(name)!)
    }
  }
  return val
}

export function runArk(compiledVal: CompiledArk, env: Namespace = globals): Val {
  const val = link(compiledVal, env)
  return evalArk(val, new RuntimeStack())
}

export function toJs(val: Val): any {
  if (val instanceof ConcreteVal) {
    return val.val
  } else if (val instanceof Obj) {
    const obj = {}
    // eslint-disable-next-line guard-for-in
    for (const key in val) {
      if (!key.startsWith('_')) {
        (obj as any)[key] = toJs((val as any)[key] as Val)
      }
    }
    return obj
  } else if (val instanceof DictLiteral) {
    // Best effort.
    return toJs(evalArk(val, new RuntimeStack()))
  } else if (val instanceof Dict) {
    const evaluatedMap = new Map<any, Val>()
    for (const [k, v] of val.map) {
      evaluatedMap.set(k, toJs(evalArk(v, new RuntimeStack())))
    }
    return evaluatedMap
  } else if (val instanceof List) {
    return val.val.map(toJs)
  }
  return val
}

export function serialize(val: Val) {
  function doSerialize(val: Val): any {
    if (val instanceof SymRef || val instanceof NativeFexpr) {
      return val._debug.get('name')
    } else if (val instanceof Str) {
      return ['str', val.val]
    } else if (val instanceof ConcreteVal) {
      return val.val
    } else if (val instanceof Ref) {
      return ['ref', doSerialize(val.val)]
    } else if (val instanceof Fn) {
      return ['fn', ['params', ...val.params], doSerialize(val.body)]
    } else if (val instanceof Fexpr) {
      return ['fexpr', ['params', ...val.params], doSerialize(val.body)]
    } else if (val instanceof Obj) {
      const obj = {}
      // eslint-disable-next-line guard-for-in
      for (const key in val) {
        (obj as any)[key] = doSerialize((val as any)[key] as Val)
      }
      return obj
    } else if (val instanceof DictLiteral) {
      const obj: any[] = ['map']
      for (const [k, v] of val.map) {
        obj.push([doSerialize(k), doSerialize(v)])
      }
      return obj
    } else if (val instanceof Dict) {
      const obj: any[] = ['map']
      for (const [k, v] of val.map) {
        // FIXME: see evalArk.
        const keyJs = k instanceof Val ? doSerialize(k) : k
        obj.push([keyJs, doSerialize(v)])
      }
      return obj
    } else if (val instanceof List) {
      return ['list', ...val.val.map(doSerialize)]
    } else if (val instanceof Let) {
      return ['let', ['params', ...val.boundVars], doSerialize(val.body)]
    } else if (val instanceof Call) {
      return [doSerialize(val.fn), ...val.args.map(doSerialize)]
    } else if (val instanceof Prop) {
      return ['prop', val.prop, doSerialize(val.ref), ...val.args.map(doSerialize)]
    }
    return val
  }

  return JSON.stringify(doSerialize(val))
}

export function debug(x: any, depth: number | null = 1) {
  console.dir(x, {depth, colors: true})
}
