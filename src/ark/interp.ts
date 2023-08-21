export type Binding = BindingVal
export type Environment = EnvironmentVal

// Base class for compiled code.
export class Val {
  // Uncomment the following for debug.
  // static counter = 0

  // _uid: number

  // constructor() {
  //   super()
  //   this._uid = Val.counter
  //   Val.counter += 1
  // }

  eval(_env: Environment): Val {
    return this
  }

  _value(): any {
    return this
  }

  _toJs(): any {
    return this._value()
  }
}

class ConcreteVal extends Val {
  constructor(protected val: any = null) {
    super()
  }

  _value(): any {
    return this.val
  }
}

export class Null extends ConcreteVal {
  constructor() {
    super(null)
  }
}

export class Bool extends ConcreteVal {
  constructor(protected val: boolean) {
    super(val)
  }
}

export class Num extends ConcreteVal {
  constructor(protected val: number) {
    super(val)
  }
}

export class Str extends ConcreteVal {
  constructor(protected val: string) {
    super(val)
  }

  _toJs() {
    return ['str', this.val]
  }
}

export class HakException extends Error {
  constructor(protected val: Val = new Null()) {
    super()
  }

  _value(): Val {
    return this.val
  }
}

export class BreakException extends HakException {}

export class ReturnException extends HakException {}

export class ContinueException extends HakException {}

export class PropertyException extends Error {}

export function bindArgsToParams(params: string[], args: Val[]): Binding {
  const binding = new BindingVal(
    new Map(params.map((key, index) => [key, new Ref(args[index] ?? new Null())])),
  )
  if (args.length > params.length) {
    binding.map.set('...', new Ref(new List(args.slice(params.length))))
  }
  return binding
}

class FexprClosure extends Val {
  constructor(protected params: string[], protected freeVars: Binding, protected body: Val) {
    super()
  }

  call(env: Environment, args: Val[]) {
    let res: Val = new Null()
    try {
      const binding = bindArgsToParams(this.params, args)
      res = this.body.eval(env.extend(this.freeVars).extend(binding))
    } catch (e) {
      if (!(e instanceof ReturnException)) {
        throw e
      }
      res = e._value()
    }
    return res
  }
}

class FnClosure extends FexprClosure {
  call(env: Environment, args: Val[]) {
    const evaluatedArgs = evaluateArgs(env, args)
    return super.call(env, evaluatedArgs)
  }
}

export class Fexpr extends Val {
  constructor(protected params: string[], protected freeVars: Set<string>, protected body: Val) {
    super()
  }

  _bindFreeVars(env: Environment): Binding {
    return new BindingVal(new Map(
      [...this.freeVars].map((name): [string, Ref] => [name, env.get(name)]),
    ))
  }

  _toJs() {
    return ['fexpr', ['params', ...this.params], this.body._toJs()]
  }

  eval(env: Environment) {
    return new FexprClosure(this.params, this._bindFreeVars(env), this.body)
  }
}

export class NativeFexpr extends Val {
  constructor(
    public name: string,
    protected body: (env: Environment, ...args: Val[]) => Val,
  ) {
    super()
  }

  _toJs() {
    return this.name
  }

  call(env: Environment, args: Val[]) {
    return this.body(env, ...args)
  }
}

function evaluateArgs(env: Environment, args: Val[]) {
  const evaluatedArgs: Val[] = []
  for (const arg of args) {
    evaluatedArgs.push(arg.eval(env))
  }
  return evaluatedArgs
}

export class Fn extends Fexpr {
  eval(env: Environment) {
    return new FnClosure(this.params, this._bindFreeVars(env), this.body)
  }

  _toJs() {
    return ['fn', ['params', ...this.params], this.body._toJs()]
  }
}

class NativeFn extends Val {
  constructor(
    public name: string,
    protected body: (...args: Val[]) => Val,
  ) {
    super()
  }

  call(env: Environment, args: Val[]) {
    return this.body(...evaluateArgs(env, args))
  }
}

export class Ref extends Val {
  constructor(protected val: Val = new Null()) {
    super()
  }

  eval(_env: Environment) {
    return this.val
  }

  _toJs(): any {
    return ['ref', this.val._toJs()]
  }

  set(_env: Environment, val: Val) {
    this.val = val
    return val
  }
}

export class SymRef extends Ref {
  static intrinsics: Binding

  constructor(env: Environment, public name: string) {
    super()
    if (env.getIndex(name) === undefined) {
      throw new Error(`undefined symbol ${name}`)
    }
  }

  eval(env: Environment): Val {
    const ref = env.get(this.name)
    return ref.eval(env)
  }

  _toJs() {
    return this.name
  }

