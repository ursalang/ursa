import {Node, IterationNode} from 'ohm-js'
import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
  Val, Null, Bool, Num, Str, ObjLiteral, ListLiteral, DictLiteral,
  Call, Let, Fn, Prop, Ass, Get, intrinsics,
} from '../ark/interp.js'
import {
  CompiledArk, symRef, Environment, FreeVars, PartialCompiledArk, checkParamList,
  ArkCompilerError,
} from '../ark/compiler.js'
// eslint-disable-next-line import/extensions
import grammar, {UrsaSemantics} from './ursa.ohm-bundle.js'

// Specify precise type so semantics can be precisely type-checked.
const semantics: UrsaSemantics = grammar.createSemantics()

class UrsaCompilerError extends Error {
  constructor(node: Node, message: string) {
    super(`${node.source.getLineAndColumnMessage()}\n${message}`)
  }
}

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

class SingleLet extends AST {
  constructor(public id: Node, public node: Node) {
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

function listNodeToParamList(listNode: Node): string[] {
  try {
    return checkParamList(listNode.asIteration().children.map((x) => x.sourceString))
  } catch (e) {
    if (!(e instanceof ArkCompilerError)) {
      throw e
    }
    throw new UrsaCompilerError(listNode, e.message)
  }
}

function makeFn(env: Environment, params: Node, body: Node): Val {
  const paramStrings = listNodeToParamList(params)
  const innerEnv = env.pushFrame(paramStrings)
  const bodyFreeVars = body.freeVars(innerEnv)
  const compiledBody = body.toAST(innerEnv, false)
  paramStrings.forEach((p) => bodyFreeVars.delete(p))
  return new Fn(paramStrings, bodyFreeVars, compiledBody)
}

function indexExp(env: Environment, lval: boolean, object: Node, index: Node): AST {
  const compiledObj = object.toAST(env, false)
  const compiledIndex = index.toAST(env, false)
  return lval
    ? new IndexExp(compiledObj, compiledIndex)
    : new Call(new Get(new Prop('get', compiledObj)), [compiledIndex])
}

function makeIfChain(ifs: Call[]): Call {
  if (ifs.length > 1) {
    ifs[0].children.push(makeIfChain(ifs.slice(1)))
  }
  return ifs[0]
}

semantics.addOperation<AST>('toAST(env,lval)', {
  Sequence_seq(exp, _sep, seq) {
    const exps = [exp.toAST(this.args.env, false)]
    let compiledSeq = seq.toAST(this.args.env.push(exp.boundVars), false)
    const boundVars = exp.boundVars
    if (compiledSeq instanceof Let) {
      boundVars.push(...compiledSeq.boundVars)
      compiledSeq = compiledSeq.body
    }
    if (compiledSeq instanceof Call && compiledSeq.children[0] === intrinsics.get('seq')!) {
      exps.push(...compiledSeq.children.slice(1))
    } else {
      exps.push(compiledSeq)
    }
    while (exps.length > 0 && exps[exps.length - 1] === Null()) {
      exps.pop()
    }
    const compiledSeqBody = exps.length === 1 ? exps[0] : new Call(intrinsics.get('seq')!, exps)
    if (boundVars.length > 0) {
      return new Let(boundVars, compiledSeqBody)
    }
    return compiledSeqBody
  },
  Sequence_empty() {
    return Null()
  },

  PrimaryExp_continue(_continue) {
    return new Call(intrinsics.get('continue')!, [])
  },
  PrimaryExp_ident(_sym) {
    const symref = this.symref(this.args.env).value
    return this.args.lval ? symref : new Get(symref)
  },
  PrimaryExp_paren(_open, exp, _close) {
    return exp.toAST(this.args.env, false)
  },

  List(_open, elems, _maybe_comma, _close) {
    return new ListLiteral(elems.asIteration().children.map((x) => x.toAST(this.args.env, false)))
  },

  Object(_open, elems, _maybe_comma, _close) {
    const inits = new Map()
    const parsedElems = elems.asIteration().children.map(
      (value) => value.toAST(this.args.env, false),
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
      (value) => value.toAST(this.args.env, false),
    )
    for (const elem of parsedElems) {
      inits.set((elem as KeyValue).key, (elem as KeyValue).val)
    }
    return new DictLiteral(inits)
  },
  KeyValue(key, _colon, value) {
    return new KeyValue(key.toAST(this.args.env, false), value.toAST(this.args.env, false))
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
  CallExp_property(exp, _dot, ident) {
    const compiledProp = new Prop(ident.sourceString, exp.toAST(this.args.env, false))
    return this.args.lval ? compiledProp : new Get(compiledProp)
  },
  CallExp_call(exp, args) {
    return new Call(exp.toAST(this.args.env, false), args.toAST(this.args.env, false).args)
  },
  CallExp_property_call(exp, args) {
    return new Call(exp.toAST(this.args.env, false), args.toAST(this.args.env, false).args)
  },
  Arguments(_open, args, _maybe_comma, _close) {
    return new Arguments(args.asIteration().children.map((x) => x.toAST(this.args.env, false)))
  },

  Ifs(ifs, _else, e_else) {
    const compiledIfs = ifs.asIteration().children.map((x) => x.toAST(this.args.env, false))
    if (e_else.children.length > 0) {
      compiledIfs.push(e_else.children[0].toAST(this.args.env, false))
    }
    return makeIfChain(compiledIfs)
  },
  If(_if, e_cond, e_then) {
    const args: Val[] = [e_cond.toAST(this.args.env, false), e_then.toAST(this.args.env, false)]
    return new Call(intrinsics.get('if')!, args)
  },

  Fn(_fn, _open, params, _maybe_comma, _close, body) {
    return makeFn(this.args.env, params, body)
  },

  Loop(_loop, e_body) {
    return new Call(intrinsics.get('loop')!, [e_body.toAST(this.args.env, false)])
  },

  UnaryExp_break(_break, exp) {
    return new Call(intrinsics.get('break')!, [maybeVal(this.args.env, exp)])
  },
  UnaryExp_return(_return, exp) {
    return new Call(intrinsics.get('return')!, [maybeVal(this.args.env, exp)])
  },
  UnaryExp_not(_not, exp) {
    return new Call(intrinsics.get('not')!, [exp.toAST(this.args.env, false)])
  },
  UnaryExp_bitwise_not(_not, exp) {
    return new Call(intrinsics.get('~')!, [exp.toAST(this.args.env, false)])
  },
  UnaryExp_pos(_plus, exp) {
    return new Call(intrinsics.get('pos')!, [exp.toAST(this.args.env, false)])
  },
  UnaryExp_neg(_minus, exp) {
    return new Call(intrinsics.get('neg')!, [exp.toAST(this.args.env, false)])
  },

  ExponentExp_power(left, _power, right) {
    return new Call(intrinsics.get('**')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)])
  },

  ProductExp_times(left, _times, right) {
    return new Call(intrinsics.get('*')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)])
  },
  ProductExp_divide(left, _divide, right) {
    return new Call(intrinsics.get('/')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)])
  },
  ProductExp_mod(left, _mod, right) {
    return new Call(intrinsics.get('%')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)])
  },

  SumExp_plus(left, _plus, right) {
    return new Call(intrinsics.get('+')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)])
  },
  SumExp_minus(left, _minus, right) {
    return new Call(intrinsics.get('-')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)])
  },

  CompareExp_eq(left, _eq, right) {
    return new Call(intrinsics.get('=')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)])
  },
  CompareExp_neq(left, _neq, right) {
    return new Call(intrinsics.get('!=')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)])
  },
  CompareExp_lt(left, _le, right) {
    return new Call(intrinsics.get('<')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)])
  },
  CompareExp_leq(left, _leq, right) {
    return new Call(intrinsics.get('<=')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)])
  },
  CompareExp_gt(left, _gt, right) {
    return new Call(intrinsics.get('>')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)])
  },
  CompareExp_geq(left, _geq, right) {
    return new Call(intrinsics.get('>=')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)])
  },

  BitwiseExp_and(left, _and, right) {
    return new Call(intrinsics.get('&')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)])
  },
  BitwiseExp_or(left, _or, right) {
    return new Call(intrinsics.get('|')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)])
  },
  BitwiseExp_xor(left, _xor, right) {
    return new Call(intrinsics.get('^')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)])
  },
  BitwiseExp_lshift(left, _lshift, right) {
    return new Call(intrinsics.get('<<')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)])
  },
  BitwiseExp_arshift(left, _rshift, right) {
    return new Call(intrinsics.get('>>')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)])
  },
  BitwiseExp_lrshift(left, _arshift, right) {
    return new Call(intrinsics.get('>>>')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)])
  },

  LogicExp_and(left, _and, right) {
    return new Call(
      intrinsics.get('and')!,
      [left.toAST(this.args.env, false), right.toAST(this.args.env, false)],
    )
  },
  LogicExp_or(left, _or, right) {
    return new Call(
      intrinsics.get('or')!,
      [left.toAST(this.args.env, false), right.toAST(this.args.env, false)],
    )
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

  Lets(lets) {
    const parsedLets = []
    const letIds: string[] = []
    for (const l of lets.asIteration().children) {
      const parsedLet: SingleLet = l.toAST(this.args.env, false)
      parsedLets.push(parsedLet)
      if (letIds.includes(parsedLet.id.sourceString)) {
        throw new UrsaCompilerError(this, `Duplicate identifier in let: ${parsedLet.id.sourceString}`)
      }
      letIds.push(parsedLet.id.sourceString)
    }
    const innerEnv = this.args.env.push(letIds)
    const assignments = parsedLets.map(
      (l) => new Ass(l.id.symref(innerEnv).value, l.node.toAST(innerEnv, false)),
    )
    return assignments.length > 1 ? new Call(intrinsics.get('seq')!, assignments) : assignments[0]
  },
  Let(_let, ident, _eq, val) {
    return new SingleLet(ident, val)
  },

  Use(_use, pathList) {
    const path = pathList.asIteration().children
    const ident = path[path.length - 1]
    // For path x.y.z, compile `let z = x.use(y.z); …`
    const innerEnv = this.args.env.push([ident.sourceString])
    const compiledLet = new Let(
      [ident.sourceString],
      new Call(intrinsics.get('seq')!, [
        new Ass(
          ident.symref(innerEnv).value,
          new Call(
            new Get(new Prop('use', new Get(path[0].symref(innerEnv).value))),
            path.slice(1).map((id) => Str(id.sourceString)),
          ),
        ),
      ]),
    )
    return compiledLet
  },

  Block(_open, seq, _close) {
    return seq.toAST(this.args.env, false)
  },

  ident(_ident) {
    return Str(this.sourceString)
  },

  null(_null) {
    return Null()
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

function mergeBoundVars(children: Node[]): string[] {
  const boundVars: string[] = []
  children.forEach((child) => boundVars.push(...child.boundVars))
  return boundVars
}

semantics.addAttribute<String[]>('boundVars', {
  _terminal() {
    return []
  },
  _nonterminal(...children) {
    return mergeBoundVars(children)
  },
  _iter(...children) {
    return mergeBoundVars(children)
  },

  Sequence_seq(_exp, _sc, _seq) {
    return []
  },

  Fn(_fn, _open, _params, _maybe_comma, _close, _body) {
    return []
  },

  Let(_let, ident, _eq, _val) {
    return [ident.sourceString]
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

  Sequence_seq(exp, _sep, seq) {
    const freeVars = new FreeVars().merge(exp.freeVars(this.args.env))
    freeVars.merge(seq.freeVars(this.args.env.push(exp.boundVars)))
    exp.boundVars.forEach((b: string) => freeVars.delete(b))
    seq.boundVars.forEach((b: string) => freeVars.delete(b))
    return freeVars
  },

  PropertyValue(_ident, _colon, value) {
    return value.freeVars(this.args.env)
  },

  PropertyExp_property(propertyExp, _dot, _ident) {
    return propertyExp.freeVars(this.args.env)
  },

  CallExp_property(propertyExp, _dot, _ident) {
    return propertyExp.freeVars(this.args.env)
  },

  Fn(_fn, _open, params, _maybe_comma, _close, body) {
    const paramStrings = listNodeToParamList(params)
    const innerEnv = this.args.env.pushFrame([...paramStrings])
    const freeVars = new FreeVars().merge(body.freeVars(innerEnv))
    paramStrings.forEach((p) => freeVars.delete(p))
    return freeVars
  },

  Lets(lets) {
    const letIds = lets.asIteration().children.map((x) => x.children[1].sourceString)
    const innerEnv = this.args.env.push(letIds)
    const freeVars = new FreeVars()
    for (const l of lets.asIteration().children) {
      freeVars.merge(l.children[3].freeVars(innerEnv))
    }
    for (const id of letIds) {
      freeVars.delete(id)
    }
    return freeVars
  },

  Use(_use, pathList) {
    const path = pathList.asIteration().children
    const ident = path[path.length - 1]
    const innerEnv = this.args.env.push([ident.sourceString])
    const freeVars = new FreeVars().merge(path[0].symref(innerEnv).freeVars)
    freeVars.delete(ident.sourceString)
    return freeVars
  },

  ident(_ident) {
    return this.symref(this.args.env).freeVars
  },
})

// Ohm attributes can't take arguments, so memoize an operation.
const symrefs = new Map<Node, CompiledArk>()
semantics.addOperation<CompiledArk>('symref(env)', {
  ident(_ident) {
    if (!symrefs.has(this)) {
      try {
        symrefs.set(this, symRef(this.args.env, this.sourceString))
      } catch (e) {
        if (!(e instanceof ArkCompilerError)) {
          throw e
        }
        throw new UrsaCompilerError(_ident, e.message)
      }
    }
    return symrefs.get(this)!
  },
})

export function compile(
  expr: string,
  env: Environment = new Environment(),
  startRule?: string,
): PartialCompiledArk {
  const matchResult = grammar.match(expr, startRule)
  if (matchResult.failed()) {
    throw new Error(matchResult.message)
  }
  const ast = semantics(matchResult)
  const compiled = ast.toAST(env, false)
  const freeVars = ast.freeVars(env)
  env.externalSyms.forEach((_val, id) => freeVars.delete(id))
  return new PartialCompiledArk(compiled, freeVars, ast.boundVars)
}
