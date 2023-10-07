import assert from 'assert'
import {
  CompiledArk, Environment, FreeVars, Namespace,
} from './compiler.js'

export class Stack<T> {
  public stack: T[][]

  constructor(outerStack: T[][] = [[]]) {
    assert(outerStack.length > 0)
    this.stack = outerStack
  }

  push(items: T[]) {
    return new (this.constructor as any)(
      [[...items, ...this.stack[0].slice()], ...this.stack.slice(1)],
    )
  }

  pushFrame(frame: T[]) {
    return new (this.constructor as any)([frame, ...this.stack.slice()])
  }
}

// FIXME: Make the stack of type [Val[], Ref[]][]: pairs of frame and upvars
export class RuntimeStack extends Stack<Val> {}

// Base class for compiled code.
export class Val {
  // Uncomment the following for debug.
  // FIXME: make this a run-time (or build-time?) option.
  // static counter = 0

  // _uid: number

  // constructor() {
  //   this._uid = Val.counter
  //   Val.counter += 1
  // }

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

export class NonLocalReturn extends Error {
  constructor(protected val: Val = new Null()) {
    super()
  }

  value(): Val {
    return this.val
  }
}

export class BreakException extends NonLocalReturn {}

export class ReturnException extends NonLocalReturn {}

export class ContinueException extends NonLocalReturn {}

export class PropertyException extends Error {}

export class AssException extends Error {}

export function bindArgsToParams(params: string[], args: Val[]): Ref[] {
  const frame: ValRef[] = params.map(
    (_key, index) => new ValRef(args[index] ?? new Null()),
  )
  if (args.length > params.length) {
    // FIXME: Support '...' as an identifier
    frame.push(new ValRef(new List(args.slice(params.length))))
  }
  return frame
}

class FexprClosure extends Val {
  constructor(protected params: string[], protected freeVars: Val[], protected body: Val) {
    super()
  }

