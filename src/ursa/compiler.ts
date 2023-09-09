import {Node, IterationNode} from 'ohm-js'
import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
  Val, Null, Bool, Num, Str, Ref, List, Obj, DictLiteral,
  Call, Let, Fn, intrinsics, SymRef, Prop, Ass,
} from '../ark/interp.js'
import {
  CompiledArk, symRef, Environment, FreeVars,
} from '../ark/compiler.js'
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

class Arguments extends AST {
  constructor(public args: Val[]) {
    super()
  }
}

function maybeVal(env: Environment, exp: IterationNode): Val {
  return exp.children.length > 0 ? exp.children[0].toAST(env) : new Null()
}

function listNodeToStringList(listNode: Node): string[] {
  return listNode.asIteration().children.map((x) => x.sourceString)
}

function makeFn(env: Environment, params: Node, body: Node): Val {
  const paramList = listNodeToStringList(params)
  const innerEnv = env.pushFrame(paramList)
  const bodyFreeVars = body.freeVars(innerEnv)
  const compiledBody = body.toAST(innerEnv)
  paramList.forEach((p) => bodyFreeVars.delete(p))
  env.popFrame()
  return new Fn(paramList, bodyFreeVars, compiledBody)
}

semantics.addOperation<AST>('toAST(env)', {
  If(_if, e_cond, e_then, _else, e_else) {
    const args: Val[] = [e_cond.toAST(this.args.env), e_then.toAST(this.args.env)]
    if (e_else.children.length > 0) {
      args.push(e_else.children[0].toAST(this.args.env))
    }
    return new Call(intrinsics.if, args)
  },
  Fn_anon(_fn, _open, params, _maybe_comma, _close, body) {
    return makeFn(this.args.env, params, body)
  },
  NamedFn(_fn, ident, _open, params, _maybe_comma, _close, body) {
    return new Ass(
      new Ref(ident.symref(this.args.env)[0]),
      makeFn(this.args.env, params, body),
    )
  },
  CallExp_call(exp, args) {
    return new Call(exp.toAST(this.args.env), args.toAST(this.args.env).args)
  },
  CallExp_propcall(exp, args) {
    return new Call(exp.toAST(this.args.env), args.toAST(this.args.env).args)
  },
  CallExp_prop(exp, _dot, ident) {
    return new Call(new Prop(ident.sourceString, exp.toAST(this.args.env)), [])
  },
  Arguments(_open, args, _maybe_comma, _close) {
    return new Arguments(
      args.asIteration().children.map((value, _i, _arr) => value.toAST(this.args.env)),
    )
  },
  PropertyExp_index(object, _open, index, _close) {
    return new Call(new Prop('get', object.toAST(this.args.env)), [index.toAST(this.args.env)])
  },
  CallExp_index(object, _open, index, _close) {
    return new Call(new Prop('get', object.toAST(this.args.env)), [index.toAST(this.args.env)])
  },
  Loop(_loop, e_body) {
    return new Call(intrinsics.loop, [e_body.toAST(this.args.env)])
  },
  // FIXME: rather than rewrite compiledLvalue, use a parameter to LvalueExp
  // to compile it differently.
  AssignmentExp_ass(lvalue, _eq, value) {
    const compiledLvalue = lvalue.toAST(this.args.env)
    const compiledValue = value.toAST(this.args.env)
    if (compiledLvalue instanceof Call && compiledLvalue.fn instanceof Prop && compiledLvalue.fn.prop === 'get') {
      return new Call(new Prop('set', compiledLvalue.fn.ref), [...compiledLvalue.args, compiledValue])
    } else if (compiledLvalue instanceof SymRef) {
      return new Ass(new Ref(compiledLvalue), compiledValue)
    }
    return new Ass(compiledLvalue, compiledValue)
  },
  LogicExp_and(left, _and, right) {
    return new Call(intrinsics.and, [left.toAST(this.args.env), right.toAST(this.args.env)])
  },
  LogicExp_or(left, _or, right) {
    return new Call(intrinsics.or, [left.toAST(this.args.env), right.toAST(this.args.env)])
  },
  UnaryExp_not(_not, exp) {
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
  List(_open, elems, _maybe_comma, _close) {
    return new List(
      elems.asIteration().children.map((value, _i, _arr) => value.toAST(this.args.env)),
    )
  },
  Object(_open, elems, _maybe_comma, _close) {
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
  Map(_open, elems, _maybe_comma, _close) {
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
    return new Prop(property.sourceString, object.toAST(this.args.env))
  },
  UnaryExp_break(_break, exp) {
    return new Call(intrinsics.break, [maybeVal(this.args.env, exp)])
  },
  UnaryExp_return(_return, exp) {
    return new Call(intrinsics.return, [maybeVal(this.args.env, exp)])
  },
  PrimaryExp_continue(_continue) {
    return new Call(intrinsics.continue, [])
  },
  PrimaryExp_null(_null) {
    return new Null()
  },
  PrimaryExp_ident(_sym) {
    return this.symref(this.args.env)[0]
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
    const innerBinding = this.args.env.push([ident.sourceString])
    const compiledCall = new Call(intrinsics.seq, [
      new Ass(new Ref(ident.symref(innerBinding)[0]), value.toAST(innerBinding)),
      seq.toAST(innerBinding),
    ])
    const compiledLet = new Let([ident.sourceString], compiledCall)
    this.args.env.pop(1)
    return compiledLet
  },
  Sequence_letfn(_let, namedFn, _sep, seq) {
    const ident = namedFn.children[1].sourceString
    const innerEnv = this.args.env.push([ident])
    const fn = namedFn.toAST(innerEnv)
    const compiledSeq = seq.toAST(innerEnv)
    const compiledLet = new Let([ident], new Call(intrinsics.seq, [fn, compiledSeq]))
    this.args.env.pop(1)
    return compiledLet
  },
  Sequence_use(_use, pathList, _sep, seq) {
    const path = pathList.asIteration().children
    const ident = path[path.length - 1]
    // For path x.y.z, compile `let z = x.use(y.z); …`
    const innerEnv = this.args.env.push([ident.sourceString])
    const compiledLet = new Let(
      [ident.sourceString],
      new Call(intrinsics.seq, [
        new Ass(
          new Ref(ident.symref(innerEnv)[0]),
          new Call(
            new Prop('use', path[0].symref(innerEnv)[0]),
            path.slice(1).map((id) => new Str(id.sourceString)),
          ),
        ),
        seq.toAST(innerEnv),
      ]),
    )
    this.args.env.pop(1)
    return compiledLet
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

function mergeFreeVars(env: Environment, children: Node[]): FreeVars {
  const freeVars = new FreeVars()
  children.forEach((child) => freeVars.merge(child.freeVars(env)))
  return freeVars
}

semantics.addOperation<FreeVars>('freeVars(env)', {
  _terminal() {
    return new FreeVars()
  },
  _nonterminal(...children) {
    return mergeFreeVars(this.args.env, children)
  },
  _iter(...children) {
    return mergeFreeVars(this.args.env, children)
  },
  Sequence_let(_let, ident, _eq, value, _sep, seq) {
    const innerBinding = this.args.env.push([ident.sourceString])
    const freeVars = new FreeVars().merge(seq.freeVars(innerBinding))
    freeVars.merge(value.freeVars(innerBinding))
    freeVars.delete(ident.sourceString)
    this.args.env.pop(1)
    return freeVars
  },
  Sequence_letfn(_let, namedFn, _sep, seq) {
    const ident = namedFn.children[1].sourceString
    const innerEnv = this.args.env.push([ident])
    const freeVars = new FreeVars().merge(seq.freeVars(innerEnv))
    freeVars.merge(namedFn.freeVars(innerEnv))
    namedFn.children[3].freeVars(innerEnv).forEach(
      (_v: SymRef[], k: string) => freeVars.delete(k),
    )
    freeVars.delete(namedFn.children[1].sourceString)
    this.args.env.pop(1)
    return freeVars
  },
  Sequence_use(_use, pathList, _sep, seq) {
    const path = pathList.asIteration().children
    const ident = path[path.length - 1]
    const innerEnv = this.args.env.push([ident.sourceString])
    const freeVars = new FreeVars()
      .merge(seq.freeVars(innerEnv))
      .merge(path[0].symref(this.args.env)[1])
    freeVars.delete(ident.sourceString)
    this.args.env.pop(1)
    return freeVars
  },
  Fn_anon(_fn, _open, params, _maybe_comma, _close, body) {
    const paramStrings = listNodeToStringList(params)
    const innerEnv = this.args.env.pushFrame(paramStrings)
    const freeVars = new FreeVars().merge(body.freeVars(innerEnv))
    paramStrings.forEach((p) => freeVars.delete(p))
    this.args.env.popFrame()
    return freeVars
  },
  NamedFn(_fn, ident, _open, params, _maybe_comma, _close, body) {
    const paramStrings = listNodeToStringList(params)
    const innerEnv = this.args.env.pushFrame(paramStrings)
    const freeVars = new FreeVars().merge(body.freeVars(innerEnv))
    freeVars.delete(ident.sourceString)
    this.args.env.popFrame()
    listNodeToStringList(params).forEach((p) => freeVars.delete(p))
    return freeVars
  },
  PropertyExp_property(propertyExp, _dot, _ident) {
    return propertyExp.freeVars(this.args.env)
  },
  ident(_l, _ns) {
    return this.symref(this.args.env)[1]
  },
})

// Ohm attributes can't take arguments, so memoize an operation.
const symrefs = new Map<Node, CompiledArk>()
semantics.addOperation<CompiledArk>('symref(env)', {
  ident(_l, _ns) {
    if (!symrefs.has(this)) {
      symrefs.set(this, symRef(this.args.env, this.sourceString))
    }
    return symrefs.get(this)!
  },
})

export function compile(expr: string, env: Environment = new Environment()): CompiledArk {
  const matchResult = grammar.match(expr)
  if (matchResult.failed()) {
    throw new Error(matchResult.message)
  }
  const ast = semantics(matchResult)
  return [ast.toAST(env), ast.freeVars(env)]
}
