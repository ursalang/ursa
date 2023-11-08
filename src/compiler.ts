import {Node, IterationNode, Interval} from 'ohm-js'
import {grammar, semantics} from '@ursalang/ohm-grammar'
import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
  Val, Null, Bool, Num, Str, ObjLiteral, ListLiteral, DictLiteral,
  Call, Let, Fn, Prop, Ass, Get, intrinsics, ArkState, ArkRuntimeError, FreeVarsMap,
} from '@ursalang/ark'
import {
  CompiledArk, symRef, Environment, PartialCompiledArk, checkParamList,
  ArkCompilerError,
// eslint-disable-next-line import/extensions
} from '@ursalang/ark/lib/compiler.js'

class UrsaError extends Error {
  constructor(source: Interval, message: string) {
    super(`${source.getLineAndColumnMessage()}\n${message}`)
  }
}

class UrsaCompilerError extends UrsaError {}

class UrsaRuntimeError extends UrsaError {
  constructor(public ark: ArkState, source: Interval, message: string) {
    super(source, message)
    const callStack = ark.debug.get('callStack')
    const fnSymStack = ark.debug.get('fnSymStack')
    const trace = []
    // Ignore the top level (outermost frame).
    for (let i = 0; i < callStack.length - 1; i += 1) {
      const source = callStack[i].debug.get('source')
      const fnName = (i > 0 ? `in ${fnSymStack[i - 1].debug.get('name')}` : 'at top level') ?? 'in anonymous function'
      if (source !== undefined) {
        const line = source.getLineAndColumn()
        trace.push(`line ${line.lineNum}\n    ${line.line}, ${fnName}`)
      } else {
        trace.push('(uninstrumented stack frame)')
      }
    }
    this.message += `

Traceback (most recent call last)
${trace.map((s) => `  ${s}`).join('\n')}`
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
    throw new UrsaCompilerError(listNode.source, e.message)
  }
}

function addLoc(val: Val, node: Node) {
  val.debug.set('source', node.source)
  return val
}

function indexExp(expNode: Node, env: Environment, lval: boolean, object: Node, index: Node): AST {
  const compiledObj = object.toAST(env, false)
  const compiledIndex = index.toAST(env, false)
  return lval
    ? new IndexExp(compiledObj, compiledIndex)
    : addLoc(new Call(new Get(new Prop('get', compiledObj)), [compiledIndex]), expNode)
}

function makeIfChain(ifs: Call[]): Call {
  if (ifs.length > 1) {
    ifs[0].children.push(makeIfChain(ifs.slice(1)))
  }
  return ifs[0]
}

