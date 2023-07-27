import {Node} from 'ohm-js'
// eslint-disable-next-line import/extensions
import grammar, {HakLispSemantics} from './haklisp.ohm-bundle.js'

// Specify precise type so semantics can be precisely type-checked.
const semantics: HakLispSemantics = grammar.createSemantics()

export type Binding = BindingVal
export type Environment = EnvironmentVal

// Base class for parsing the language, extended directly by classes used
// only during parsing.
export class AST {}

// Base class for compiled code.
export class Val extends AST {
  // Uncomment the following for debug.
  // static counter = 0

  // uid: number

  // constructor() {
  //   super()
  //   this.uid = Val.counter
  //   Val.counter += 1
  // }

  eval(_env: Environment): Val {
    return this
  }

  value(): any {
    return this
  }

  properties: {[key: string]: Function} = {}
}

abstract class ConcreteVal extends Val {
  constructor(protected val: any = null) {
    super()
  }

  value(): any {
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
      res = this.body.eval(env.extend(this.freeVars).extend(binding))
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

class Fexpr extends Val {
  constructor(protected params: string[], protected freeVars: Set<string>, protected body: Val) {
    super()
  }

  bindFreeVars(env: Environment): Binding {
    return new BindingVal(new Map(
      [...this.freeVars].map((name): [string, Ref] => [name, env.get(name)]),
    ))
  }

  eval(env: Environment) {
    return new FexprClosure(this.params, this.bindFreeVars(env), this.body)
  }
}

export class NativeFexpr extends Val {
  constructor(
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
    evaluatedArgs.push(arg.eval(env))
  }
  return evaluatedArgs
}

export class Fn extends Fexpr {
  eval(env: Environment) {
    return new FnClosure(this.params, this.bindFreeVars(env), this.body)
  }
}

class NativeFn extends Val {
  constructor(
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

  set(_env: Environment, val: Val): Val {
    this.val = val
    return this.val
  }

  properties = {
    set: (_env: Environment, val: Val) => {
      this.val = val
      return val
    },
  }
}

export class SymRef extends Ref {
  static globals: Binding

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

  set(env: Environment, val: Val) {
    const evaluatedVal = val.eval(env)
    env.set(this.name, evaluatedVal)
    return evaluatedVal
  }

  properties = {
    set: (env: Environment, val: Val) => {
      this.set(env, val)
      return val
    },
  }
}

export class HakMap<K, V extends Val> extends Val {
  constructor(public map: Map<K, V>) {
    super()
  }

  eval(env: Environment): Val {
    const evaluatedMap = new Map<K, V>()
    for (const [k, v] of this.map) {
      evaluatedMap.set(k, v.eval(env) as V)
    }
    this.map = evaluatedMap
    return this
  }

  value() {
    const valElems = new Map()
    for (const [k, v] of this.map) {
      valElems.set(k, v.value())
    }
    return valElems
  }

  properties = {
    get: (_env: Environment, index: Val) => this.map.get(index.value()),
  }
}

export class Obj extends HakMap<string, Val> {}

// A BindingVal holds Refs to Vals, so that the Vals can be referred to in
// multiple BindingVals, in particular by closures' free variables.
export class BindingVal extends HakMap<string, Ref> {}

// Until we can evaluate a dict literal, we don't know the values of its
// keys.
export class DictLiteral extends Val {
  constructor(protected map: Map<Val, Val>) {
    super()
  }

  eval(env: Environment): Dict {
    const evaluatedMap = new Map<any, Val>()
    for (const [k, v] of this.map) {
      evaluatedMap.set(k.eval(env).value(), v.eval(env))
    }
    return new Dict(evaluatedMap)
  }

  // Best effort.
  value() {
    return this.eval(new EnvironmentVal([])).value()
  }
}

export class Dict extends HakMap<any, Val> {
  constructor(public map: Map<Val, Val>) {
    super(map)
  }

  value() {
    const evaluatedMap = new Map<any, Val>()
    for (const [k, v] of this.map) {
      evaluatedMap.set(k, v.eval(new EnvironmentVal([])).value())
    }
    return evaluatedMap
  }

  properties = {
    ...super.properties,
    set: (_env: Environment, index: Val, val: Val) => {
      this.map.set(index.value(), val)
      return val
    },
    get: (_env: Environment, index: Val) => this.map.get(index.value()) ?? new Null(),
  }
}

export class List extends Val {
  constructor(private val: Val[]) {
    super()
  }

  eval(env: Environment): Val {
    this.val = this.val.map((e: Val) => e.eval(env))
    return this
  }

  value() {
    return this.val.map((e: Val) => e.value())
  }

  properties = {
    length: (_env: Environment) => new Num(this.val.length),
    get: (_env: Environment, index: Val) => this.val[(index as Num).value()],
    set: (_env: Environment, index: Val, val: Val) => {
      this.val[index.value()] = val
      return val
    },
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
}

export class Call extends Val {
  constructor(private fn: Val, private args: Val[]) {
    super()
  }

  eval(env: Environment) {
    const fn = this.fn.eval(env) as FexprClosure
    return fn.call(env, this.args)
  }
}

const globals: [string, Val][] = [
  ['pi', new Num(Math.PI)],
  ['e', new Num(Math.E)],
  ['true', new Bool(true)],
  ['false', new Bool(false)],
  ['new', new NativeFn((val: Val) => new Ref(val))],
  ['eval', new NativeFexpr((env: Environment, ref: Val) => ref.eval(env).eval(env))],
  ['pos', new NativeFn((val: Val) => new Num(+val.value()))],
  ['neg', new NativeFn((val: Val) => new Num(-val.value()))],
  ['not', new NativeFn((val: Val) => new Bool(!val.value()))],
  ['seq', new NativeFexpr((env: Environment, ...args: Val[]) => {
    let res: Val = new Null()
    for (const exp of args) {
      res = exp.eval(env)
    }
    return res
  })],
  ['if', new NativeFexpr((env: Environment, cond: Val, e_then: Val, e_else: Val) => {
    const condVal = cond.eval(env)
    if (condVal.value()) {
      return e_then.eval(env)
    }
    return e_else ? e_else.eval(env) : new Null()
  })],
  ['and', new NativeFexpr((env: Environment, left: Val, right: Val) => {
    const leftVal = left.eval(env)
    if (leftVal.value()) {
      return right.eval(env)
    }
    return leftVal
  })],
  ['or', new NativeFexpr((env: Environment, left: Val, right: Val) => {
    const leftVal = left.eval(env)
    if (leftVal.value()) {
      return leftVal
    }
    return right.eval(env)
  })],
  ['loop', new NativeFexpr((env: Environment, body: Val) => {
    for (; ;) {
      try {
        body.eval(env)
      } catch (e) {
        if (e instanceof BreakException) {
          return e.value()
        }
        if (!(e instanceof ContinueException)) {
          throw e
        }
      }
    }
  })],
  ['break', new NativeFn((val: Val) => {
    throw new BreakException(val)
  })],
  ['continue', new NativeFn(() => {
    throw new ContinueException()
  })],
  ['return', new NativeFn((val: Val) => {
    throw new ReturnException(val)
  })],
  ['=', new NativeFn((left: Val, right: Val) => new Bool(left.value() === right.value()))],
  ['!=', new NativeFn((left: Val, right: Val) => new Bool(left.value() !== right.value()))],
  ['<', new NativeFn((left: Val, right: Val) => new Bool(left.value() < right.value()))],
  ['<=', new NativeFn((left: Val, right: Val) => new Bool(left.value() <= right.value()))],
  ['>', new NativeFn((left: Val, right: Val) => new Bool(left.value() > right.value()))],
  ['>=', new NativeFn((left: Val, right: Val) => new Bool(left.value() >= right.value()))],
  ['+', new NativeFn((left: Val, right: Val) => new Num(left.value() + right.value()))],
  ['-', new NativeFn((left: Val, right: Val) => new Num(left.value() - right.value()))],
  ['*', new NativeFn((left: Val, right: Val) => new Num(left.value() * right.value()))],
  ['/', new NativeFn((left: Val, right: Val) => new Num(left.value() / right.value()))],
  ['%', new NativeFn((left: Val, right: Val) => new Num(left.value() % right.value()))],
  ['**', new NativeFn((left: Val, right: Val) => new Num(left.value() ** right.value()))],
  ['print', new NativeFn((obj: Val) => {
    debug(obj.value())
    return new Null()
  })],
]

function listToBinding(elems: [string, Val][]): BindingVal {
  return new BindingVal(new Map(elems.map(([k, v]): [string, Ref] => [k, new Ref(v)])))
}

SymRef.globals = listToBinding(globals)

export class EnvironmentVal {
  public env: Binding[]

  constructor(localEnv: Binding[]) {
    this.env = [...localEnv, SymRef.globals]
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

class KeyValue extends AST {
  constructor(public key: AST, public val: AST) {
    super()
  }
}

class PropertyValue extends AST {
  constructor(public key: string, public val: AST) {
    super()
  }
}

export class Quote extends Val {
  constructor(public sym: string) {
    super()
  }

  eval(env: EnvironmentVal): Val {
    return new SymRef(env, this.sym)
  }
}

semantics.addOperation<AST>('toAST(env)', {
  Program(atoms) {
    if (atoms.children.length === 0) {
      return new Null()
    }
    return new Call(new SymRef(this.args.env, 'seq'), atoms.children.map((value) => value.toAST(this.args.env)))
  },
  Atom_stmt(_open, stmt, _close) {
    return stmt.toAST(this.args.env)
  },
  Object(_open, elems, _close) {
    const inits = new Map<string, Val>()
    for (const elem of elems.children.map((value) => value.toAST(this.args.env))) {
      inits.set((elem as PropertyValue).key, (elem as PropertyValue).val as Val)
    }
    return new Obj(inits)
  },
  PropertyValue(sym, _colon, val) {
    return new PropertyValue(sym.sourceString, val.toAST(this.args.env))
  },
  Stmt_call(exp, args) {
    return new Call(
      exp.toAST(this.args.env),
      args.children.map((value) => value.toAST(this.args.env)),
    )
  },
  Stmt_let(_let, params, body) {
    const paramList = params.toAST(this.args.env)
    const paramBinding = bindArgsToParams(paramList, [])
    return new Let(paramList, body.toAST(this.args.env.extend(paramBinding)))
  },
  Stmt_fn(_fn, params, body) {
    const paramList = params.toAST(this.args.env)
    const paramBinding = bindArgsToParams(paramList, [])
    return new Fn(
      paramList,
      this.freeVars,
      body.toAST(this.args.env.extend(paramBinding)),
    )
  },
  Stmt_fexpr(_fn, params, body) {
    const paramBinding = bindArgsToParams(params.toAST(this.args.env), [])
    return new Fexpr(
      params.toAST(this.args.env),
      this.freeVars,
      body.toAST(this.args.env.extend(paramBinding)),
    )
  },
  Stmt_quote(_quote, sym) {
    return new Quote(sym.sourceString)
  },
  Stmt_prop(_prop, prop, ref, rest) {
    const propName = prop.sourceString
    const refVal = ref.toAST(this.args.env)
    return new Call(
      new NativeFexpr((env, ...args) => {
        const evaluatedRef = refVal.eval(env)
        const props = evaluatedRef.properties
        if (!(propName in props)) {
          throw new PropertyException(`no property '${propName}'`)
        }
        return evaluatedRef.properties[propName](env, ...args.map((e) => e.eval(env)))
      }),
      rest.children.map((value: Node) => value.toAST(this.args.env)),
    )
  },
  ParamList(_open, params, _close) {
    return params.children.map((name) => name.sourceString)
  },
  List(_open, elems, _close) {
    const inits: Val[] = []
    for (const elem of elems.children.map((value) => value.toAST(this.args.env))) {
      inits.push(elem)
    }
    return new List(inits)
  },
  Map(_open, elems, _close) {
    const inits = new Map<Val, Val>()
    for (const elem of elems.children.map((value) => value.toAST(this.args.env))) {
      inits.set((elem as KeyValue).key as Val, (elem as KeyValue).val as Val)
    }
    return new DictLiteral(inits)
  },
  KeyValue(key, _colon, value) {
    return new KeyValue(key.toAST(this.args.env), value.toAST(this.args.env))
  },
  Literal_null(_null) {
    return new Null()
  },
  symbol_alphanum(_l, _ns) {
    return new SymRef(this.args.env, this.sourceString)
  },
  symbol_punct(_p) {
    return new SymRef(this.args.env, this.sourceString)
  },
  bool(flag) {
    return new Bool(flag.sourceString === 'true')
  },
  number(_) {
    return new Num(parseFloat(this.sourceString))
  },
  string(_open, str, _close) {
    return new Str(str.sourceString)
  },
})

export function mergeFreeVars(children: Node[]): Set<string> {
  return new Set<string>(children.map((child) => [...child.freeVars]).flat())
}

export function setDifference<T>(setA: Set<T>, setB: Set<T>) {
  const difference = new Set(setA)
  for (const elem of setB) {
    difference.delete(elem)
  }
  return difference
}

semantics.addAttribute<Set<string>>('freeVars', {
  _terminal() {
    return new Set()
  },
  _nonterminal(...children) {
    return mergeFreeVars(children)
  },
  _iter(...children) {
    return mergeFreeVars(children)
  },
  Stmt_let(_let, binding, body) {
    return setDifference(body.freeVars, binding.freeVars)
  },
  Stmt_fn(_fn, params, body) {
    return setDifference(body.freeVars, params.freeVars)
  },
  Stmt_prop(_prop, _propName, ref, rest) {
    return mergeFreeVars([ref, rest])
  },
  symbol_alphanum(_l, _ns) {
    return new Set<string>([this.sourceString])
  },
  symbol_punct(_p) {
    return new Set([this.sourceString])
  },
})

export function toVal(expr: string): Val {
  const matchResult = grammar.match(expr)
  if (matchResult.failed()) {
    console.log(matchResult.message)
  }
  return semantics(matchResult).toAST(new EnvironmentVal([]))
}

export function debug(x: any, depth: number | undefined = undefined) {
  console.dir(x, {depth: depth ?? null})
}
