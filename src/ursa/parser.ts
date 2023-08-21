import {Node, IterationNode} from 'ohm-js'
import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug, intrinsics,
  Val, Null, Bool, Num, Str, Ref, SymRef, List, Obj, DictLiteral,
  Call, Let, Fn, NativeFexpr, PropertyException,
  bindArgsToParams, BindingVal, Environment, EnvironmentVal,
} from '../ark/interp.js'
// eslint-disable-next-line import/extensions
import grammar, {UrsaSemantics} from './ursa.ohm-bundle.js'

// Specify precise type so semantics can be precisely type-checked.
const semantics: UrsaSemantics = grammar.createSemantics()

// Base class for parsing the language, extended directly by classes used
// only during parsing.
class AST {}

class PropertyValue extends AST {
  constructor(public key: string, public val: Val) {
    super()
  }
}

class KeyValue extends AST {
  constructor(public key: Val, public val: Val) {
    super()
  }
}

function maybeValue(env: Environment, exp: IterationNode): Val {
  return exp.children.length > 0 ? exp.children[0].toAST(env) : new Null()
}

function makeFn(env: Environment, freeVars: Set<string>, params: Node, body: Node): Val {
  const paramList = params.asIteration().children.map(
    (value) => value.toAST(env)._value(),
  )
  const paramBinding = bindArgsToParams(paramList, [])
  return new Fn(
    paramList,
    freeVars,
    body.toAST(env.extend(paramBinding)),
  )
}

function propAccess(ref: Val, prop: string, ...rest: Val[]): Val {
  return new Call(
    new NativeFexpr(`prop_${prop}`, (env, ...args) => {
      const obj: any = ref.eval(env)
      if (!(prop in obj)) {
        throw new PropertyException(`no property '${prop}'`)
      }
      return obj[prop](env, ...args.map((e) => e.eval(env)))
    }),
    rest,
  )
}