semantics.addOperation<AST>('toAST(env,lval)', {
  Sequence(exps, _sc) {
    const compiledExps = []
    const boundVars = []
    for (const exp of exps.asIteration().children) {
      const compiledExp = exp.toAST(this.args.env.push(boundVars), false)
      boundVars.push(...exp.boundVars)
      compiledExps.push(compiledExp)
    }
    const compiledSeqBody = compiledExps.length === 1
      ? compiledExps[0]
      : new Call(intrinsics.get('seq')!, compiledExps)
    const compiledSeq = boundVars.length > 0
      ? new Let(boundVars, compiledSeqBody)
      : compiledSeqBody
    return addLoc(compiledSeq, this)
  },

  PrimaryExp_continue(_continue) {
    return addLoc(new Call(intrinsics.get('continue')!, []), this)
  },
  PrimaryExp_ident(_sym) {
    const symref = this.symref(this.args.env).value
    return addLoc(this.args.lval ? symref : new Get(symref), this)
  },
  PrimaryExp_paren(_open, exp, _close) {
    return addLoc(exp.toAST(this.args.env, false), this)
  },

  List(_open, elems, _maybe_comma, _close) {
    return addLoc(
      new ListLiteral(elems.asIteration().children.map((x) => x.toAST(this.args.env, false))),
      this,
    )
  },

  Object(_open, elems, _maybe_comma, _close) {
    const inits = new Map()
    elems.asIteration().children.forEach((value) => {
      const elem = value.toAST(this.args.env, false)
      inits.set((elem as PropertyValue).key, (elem as PropertyValue).val)
    })
    return addLoc(new ObjLiteral(inits), this)
  },
  PropertyValue(ident, _colon, value) {
    return new PropertyValue(
      ident.sourceString,
      addLoc(value.toAST(this.args.env, false), value),
    )
  },

  Map(_open, elems, _maybe_comma, _close) {
    const inits = new Map<Val, Val>()
    elems.asIteration().children.forEach((value) => {
      const elem = value.toAST(this.args.env, false)
      inits.set((elem as KeyValue).key, (elem as KeyValue).val)
    })
    return addLoc(new DictLiteral(inits), this)
  },
  KeyValue(key, _colon, value) {
    return new KeyValue(
      key.toAST(this.args.env, false),
      addLoc(value.toAST(this.args.env, false), value),
    )
  },

  PropertyExp_property(object, _dot, property) {
    const compiledProp = new Prop(property.sourceString, object.toAST(this.args.env, false))
    return addLoc(this.args.lval ? compiledProp : new Get(compiledProp), this)
  },
  PropertyExp_index(object, _open, index, _close) {
    return indexExp(this, this.args.env, this.args.lval, object, index)
  },

  CallExp_index(object, _open, index, _close) {
    return indexExp(this, this.args.env, this.args.lval, object, index)
  },
  CallExp_property(exp, _dot, ident) {
    const compiledProp = new Prop(ident.sourceString, exp.toAST(this.args.env, false))
    return addLoc(this.args.lval ? compiledProp : new Get(compiledProp), this)
  },
  CallExp_call(exp, args) {
    return addLoc(
      new Call(exp.toAST(this.args.env, false), args.toAST(this.args.env, false).args),
      this,
    )
  },
  CallExp_property_call(exp, args) {
    return addLoc(
      new Call(exp.toAST(this.args.env, false), args.toAST(this.args.env, false).args),
      this,
    )
  },
  Arguments(_open, args, _maybe_comma, _close) {
    return new Arguments(
      args.asIteration().children.map((x) => addLoc(x.toAST(this.args.env, false), x)),
    )
  },

  Ifs(ifs, _else, e_else) {
    const compiledIfs = ifs.asIteration().children.map(
      (x) => addLoc(x.toAST(this.args.env, false), x),
    )
    if (e_else.children.length > 0) {
      compiledIfs.push(e_else.children[0].toAST(this.args.env, false))
    }
    return makeIfChain(compiledIfs)
  },
  If(_if, e_cond, e_then) {
    const args: Val[] = [e_cond.toAST(this.args.env, false), e_then.toAST(this.args.env, false)]
    return addLoc(new Call(intrinsics.get('if')!, args), this)
  },

  Fn(_fn, _open, params, _maybe_comma, _close, body) {
    const paramStrings = listNodeToParamList(params)
    const innerEnv = this.args.env.pushFrame(paramStrings)
    const bodyFreeVars: FreeVarsMap = body.freeVars(innerEnv)
    const compiledBody = body.toAST(innerEnv, false)
    paramStrings.forEach((p) => bodyFreeVars.delete(p))
    return addLoc(new Fn(paramStrings, bodyFreeVars, compiledBody), this)
  },

  Loop(_loop, e_body) {
    return addLoc(new Call(intrinsics.get('loop')!, [e_body.toAST(this.args.env, false)]), this)
  },

  UnaryExp_break(_break, exp) {
    return addLoc(new Call(intrinsics.get('break')!, [maybeVal(this.args.env, exp)]), this)
  },
  UnaryExp_return(_return, exp) {
    return addLoc(new Call(intrinsics.get('return')!, [maybeVal(this.args.env, exp)]), this)
  },
  UnaryExp_not(_not, exp) {
    return addLoc(new Call(intrinsics.get('not')!, [exp.toAST(this.args.env, false)]), this)
  },
  UnaryExp_bitwise_not(_not, exp) {
    return addLoc(new Call(intrinsics.get('~')!, [exp.toAST(this.args.env, false)]), this)
  },
  UnaryExp_pos(_plus, exp) {
    return addLoc(new Call(intrinsics.get('pos')!, [exp.toAST(this.args.env, false)]), this)
  },
  UnaryExp_neg(_minus, exp) {
    return addLoc(new Call(intrinsics.get('neg')!, [exp.toAST(this.args.env, false)]), this)
  },

  ExponentExp_power(left, _power, right) {
    return addLoc(new Call(intrinsics.get('**')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)]), this)
  },

  ProductExp_times(left, _times, right) {
    return addLoc(new Call(intrinsics.get('*')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)]), this)
  },
  ProductExp_divide(left, _divide, right) {
    return addLoc(new Call(intrinsics.get('/')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)]), this)
  },
  ProductExp_mod(left, _mod, right) {
    return addLoc(new Call(intrinsics.get('%')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)]), this)
  },

  SumExp_plus(left, _plus, right) {
    return addLoc(new Call(intrinsics.get('+')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)]), this)
  },
  SumExp_minus(left, _minus, right) {
    return addLoc(new Call(intrinsics.get('-')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)]), this)
  },

  CompareExp_eq(left, _eq, right) {
    return addLoc(new Call(intrinsics.get('=')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)]), this)
  },
  CompareExp_neq(left, _neq, right) {
    return addLoc(new Call(intrinsics.get('!=')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)]), this)
  },
  CompareExp_lt(left, _le, right) {
    return addLoc(new Call(intrinsics.get('<')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)]), this)
  },
  CompareExp_leq(left, _leq, right) {
    return addLoc(new Call(intrinsics.get('<=')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)]), this)
  },
  CompareExp_gt(left, _gt, right) {
    return addLoc(new Call(intrinsics.get('>')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)]), this)
  },
  CompareExp_geq(left, _geq, right) {
    return addLoc(new Call(intrinsics.get('>=')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)]), this)
  },

  BitwiseExp_and(left, _and, right) {
    return addLoc(new Call(intrinsics.get('&')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)]), this)
  },
  BitwiseExp_or(left, _or, right) {
    return addLoc(new Call(intrinsics.get('|')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)]), this)
  },
  BitwiseExp_xor(left, _xor, right) {
    return addLoc(new Call(intrinsics.get('^')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)]), this)
  },
  BitwiseExp_lshift(left, _lshift, right) {
    return addLoc(new Call(intrinsics.get('<<')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)]), this)
  },
  BitwiseExp_arshift(left, _rshift, right) {
    return addLoc(new Call(intrinsics.get('>>')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)]), this)
  },
  BitwiseExp_lrshift(left, _arshift, right) {
    return addLoc(new Call(intrinsics.get('>>>')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)]), this)
  },

  LogicExp_and(left, _and, right) {
    return addLoc(
      new Call(
        intrinsics.get('and')!,
        [left.toAST(this.args.env, false), right.toAST(this.args.env, false)],
      ),
      this,
    )
  },
  LogicExp_or(left, _or, right) {
    return addLoc(
      new Call(
        intrinsics.get('or')!,
        [left.toAST(this.args.env, false), right.toAST(this.args.env, false)],
      ),
      this,
    )
  },

  AssignmentExp_ass(lvalue, _eq, value) {
    const compiledLvalue = lvalue.toAST(this.args.env, true)
    const compiledValue = value.toAST(this.args.env, false)
    let compiled
    if (compiledLvalue instanceof IndexExp) {
      compiled = new Call(
        new Get(new Prop('set', compiledLvalue.obj)),
        [compiledLvalue.index, compiledValue],
      )
    } else {
      compiled = new Ass(compiledLvalue, compiledValue)
    }
    return addLoc(compiled, this)
  },

  Lets(lets) {
    const parsedLets = []
    const letIds: string[] = []
    for (const l of lets.asIteration().children) {
      const parsedLet: SingleLet = l.toAST(this.args.env, false)
      parsedLets.push(parsedLet)
      if (letIds.includes(parsedLet.id.sourceString)) {
        throw new UrsaCompilerError(this.source, `Duplicate identifier in let: ${parsedLet.id.sourceString}`)
      }
      letIds.push(parsedLet.id.sourceString)
    }
    const innerEnv = this.args.env.push(letIds)
    const assignments = parsedLets.map(
      (l) => new Ass(l.id.symref(innerEnv).value, l.node.toAST(innerEnv, false)),
    )
    const compiled = assignments.length > 1
      ? new Call(intrinsics.get('seq')!, assignments)
      : assignments[0]
    return addLoc(compiled, this)
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
    return addLoc(compiledLet, this)
  },

  Block(_open, seq, _close) {
    return addLoc(seq.toAST(this.args.env, false), this)
  },

  // This rule is not used for symbol references, but for property and
  // parameter names.
  ident(_ident) {
    return addLoc(Str(this.sourceString), this)
  },

  null(_null) {
    return addLoc(Null(), this)
  },

  bool(flag) {
    return addLoc(Bool(flag.sourceString === 'true'), this)
  },

  number(_) {
    return addLoc(Num(parseFloat(this.sourceString)), this)
  },

  string(_open, _str, _close) {
    // FIXME: Parse string properly
    // eslint-disable-next-line no-eval
    return addLoc(Str(eval(this.sourceString)), this)
  },
})

// Ohm attributes can't take arguments, so memoize an operation.
const symrefs = new Map<Node, CompiledArk>()
semantics.addOperation<CompiledArk>('symref(env)', {
  ident(ident) {
    if (!symrefs.has(this)) {
      try {
        symrefs.set(this, symRef(this.args.env, this.sourceString))
      } catch (e) {
        if (!(e instanceof ArkCompilerError)) {
          throw e
        }
        throw new UrsaCompilerError(ident.source, e.message)
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
  const freeVars: FreeVarsMap = ast.freeVars(env)
  env.externalSyms.forEach((_val, id) => freeVars.delete(id))
  return new PartialCompiledArk(compiled, freeVars, ast.boundVars)
}

export function runWithTraceback(ark: ArkState, compiledVal: CompiledArk): Val {
  try {
    return ark.run(compiledVal)
  } catch (e) {
    if (e instanceof ArkRuntimeError) {
      const sourceLoc = ark.debug.get('sourceStack')
      throw new UrsaRuntimeError(ark, sourceLoc[0] as Interval, e.message)
    }
    throw e
  }
}
