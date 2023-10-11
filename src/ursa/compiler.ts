import {Node, IterationNode} from 'ohm-js'
import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
  Val, Null, Bool, Num, Str, ObjLiteral, ListLiteral, DictLiteral,
  Call, Let, Fn, SymRef, Prop, Ass, Get, intrinsics,
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

class IndexExp extends AST {
  constructor(public obj: Val, public index: Val) {
    super()
  }
}

class Arguments extends AST {
  constructor(public args: Val[]) {
    super()
  }
}

function maybeVal(env: Environment, exp: IterationNode): Val {
  return exp.children.length > 0 ? exp.children[0].toAST(env, false) : Null()
}

function listNodeToStringList(listNode: Node): string[] {
  return listNode.asIteration().children.map((x) => x.sourceString)
}

function makeFn(env: Environment, params: Node, body: Node): Val {
  const paramList = listNodeToStringList(params)
  const innerEnv = env.pushFrame(paramList)
  const bodyFreeVars = body.freeVars(innerEnv)
  const compiledBody = body.toAST(innerEnv, false)
  paramList.forEach((p) => bodyFreeVars.delete(p))
  return new Fn(paramList, bodyFreeVars, compiledBody)
}

function indexExp(env: Environment, lval: boolean, object: Node, index: Node): AST {
  const compiledObj = object.toAST(env, false)
  const compiledIndex = index.toAST(env, false)
  return lval
    ? new IndexExp(compiledObj, compiledIndex)
    : new Call(new Get(new Prop('get', compiledObj)), [compiledIndex])
}