semantics.addOperation<AST>('toAST(env)', {
  If(_if, e_cond, e_then, _else, e_else) {
    const args: Val[] = [e_cond.toAST(this.args.env), e_then.toAST(this.args.env)]
    if (e_else.children.length > 0) {
      args.push(e_else.children[0].toAST(this.args.env))
    }
    return new Call(intrinsics.if, args)
  },
  Fn_anon(_fn, _open, params, _close, body) {
    return makeFn(this.args.env, this.freeVars, params, body)
  },
  NamedFn(_fn, ident, _open, params, _close, body) {
    const bindingEnv = new BindingVal(
      new Map([[ident.sourceString, new Ref(new Null())]]),
    )
    return propAccess(
      new Ref(new SymRef(this.args.env, ident.sourceString)),
      'set',
      makeFn(
        this.args.env.extend(bindingEnv),
        new Set([...this.freeVars, ident.sourceString]),
        params,
        body,
      ),
    )
  },
  CallExp_call(exp, _open, args, _close) {
    return new Call(
      exp.toAST(this.args.env),
      args.asIteration().children.map((value, _i, _arr) => value.toAST(this.args.env)),
    )
  },
  IndexExp_index(object, _open, index, _close) {
    return propAccess(object.toAST(this.args.env), 'get', index.toAST(this.args.env))
  },
  Loop(_loop, e_body) {
    return new Call(intrinsics.loop, [e_body.toAST(this.args.env)])
  },
  Assignment_index(callExp, _open, index, _close, _eq, value) {
    return propAccess(callExp.toAST(this.args.env), 'set', index.toAST(this.args.env), value.toAST(this.args.env))
  },
  Assignment_ident(ident, _eq, value) {
    return propAccess(new Ref(new SymRef(this.args.env, ident.sourceString)), 'set', value.toAST(this.args.env))
  },
  LogicExp_and(left, _and, right) {
    return new Call(intrinsics.and, [left.toAST(this.args.env), right.toAST(this.args.env)])
  },
  LogicExp_or(left, _or, right) {
    return new Call(intrinsics.or, [left.toAST(this.args.env), right.toAST(this.args.env)])
  },
  LogicExp_not(_not, exp) {
    return new Call(intrinsics.not, [exp.toAST(this.args.env)])
  },
  CompareExp_eq(left, _eq, right) {
    return new Call(intrinsics['='], [left.toAST(this.args.env), right.toAST(this.args.env)])
  },
  CompareExp_neq(left, _neq, right) {
    return new Call(intrinsics['!='], [left.toAST(this.args.env), right.toAST(this.args.env)])
  },
  CompareExp_lt(left, _le, right) {
    return new Call(intrinsics['<'], [left.toAST(this.args.env), right.toAST(this.args.env)])
  },
  CompareExp_leq(left, _leq, right) {
    return new Call(intrinsics['<='], [left.toAST(this.args.env), right.toAST(this.args.env)])
  },
  CompareExp_gt(left, _gt, right) {
    return new Call(intrinsics['>'], [left.toAST(this.args.env), right.toAST(this.args.env)])
  },
  CompareExp_geq(left, _geq, right) {
    return new Call(intrinsics['>='], [left.toAST(this.args.env), right.toAST(this.args.env)])
  },
  ArithmeticExp_plus(left, _plus, right) {
    return new Call(intrinsics['+'], [left.toAST(this.args.env), right.toAST(this.args.env)])
  },
  ArithmeticExp_minus(left, _minus, right) {
    return new Call(intrinsics['-'], [left.toAST(this.args.env), right.toAST(this.args.env)])
  },
  ProductExp_times(left, _times, right) {
    return new Call(intrinsics['*'], [left.toAST(this.args.env), right.toAST(this.args.env)])
  },
  ProductExp_divide(left, _divide, right) {
    return new Call(intrinsics['/'], [left.toAST(this.args.env), right.toAST(this.args.env)])
  },
  ProductExp_mod(left, _mod, right) {
    return new Call(intrinsics['%'], [left.toAST(this.args.env), right.toAST(this.args.env)])
  },
  ExponentExp_power(left, _power, right) {
    return new Call(intrinsics['**'], [left.toAST(this.args.env), right.toAST(this.args.env)])
  },
  PrimaryExp_paren(_open, exp, _close) {
    return exp.toAST(this.args.env)
  },
  Block(_open, seq, _close) {
    return seq.toAST(this.args.env)
  },
  List(_open, elems, _close) {
    return new List(
      elems.asIteration().children.map((value, _i, _arr) => value.toAST(this.args.env)),
    )
  },
  Object(_open, elems, _close) {
    const inits = {}
    const parsedElems = elems.asIteration().children.map(
      (value, _i, _arr) => value.toAST(this.args.env),
    )
    for (const elem of parsedElems) {
      (inits as any)[(elem as PropertyValue).key] = (elem as PropertyValue).val
    }
    return new Obj(inits)
  },
  PropertyValue(ident, _colon, value) {
    return new PropertyValue(ident.sourceString, value.toAST(this.args.env))
  },
  Map(_open, elems, _close) {
    const inits = new Map<Val, Val>()
    const parsedElems = elems.asIteration().children.map(
      (value, _i, _arr) => value.toAST(this.args.env),
    )
    for (const elem of parsedElems) {
      inits.set((elem as KeyValue).key, (elem as KeyValue).val)
    }
    return new DictLiteral(inits)
  },
  KeyValue(key, _colon, value) {
    return new KeyValue(key.toAST(this.args.env), value.toAST(this.args.env))
  },
  UnaryExp_pos(_plus, exp) {
    return new Call(intrinsics.pos, [exp.toAST(this.args.env)])
  },
  UnaryExp_neg(_minus, exp) {
    return new Call(intrinsics.neg, [exp.toAST(this.args.env)])
  },
  PropertyExp_property(object, _dot, property) {
    return propAccess(object.toAST(this.args.env), property.sourceString)
  },
  PrimaryExp_break(_break, exp) {
    return new Call(intrinsics.break, [maybeValue(this.args.env, exp)])
  },
  PrimaryExp_return(_return, exp) {
    return new Call(intrinsics.return, [maybeValue(this.args.env, exp)])
  },
  PrimaryExp_continue(_continue) {
    return new Call(intrinsics.continue, [])
  },
  PrimaryExp_null(_null) {
    return new Null()
  },
  PrimaryExp_ident(_sym) {
    return new SymRef(this.args.env, this.sourceString)
  },
  Sequence(exp) {
    return exp.toAST(this.args.env)
  },
  Sequence_seq(seq, _sep) {
    const children = seq.asIteration().children
    if (children.length === 1) {
      return children[0].toAST(this.args.env)
    }
    return new Call(
      intrinsics.seq,
      seq.asIteration().children.map((exp) => exp.toAST(this.args.env)),
    )
  },
  Sequence_let(_let, ident, _eq, value, _sep, seq) {
    const bindingEnv = new BindingVal(
      new Map([[ident.sourceString, value.toAST(this.args.env)]]),
    )
    const innerBinding = this.args.env.extend(bindingEnv)
    return new Let(
      [ident.sourceString],
      new Call(intrinsics.seq, [
        propAccess(new Ref(new SymRef(innerBinding, ident.sourceString)), 'set', value.toAST(this.args.env)),
        seq.toAST(innerBinding),
      ]),
    )
  },
  Sequence_letfn(_let, namedFn, _sep, seq) {
    const ident = namedFn.children[1].sourceString
    const bindingEnv = new BindingVal(new Map([[ident, new Ref(new Null())]]))
    const innerEnv = this.args.env.extend(bindingEnv)
    const fn = namedFn.toAST(innerEnv)
    return new Let(
      [ident],
      new Call(intrinsics.seq, [
        fn,
        seq.toAST(innerEnv),
      ]),
    )
  },
  Sequence_use(_use, pathList, _sep, seq) {
    const path = pathList.asIteration().children.map((id) => id.sourceString)
    const ident = path[path.length - 1]
    const bindingEnv = new BindingVal(
      new Map([[ident, new Ref(new Null())]]),
    )
    // For path x.y.z, compile `let z = x.use(y.z); …`
    return new Let(
      [ident],
      new Call(intrinsics.seq, [
        propAccess(
          new Ref(new SymRef(this.args.env, ident)),
          'set',
          propAccess(
            new SymRef(this.args.env.extend(bindingEnv), path[0]),
            'use',
            ...path.slice(1).map((id) => new Str(id)),
          ),
        ),
        seq.toAST(this.args.env.extend(bindingEnv)),
      ]),
    )
  },
  Sequence_exp(exp, _sc) {
    return exp.toAST(this.args.env)
  },
  ident(_l, _ns) {
    return new Str(this.sourceString)
  },
  bool(flag) {
    return new Bool(flag.sourceString === 'true')
  },
  number(_) {
    return new Num(parseFloat(this.sourceString))
  },
  string(_open, _str, _close) {
    // FIXME: Parse string properly
    // eslint-disable-next-line no-eval
    return new Str(eval(this.sourceString))
  },
})

