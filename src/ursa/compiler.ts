// Ursa compiler.
// © Reuben Thomas 2023-2024
// Released under the GPL version 3, or (at your option) any later version.

import {Interval} from 'ohm-js'

import grammar, {
  Node, NonterminalNode, IterationNode, ThisNode,
  // eslint-disable-next-line import/extensions
} from '../grammar/ursa.ohm-bundle.js'
import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
  ArkState, intrinsics, ArkRuntimeError,
  ArkVal, ArkExp, ArkLiteral, ArkNull, ArkBoolean, ArkNumber, ArkString,
  ArkSequence, ArkIf, ArkLoop, ArkAnd, ArkOr,
  ArkObjectLiteral, ArkListLiteral, ArkMapLiteral,
  ArkCall, ArkLet, ArkFn, ArkProperty, ArkGet, ArkSet, ArkReturn,
  ArkBreak, ArkContinue, ArkNullVal,
} from '../ark/interpreter.js'
import {
  ArkCompilerError, symRef, Frame, Environment, checkParamList,
} from '../ark/compiler.js'

type ParserOperations = {
  toExp(a: ParserArgs): ArkExp
  toLval(a: ParserArgs): ArkExp
  toDefinition(a: ParserArgs): Definition
  toKeyValue(a: ParserArgs): KeyValue
  toArguments(a: ParserArgs): Arguments
  toType(a: ParserArgs): void
  toMethod(a: ParserArgs): string[]
  toParam(a: ParserArgs): string
  boundVars: string[]
  symref(a: ParserArgs): ArkExp
}

type ParserArgs = {
  env: Environment
  inLoop?: boolean
  inFn?: boolean
}

type ParserNode = Node<ParserOperations>
type ParserNonterminalNode = NonterminalNode<ParserOperations>
type ParserIterationNode = IterationNode<ParserOperations>
type ParserThisNode = ThisNode<{a: ParserArgs}, ParserOperations>

// eslint-disable-next-line max-len
const semantics = grammar.createSemantics<ParserNode, ParserNonterminalNode, ParserIterationNode, ParserThisNode, ParserOperations>()

class UrsaError extends Error {
  constructor(source: Interval, message: string) {
    super(`${source ? source.getLineAndColumnMessage() : 'unknown location'}\n${message}`)
  }
}

export class UrsaCompilerError extends UrsaError {}

