import {Node, IterationNode} from 'ohm-js'
import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
  Val, Null, Bool, Num, Str, Quote, Ref, SymRef, List, Obj, DictLiteral,
  Call, Let, Fn, NativeFexpr, PropertyException,
  bindArgsToParams, BindingVal, Environment, EnvironmentVal,
} from '../hak/interp.js'
import {AST, setDifference, mergeFreeVars} from '../hak/parser.js'
// eslint-disable-next-line import/extensions
import grammar, {UrsaSemantics} from './ursa.ohm-bundle.js'

// Specify precise type so semantics can be precisely type-checked.
const semantics: UrsaSemantics = grammar.createSemantics()

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
    new NativeFexpr((env, ...args) => {
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
    return propAccess(object.toAST(this.args.env), 'get', index.toAST(this.args.env))
  },
  Loop(_loop, e_body) {
    return new Call(new SymRef(this.args.env, 'loop'), [e_body.toAST(this.args.env)])
  },
  Assignment_index(callExp, _open, index, _close, _eq, value) {
    return propAccess(callExp.toAST(this.args.env), 'set', index.toAST(this.args.env), value.toAST(this.args.env))
  },
  Assignment_ident(ident, _eq, value) {
    return propAccess(new Quote(ident.sourceString), 'set', value.toAST(this.args.env))
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
    return new Call(new SymRef(this.args.env, 'pos'), [exp.toAST(this.args.env)])
  },
  UnaryExp_neg(_minus, exp) {
    return new Call(new SymRef(this.args.env, 'neg'), [exp.toAST(this.args.env)])
  },
  PropertyExp_property(object, _dot, property) {
    return propAccess(object.toAST(this.args.env), property.sourceString)
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
    return new Let(
      [ident.sourceString],
      new Call(new SymRef(this.args.env, 'seq'), [
        propAccess(new Quote(ident.sourceString), 'set', value.toAST(this.args.env)),
        seq.toAST(this.args.env.extend(bindingEnv)),
      ]),
    )
  },
  Sequence_letfn(_let, _fn, ident, _open, params, _close, block, _sep, seq, _maybe_sep) {
    const bindingEnv = new BindingVal(
      new Map([[ident.sourceString, new Ref(new Null())]]),
    )
    return new Let(
      [ident.sourceString],
      new Call(new SymRef(this.args.env, 'seq'), [
        propAccess(
          new Quote(ident.sourceString),
          'set',
          makeFn(
            this.args.env.extend(bindingEnv),
            new Set([...this.freeVars, ident.sourceString]),
            params,
            block,
          ),
        ),
        seq.toAST(this.args.env.extend(bindingEnv)),
      ]),
    )
  },
  Sequence_use(_use, pathList, _sep, seq, _maybe_sep) {
    const path = pathList.asIteration().children.map((id) => id.sourceString)
    const ident = path[path.length - 1]
    const bindingEnv = new BindingVal(
      new Map([[ident, new Ref(new Null())]]),
    )
    // For path x.y.z, compile `let z = x.use(y.z); …`
    return new Let(
      [ident],
      new Call(new SymRef(this.args.env, 'seq'), [
        propAccess(
          new Quote(ident),
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
  Sequence_letfn(_let, _fn, ident, _open, params, _close, body, _sep, seq, _maybe_sep) {
    return setDifference(
      new Set([...seq.freeVars, ...body.freeVars]),
      new Set([...params.freeVars, ident.sourceString]),
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
  if (matchResult.failed()) {
    throw new Error(matchResult.message)
  }
  return semantics(matchResult).toAST(new EnvironmentVal([]))
}
