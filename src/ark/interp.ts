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
      res = evalArk(this.body, env.extend(this.freeVars).extend(binding))
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
  call(env: Environment, args: Val[]) {
    const evaluatedArgs = evaluateArgs(env, args)
    return super.call(env, evaluatedArgs)
  }
}

export class Fexpr extends Val {
  constructor(public params: string[], protected freeVars: Set<string>, public body: Val) {
    super()
  }

  bindFreeVars(env: Environment): Binding {
    return new BindingVal(new Map(
      [...this.freeVars].map((name): [string, Ref] => [name, env.get(name)]),
    ))
  }
}

export class NativeFexpr extends Val {
  constructor(
    public name: string,
    protected body: (env: Environment, ...args: Val[]) => Val,
  ) {
    super()
  }

  call(env: Environment, args: Val[]) {
    return this.body(env, ...args)
  }
}

function evaluateArgs(env: Environment, args: Val[]) {
  const evaluatedArgs: Val[] = []
  for (const arg of args) {
    evaluatedArgs.push(evalArk(arg, env))
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

  call(env: Environment, args: Val[]) {
    return this.body(...evaluateArgs(env, args))
  }
}

export class Ref extends Val {
  constructor(public val: Val = new Null()) {
    super()
  }

  set(_env: Environment, val: Val) {
    this.val = val
    return val
  }
}

export class SymRef extends Ref {
  // FIXME: This has no reason to be here.
  static intrinsics: Binding

  constructor(env: Environment, public name: string) {
    super()
    if (env.getIndex(name) === undefined) {
      throw new Error(`undefined symbol ${name}`)
    }
  }

  set(env: Environment, val: Val) {
    const evaluatedVal = evalArk(val, env)
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
  constructor(public map: Map<Val, Val>) {
    super()
  }
}

export class Dict extends Val {
  constructor(public map: Map<Val, Val>) {
    super()
  }

  set(_env: Environment, index: Val, val: Val) {
    this.map.set(valueOf(index), val)
    return val
  }

  get(_env: Environment, index: Val) {
    return this.map.get(valueOf(index)) ?? new Null()
  }
}

export class List extends Val {
  constructor(public val: Val[]) {
    super()
  }

  length(_env: Environment) {
    return new Num(this.val.length)
  }

  get(_env: Environment, index: Val) {
    return this.val[valueOf(index as Num)]
  }

  set(_env: Environment, index: Val, val: Val) {
    this.val[valueOf(index)] = val
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
    return new NativeFn(x.name, (...args: Val[]) => jsToVal(x(...args.map(valueOf))))
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
  pos: new NativeFn('pos', (val: Val) => new Num(+valueOf(val))),
  neg: new NativeFn('neg', (val: Val) => new Num(-valueOf(val))),
  not: new NativeFn('not', (val: Val) => new Bool(!valueOf(val))),
  seq: new NativeFexpr('seq', (env: Environment, ...args: Val[]) => {
    let res: Val = new Null()
    for (const exp of args) {
      res = evalArk(exp, env)
    }
    return res
  }),
  if: new NativeFexpr('if', (env: Environment, cond: Val, e_then: Val, e_else: Val) => {
    const condVal = evalArk(cond, env)
    if (valueOf(condVal)) {
      return evalArk(e_then, env)
    }
    return e_else ? evalArk(e_else, env) : new Null()
  }),
  and: new NativeFexpr('and', (env: Environment, left: Val, right: Val) => {
    const leftVal = evalArk(left, env)
    if (valueOf(leftVal)) {
      return evalArk(right, env)
    }
    return leftVal
  }),
  or: new NativeFexpr('or', (env: Environment, left: Val, right: Val) => {
    const leftVal = evalArk(left, env)
    if (valueOf(leftVal)) {
      return leftVal
    }
    return evalArk(right, env)
  }),
  loop: new NativeFexpr('loop', (env: Environment, body: Val) => {
    for (; ;) {
      try {
        evalArk(body, env)
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
  '=': new NativeFn('=', (left: Val, right: Val) => new Bool(valueOf(left) === valueOf(right))),
  '!=': new NativeFn('!=', (left: Val, right: Val) => new Bool(valueOf(left) !== valueOf(right))),
  '<': new NativeFn('<', (left: Val, right: Val) => new Bool(valueOf(left) < valueOf(right))),
  '<=': new NativeFn('<=', (left: Val, right: Val) => new Bool(valueOf(left) <= valueOf(right))),
  '>': new NativeFn('>', (left: Val, right: Val) => new Bool(valueOf(left) > valueOf(right))),
  '>=': new NativeFn('>=', (left: Val, right: Val) => new Bool(valueOf(left) >= valueOf(right))),
  '+': new NativeFn('+', (left: Val, right: Val) => new Num(valueOf(left) + valueOf(right))),
  '-': new NativeFn('-', (left: Val, right: Val) => new Num(valueOf(left) - valueOf(right))),
  '*': new NativeFn('*', (left: Val, right: Val) => new Num(valueOf(left) * valueOf(right))),
  '/': new NativeFn('/', (left: Val, right: Val) => new Num(valueOf(left) / valueOf(right))),
  '%': new NativeFn('%', (left: Val, right: Val) => new Num(valueOf(left) % valueOf(right))),
  '**': new NativeFn('**', (left: Val, right: Val) => new Num(valueOf(left) ** valueOf(right))),
  print: new NativeFn('print', (obj: Val) => {
    console.log(valueOf(obj))
    return new Null()
  }),
  debug: new NativeFn('debug', (obj: Val) => {
    debug(obj)
    return new Null()
  }),
  js: new Obj({
    use: (_env: EnvironmentVal, ...args: Val[]) => {
      const requirePath = (args.map(valueOf).join('.'))
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

export function evalArk(val: Val, env: EnvironmentVal): Val {
  if (val instanceof SymRef) {
    const ref = env.get(val.name)
    return evalArk(ref, env)
  } else if (val instanceof Ref) {
    return val.val
  } else if (val instanceof Fn) {
    return new FnClosure(val.params, val.bindFreeVars(env), val.body)
  } else if (val instanceof Fexpr) {
    return new FexprClosure(val.params, val.bindFreeVars(env), val.body)
  } else if (val instanceof DictLiteral) {
    const evaluatedMap = new Map<any, Val>()
    for (const [k, v] of val.map) {
      evaluatedMap.set(valueOf(evalArk(k, env)), evalArk(v, env))
    }
    return new Dict(evaluatedMap)
  } else if (val instanceof Dict) {
    const evaluatedMap = new Map<any, Val>()
    for (const [k, v] of val.map) {
      evaluatedMap.set(k, evalArk(v, env) as Val)
    }
    // FIXME: Don't do this: need to be able to use ConcreteVal values as
    // keys by their underlying value.
    // eslint-disable-next-line no-param-reassign
    val.map = evaluatedMap
    return val
  } else if (val instanceof List) {
    // eslint-disable-next-line no-param-reassign
    val.val = val.val.map((e) => evalArk(e, env))
    return val
  } else if (val instanceof Let) {
    const binding = bindArgsToParams(val.boundVars, [])
    binding.map.forEach((v) => {
      // First eval the Ref, then eval the value
      v.set(env, evalArk(evalArk(v, env), env))
    })
    return evalArk(val.body, env.extend(binding))
  } else if (val instanceof Call) {
    const fn = evalArk(val.fn, env) as FexprClosure
    return fn.call(env, val.args)
  } else if (val instanceof Prop) {
    const obj = evalArk(val.ref, env)
    if (!(val.prop in obj)) {
      throw new PropertyException(`no property '${val.prop}'`)
    }
    return (obj as any)[val.prop](env, ...val.args.map((e) => evalArk(e, env)))
  }
  return val
}

export function valueOf(val: Val): any {
  if (val instanceof ConcreteVal) {
    return val.val
  } else if (val instanceof Obj) {
    const obj = {}
    // eslint-disable-next-line guard-for-in
    for (const key in val) {
      (obj as any)[key] = valueOf((val as any)[key] as Val)
    }
    return obj
  } else if (val instanceof DictLiteral) {
    // Best effort.
    return valueOf(evalArk(val, new EnvironmentVal([])))
  } else if (val instanceof Dict) {
    const evaluatedMap = new Map<any, Val>()
    for (const [k, v] of val.map) {
      evaluatedMap.set(k, valueOf(evalArk(v, new EnvironmentVal([]))))
    }
    return evaluatedMap
  } else if (val instanceof List) {
    return val.val.map(valueOf)
  }
  return val
}

export function toJson(val: Val): any {
  if (val instanceof SymRef || val instanceof NativeFexpr) {
    return val.name
  } else if (val instanceof Str) {
    return ['str', val.val]
  } else if (val instanceof ConcreteVal) {
    return val.val
  } else if (val instanceof Ref) {
    return ['ref', toJson(val.val)]
  } else if (val instanceof Fn) {
    return ['fn', ['params', ...val.params], toJson(val.body)]
  } else if (val instanceof Fexpr) {
    return ['fexpr', ['params', ...val.params], toJson(val.body)]
  } else if (val instanceof Obj) {
    const obj = {}
    // eslint-disable-next-line guard-for-in
    for (const key in val) {
      (obj as any)[key] = toJson((val as any)[key] as Val)
    }
    return obj
  } else if (val instanceof DictLiteral) {
    const obj: any[] = ['map']
    for (const [k, v] of val.map) {
      obj.push([toJson(k), toJson(v)])
    }
    return obj
  } else if (val instanceof Dict) {
    const obj: any[] = ['map']
    for (const [k, v] of val.map) {
      // FIXME: see valueOf.
      const keyJs = k instanceof Val ? toJson(k) : k
      obj.push([keyJs, toJson(v)])
    }
    return obj
  } else if (val instanceof List) {
    return ['list', ...val.val.map(toJson)]
  } else if (val instanceof Let) {
    return ['let', ['params', ...val.boundVars], toJson(val.body)]
  } else if (val instanceof Call) {
    return [toJson(val.fn), ...val.args.map(toJson)]
  } else if (val instanceof Prop) {
    return ['prop', val.prop, toJson(val.ref), ...val.args.map(toJson)]
  }
  return val
}

export function valToJson(val: Val) {
  return JSON.stringify(toJson(val))
}

export function debug(x: any, depth: number | null = 1) {
  console.dir(x, {depth})
}