function mergeFreeVars(children: Node[]): Set<string> {
  return new Set<string>(children.flatMap((child) => [...child.freeVars]))
}

function setDifference<T>(setA: Set<T>, setB: Set<T>) {
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
  Sequence_let(_let, ident, _eq, value, _sep, seq) {
    return setDifference(
      new Set([...seq.freeVars, ...value.freeVars]),
      new Set([ident.sourceString]),
    )
  },
  Sequence_letfn(_let, namedFn, _sep, seq) {
    return setDifference(
      new Set([...seq.freeVars, ...namedFn.freeVars]),
      new Set([...namedFn.children[3].freeVars, namedFn.children[1].sourceString]),
    )
  },
  Fn_anon(_fn, _open, params, _close, body) {
    return setDifference(body.freeVars, params.freeVars)
  },
  NamedFn(_fn, ident, _open, params, _close, body) {
    return setDifference(
      setDifference(body.freeVars, new Set([ident.sourceString])),
      params.freeVars,
    )
  },
  PropertyExp_property(propertyExp, _dot, _ident) {
    return propertyExp.freeVars
  },
  ident(_l, _ns) {
    return new Set([this.sourceString])
  },
})

// eslint-disable-next-line import/prefer-default-export
export function toVal(expr: string): Val {
  const matchResult = grammar.match(expr)
  if (matchResult.failed()) {
    throw new Error(matchResult.message)
  }
  return semantics(matchResult).toAST(new EnvironmentVal([]))
}