class UrsaRuntimeError extends UrsaError {
  constructor(public ark: ArkState, source: Interval, message: string) {
    super(source, message)
    const trace = []
    // Exclude top level stack frame from trace-back.
    for (let state: ArkState = ark; state.outerState !== undefined; state = state.outerState) {
      const callInfo = state.frame.debug.source
      let fnName
      if (state.outerState.outerState !== undefined) {
        const fnNameInfo = state.outerState.frame.debug.name
        if (fnNameInfo !== undefined) {
          fnName = fnNameInfo.debug.name
        }
        fnName = `in ${fnName}`
      } else {
        fnName = 'at top level'
      }
      if (callInfo !== undefined) {
        const line = (callInfo.debug.sourceLoc as Interval).getLineAndColumn()
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
export class AST {}

class Definition extends AST {
  constructor(public ident: ParserNode, public val: ArkExp) {
    super()
  }
}

class KeyValue extends AST {
  constructor(public key: ArkExp, public val: ArkExp) {
    super()
  }
}

class Arguments extends AST {
  constructor(public args: ArkExp[]) {
    super()
  }
}

function maybeVal(a: ParserArgs, exp: ParserIterationNode): ArkExp {
  return exp.children.length > 0
    ? exp.children[0].toExp(a)
    : new ArkLiteral(ArkNull())
}

function addLoc(val: ArkExp, node: ParserNode) {
  val.debug.sourceLoc = node.source
  return val
}

function makeProperty(a: ParserArgs, object: ParserNonterminalNode, property: ParserNode) {
  return addLoc(new ArkProperty(property.sourceString, object.toExp(a)), object)
}

function makeIfChain(ifs: ArkIf[]): ArkIf {
  if (ifs.length > 1) {
    ifs[0].elseExp = makeIfChain(ifs.slice(1))
  }
  return ifs[0]
}

semantics.addOperation<Definition>('toDefinition(a)', {
  Definition(ident, initializer) {
    return new Definition(
      ident,
      addLoc(initializer.children[1].toExp(this.args.a), initializer),
    )
  },
})

semantics.addOperation<KeyValue>('toKeyValue(a)', {
  KeyValue(key, _colon, value) {
    return new KeyValue(
      key.toExp(this.args.a),
      addLoc(value.toExp(this.args.a), value),
    )
  },
})

semantics.addOperation<Arguments>('toArguments(a)', {
  Arguments(_open, args, _maybeComma, _close) {
    return new Arguments(
      args.asIteration().children.map(
        (x) => addLoc(x.toExp(this.args.a), x),
      ),
    )
  },
})

semantics.addOperation<string>('toParam(a)', {
  Param(ident, maybeType) {
    if (maybeType.children.length > 0) {
      maybeType.children[0].children[1].toType(this.args.a)
    }
    return ident.sourceString
  },
})

function makeSequence(a: ParserArgs, exps: ParserNode[]): ArkExp {
  const res = []
  for (const [i, exp] of exps.entries()) {
    const compiledExp = exp.toExp(a)
    if (compiledExp instanceof ArkLet) {
      const innerEnv = a.env.push(compiledExp.boundVars.map((bv) => bv[0]))
      let letBody = compiledExp.body
      if (i < exps.length - 1) {
        const seqBody = []
        // FIXME: add an AST class for compiling Lets, rather than producing
        // an ArkLet and then having to take it apart like this.
        if (!(compiledExp.body instanceof ArkLiteral
          && compiledExp.body.val instanceof ArkNullVal)) {
          seqBody.push(compiledExp.body)
        }
        seqBody.push(makeSequence({...a, env: innerEnv}, exps.slice(i + 1)))
        letBody = seqBody.length === 1 ? seqBody[0] : new ArkSequence(seqBody)
      }
      res.push(new ArkLet(compiledExp.boundVars, letBody))
      break
    } else {
      res.push(compiledExp)
    }
  }
  if (res.length === 1) {
    return res[0]
  }
  return new ArkSequence(res)
}

semantics.addOperation<ArkExp>('toExp(a)', {
  Sequence(exps, _sc) {
    return addLoc(makeSequence(this.args.a, exps.asIteration().children), this)
  },

  PrimaryExp_ident(_sym) {
    return addLoc(new ArkGet(this.symref(this.args.a)), this)
  },
  PrimaryExp_paren(_open, exp, _close) {
    return addLoc(exp.toExp(this.args.a), this)
  },

  List(_open, elems, _maybeComma, _close) {
    return addLoc(
      new ArkListLiteral((elems.asIteration().children).map(
        (x) => x.toExp(this.args.a),
      )),
      this,
    )
  },

  Map(_open, elems, _maybeComma, _close) {
    const inits = new Map<ArkExp, ArkExp>()
    elems.asIteration().children.forEach((value) => {
      const elem = value.toKeyValue(this.args.a)
      inits.set(elem.key, elem.val)
    })
    return addLoc(new ArkMapLiteral(inits), this)
  },

  Object(type, _open, elems, _maybeComma, _close) {
    // TODO: compile the type, add to ArkObjectLiteral
    type.toType(this.args.a)
    const inits = new Map<string, ArkExp>()
    elems.asIteration().children.forEach((value) => {
      const elem = value.toDefinition(this.args.a)
      inits.set(elem.ident.sourceString, elem.val)
    })
    return addLoc(new ArkObjectLiteral(inits), this)
  },

  PropertyExp_property(object, _dot, property) {
    return addLoc(new ArkGet(makeProperty(this.args.a, object, property)), this)
  },

  CallExp_property(exp, _dot, property) {
    return addLoc(new ArkGet(makeProperty(this.args.a, exp, property)), this)
  },
  CallExp_call(exp, args) {
    return addLoc(
      new ArkCall(exp.toExp(this.args.a), args.toArguments(this.args.a).args),
      this,
    )
  },
  CallExp_property_call(exp, args) {
    return addLoc(
      new ArkCall(exp.toExp(this.args.a), args.toArguments(this.args.a).args),
      this,
    )
  },

  Ifs(ifs, _else, elseBlock) {
    const compiledIfs: ArkIf[] = (ifs.asIteration().children).map(
      (x) => addLoc(x.toExp(this.args.a), x) as ArkIf,
    )
    if (elseBlock.children.length > 0) {
      compiledIfs.push(
        elseBlock.children[0].toExp(this.args.a) as ArkIf,
      )
    }
    return makeIfChain(compiledIfs)
  },
  If(_if, cond, thenBlock) {
    return addLoc(
      new ArkIf(cond.toExp(this.args.a), thenBlock.toExp(this.args.a)),
      this,
    )
  },

  Fn(type, body) {
    const paramStrings = type.toMethod(this.args.a)
    // TODO: Environment should contain typed params, not just strings
    const innerEnv = this.args.a.env.pushFrame(new Frame(paramStrings, []))
    const compiledBody = body.toExp({env: innerEnv, inLoop: false, inFn: true})
    // TODO: ArkFn should be an ArkObject which contains one method.
    return addLoc(new ArkFn(
      paramStrings,
      innerEnv.stack[0].captures.map((c) => symRef(this.args.a.env, c)),
      compiledBody,
    ), this)
  },

  Loop(_loop, body) {
    return addLoc(new ArkLoop(body.toExp({...this.args.a, inLoop: true})), this)
  },

  For(_for, ident, _of, iterator, body) {
    const forVar = ident.sourceString
    const innerEnv = this.args.a.env.push(['_for'])
    const compiledIterator = iterator.toExp({...this.args.a, env: innerEnv})
    const loopEnv = innerEnv.push([forVar])
    const compiledForVar = symRef(loopEnv, forVar)
    const compiledForBody = body.toExp({...this.args.a, env: loopEnv, inLoop: true})
    const loopBody = new ArkLet(
      [[forVar, new ArkCall(new ArkGet(symRef(loopEnv, '_for')), [])]],
      new ArkSequence([
        new ArkIf(
          new ArkCall(new ArkLiteral(intrinsics.get('=')), [new ArkGet(compiledForVar), new ArkLiteral(ArkNull())]),
          new ArkBreak(),
        ),
        compiledForBody,
      ]),
    )
    return new ArkLet([['_for', compiledIterator]], new ArkLoop(loopBody))
  },

  UnaryExp_bitwise_not(_not, exp) {
    return addLoc(
      new ArkCall(new ArkLiteral(intrinsics.get('~')), [exp.toExp(this.args.a)]),
      this,
    )
  },
  UnaryExp_pos(_plus, exp) {
    return addLoc(
      new ArkCall(new ArkLiteral(intrinsics.get('pos')), [exp.toExp(this.args.a)]),
      this,
    )
  },
  UnaryExp_neg(_minus, exp) {
    return addLoc(
      new ArkCall(new ArkLiteral(intrinsics.get('neg')), [exp.toExp(this.args.a)]),
      this,
    )
  },

  ExponentExp_power(left, _power, right) {
    return addLoc(
      new ArkCall(new ArkLiteral(intrinsics.get('**')), [left.toExp(this.args.a), right.toExp(this.args.a)]),
      this,
    )
  },

  ProductExp_times(left, _times, right) {
    return addLoc(
      new ArkCall(new ArkLiteral(intrinsics.get('*')), [left.toExp(this.args.a), right.toExp(this.args.a)]),
      this,
    )
  },
  ProductExp_divide(left, _divide, right) {
    return addLoc(
      new ArkCall(new ArkLiteral(intrinsics.get('/')), [left.toExp(this.args.a), right.toExp(this.args.a)]),
      this,
    )
  },
  ProductExp_mod(left, _mod, right) {
    return addLoc(
      new ArkCall(new ArkLiteral(intrinsics.get('%')), [left.toExp(this.args.a), right.toExp(this.args.a)]),
      this,
    )
  },

  SumExp_plus(left, _plus, right) {
    return addLoc(
      new ArkCall(new ArkLiteral(intrinsics.get('+')), [left.toExp(this.args.a), right.toExp(this.args.a)]),
      this,
    )
  },
  SumExp_minus(left, _minus, right) {
    return addLoc(
      new ArkCall(new ArkLiteral(intrinsics.get('-')), [left.toExp(this.args.a), right.toExp(this.args.a)]),
      this,
    )
  },

  CompareExp_eq(left, _eq, right) {
    return addLoc(
      new ArkCall(new ArkLiteral(intrinsics.get('=')), [left.toExp(this.args.a), right.toExp(this.args.a)]),
      this,
    )
  },
  CompareExp_neq(left, _neq, right) {
    return addLoc(
      new ArkCall(new ArkLiteral(intrinsics.get('!=')), [left.toExp(this.args.a), right.toExp(this.args.a)]),
      this,
    )
  },
  CompareExp_lt(left, _lt, right) {
    return addLoc(
      new ArkCall(new ArkLiteral(intrinsics.get('<')), [left.toExp(this.args.a), right.toExp(this.args.a)]),
      this,
    )
  },
  CompareExp_leq(left, _leq, right) {
    return addLoc(
      new ArkCall(new ArkLiteral(intrinsics.get('<=')), [left.toExp(this.args.a), right.toExp(this.args.a)]),
      this,
    )
  },
  CompareExp_gt(left, _gt, right) {
    return addLoc(
      new ArkCall(new ArkLiteral(intrinsics.get('>')), [left.toExp(this.args.a), right.toExp(this.args.a)]),
      this,
    )
  },
  CompareExp_geq(left, _geq, right) {
    return addLoc(
      new ArkCall(new ArkLiteral(intrinsics.get('>=')), [left.toExp(this.args.a), right.toExp(this.args.a)]),
      this,
    )
  },

  BitwiseExp_and(left, _and, right) {
    return addLoc(
      new ArkCall(new ArkLiteral(intrinsics.get('&')), [left.toExp(this.args.a), right.toExp(this.args.a)]),
      this,
    )
  },
  BitwiseExp_or(left, _or, right) {
    return addLoc(
      new ArkCall(new ArkLiteral(intrinsics.get('|')), [left.toExp(this.args.a), right.toExp(this.args.a)]),
      this,
    )
  },
  BitwiseExp_xor(left, _xor, right) {
    return addLoc(
      new ArkCall(new ArkLiteral(intrinsics.get('^')), [left.toExp(this.args.a), right.toExp(this.args.a)]),
      this,
    )
  },
  BitwiseExp_lshift(left, _lshift, right) {
    return addLoc(
      new ArkCall(new ArkLiteral(intrinsics.get('<<')), [left.toExp(this.args.a), right.toExp(this.args.a)]),
      this,
    )
  },
  BitwiseExp_arshift(left, _arshift, right) {
    return addLoc(
      new ArkCall(new ArkLiteral(intrinsics.get('>>')), [left.toExp(this.args.a), right.toExp(this.args.a)]),
      this,
    )
  },
  BitwiseExp_lrshift(left, _lrshift, right) {
    return addLoc(
      new ArkCall(new ArkLiteral(intrinsics.get('>>>')), [left.toExp(this.args.a), right.toExp(this.args.a)]),
      this,
    )
  },

  LogicNotExp_not(_not, exp) {
    return addLoc(
      new ArkCall(new ArkLiteral(intrinsics.get('not')), [exp.toExp(this.args.a)]),
      this,
    )
  },

  LogicExp_and(left, _and, right) {
    return addLoc(
      new ArkAnd(left.toExp(this.args.a), right.toExp(this.args.a)),
      this,
    )
  },
  LogicExp_or(left, _or, right) {
    return addLoc(
      new ArkOr(left.toExp(this.args.a), right.toExp(this.args.a)),
      this,
    )
  },

  AssignmentExp_ass(lvalue, _ass, value) {
    const compiledLvalue = lvalue.toLval(this.args.a)
    const compiledValue = value.toExp(this.args.a)
    return addLoc(new ArkSet(compiledLvalue, compiledValue), this)
  },

  Exp_break(_break, exp) {
    if (!this.args.a.inLoop) {
      throw new UrsaCompilerError(_break.source, 'break used outside a loop')
    }
    return addLoc(new ArkBreak(maybeVal(this.args.a, exp)), this)
  },
  Exp_continue(_continue) {
    if (!this.args.a.inLoop) {
      throw new UrsaCompilerError(_continue.source, 'continue used outside a loop')
    }
    return addLoc(new ArkContinue(), this)
  },
  Exp_return(_return, exp) {
    if (!this.args.a.inFn) {
      throw new UrsaCompilerError(_return.source, 'return used outside a function')
    }
    return addLoc(new ArkReturn(maybeVal(this.args.a, exp)), this)
  },

  Lets(lets) {
    const letIds: string[] = []
    for (const l of (lets.asIteration().children)) {
      const ident = l.children[1].children[0].sourceString
      if (letIds.includes(ident)) {
        throw new UrsaCompilerError(this.source, `Duplicate identifier in let: ${ident}`)
      }
      letIds.push(ident)
    }
    const innerEnv = this.args.a.env.push(letIds)
    const parsedLets = []
    for (const l of lets.asIteration().children) {
      const definition = l.children[1].toDefinition({...this.args.a, env: innerEnv})
      parsedLets.push(definition)
    }
    return addLoc(
      new ArkLet(
        parsedLets.map((def) => [def.ident.sourceString, def.val]),
        new ArkLiteral(ArkNull()),
      ),
      this,
    )
  },

  Use(_use, pathList) {
    const path = pathList.asIteration().children
    const ident = path[path.length - 1]
    // For path x.y.z, compile `let z = x.use(y.z)`
    const innerEnv = this.args.a.env.push([ident.sourceString])
    const compiledUse = new ArkLet([[ident.sourceString, new ArkCall(
      new ArkGet(addLoc(new ArkProperty('use', new ArkGet(path[0].symref({...this.args.a, env: innerEnv}))), this)),
      path.slice(1).map((id) => new ArkLiteral(ArkString(id.sourceString))),
    )]], new ArkLiteral(ArkNull()))
    return addLoc(compiledUse, this)
  },

  Block(_open, seq, _close) {
    return addLoc(seq.toExp(this.args.a), this)
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
    return addLoc(new ArkLiteral(ArkString(eval(this.sourceString) as string)), this)
  },

  literalString(_open, str, _close) {
    return addLoc(new ArkLiteral(ArkString(str.sourceString)), this)
  },
})

// TODO: actually collect the type information.
semantics.addOperation<void>('toType(a)', {
  NamedType(_path, typeArgs) {
    if (typeArgs.children.length > 0) {
      typeArgs.children[0].children[1].asIteration().children.map(
        (child) => child.toType(this.args.a),
      )
    }
  },
  Type_intersection(types) {
    types.asIteration().children.map((child) => child.toType(this.args.a))
  },
  Type_fn(type) {
    type.toMethod(this.args.a)
  },
})

// TODO: return types along with parameter names, and return type.
semantics.addOperation<string[]>('toMethod(a)', {
  FnType(_fn, _open, params, _maybeComma, _close, maybeType) {
    const parsedParams = params.asIteration().children.map((p) => p.toParam(this.args.a))
    try {
      checkParamList(parsedParams)
    } catch (e) {
      if (!(e instanceof ArkCompilerError)) {
        throw e
      }
      throw new UrsaCompilerError(params.source, e.message)
    }
    if (maybeType.children.length > 0) {
      maybeType.children[0].children[1].toType(this.args.a)
    }
    return parsedParams
  },
})

semantics.addOperation<ArkExp>('toLval(a)', {
  PrimaryExp_ident(_sym) {
    return addLoc(this.symref(this.args.a), this)
  },

  PropertyExp_property(object, _dot, property) {
    return makeProperty(this.args.a, object, property)
  },

  CallExp_property(exp, _dot, ident) {
    return makeProperty(this.args.a, exp, ident)
  },
})

function mergeBoundVars(children: ParserNode[]): string[] {
  const boundVars: string[] = []
  children.forEach((child) => boundVars.push(...child.boundVars))
  return boundVars
}

semantics.addAttribute<string[]>('boundVars', {
  _terminal() {
    return []
  },
  _nonterminal(...children) {
    return mergeBoundVars(children)
  },
  _iter(...children) {
    return mergeBoundVars(children)
  },

  Sequence(_exps, _sc) {
    return []
  },

  Let(_let, definition) {
    return [definition.children[0].sourceString]
  },

  Use(_use, pathList) {
    const path = pathList.asIteration().children
    const ident = path[path.length - 1]
    return [ident.sourceString]
  },
})

// Ohm attributes can't take arguments, so memoize an operation.
const symrefs = new Map<ParserNode, ArkExp>()
semantics.addOperation<ArkExp>('symref(a)', {
  ident(ident) {
    if (!symrefs.has(this)) {
      try {
        symrefs.set(this, symRef(this.args.a.env, this.sourceString))
      } catch (e) {
        if (e instanceof ArkCompilerError) {
          throw new UrsaCompilerError(ident.source, e.message)
        }
        throw e
      }
    }
    return symrefs.get(this)!
  },
})

export function compile(
  expr: string,
  env: Environment = new Environment(),
  startRule?: string,
): ArkExp {
  const matchResult = grammar.match(expr, startRule)
  if (matchResult.failed()) {
    throw new Error(matchResult.message)
  }
  const ast = semantics(matchResult)
  const args = {env, inLoop: false, inFn: false}
  return ast.toExp(args)
}

export async function runWithTraceback(ark: ArkState, compiledExp: ArkExp): Promise<ArkVal> {
  try {
    return await ark.run(compiledExp)
  } catch (e) {
    if (e instanceof ArkRuntimeError) {
      throw new UrsaRuntimeError(e.ark, e.sourceLoc as Interval, e.message)
    }
    throw e
  }
}