semantics.addOperation<AST>('toAST(env,lval)', {
  If(_if, e_cond, e_then, _else, e_else) {
    const args: Val[] = [e_cond.toAST(this.args.env, false), e_then.toAST(this.args.env, false)]
    if (e_else.children.length > 0) {
      args.push(e_else.children[0].toAST(this.args.env, false))
    }
    return new Call(intrinsics.if, args)
  },
  Fn_anon(_fn, _open, params, _maybe_comma, _close, body) {
    return makeFn(this.args.env, params, body)
  },
  NamedFn(_fn, ident, _open, params, _maybe_comma, _close, body) {
    return new Ass(
      ident.symref(this.args.env)[0],
      makeFn(this.args.env, params, body),
    )
  },
  CallExp_call(exp, args) {
    return new Call(exp.toAST(this.args.env, false), args.toAST(this.args.env, false).args)
  },
  CallExp_propcall(exp, args) {
    return new Call(exp.toAST(this.args.env, false), args.toAST(this.args.env, false).args)
  },
  CallExp_prop(exp, _dot, ident) {
    return new Call(new Get(new Prop(ident.sourceString, exp.toAST(this.args.env, false))), [])
  },
  Arguments(_open, args, _maybe_comma, _close) {
    return new Arguments(
      args.asIteration().children.map((value, _i, _arr) => value.toAST(this.args.env, false)),
    )
  },
  PropertyExp_property(object, _dot, property) {
    const compiledProp = new Prop(property.sourceString, object.toAST(this.args.env, false))
    return this.args.lval ? compiledProp : new Get(compiledProp)
  },
  PropertyExp_index(object, _open, index, _close) {
    return indexExp(this.args.env, this.args.lval, object, index)
  },
  CallExp_index(object, _open, index, _close) {
    return indexExp(this.args.env, this.args.lval, object, index)
  },
  Loop(_loop, e_body) {
    return new Call(intrinsics.loop, [e_body.toAST(this.args.env, false)])
  },
  AssignmentExp_ass(lvalue, _eq, value) {
    const compiledLvalue = lvalue.toAST(this.args.env, true)
    const compiledValue = value.toAST(this.args.env, false)
    if (compiledLvalue instanceof IndexExp) {
      return new Call(
        new Get(new Prop('set', compiledLvalue.obj)),
        [compiledLvalue.index, compiledValue],
      )
    }
    return new Ass(compiledLvalue, compiledValue)
  },
  LogicExp_and(left, _and, right) {
    return new Call(
      intrinsics.and,
      [left.toAST(this.args.env, false), right.toAST(this.args.env, false)],
    )
  },
  LogicExp_or(left, _or, right) {
    return new Call(
      intrinsics.or,
      [left.toAST(this.args.env, false), right.toAST(this.args.env, false)],
    )
  },
  UnaryExp_not(_not, exp) {
    return new Call(intrinsics.not, [exp.toAST(this.args.env, false)])
  },
  CompareExp_eq(left, _eq, right) {
    return new Call(intrinsics['='], [left.toAST(this.args.env, false), right.toAST(this.args.env, false)])
  },
  CompareExp_neq(left, _neq, right) {
    return new Call(intrinsics['!='], [left.toAST(this.args.env, false), right.toAST(this.args.env, false)])
  },
  CompareExp_lt(left, _le, right) {
    return new Call(intrinsics['<'], [left.toAST(this.args.env, false), right.toAST(this.args.env, false)])
  },
  CompareExp_leq(left, _leq, right) {
    return new Call(intrinsics['<='], [left.toAST(this.args.env, false), right.toAST(this.args.env, false)])
  },
  CompareExp_gt(left, _gt, right) {
    return new Call(intrinsics['>'], [left.toAST(this.args.env, false), right.toAST(this.args.env, false)])
  },
  CompareExp_geq(left, _geq, right) {
    return new Call(intrinsics['>='], [left.toAST(this.args.env, false), right.toAST(this.args.env, false)])
  },
  ArithmeticExp_plus(left, _plus, right) {
    return new Call(intrinsics['+'], [left.toAST(this.args.env, false), right.toAST(this.args.env, false)])
  },
  ArithmeticExp_minus(left, _minus, right) {
    return new Call(intrinsics['-'], [left.toAST(this.args.env, false), right.toAST(this.args.env, false)])
  },
  ProductExp_times(left, _times, right) {
    return new Call(intrinsics['*'], [left.toAST(this.args.env, false), right.toAST(this.args.env, false)])
  },
  ProductExp_divide(left, _divide, right) {
    return new Call(intrinsics['/'], [left.toAST(this.args.env, false), right.toAST(this.args.env, false)])
  },
  ProductExp_mod(left, _mod, right) {
    return new Call(intrinsics['%'], [left.toAST(this.args.env, false), right.toAST(this.args.env, false)])
  },
  ExponentExp_power(left, _power, right) {
    return new Call(intrinsics['**'], [left.toAST(this.args.env, false), right.toAST(this.args.env, false)])
  },
  PrimaryExp_paren(_open, exp, _close) {
    return exp.toAST(this.args.env, false)
  },
  Block(_open, seq, _close) {
    return seq.toAST(this.args.env, false)
  },
  List(_open, elems, _maybe_comma, _close) {
    return new ListLiteral(
      elems.asIteration().children.map((value, _i, _arr) => value.toAST(this.args.env, false)),
    )
  },
  Object(_open, elems, _maybe_comma, _close) {
    const inits = new Map()
    const parsedElems = elems.asIteration().children.map(
      (value, _i, _arr) => value.toAST(this.args.env, false),
    )
    for (const elem of parsedElems) {
      inits.set((elem as PropertyValue).key, (elem as PropertyValue).val)
    }
    return new ObjLiteral(inits)
  },
  PropertyValue(ident, _colon, value) {
    return new PropertyValue(ident.sourceString, value.toAST(this.args.env, false))
  },
  Map(_open, elems, _maybe_comma, _close) {
    const inits = new Map<Val, Val>()
    const parsedElems = elems.asIteration().children.map(
      (value, _i, _arr) => value.toAST(this.args.env, false),
    )
    for (const elem of parsedElems) {
      inits.set((elem as KeyValue).key, (elem as KeyValue).val)
    }
    return new DictLiteral(inits)
  },
  KeyValue(key, _colon, value) {
    return new KeyValue(key.toAST(this.args.env, false), value.toAST(this.args.env, false))
  },
  UnaryExp_pos(_plus, exp) {
    return new Call(intrinsics.pos, [exp.toAST(this.args.env, false)])
  },
  UnaryExp_neg(_minus, exp) {
    return new Call(intrinsics.neg, [exp.toAST(this.args.env, false)])
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
    return Null()
  },
  PrimaryExp_ident(_sym) {
    const symref = this.symref(this.args.env)[0]
    return this.args.lval ? symref : new Get(symref)
  },
  Sequence_seq(exp, _sep, seq) {
    const exps = [exp.toAST(this.args.env, false)]
    const compiledSeq = seq.toAST(this.args.env, false)
    if (compiledSeq instanceof Call && compiledSeq.fn === intrinsics.seq) {
      exps.push(...compiledSeq.args)
    } else {
      exps.push(compiledSeq)
    }
    while (exps.length > 0 && exps[exps.length - 1] === Null()) {
      exps.pop()
    }
    if (exps.length === 1) {
      return exps[0]
    }
    return new Call(intrinsics.seq, exps)
  },
  Sequence_let(_let, ident, _eq, value, _sep, seq) {
    const innerBinding = this.args.env.push([ident.sourceString])
    const compiledCall = new Call(intrinsics.seq, [
      new Ass(ident.symref(innerBinding)[0], value.toAST(innerBinding, false)),
      seq.toAST(innerBinding, false),
    ])
    const compiledLet = new Let([ident.sourceString], compiledCall)
    return compiledLet
  },
  Sequence_letfn(_let, namedFn, _sep, seq) {
    const ident = namedFn.children[1].sourceString
    const innerEnv = this.args.env.push([ident])
    const fn = namedFn.toAST(innerEnv, false)
    const compiledSeq = seq.toAST(innerEnv, false)
    const compiledLet = new Let([ident], new Call(intrinsics.seq, [fn, compiledSeq]))
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
          ident.symref(innerEnv)[0],
          new Call(
            new Get(new Prop('use', path[0].symref(innerEnv)[0])),
            path.slice(1).map((id) => Str(id.sourceString)),
          ),
        ),
        seq.toAST(innerEnv, false),
      ]),
    )
    return compiledLet
  },
  Sequence_empty() {
    return Null()
  },
  ident(_l, _ns) {
    return Str(this.sourceString)
  },
  bool(flag) {
    return Bool(flag.sourceString === 'true')
  },
  number(_) {
    return Num(parseFloat(this.sourceString))
  },
  string(_open, _str, _close) {
    // FIXME: Parse string properly
    // eslint-disable-next-line no-eval
    return Str(eval(this.sourceString))
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
    return freeVars
  },
  Fn_anon(_fn, _open, params, _maybe_comma, _close, body) {
    const paramStrings = listNodeToStringList(params)
    const innerEnv = this.args.env.pushFrame(paramStrings)
    const freeVars = new FreeVars().merge(body.freeVars(innerEnv))
    paramStrings.forEach((p) => freeVars.delete(p))
    return freeVars
  },
  NamedFn(_fn, ident, _open, params, _maybe_comma, _close, body) {
    const paramStrings = listNodeToStringList(params)
    const innerEnv = this.args.env.pushFrame(paramStrings)
    const freeVars = new FreeVars().merge(body.freeVars(innerEnv))
    freeVars.delete(ident.sourceString)
    listNodeToStringList(params).forEach((p) => freeVars.delete(p))
    return freeVars
  },
  PropertyValue(_ident, _colon, value) {
    return value.freeVars(this.args.env)
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
  return [ast.toAST(env, false), ast.freeVars(env)]
}