  set(env: Environment, val: Val) {
    const evaluatedVal = val.eval(env)
    env.set(this.name, evaluatedVal)
    return evaluatedVal
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

  _value(): object {
    const jsObj = {}
    // eslint-disable-next-line guard-for-in
    for (const key in this) {
      (jsObj as any)[key] = (this[key] as Val)._value()
    }
    return jsObj
  }

  _toJs() {
    const jsObj = {}
    // eslint-disable-next-line guard-for-in
    for (const key in this) {
      (jsObj as any)[key] = (this[key] as Val)._toJs()
    }
    return jsObj
  }
}

// A BindingVal holds Refs to Vals, so that the Vals can be referred to in
// multiple BindingVals, in particular by closures' free variables.
export class BindingVal extends Val {
  constructor(public map: Map<string, Ref>) {
    super()
  }
}

// Until we can evaluate a dict literal, we don't know the values of its
// keys.
export class DictLiteral extends Val {
  constructor(protected map: Map<Val, Val>) {
    super()
  }

  eval(env: Environment): Dict {
    const evaluatedMap = new Map<any, Val>()
    for (const [k, v] of this.map) {
      evaluatedMap.set(k.eval(env)._value(), v.eval(env))
    }
    return new Dict(evaluatedMap)
  }

  // Best effort.
  _value() {
    return this.eval(new EnvironmentVal([]))._value()
  }

  _toJs() {
    const obj: any[] = ['map']
    for (const [k, v] of this.map) {
      obj.push([k._toJs(), v._toJs()])
    }
    return obj
  }
}

export class Dict extends Val {
  constructor(public map: Map<Val, Val>) {
    super()
  }

  eval(env: Environment): Val {
    const evaluatedMap = new Map<any, Val>()
    for (const [k, v] of this.map) {
      evaluatedMap.set(k, v.eval(env) as Val)
    }
    // FIXME: Don't do this: need to be able to use ConcreteVal values as
    // keys by their underlying value.
    this.map = evaluatedMap
    return this
  }

  _value() {
    const evaluatedMap = new Map<any, Val>()
    for (const [k, v] of this.map) {
      evaluatedMap.set(k, v.eval(new EnvironmentVal([]))._value())
    }
    return evaluatedMap
  }

  _toJs() {
    const obj: any[] = ['map']
    for (const [k, v] of this.map) {
      // FIXME: see above.
      const keyJs = k instanceof Val ? k._toJs() : k
      obj.push([keyJs, v._toJs()])
    }
    return obj
  }

  set(_env: Environment, index: Val, val: Val) {
    this.map.set(index._value(), val)
    return val
  }

  get(_env: Environment, index: Val) {
    return this.map.get(index._value()) ?? new Null()
  }
}

export class List extends Val {
  constructor(private val: Val[]) {
    super()
  }

  eval(env: Environment): Val {
    this.val = this.val.map((e) => e.eval(env))
    return this
  }

  _value() {
    return this.val.map((e) => e._value())
  }

  _toJs() {
    return ['list', ...this.val.map((e) => e._toJs())]
  }

  length(_env: Environment) {
    return new Num(this.val.length)
  }

  get(_env: Environment, index: Val) {
    return this.val[(index as Num)._value()]
  }

  set(_env: Environment, index: Val, val: Val) {
    this.val[index._value()] = val
    return val
  }
}

export class Let extends Val {
  constructor(private boundVars: string[], private body: Val) {
    super()
  }

  eval(env: Environment) {
    const binding = bindArgsToParams(this.boundVars, [])
    binding.map.forEach((v) => {
      // First eval the Ref, then eval the value
      v.set(env, v.eval(env).eval(env))
    })
    return this.body.eval(env.extend(binding))
  }

  _toJs() {
    return ['let', ['params', ...this.boundVars], this.body._toJs()]
  }
}

export class Call extends Val {
  constructor(public fn: Val, public args: Val[]) {
    super()
  }

  eval(env: Environment) {
    const fn = this.fn.eval(env) as FexprClosure
    return fn.call(env, this.args)
  }

  _toJs() {
    return [this.fn._toJs(), ...this.args.map((arg) => arg._toJs())]
  }
}

export class Prop extends Val {
  constructor(public prop: string, public ref: Val, public args: Val[]) {
    super()
  }

  eval(env: Environment) {
    const obj = this.ref.eval(env)
    if (!(this.prop in obj)) {
      throw new PropertyException(`no property '${this.prop}'`)
    }
    return (obj as any)[this.prop](env, ...this.args.map((e) => e.eval(env)))
  }

