// Ursa compiler.
// © Reuben Thomas 2023
// Released under the MIT license.

import {Node, IterationNode, Interval} from 'ohm-js'

import {grammar, semantics} from '@ursalang/ohm-grammar'
import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
  ArkState, intrinsics, ArkRuntimeError, ArkCompilerError, FreeVarsMap,
  ArkVal, ArkExp, ArkNull, ArkBoolean, ArkNumber, ArkString,
  ArkSequence, ArkIf, ArkLoop, ArkAnd, ArkOr,
  ArkObjectLiteral, ArkListLiteral, ArkMapLiteral,
  ArkCall, ArkLet, ArkFn, ArkProperty, ArkGet, ArkSet,
  CompiledArk, symRef, Environment, PartialCompiledArk, checkParamList, ArkLiteral,
} from '@ursalang/ark'

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
  constructor(public key: string, public val: ArkExp) {
    super()
  }
}

class KeyValue extends AST {
  constructor(public key: ArkExp, public val: ArkExp) {
    super()
  }
}

class IndexExp extends AST {
  constructor(public obj: ArkExp, public index: ArkExp) {
    super()
  }
}

class SingleLet extends AST {
  constructor(public id: Node, public node: Node) {
    super()
  }
}

class Arguments extends AST {
  constructor(public args: ArkExp[]) {
    super()
  }
}

