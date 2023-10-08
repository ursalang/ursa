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

class ConcreteVal<T> extends Val {
  constructor(public val: T) {
    super()
  }
}

class ConcreteInterned {
  constructor() {
    throw new Error('use ConcreteInterned.create, not constructor')
  }

  private static intern: Map<any, ConcreteVal<any>> = new Map()

  static value<T>(rawVal: T): ConcreteVal<T> {
    let val = ConcreteInterned.intern.get(rawVal)
    if (val === undefined) {
      val = new ConcreteVal(rawVal)
      ConcreteInterned.intern.set(rawVal, val)
    }
    return val
  }
}

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

export class PropertyException extends Error {}

export class AssException extends Error {}

export function bindArgsToParams(params: string[], args: Val[]): Ref[] {
  const frame: ValRef[] = params.map(
    (_key, index) => new ValRef(args[index] ?? Null()),
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
    let res: Val = Null()
    try {
      const frame = bindArgsToParams(this.params, args)
      res = interpret(this.body, stack.pushFrame(this.freeVars).pushFrame(frame))
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
  constructor(public val: Val = Null()) {
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

export class Class extends Val {
  public val: Map<string, Val>

  constructor(obj: Map<string, Val>) {
    super()
    this.val = obj
  }
}

export class ObjLiteral extends Class {}
export class Obj extends ObjLiteral {}

export class PropRef extends Ref {
  constructor(public obj: Obj, public prop: string) {
    super()
  }

  get(_stack: RuntimeStack) {
    return this.obj.val.get(this.prop) ?? Null()
  }

  set(_stack: RuntimeStack, val: Val) {
    this.obj.val.set(this.prop, val)
    return val
  }
}

export class DictLiteral extends Class {
  constructor(public map: Map<Val, Val>) {
    super(new Map<string, Val>([
      ['set', new NativeFn(
        'Dict.set',
        (index: Val, val: Val) => {
          this.map.set(index, val)
          return val
        },
      )],
      ['get', new NativeFn(
        'Dict.get',
        (index: Val) => this.map.get(index) ?? Null(),
      )],
    ]))
  }
}

export class Dict extends DictLiteral {}

export class ListLiteral extends Class {
  constructor(public list: Val[]) {
    super(new Map<string, Val>([
      ['get', new NativeFn(
        'List.get',
        (index: Val) => this.list[toJs(index)],
      )],
      ['set', new NativeFn(
        'List.set',
        (index: Val, val: Val) => {
          this.list[toJs(index)] = val
          return val
        },
      )],
    ]))
    this.val.set('length', Num(this.list.length))
  }
}

export class List extends ListLiteral {}

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
  // ref must compute a Ref
  constructor(public prop: string, public ref: Val) {
    super()
  }
}

function jsToVal(x: any): Val {
  if (x === null || x === undefined) {
    return Null()
  }
  if (typeof x === 'boolean') {
    return Bool(x)
  }
  if (typeof x === 'number') {
    return Num(x)
  }
  if (typeof x === 'string') {
    return Str(x)
  }
  if (typeof x === 'function') {
    return new NativeFn(x.name, (...args: Val[]) => jsToVal(x(...args.map(toJs))))
  }
  if (typeof x === 'object') {
    return new ObjLiteral(x)
  }
  if (x instanceof Array) {
    return new ListLiteral(x)
  }
  if (x instanceof Map) {
    return new DictLiteral(x)
  }
  throw new Error(`cannot convert JavaScript value ${x}`)
}

export const intrinsics: {[key: string]: Val} = {
  pos: new NativeFn('pos', (val: Val) => Num(+toJs(val))),
  neg: new NativeFn('neg', (val: Val) => Num(-toJs(val))),
  not: new NativeFn('not', (val: Val) => Bool(!toJs(val))),
  seq: new NativeFexpr('seq', (stack: RuntimeStack, ...args: Val[]) => {
    let res: Val = Null()
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
    return e_else ? interpret(e_else, stack) : Null()
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
          return e.val
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
  '=': new NativeFn('=', (left: Val, right: Val) => Bool(toJs(left) === toJs(right))),
  '!=': new NativeFn('!=', (left: Val, right: Val) => Bool(toJs(left) !== toJs(right))),
  '<': new NativeFn('<', (left: Val, right: Val) => Bool(toJs(left) < toJs(right))),
  '<=': new NativeFn('<=', (left: Val, right: Val) => Bool(toJs(left) <= toJs(right))),
  '>': new NativeFn('>', (left: Val, right: Val) => Bool(toJs(left) > toJs(right))),
  '>=': new NativeFn('>=', (left: Val, right: Val) => Bool(toJs(left) >= toJs(right))),
  '+': new NativeFn('+', (left: Val, right: Val) => Num(toJs(left) + toJs(right))),
  '-': new NativeFn('-', (left: Val, right: Val) => Num(toJs(left) - toJs(right))),
  '*': new NativeFn('*', (left: Val, right: Val) => Num(toJs(left) * toJs(right))),
  '/': new NativeFn('/', (left: Val, right: Val) => Num(toJs(left) / toJs(right))),
  '%': new NativeFn('%', (left: Val, right: Val) => Num(toJs(left) % toJs(right))),
  '**': new NativeFn('**', (left: Val, right: Val) => Num(toJs(left) ** toJs(right))),
}

export const globals = new Map([
  ['pi', new ValRef(Num(Math.PI))],
  ['e', new ValRef(Num(Math.E))],
  ['print', new ValRef(new NativeFn('print', (obj: Val) => {
    console.log(toJs(obj))
    return Null()
  }))],
  ['debug', new ValRef(new NativeFn('debug', (obj: Val) => {
    debug(obj)
    return Null()
  }))],
  // FIXME: make this work again!
  // ['js', new Ref(new Obj({
  //   use: new NativeFn('js', (...args: Val[]) => {
  //     const requirePath = (args.map(toJs).join('.'))
  //     // eslint-disable-next-line import/no-dynamic-require, global-require
  //     const module = require(requirePath)
  //     const wrappedModule = new Map()
  //     // eslint-disable-next-line guard-for-in
  //     for (const key in module) {
  //       wrappedModule.set(key, jsToVal(module[key]))
  //     }
  //     return new Obj(wrappedModule)
  //   }),
  // }))],
  ['JSON', new ValRef(new Obj(new Map([
    ['parse', new NativeFn('JSON.parse', (str: Val) => jsToVal(JSON.parse(toJs(str))))],
    ['stringify', new NativeFn('JSON.stringify', (val: Val) => Str(JSON.stringify(toJs(val))))],
  ])))],
])

function interpret(val: Val, stack: RuntimeStack): Val {
  if (val instanceof SymRef) {
    return val.get(stack)
  } else if (val instanceof Get) {
    return (interpret(val.val, stack) as Ref).get(stack)
  } else if (val instanceof Ass) {
    const ref = interpret(val.ref, stack)
    const res = interpret(val.val, stack)
    if (!(ref instanceof Ref || ref instanceof SymRef)) {
      throw new AssException('assignment to non-Ref/SymRef')
    }
    ref.set(stack, res)
    return res
  } else if (val instanceof Fn) {
    return new FnClosure(val.params, val.captureFreeVars(stack), val.body)
  } else if (val instanceof Fexpr) {
    return new FexprClosure(val.params, val.captureFreeVars(stack), val.body)
  } else if (val instanceof ObjLiteral) {
    return new Obj(val.val)
  } else if (val instanceof ListLiteral) {
    return new List(val.list.map((e) => interpret(e, stack)))
  } else if (val instanceof DictLiteral) {
    const evaluatedMap = new Map<any, Val>()
    for (const [k, v] of val.map) {
      evaluatedMap.set(interpret(k, stack), interpret(v, stack))
    }
    return new Dict(evaluatedMap)
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
    return new PropRef(obj as Obj, val.prop)
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
  } else if (val instanceof ObjLiteral) {
    const obj = {}
    for (const [k, v] of val.val) {
      (obj as any)[k] = toJs(v)
    }
    return obj
  } else if (val instanceof DictLiteral) {
    const jsMap = new Map<any, Val>()
    for (const [k, v] of val.map) {
      jsMap.set(toJs(k), toJs(v))
    }
    return jsMap
  } else if (val instanceof ListLiteral) {
    return val.list.map(toJs)
  }
  return val
}

export function serialize(val: Val) {
  function doSerialize(val: Val): any {
    if (val instanceof SymRef) {
      return val._debug.get('name')
    } else if (val instanceof NativeFexpr || val instanceof NativeFn) {
      return val.name
    } else if (val instanceof ConcreteVal) {
      const rawVal = val.val
      if (typeof rawVal === 'string') {
        return ['str', val.val]
      }
      return val.val
    } else if (val instanceof PropRef) {
      return ['ref', ['prop', doSerialize(val.obj), val.prop]]
    } else if (val instanceof ValRef) {
      return ['ref', doSerialize(val.val)]
    } else if (val instanceof Get) {
      return ['get', doSerialize(val.val)]
    } else if (val instanceof Fn) {
      return ['fn', ['params', ...val.params], doSerialize(val.body)]
    } else if (val instanceof Fexpr) {
      return ['fexpr', ['params', ...val.params], doSerialize(val.body)]
    } else if (val instanceof ObjLiteral) {
      const obj = {}
      for (const [k, v] of val.val) {
        (obj as any)[k] = doSerialize(v)
      }
      return obj
    } else if (val instanceof DictLiteral) {
      const obj: any[] = ['map']
      for (const [k, v] of val.map) {
        obj.push([doSerialize(k), doSerialize(v)])
      }
      return obj
    } else if (val instanceof ListLiteral) {
      return ['list', ...val.list.map(doSerialize)]
    } else if (val instanceof Let) {
      return ['let', ['params', ...val.boundVars], doSerialize(val.body)]
    } else if (val instanceof Call) {
      return [doSerialize(val.fn), ...val.args.map(doSerialize)]
    } else if (val instanceof Ass) {
      return ['set', doSerialize(val.ref), doSerialize(val.val)]
    } else if (val instanceof Prop) {
      return ['prop', val.prop, doSerialize(val.ref)]
    } else if (val === undefined || val === null) {
      return Null()
    }
    return val.toString()
  }
  return JSON.stringify(doSerialize(val))
}

export function debug(x: any, depth: number | null = 1) {
  console.dir(x, {depth, colors: true})
}
