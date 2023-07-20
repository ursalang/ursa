import grammar, {HakLispSemantics} from './haklisp.ohm-bundle'

// Specify precise type so semantics can be precisely type-checked.
const semantics: HakLispSemantics = grammar.createSemantics()

// Unify with Object? then can be directly evalled. At least in Let…
type Binding = {[key: string]: Val}

// Base class for parsing the language, extended directly by classes used
// only during parsing.
export class AST {}

// Base class for compiled code.
export class Val extends AST {
  eval(_env: Binding[]): Val {
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

export class IndexException extends HakException {}

export class PropertyException extends HakException {}

function bindArgsToParams(params: string[], args: Val[]): Binding {
  const binding = Object.fromEntries(params.map((key, index) => [key, args[index]]))
  if (args.length > params.length) {
    binding['...'] = new List(args.slice(params.length))
  }
  return binding
}

class Fexpr extends Val {
  // FIXME: close over env supplied to constructor
  constructor(public params: string[], protected env: Obj, protected body: Val) {
    super()
  }

  properties = {
    call: (args: Val[], env: Binding[]) => {
      let res: Val = new Null()
      try {
        res = this.body.eval([...env, bindArgsToParams(this.params, args)])
      } catch (e) {
        if (!(e instanceof ReturnException)) {
          throw e
        }
        res = e.value()
      }
      return res
    },
  }
}

class NativeFexpr extends Val {
  constructor(
    protected body: (env: Binding[], ...args: Val[]) => Val,
  ) {
    super()
  }

  properties = {
    call: (args: Val[], env: Binding[]) => this.body(env, ...args),
  }
}

function evaluateArgs(env: Binding[], args: Val[]) {
  const evaluatedArgs: Val[] = []
  for (const arg of args) {
    evaluatedArgs.push(arg.eval(env))
  }
  return evaluatedArgs
}

class Fn extends Fexpr {
  properties = {
    call: (args: Val[], env: Binding[]) => {
      let res: Val = new Null()
      try {
        const binding = bindArgsToParams(this.params, evaluateArgs(env, args))
        res = this.body.eval([...env, binding])
      } catch (e) {
        if (!(e instanceof ReturnException)) {
          throw e
        }
        res = e.value()
      }
      return res
    },
  }
}

class NativeFn extends Val {
  constructor(
    protected body: (...args: Val[]) => Val,
  ) {
    super()
  }

  properties = {
    call: (args: Val[], env: Binding[]) => this.body(...evaluateArgs(env, args)),
  }
}

class Ref extends Val {
  constructor(protected val: Val = new Null()) {
    super()
  }

  eval(_env: Binding[]) {
    return this.val
  }

  set(_env: Binding[], val: Val): Val {
    this.val = val
    return this.val
  }
}

export class Sym extends Ref {
  static globals: {[name: string]: Val} = {}

  static findBinding(env: Binding[], id: string): Binding {
    for (let i = env.length - 1; i >= 0; i -= 1) {
      if (env[i][id] !== undefined) {
        return env[i]
      }
    }
    return Sym.globals
  }

  constructor(public name: string) {
    super()
  }

  eval(env: Binding[]): Val {
    const disp = Sym.findBinding(env, this.name)
    return disp[this.name]
  }

  set(env: Binding[], val: Val) {
    const disp = Sym.findBinding(env, this.name)
    const evaluatedVal = val.eval(env)
    disp[this.name] = evaluatedVal
    return evaluatedVal
  }

  properties = {
    set: (env: Binding[], val: Val) => {
      const disp = Sym.findBinding(env, this.name)
      const evaluatedVal = val.eval(env)
      disp[this.name] = evaluatedVal
      return evaluatedVal
    },
  }
}

export class HakMap<K> extends Val {
  constructor(protected map: Map<K, Val>) {
    super()
  }

  eval(env: Binding[]): Val {
    const evaluatedMap = new Map<K, Val>()
    for (const [k, v] of this.map) {
      evaluatedMap.set(k, v.eval(env))
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
    get: (index: Val) => this.map.get(index.value()),
  }
}

export class Obj extends HakMap<string> {
  toBinding(): Binding {
    const binding: Binding = {}
    for (const [name, arg] of this.map) {
      binding[name] = arg
    }
    return binding
  }
}

// Until we can evaluate a dict literal, we don't know the values of its
// keys.
export class DictLiteral extends Val {
  constructor(protected map: Map<Val, Val>) {
    super()
  }

  eval(env: Binding[]): Dict {
    const evaluatedMap = new Map<any, Val>()
    for (const [k, v] of this.map) {
      evaluatedMap.set(k.eval(env).value(), v.eval(env))
    }
    return new Dict(evaluatedMap)
  }

  // Best effort.
  value() {
    return this.eval([]).value()
  }
}

export class Dict extends HakMap<any> {
  constructor(protected map: Map<Val, Val>) {
    super(map)
  }

  value() {
    const evaluatedMap = new Map<any, Val>()
    for (const [k, v] of this.map) {
      evaluatedMap.set(k, v.eval([]).value())
    }
    return evaluatedMap
  }

  properties = {
    ...super.properties,
    set: (index: Val, val: Val) => {
      this.map.set(index.value(), val)
      return val
    },
    get: (index: Val) => this.map.get(index.value()) ?? new Null(),
  }
}

export class List extends Val {
  constructor(private val: Val[]) {
    super()
  }

  value() {
    return this.val.map((e: Val) => e.value())
  }

  toParamList(): string[] {
    const params: string[] = []
    for (const param of this.val) {
      params.push((param as Sym).name)
    }
    if (params.length !== new Set(params).size) {
      throw new Error(`parameters not unique: ${params}`)
    }
    return params
  }

  properties = {
    length: () => new Num(this.val.length),
    get: (index: Val) => this.val[(index as Num).value()],
    set: (index: Val, val: Val) => {
      this.val[index.value()] = val
      return val
    },
  }
}

export class Let extends Val {
  constructor(private binding: Obj, private body: Val) {
    super()
  }

  eval(env: Binding[]) {
    env.push((this.binding.eval(env) as Obj).toBinding())
    const res = this.body.eval(env)
    env.pop()
    return res
  }
}

export class Call extends Val {
  constructor(private fn: Val, private args: Val[]) {
    super()
  }

  eval(env: Binding[]) {
    const fn = this.fn.eval(env) as Fn
    return fn.properties.call(this.args, env)
  }
}

// FIXME: prepend to env
Object.assign(Sym.globals, {
  pi: new Num(Math.PI),
  e: new Num(Math.E),
  true: new Bool(true),
  false: new Bool(false),
  new: new NativeFn((val: Val) => new Ref(val)),
  quote: new NativeFexpr((_env: Binding[], val: Val) => val),
  eval: new NativeFexpr((env: Binding[], ref: Val) => ref.eval(env).eval(env)),
  // FIXME: This should be a NativeFn, once Sym no longer needs env passed to its set method
  set: new NativeFexpr((env: Binding[], ref: Val, val: Val) => {
    const evaluatedRef = ref.eval(env) as Ref
    return evaluatedRef.set(env, val.eval(env))
  }),
  prop: new NativeFexpr((env: Binding[], prop: Val, ref: Val, ...rest: Val[]): Val => {
    const evaluatedRef = ref.eval(env)
    const props = evaluatedRef.properties
    const propName = (prop.eval(env) as Sym).name
    if (!(propName in props)) {
      throw new PropertyException(new Str(`no property '${propName}'`))
    }
    return evaluatedRef.properties[propName](...rest.map((e) => e.eval(env)))
  }),
  pos: new NativeFn((val: Val) => new Num(+val.value())),
  neg: new NativeFn((val: Val) => new Num(-val.value())),
  not: new NativeFn((val: Val) => new Bool(!val.value())),
  seq: new NativeFexpr((env: Binding[], ...args: Val[]) => {
    let res: Val = new Null()
    for (const exp of args) {
      res = exp.eval(env)
    }
    return res
  }),
  fexpr: new NativeFexpr((_env: Binding[], params: Val, body: Val) => new Fexpr(
    (params as List).toParamList(),
    new Obj(new Map()),
    body,
  )),
  let: new NativeFexpr((env: Binding[], object: Val, body: Val) => new Let(
    object.eval(env) as Obj,
    body,
  ).eval(env)),
  fn: new NativeFexpr((_env: Binding[], params: Val, body: Val) => new Fn(
    (params as List).toParamList(),
    new Obj(new Map()),
    body,
  )),
  if: new NativeFexpr((env: Binding[], cond: Val, e_then: Val, e_else: Val) => {
    const condVal = cond.eval(env)
    if (condVal.value()) {
      return e_then.eval(env)
    }
    return e_else ? e_else.eval(env) : new Null()
  }),
  and: new NativeFexpr((env: Binding[], left: Val, right: Val) => {
    const leftVal = left.eval(env)
    if (leftVal.value()) {
      return right.eval(env)
    }
    return leftVal
  }),
  or: new NativeFexpr((env: Binding[], left: Val, right: Val) => {
    const leftVal = left.eval(env)
    if (leftVal.value()) {
      return leftVal
    }
    return right.eval(env)
  }),
  loop: new NativeFexpr((env: Binding[], body: Val) => {
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
  }),
  break: new NativeFn((val: Val) => {
    throw new BreakException(val)
  }),
  continue: new NativeFn(() => {
    throw new ContinueException()
  }),
  return: new NativeFn((val: Val) => {
    throw new ReturnException(val)
  }),
  '=': new NativeFn((left: Val, right: Val) => new Bool(left.value() === right.value())),
  '!=': new NativeFn((left: Val, right: Val) => new Bool(left.value() !== right.value())),
  '<': new NativeFn((left: Val, right: Val) => new Bool(left.value() < right.value())),
  '<=': new NativeFn((left: Val, right: Val) => new Bool(left.value() <= right.value())),
  '>': new NativeFn((left: Val, right: Val) => new Bool(left.value() > right.value())),
  '>=': new NativeFn((left: Val, right: Val) => new Bool(left.value() >= right.value())),
  '+': new NativeFn((left: Val, right: Val) => new Num(left.value() + right.value())),
  '-': new NativeFn((left: Val, right: Val) => new Num(left.value() - right.value())),
  '*': new NativeFn((left: Val, right: Val) => new Num(left.value() * right.value())),
  '/': new NativeFn((left: Val, right: Val) => new Num(left.value() / right.value())),
  '%': new NativeFn((left: Val, right: Val) => new Num(left.value() % right.value())),
  '**': new NativeFn((left: Val, right: Val) => new Num(left.value() ** right.value())),
})

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

semantics.addOperation<AST>('toAST()', {
  Program(atoms) {
    if (atoms.children.length === 0) {
      return new Null()
    }
    return new Call(new Sym('seq'), atoms.children.map((value) => value.toAST()))
  },
  Object(_open, elems, _close) {
    const inits = new Map<string, Val>()
    for (const elem of elems.children.map((value) => value.toAST())) {
      inits.set((elem as PropertyValue).key, (elem as PropertyValue).val as Val)
    }
    return new Obj(inits)
  },
  PropertyValue(sym, _colon, val) {
    return new PropertyValue(sym.sourceString, val.toAST())
  },
  Call(_open, exp, args, _close) {
    return new Call(
      exp.toAST(),
      args.children.map((value) => value.toAST()),
    )
  },
  List(_open, elems, _close) {
    const inits: Val[] = []
    for (const elem of elems.children.map((value) => value.toAST())) {
      inits.push(elem)
    }
    return new List(inits)
  },
  Map(_open, elems, _close) {
    const inits = new Map<Val, Val>()
    for (const elem of elems.children.map((value) => value.toAST())) {
      inits.set((elem as KeyValue).key as Val, (elem as KeyValue).val as Val)
    }
    return new DictLiteral(inits)
  },
  KeyValue(key, _colon, value) {
    return new KeyValue(key.toAST(), value.toAST())
  },
  Literal_null(_null) {
    return new Null()
  },
  symbol_alphanum(_l, _ns) {
    return new Sym(this.sourceString)
  },
  symbol_punct(_p) {
    return new Sym(this.sourceString)
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

export function toVal(expr: string): Val {
  const matchResult = grammar.match(expr)
  return semantics(matchResult).toAST()
}

export function debug(x: any) {
  console.dir(x, {depth: null})
}