function maybeVal(env: Environment, exp: IterationNode): ArkExp {
  return exp.children.length > 0 ? exp.children[0].toAST(env, false) : new ArkLiteral(ArkNull())
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

function addLoc(val: ArkExp, node: Node) {
  val.debug.set('source', node.source)
  return val
}

function indexExp(expNode: Node, env: Environment, lval: boolean, object: Node, index: Node): AST {
  const compiledObj = object.toAST(env, false)
  const compiledIndex = index.toAST(env, false)
  return lval
    ? new IndexExp(compiledObj, compiledIndex)
    : addLoc(new ArkCall(new ArkGet(new ArkProperty('get', compiledObj)), [compiledIndex]), expNode)
}

function makeIfChain(ifs: ArkIf[]): ArkIf {
  if (ifs.length > 1) {
    ifs[0].elseExp = makeIfChain(ifs.slice(1))
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
      : new ArkSequence(compiledExps)
    const compiledSeq = boundVars.length > 0
      ? new ArkLet(boundVars, compiledSeqBody)
      : compiledSeqBody
    return addLoc(compiledSeq, this)
  },

  PrimaryExp_continue(_continue) {
    return addLoc(new ArkCall(intrinsics.get('continue')!, []), this)
  },
  PrimaryExp_ident(_sym) {
    const symref = this.symref(this.args.env).value
    return addLoc(this.args.lval ? symref : new ArkGet(symref), this)
  },
  PrimaryExp_paren(_open, exp, _close) {
    return addLoc(exp.toAST(this.args.env, false), this)
  },

  List(_open, elems, _maybeComma, _close) {
    return addLoc(
      new ArkListLiteral(elems.asIteration().children.map((x) => x.toAST(this.args.env, false))),
      this,
    )
  },

  Object(_open, elems, _maybeComma, _close) {
    const inits = new Map()
    elems.asIteration().children.forEach((value) => {
      const elem = value.toAST(this.args.env, false)
      inits.set((elem as PropertyValue).key, (elem as PropertyValue).val)
    })
    return addLoc(new ArkObjectLiteral(inits), this)
  },
  PropertyValue(ident, _colon, value) {
    return new PropertyValue(
      ident.sourceString,
      addLoc(value.toAST(this.args.env, false), value),
    )
  },

  Map(_open, elems, _maybeComma, _close) {
    const inits = new Map<ArkExp, ArkExp>()
    elems.asIteration().children.forEach((value) => {
      const elem = value.toAST(this.args.env, false)
      inits.set((elem as KeyValue).key, (elem as KeyValue).val)
    })
    return addLoc(new ArkMapLiteral(inits), this)
  },
  KeyValue(key, _colon, value) {
    return new KeyValue(
      key.toAST(this.args.env, false),
      addLoc(value.toAST(this.args.env, false), value),
    )
  },

  PropertyExp_property(object, _dot, property) {
    const compiledProp = new ArkProperty(property.sourceString, object.toAST(this.args.env, false))
    return addLoc(this.args.lval ? compiledProp : new ArkGet(compiledProp), this)
  },
  PropertyExp_index(object, _open, index, _close) {
    return indexExp(this, this.args.env, this.args.lval, object, index)
  },

  CallExp_index(object, _open, index, _close) {
    return indexExp(this, this.args.env, this.args.lval, object, index)
  },
  CallExp_property(exp, _dot, ident) {
    const compiledProp = new ArkProperty(ident.sourceString, exp.toAST(this.args.env, false))
    return addLoc(this.args.lval ? compiledProp : new ArkGet(compiledProp), this)
  },
  CallExp_call(exp, args) {
    return addLoc(
      new ArkCall(exp.toAST(this.args.env, false), args.toAST(this.args.env, false).args),
      this,
    )
  },
  CallExp_property_call(exp, args) {
    return addLoc(
      new ArkCall(exp.toAST(this.args.env, false), args.toAST(this.args.env, false).args),
      this,
    )
  },
  Arguments(_open, args, _maybeComma, _close) {
    return new Arguments(
      args.asIteration().children.map((x) => addLoc(x.toAST(this.args.env, false), x)),
    )
  },

  Ifs(ifs, _else, elseExp) {
    const compiledIfs: ArkIf[] = ifs.asIteration().children.map(
      (x) => addLoc(x.toAST(this.args.env, false), x) as ArkIf,
    )
    if (elseExp.children.length > 0) {
      compiledIfs.push(elseExp.children[0].toAST(this.args.env, false))
    }
    return makeIfChain(compiledIfs)
  },
  If(_if, cond, thenExp) {
    return addLoc(
      new ArkIf(cond.toAST(this.args.env, false), thenExp.toAST(this.args.env, false)),
      this,
    )
  },

  Fn(_fn, _open, params, _maybeComma, _close, body) {
    const paramStrings = listNodeToParamList(params)
    const innerEnv = this.args.env.pushFrame([paramStrings, []])
    const bodyFreeVars: FreeVarsMap = body.freeVars(innerEnv)
    const compiledBody = body.toAST(innerEnv, false)
    paramStrings.forEach((p) => bodyFreeVars.delete(p))
    return addLoc(new ArkFn(paramStrings, [...bodyFreeVars.values()].flat(), compiledBody), this)
  },

  Loop(_loop, body) {
    return addLoc(new ArkLoop(body.toAST(this.args.env, false)), this)
  },

  UnaryExp_break(_break, exp) {
    return addLoc(new ArkCall(intrinsics.get('break')!, [maybeVal(this.args.env, exp)]), this)
  },
  UnaryExp_return(_return, exp) {
    return addLoc(new ArkCall(intrinsics.get('return')!, [maybeVal(this.args.env, exp)]), this)
  },
  UnaryExp_not(_not, exp) {
    return addLoc(new ArkCall(intrinsics.get('not')!, [exp.toAST(this.args.env, false)]), this)
  },
  UnaryExp_bitwise_not(_not, exp) {
    return addLoc(new ArkCall(intrinsics.get('~')!, [exp.toAST(this.args.env, false)]), this)
  },
  UnaryExp_pos(_plus, exp) {
    return addLoc(new ArkCall(intrinsics.get('pos')!, [exp.toAST(this.args.env, false)]), this)
  },
  UnaryExp_neg(_minus, exp) {
    return addLoc(new ArkCall(intrinsics.get('neg')!, [exp.toAST(this.args.env, false)]), this)
  },

  ExponentExp_power(left, _power, right) {
    return addLoc(new ArkCall(intrinsics.get('**')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)]), this)
  },

  ProductExp_times(left, _times, right) {
    return addLoc(new ArkCall(intrinsics.get('*')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)]), this)
  },
  ProductExp_divide(left, _divide, right) {
    return addLoc(new ArkCall(intrinsics.get('/')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)]), this)
  },
  ProductExp_mod(left, _mod, right) {
    return addLoc(new ArkCall(intrinsics.get('%')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)]), this)
  },

  SumExp_plus(left, _plus, right) {
    return addLoc(new ArkCall(intrinsics.get('+')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)]), this)
  },
  SumExp_minus(left, _minus, right) {
    return addLoc(new ArkCall(intrinsics.get('-')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)]), this)
  },

  CompareExp_eq(left, _eq, right) {
    return addLoc(new ArkCall(intrinsics.get('=')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)]), this)
  },
  CompareExp_neq(left, _neq, right) {
    return addLoc(new ArkCall(intrinsics.get('!=')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)]), this)
  },
  CompareExp_lt(left, _le, right) {
    return addLoc(new ArkCall(intrinsics.get('<')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)]), this)
  },
  CompareExp_leq(left, _leq, right) {
    return addLoc(new ArkCall(intrinsics.get('<=')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)]), this)
  },
  CompareExp_gt(left, _gt, right) {
    return addLoc(new ArkCall(intrinsics.get('>')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)]), this)
  },
  CompareExp_geq(left, _geq, right) {
    return addLoc(new ArkCall(intrinsics.get('>=')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)]), this)
  },

  BitwiseExp_and(left, _and, right) {
    return addLoc(new ArkCall(intrinsics.get('&')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)]), this)
  },
  BitwiseExp_or(left, _or, right) {
    return addLoc(new ArkCall(intrinsics.get('|')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)]), this)
  },
  BitwiseExp_xor(left, _xor, right) {
    return addLoc(new ArkCall(intrinsics.get('^')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)]), this)
  },
  BitwiseExp_lshift(left, _lshift, right) {
    return addLoc(new ArkCall(intrinsics.get('<<')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)]), this)
  },
  BitwiseExp_arshift(left, _rshift, right) {
    return addLoc(new ArkCall(intrinsics.get('>>')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)]), this)
  },
  BitwiseExp_lrshift(left, _arshift, right) {
    return addLoc(new ArkCall(intrinsics.get('>>>')!, [left.toAST(this.args.env, false), right.toAST(this.args.env, false)]), this)
  },

  LogicExp_and(left, _and, right) {
    return addLoc(
      new ArkAnd(left.toAST(this.args.env, false), right.toAST(this.args.env, false)),
      this,
    )
  },
  LogicExp_or(left, _or, right) {
    return addLoc(
      new ArkOr(left.toAST(this.args.env, false), right.toAST(this.args.env, false)),
      this,
    )
  },

  AssignmentExp_ass(lvalue, _eq, value) {
    const compiledLvalue = lvalue.toAST(this.args.env, true)
    const compiledValue = value.toAST(this.args.env, false)
    let compiled
    if (compiledLvalue instanceof IndexExp) {
      compiled = new ArkCall(
        new ArkGet(new ArkProperty('set', compiledLvalue.obj)),
        [compiledLvalue.index, compiledValue],
      )
    } else {
      compiled = new ArkSet(compiledLvalue, compiledValue)
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
      (l) => new ArkSet(l.id.symref(innerEnv).value, l.node.toAST(innerEnv, false)),
    )
    const compiled = assignments.length > 1
      ? new ArkSequence(assignments)
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
    const compiledLet = new ArkLet(
      [ident.sourceString],
      new ArkSequence([
        new ArkSet(
          ident.symref(innerEnv).value,
          new ArkCall(
            new ArkGet(new ArkProperty('use', new ArkGet(path[0].symref(innerEnv).value))),
            path.slice(1).map((id) => new ArkLiteral(ArkString(id.sourceString))),
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
    return addLoc(new ArkLiteral(ArkString(this.sourceString)), this)
  },

  null(_null) {
    return addLoc(new ArkLiteral(ArkNull()), this)
  },

  bool(flag) {
    return addLoc(new ArkLiteral(ArkBoolean(flag.sourceString === 'true')), this)
  },

  number(_) {
    return addLoc(new ArkLiteral(ArkNumber(parseFloat(this.sourceString))), this)
  },

  string(_open, _str, _close) {
    // FIXME: Parse string properly
    // eslint-disable-next-line no-eval
    return addLoc(new ArkLiteral(ArkString(eval(this.sourceString))), this)
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

export function runWithTraceback(ark: ArkState, compiledVal: CompiledArk): ArkVal {
  try {
    return ark.run(compiledVal)
  } catch (e) {
    if (e instanceof ArkRuntimeError) {
      throw new UrsaRuntimeError(ark, e.sourceLoc as Interval, e.message)
    }
    throw e
  }
}