  call(stack: RuntimeStack, ...args: Val[]) {
    let res: Val = new Null()
    try {
      const frame = bindArgsToParams(this.params, args)
      res = interpret(this.body, stack.pushFrame(this.freeVars).pushFrame(frame))
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
  call(stack: RuntimeStack, ...args: Val[]) {
    const evaluatedArgs = evaluateArgs(stack, ...args)
    return super.call(stack, ...evaluatedArgs)
  }
}

export class Fexpr extends Val {
  private boundFreeVars: [StackRef, SymRef[]][] = []

  constructor(public params: string[], protected freeVars: FreeVars, public body: Val) {
    super()
    let numStackFreeVars = 0
    for (const [, symrefs] of this.freeVars) {
      let isStackFreeVar = false
      for (const symref of symrefs) {
        const loc = symref.ref
        assert(loc !== undefined)
        if (loc instanceof StackRef) {
          assert(!(loc instanceof StackRefRef))
          assert(loc.level > 0)
          if (!isStackFreeVar) {
            isStackFreeVar = true
            this.boundFreeVars.push([loc, symrefs])
            numStackFreeVars += 1
          }
          symref.ref = new StackRefRef(1, numStackFreeVars - 1)
        }
      }
    }
  }

  captureFreeVars(stack: RuntimeStack): Val[] {
    const frame: Val[] = []
    for (const [loc] of this.boundFreeVars) {
      const ref = new ValRef(stack.pushFrame([]).stack[loc.level][loc.index])
      frame.push(ref)
    }
    return frame
  }
}

export class Fn extends Fexpr {}
export class NativeFexpr extends Val {
  constructor(
    public name: string, // FIXME: remove name, use debug info.
    protected body: (stack: RuntimeStack, ...args: Val[]) => Val,
  ) {
    super()
  }

  call(stack: RuntimeStack, ...args: Val[]) {
    return this.body(stack, ...args)
  }
}

function evaluateArgs(stack: RuntimeStack, ...args: Val[]) {
  const evaluatedArgs: Val[] = []
  for (const arg of args) {
    evaluatedArgs.push(interpret(arg, stack))
  }
  return evaluatedArgs
}

export class NativeFn extends Val {
  constructor(
    public name: string,
    protected body: (...args: Val[]) => Val,
  ) {
    super()
  }

  call(stack: RuntimeStack, ...args: Val[]) {
    return this.body(...evaluateArgs(stack, ...args))
  }
}

export abstract class Ref extends Val {
  abstract get(stack: RuntimeStack): Val

  abstract set(stack: RuntimeStack, val: Val): Val
}

export class ValRef extends Ref {
  constructor(public val: Val = new Null()) {
    super()
  }

  get(_stack: RuntimeStack): Val {
    return this.val
  }

  set(_stack: RuntimeStack, val: Val): Val {
    this.val = val
    return val
  }
}

export class Get extends Val {
  constructor(public val: Val) {
    super()
  }
}

export class Ass extends Val {
  constructor(public ref: Val, public val: Val) {
    super()
  }
}

export class StackRef extends Ref {
  constructor(public level: number, public index: number) {
    super()
  }

  get(stack: RuntimeStack): Val {
    return stack.stack[this.level][this.index]
  }

  set(stack: RuntimeStack, val: Val) {
    stack.stack[this.level][this.index] = val
    return val
  }
}

export class StackRefRef extends StackRef {
  get(stack: RuntimeStack): Val {
    return (stack.stack[this.level][this.index] as Ref).get(stack)
  }

  set(stack: RuntimeStack, val: Val) {
    const ref = stack.stack[this.level][this.index] as Ref;
    ref.set(stack, val)
    return val
  }
}

export class RefRef {
  ref: Ref

  constructor(ref: Ref) {
    this.ref = ref
  }

  get(stack: RuntimeStack): Val {
    return this.ref.get(stack)
  }

  set(stack: RuntimeStack, val: Val) {
    this.ref.set(stack, val)
    return val
  }
}

export class SymRef extends Val {
  ref: Ref | undefined

  constructor(env: Environment, name: string) {
    super()
    this.ref = env.getIndex(name)
    this._debug.set('name', name)
    this._debug.set('env', JSON.stringify(env))
  }

  get(stack: RuntimeStack): Val {
    return this.ref!.get(stack)
  }

  set(stack: RuntimeStack, val: Val) {
    return this.ref!.set(stack, val)
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

export class DictLiteral extends Val {
  constructor(public map: Map<Val, Val>) {
    super()
  }
}

export class Dict extends DictLiteral {
  set = new NativeFn(
    'Dict.set',
    (index: Val, val: Val) => {
      this.map.set(toJs(index), val)
      return val
    },
  )

  get = new NativeFn(
    'Dict.get',
    (index: Val) => this.map.get(toJs(index)) ?? new Null(),
  )
}

export class ListLiteral extends Val {
  constructor(public val: Val[]) {
    super()
    this.length = new Num(this.val.length)
  }

  length: Num
}

export class List extends ListLiteral {
  get = new NativeFn(
    'List.get',
    (index: Val) => this.val[toJs(index)],
  )

  set = new NativeFn(
    'List.set',
    (index: Val, val: Val) => {
      this.val[toJs(index)] = val
      return val
    },
  )
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
  constructor(public prop: string, public ref: Val) {
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
  pos: new NativeFn('pos', (val: Val) => new Num(+toJs(val))),
  neg: new NativeFn('neg', (val: Val) => new Num(-toJs(val))),
  not: new NativeFn('not', (val: Val) => new Bool(!toJs(val))),
  seq: new NativeFexpr('seq', (stack: RuntimeStack, ...args: Val[]) => {
    let res: Val = new Null()
    for (const exp of args) {
      res = interpret(exp, stack)
    }
    return res
  }),
  if: new NativeFexpr('if', (stack: RuntimeStack, cond: Val, e_then: Val, e_else: Val) => {
    const condVal = interpret(cond, stack)
    if (toJs(condVal)) {
      return interpret(e_then, stack)
    }
    return e_else ? interpret(e_else, stack) : new Null()
  }),
  and: new NativeFexpr('and', (stack: RuntimeStack, left: Val, right: Val) => {
    const leftVal = interpret(left, stack)
    if (toJs(leftVal)) {
      return interpret(right, stack)
    }
    return leftVal
  }),
  or: new NativeFexpr('or', (stack: RuntimeStack, left: Val, right: Val) => {
    const leftVal = interpret(left, stack)
    if (toJs(leftVal)) {
      return leftVal
    }
    return interpret(right, stack)
  }),
  loop: new NativeFexpr('loop', (stack: RuntimeStack, body: Val) => {
    for (; ;) {
      try {
        interpret(body, stack)
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
  ['pi', new ValRef(new Num(Math.PI))],
  ['e', new ValRef(new Num(Math.E))],
  ['print', new ValRef(new NativeFn('print', (obj: Val) => {
    console.log(toJs(obj))
    return new Null()
  }))],
  ['debug', new ValRef(new NativeFn('debug', (obj: Val) => {
    debug(obj)
    return new Null()
  }))],
  // FIXME: make this work again!
  // ['js', new Ref(new Obj({
  //   use: new NativeFn('js', (...args: Val[]) => {
  //     const requirePath = (args.map(toJs).join('.'))
  //     // eslint-disable-next-line import/no-dynamic-require, global-require
  //     const module = require(requirePath)
  //     const wrappedModule = {}
  //     // eslint-disable-next-line guard-for-in
  //     for (const key in module) {
  //       (wrappedModule as any)[key] = jsToVal(module[key])
  //     }
  //     return new Obj(wrappedModule)
  //   }),
  // }))],
  ['JSON', new ValRef(new Obj({
    parse: new NativeFn('JSON.parse', (str: Val) => jsToVal(JSON.parse(toJs(str)))),
    stringify: new NativeFn('JSON.stringify', (val: Val) => new Str(JSON.stringify(toJs(val)))),
  }))],
])

// FIXME: Add rule for Obj, and a test.
function interpret(val: Val, stack: RuntimeStack): Val {
  if (val instanceof SymRef) {
    return val.get(stack)
  } else if (val instanceof ValRef) {
    return val
  } else if (val instanceof Get) {
    return (interpret(val.val, stack) as Ref).get(stack)
  } else if (val instanceof Ass) {
    const ref = interpret(val.ref, stack)
    const res = interpret(val.val, stack)
    if (!(ref instanceof ValRef || ref instanceof SymRef)) {
      throw new AssException('assignment to non-Ref/SymRef')
    }
    ref.set(stack, res)
    return res
  } else if (val instanceof Fn) {
    return new FnClosure(val.params, val.captureFreeVars(stack), val.body)
  } else if (val instanceof Fexpr) {
    return new FexprClosure(val.params, val.captureFreeVars(stack), val.body)
  } else if (val instanceof ListLiteral) {
    return new List(val.val.map((e) => interpret(e, stack)))
  } else if (val instanceof Dict) {
    const evaluatedMap = new Map<any, Val>()
    for (const [k, v] of val.map) {
      evaluatedMap.set(k, interpret(v, stack) as Val)
    }
    // FIXME: Don't do this: need to be able to use ConcreteVal values as
    // keys by their underlying value.
    // eslint-disable-next-line no-param-reassign
    val.map = evaluatedMap
    return val
  } else if (val instanceof DictLiteral) {
    const evaluatedMap = new Map<any, Val>()
    for (const [k, v] of val.map) {
      evaluatedMap.set(toJs(interpret(k, stack)), interpret(v, stack))
    }
    return new Dict(evaluatedMap)
  } else if (val instanceof List) {
    // eslint-disable-next-line no-param-reassign
    val.val = val.val.map((e) => interpret(e, stack))
    return val
  } else if (val instanceof Let) {
    const frame = bindArgsToParams(val.boundVars, [])
    const res = interpret(val.body, stack.push(frame))
    return res
  } else if (val instanceof Call) {
    // FIXME: Use an ArkCallable trait, not FexprClosure—can also be
    // Native{Fexpr,Fn}.
    const fn = interpret(val.fn, stack) as FexprClosure
    return fn.call(stack, ...val.args)
  } else if (val instanceof Prop) {
    const obj = interpret(val.ref, stack)
    if (!(val.prop in obj)) {
      throw new PropertyException(`no property '${val.prop}'`)
    }
    return (obj as any)[val.prop]
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
      symref.ref = new ValRef(env.get(name)!)
    }
  }
  return val
}

export function runArk(compiledVal: CompiledArk, env: Namespace = globals): Val {
  const val = link(compiledVal, env)
  return interpret(val, new RuntimeStack())
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
  } else if (val instanceof Dict) {
    const evaluatedMap = new Map<any, Val>()
    for (const [k, v] of val.map) {
      evaluatedMap.set(k, toJs(interpret(v, new RuntimeStack())))
    }
    return evaluatedMap
  } else if (val instanceof DictLiteral) {
    // Best effort.
    return toJs(interpret(val, new RuntimeStack()))
  } else if (val instanceof List) {
    return val.val.map(toJs)
  }
  return val
}

export function serialize(val: Val) {
  function doSerialize(val: Val): any {
    if (val instanceof SymRef) {
      return val._debug.get('name')
    } else if (val instanceof NativeFexpr || val instanceof NativeFn) {
      return val.name
    } else if (val instanceof Str) {
      return ['str', val.val]
    } else if (val instanceof ConcreteVal) {
      return val.val
    } else if (val instanceof ValRef) {
      return ['ref', doSerialize(val.val)]
    } else if (val instanceof Get) {
      return ['get', doSerialize(val.val)]
    } else if (val instanceof Fn) {
      return ['fn', ['params', ...val.params], doSerialize(val.body)]
    } else if (val instanceof Fexpr) {
      return ['fexpr', ['params', ...val.params], doSerialize(val.body)]
    } else if (val instanceof Obj) {
      const obj = {}
      // eslint-disable-next-line guard-for-in
      for (const key in val) {
        if (!key.startsWith('_')) {
          const v = (val as any)[key];
          (obj as any)[key] = v instanceof Val ? doSerialize(v) : v
        }
      }
      return obj
    } else if (val instanceof Dict) {
      const obj: any[] = ['map']
      for (const [k, v] of val.map) {
        // FIXME: see interpret.
        const keyJs = k instanceof Val ? doSerialize(k) : k
        obj.push([keyJs, doSerialize(v)])
      }
      return obj
    } else if (val instanceof DictLiteral) {
      const obj: any[] = ['map']
      for (const [k, v] of val.map) {
        obj.push([doSerialize(k), doSerialize(v)])
      }
      return obj
    } else if (val instanceof List) {
      return ['list', ...val.val.map(doSerialize)]
    } else if (val instanceof Let) {
      return ['let', ['params', ...val.boundVars], doSerialize(val.body)]
    } else if (val instanceof Call) {
      return [doSerialize(val.fn), ...val.args.map(doSerialize)]
    } else if (val instanceof Ass) {
      return ['set', doSerialize(val.ref), doSerialize(val.val)]
    } else if (val instanceof Prop) {
      return ['prop', val.prop, doSerialize(val.ref)]
    } else if (val === undefined || val === null) {
      return null
    }
    return val.toString()
  }
  return JSON.stringify(doSerialize(val))
}

export function debug(x: any, depth: number | null = 1) {
  console.dir(x, {depth, colors: true})
}
