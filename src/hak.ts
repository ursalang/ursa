import {Node, IterationNode} from 'ohm-js'
import {
  AST, Val, Null, Bool, Num, Str, Quote, Ref, SymRef, List, DictLiteral,
  NativeFexpr, PropertyException, debug,
  Call, Let, Fn,
  bindArgsToParams, BindingVal, Environment, EnvironmentVal, setDifference, mergeFreeVars,
} from './haklisp'
import grammar, {HakSemantics} from './hak.ohm-bundle'

// Specify precise type so semantics can be precisely type-checked.
const semantics: HakSemantics = grammar.createSemantics()

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
    (value) => value.toAST(env).value(),
  )
  const paramBinding = bindArgsToParams(paramList, [])
  return new Fn(
    paramList,
    freeVars,
    body.toAST(env.extend(paramBinding)),
  )
}

function propAccess(env: EnvironmentVal, ref: Val, prop: string, ...rest: Val[]): Val {
  return new Call(
    new NativeFexpr((env, ...args) => {
      const evaluatedRef = ref.eval(env)
      const props = evaluatedRef.properties
      if (!(prop in props)) {
        throw new PropertyException(`no property '${prop}'`)
      }
      return evaluatedRef.properties[prop](env, ...args.map((e) => e.eval(env)))
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
    return new Call(new SymRef(this.args.env, 'if'), args)
  },
  Fn_anon(_fn, _open, params, _close, body) {
    return makeFn(this.args.env, this.freeVars, params, body)
  },
  Fn_named(_fn, ident, _open, params, _close, body) {
    const bindingEnv = new BindingVal(
      new Map([[ident.sourceString, new Ref(new Null())]]),
    )
    return propAccess(
      this.args.env,
      new Quote(ident.sourceString),
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
    return propAccess(this.args.env, object.toAST(this.args.env), 'get', index.toAST(this.args.env))
  },
  Loop(_loop, e_body) {
    return new Call(new SymRef(this.args.env, 'loop'), [e_body.toAST(this.args.env)])
  },
  Assignment_index(callExp, _open, index, _close, _eq, value) {
    return propAccess(this.args.env, callExp.toAST(this.args.env), 'set', index.toAST(this.args.env), value.toAST(this.args.env))
  },
  Assignment_ident(ident, _eq, value) {
    return propAccess(this.args.env, new Quote(ident.sourceString), 'set', value.toAST(this.args.env))
  },
  LogicExp_and(left, _and, right) {
    return new Call(new SymRef(this.args.env, 'and'), [left.toAST(this.args.env), right.toAST(this.args.env)])
  },
  LogicExp_or(left, _or, right) {
    return new Call(new SymRef(this.args.env, 'or'), [left.toAST(this.args.env), right.toAST(this.args.env)])
  },
  LogicExp_not(_not, exp) {
    return new Call(new SymRef(this.args.env, 'not'), [exp.toAST(this.args.env)])
  },
  CompareExp_eq(left, _eq, right) {
    return new Call(new SymRef(this.args.env, '='), [left.toAST(this.args.env), right.toAST(this.args.env)])
  },
  CompareExp_neq(left, _neq, right) {
    return new Call(new SymRef(this.args.env, '!='), [left.toAST(this.args.env), right.toAST(this.args.env)])
  },
  CompareExp_lt(left, _le, right) {
    return new Call(new SymRef(this.args.env, '<'), [left.toAST(this.args.env), right.toAST(this.args.env)])
  },
  CompareExp_leq(left, _leq, right) {
    return new Call(new SymRef(this.args.env, '<='), [left.toAST(this.args.env), right.toAST(this.args.env)])
  },
  CompareExp_gt(left, _gt, right) {
    return new Call(new SymRef(this.args.env, '>'), [left.toAST(this.args.env), right.toAST(this.args.env)])
  },
  CompareExp_geq(left, _geq, right) {
    return new Call(new SymRef(this.args.env, '>='), [left.toAST(this.args.env), right.toAST(this.args.env)])
  },
  ArithmeticExp_plus(left, _plus, right) {
    return new Call(new SymRef(this.args.env, '+'), [left.toAST(this.args.env), right.toAST(this.args.env)])
  },
  ArithmeticExp_minus(left, _minus, right) {
    return new Call(new SymRef(this.args.env, '-'), [left.toAST(this.args.env), right.toAST(this.args.env)])
  },
  ProductExp_times(left, _times, right) {
    return new Call(new SymRef(this.args.env, '*'), [left.toAST(this.args.env), right.toAST(this.args.env)])
  },
  ProductExp_divide(left, _divide, right) {
    return new Call(new SymRef(this.args.env, '/'), [left.toAST(this.args.env), right.toAST(this.args.env)])
  },
  ProductExp_mod(left, _mod, right) {
    return new Call(new SymRef(this.args.env, '%'), [left.toAST(this.args.env), right.toAST(this.args.env)])
  },
  ExponentExp_power(left, _power, right) {
    return new Call(new SymRef(this.args.env, '**'), [left.toAST(this.args.env), right.toAST(this.args.env)])
  },
  PrimaryExp_paren(_open, exp, _close) {
    return exp.toAST(this.args.env)
  },
  Block(_open, seq, _close) {
    return maybeValue(this.args.env, seq)
  },
  List(_open, elems, _close) {
    return new List(
      elems.asIteration().children.map((value, _i, _arr) => value.toAST(this.args.env)),
    )
  },
  Dict(_open, elems, _close) {
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
    return new Call(new SymRef(this.args.env, 'pos'), [exp.toAST(this.args.env)])
  },
  UnaryExp_neg(_minus, exp) {
    return new Call(new SymRef(this.args.env, 'neg'), [exp.toAST(this.args.env)])
  },
  PropertyExp_property(object, _dot, property) {
    return propAccess(this.args.env, object.toAST(this.args.env), property.sourceString)
  },
  PrimaryExp_break(_break, exp) {
    return new Call(new SymRef(this.args.env, 'break'), [maybeValue(this.args.env, exp)])
  },
  PrimaryExp_return(_return, exp) {
    return new Call(new SymRef(this.args.env, 'return'), [maybeValue(this.args.env, exp)])
  },
  PrimaryExp_continue(_continue) {
    return new Call(new SymRef(this.args.env, 'continue'), [])
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
  Sequence_seq(e_first, _sep, e_rest, _maybe_sep) {
    return new Call(new SymRef(this.args.env, 'seq'), [e_first.toAST(this.args.env), e_rest.toAST(this.args.env)])
  },
  Sequence_let(_let, ident, _eq, value, _sep, seq, _maybe_sep) {
    const bindingEnv = new BindingVal(
      new Map([[ident.sourceString, value.toAST(this.args.env)]]),
    )
    return new Let(bindingEnv, seq.toAST(this.args.env.extend(bindingEnv)))
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
  string(_open, str, _close) {
    return new Str(str.sourceString)
  },
})

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
  Sequence_let(_let, ident, _eq, value, _sep, seq, _maybe_sep) {
    return setDifference(
      new Set([...seq.freeVars, ...value.freeVars]),
      new Set([ident.sourceString]),
    )
  },
  Fn_anon(_fn, _open, params, _close, body) {
    return setDifference(body.freeVars, params.freeVars)
  },
  Fn_named(_fn, ident, _open, params, _close, body) {
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
  return semantics(matchResult).toAST(new EnvironmentVal([]))
}