  _toJs() {
    return ['prop', this.prop, this.ref._toJs(), ...this.args.map((e) => e._toJs())]
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
    return new NativeFn(x.name, (...args: Val[]) => jsToVal(x(...args.map((x) => x._value()))))
  }
  if (typeof x === 'object') {
    return new Obj(x)
  }
  throw new Error(`cannot convert JavaScript value ${x}`)
}

export const intrinsics = {
  pi: new Num(Math.PI),
  e: new Num(Math.E),
  new: new NativeFn('new', (val: Val) => new Ref(val)),
  pos: new NativeFn('pos', (val: Val) => new Num(+val._value())),
  neg: new NativeFn('neg', (val: Val) => new Num(-val._value())),
  not: new NativeFn('not', (val: Val) => new Bool(!val._value())),
  seq: new NativeFexpr('seq', (env: Environment, ...args: Val[]) => {
    let res: Val = new Null()
    for (const exp of args) {
      res = exp.eval(env)
    }
    return res
  }),
  if: new NativeFexpr('if', (env: Environment, cond: Val, e_then: Val, e_else: Val) => {
    const condVal = cond.eval(env)
    if (condVal._value()) {
      return e_then.eval(env)
    }
    return e_else ? e_else.eval(env) : new Null()
  }),
  and: new NativeFexpr('and', (env: Environment, left: Val, right: Val) => {
    const leftVal = left.eval(env)
    if (leftVal._value()) {
      return right.eval(env)
    }
    return leftVal
  }),
  or: new NativeFexpr('or', (env: Environment, left: Val, right: Val) => {
    const leftVal = left.eval(env)
    if (leftVal._value()) {
      return leftVal
    }
    return right.eval(env)
  }),
  loop: new NativeFexpr('loop', (env: Environment, body: Val) => {
    for (; ;) {
      try {
        body.eval(env)
      } catch (e) {
        if (e instanceof BreakException) {
          return e._value()
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
  '=': new NativeFn('=', (left: Val, right: Val) => new Bool(left._value() === right._value())),
  '!=': new NativeFn('!=', (left: Val, right: Val) => new Bool(left._value() !== right._value())),
  '<': new NativeFn('<', (left: Val, right: Val) => new Bool(left._value() < right._value())),
  '<=': new NativeFn('<=', (left: Val, right: Val) => new Bool(left._value() <= right._value())),
  '>': new NativeFn('>', (left: Val, right: Val) => new Bool(left._value() > right._value())),
  '>=': new NativeFn('>=', (left: Val, right: Val) => new Bool(left._value() >= right._value())),
  '+': new NativeFn('+', (left: Val, right: Val) => new Num(left._value() + right._value())),
  '-': new NativeFn('-', (left: Val, right: Val) => new Num(left._value() - right._value())),
  '*': new NativeFn('*', (left: Val, right: Val) => new Num(left._value() * right._value())),
  '/': new NativeFn('/', (left: Val, right: Val) => new Num(left._value() / right._value())),
  '%': new NativeFn('%', (left: Val, right: Val) => new Num(left._value() % right._value())),
  '**': new NativeFn('**', (left: Val, right: Val) => new Num(left._value() ** right._value())),
  print: new NativeFn('print', (obj: Val) => {
    console.log(obj._value())
    return new Null()
  }),
  debug: new NativeFn('debug', (obj: Val) => {
    debug(obj)
    return new Null()
  }),
  js: new Obj({
    use: (_env: EnvironmentVal, ...args: Val[]) => {
      const requirePath = (args.map((e) => e._value()).join('.'))
      // eslint-disable-next-line import/no-dynamic-require, global-require
      const module = require(requirePath)
      const wrappedModule = {}
      // eslint-disable-next-line guard-for-in
      for (const key in module) {
        (wrappedModule as any)[key] = () => jsToVal(module[key])
      }
      return new Obj(wrappedModule)
    },
  }),
}

function listToBinding(elems: {[key: string]: Val}): BindingVal {
  return new BindingVal(
    new Map(Object.entries(elems).map(([k, v]): [string, Ref] => [k, new Ref(v)])),
  )
}

SymRef.intrinsics = listToBinding(intrinsics)

export class EnvironmentVal {
  public env: Binding[]

  constructor(localEnv: Binding[]) {
    this.env = [...localEnv, SymRef.intrinsics]
  }

  get(sym: string) {
    const index = this.getIndex(sym)
    if (index === undefined) {
      throw new Error(`undefined symbol at run-time ${sym}`)
    }
    return this.env[index].map.get(sym)!
  }

  set(sym: string, val: Val) {
    const index = this.getIndex(sym)
    if (index === undefined) {
      throw new Error(`undefined symbol at run-time ${sym}`)
    }
    const ref = this.env[index].map.get(sym)!
    ref.set(this, val)
  }

  getIndex(sym: string) {
    for (let i = 0; i < this.env.length; i += 1) {
      if (this.env[i].map.has(sym)) {
        return i
      }
    }
    return undefined
  }

  extend(binding: Binding): Environment {
    return new EnvironmentVal([binding, ...this.env.slice(0, -1)])
  }
}

export function valToJson(val: Val) {
  return JSON.stringify(val._toJs())
}

export function debug(x: any, depth: number | null = 1) {
  console.dir(x, {depth})
}
