// Ursa compiler.
// © Reuben Thomas 2023-2024
// Released under the GPL version 3, or (at your option) any later version.

import {Interval} from 'ohm-js'

import assert from 'assert'
import grammar, {
  Node, NonterminalNode, IterationNode, ThisNode,
  // eslint-disable-next-line import/extensions
} from '../grammar/ursa.ohm-bundle.js'
import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug, valToString,
  ArkState, ArkRuntimeError,
  ArkVal, ArkExp, ArkLexp, ArkLiteral,
  ArkNull, ArkBoolean, ArkNumber, ArkString,
  ArkSequence, ArkIf, ArkLoop, ArkAnd, ArkOr,
  ArkObjectLiteral, ArkListLiteral, ArkMapLiteral,
  ArkCall, ArkLet, ArkFn, ArkProperty, ArkSet, ArkReturn,
  ArkBreak, ArkContinue, ArkAwait, ArkLaunch,
} from '../ark/interpreter.js'
import {
  ArkCompilerError, symRef, Frame, Environment, checkParamList,
} from '../ark/compiler.js'

type ParserOperations = {
  toExp(a: ParserArgs): ArkExp
  toLval(a: ParserArgs): ArkLexp
  toDefinition(a: ParserArgs): Definition
  toKeyValue(a: ParserArgs): KeyValue
  toArguments(a: ParserArgs): Arguments
  toType(a: ParserArgs): void
  toMethod(a: ParserArgs): string[]
  toParam(a: ParserArgs): string
  toLet(a: ParserArgs): LetBinding
  boundVars: string[]
}

type ParserArgs = {
  env: Environment
  inLoop?: boolean
  inFn?: boolean
  inExp?: boolean
}

type ParserNode = Node<ParserOperations>
type ParserNonterminalNode = NonterminalNode<ParserOperations>
type ParserIterationNode = IterationNode<ParserOperations>
type ParserThisNode = ThisNode<{a: ParserArgs}, ParserOperations>

// eslint-disable-next-line max-len
const semantics = grammar.createSemantics<ParserNode, ParserNonterminalNode, ParserIterationNode, ParserThisNode, ParserOperations>()

class UrsaError extends Error {
  constructor(source: Interval, message: string, options: ErrorOptions = {}) {
    super(`${source ? source.getLineAndColumnMessage() : 'unknown location'}\n${message}`, options)
  }
}

export class UrsaCompilerError extends UrsaError {}

export class UrsaRuntimeError extends UrsaError {
  constructor(public ark: ArkState, source: Interval, message: string, options: ErrorOptions = {}) {
    super(source, message, options)
    const trace = []
    // Exclude top level stack frame from trace-back.
    for (let state: ArkState = ark; state.outerState !== undefined; state = state.outerState) {
      const callerInfo = state.outerState.frame.debug.source
      let fnLocation
      if (state.outerState.outerState !== undefined) {
        let fnName = '(anonymous function)'
        if (callerInfo !== undefined && callerInfo.fn.debug.name) {
          fnName = callerInfo.fn.debug.name
        }
        fnLocation = `in ${fnName}`
      } else {
        fnLocation = 'at top level'
      }
      const callInfo = state.frame.debug.source
      if (callInfo !== undefined) {
        const line = callInfo.sourceLoc!.getLineAndColumn()
        trace.push(`line ${line.lineNum}\n    ${line.line}, ${fnLocation}`)
      } else {
        trace.push('(uninstrumented stack frame)')
      }
    }
    if (trace.length > 0) {
      this.message += `

Traceback (most recent call last)
${trace.map((s) => `  ${s}`).join('\n')}`
    }
  }
}

// Base class for parsing the language, extended directly by classes used
// only during parsing.
export class AST {}

class Definition extends AST {
  constructor(public ident: ParserNode, public exp: ArkExp) {
    super()
  }
}

class KeyValue extends AST {
  constructor(public key: ArkExp, public exp: ArkExp) {
    super()
  }
}

class Arguments extends AST {
  constructor(public args: ArkExp[]) {
    super()
  }
}

class LetBinding extends AST {
  constructor(public boundVars: [string, ArkExp][]) {
    super()
  }
}

function maybeVal(a: ParserArgs, exp: ParserIterationNode): ArkExp {
  return exp.children.length > 0
    ? exp.children[0].toExp(a)
    : new ArkLiteral(ArkNull())
}

function addLoc<T extends ArkExp>(val: T, node: ParserNode): T {
  // Ensure we don't overwrite more precise location info with less precise.
  assert(val.sourceLoc === undefined, valToString(node))
  val.sourceLoc = node.source
  return val
}

function makeProperty(
  a: ParserArgs,
  exp: ParserNode,
  object: ParserNonterminalNode,
  property: ParserNode,
) {
  return addLoc(new ArkProperty(object.toExp(a), property.sourceString), exp)
}

function makeIfChain(ifs: ArkIf[]): ArkIf {
  if (ifs.length > 1) {
    ifs[0].elseExp = makeIfChain(ifs.slice(1))
  }
  return ifs[0]
}

semantics.addOperation<Definition>('toDefinition(a)', {
  Definition(ident, initializer) {
    return new Definition(ident, initializer.children[1].toExp(this.args.a))
  },
})

semantics.addOperation<KeyValue>('toKeyValue(a)', {
  KeyValue(key, _colon, value) {
    return new KeyValue(
      key.toExp(this.args.a),
      value.toExp(this.args.a),
    )
  },
})

semantics.addOperation<Arguments>('toArguments(a)', {
  Arguments(_open, args, _maybeComma, _close) {
    return new Arguments(
      args.asIteration().children.map((x) => x.toExp(this.args.a)),
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

semantics.addOperation<LetBinding>('toLet(a)', {
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
    return new LetBinding(parsedLets.map((def) => [def.ident.sourceString, def.exp]))
  },

  Use(_use, pathList) {
    const path = pathList.asIteration().children
    const ident = path[path.length - 1]
    // For path x.y.z, compile `let z = x.use("y", "z")`
    const innerEnv = this.args.a.env.push([ident.sourceString])
    const libValue = path[0].toExp({...this.args.a, env: innerEnv})
    const useProperty = addLoc(new ArkProperty(libValue, 'use'), this)
    const useCallArgs = path.slice(1).map((id) => new ArkLiteral(ArkString(id.sourceString)))
    const useCall = addLoc(new ArkCall(useProperty, useCallArgs), this)
    return new LetBinding([[ident.sourceString, useCall]])
  },
})

function makeSequence(a: ParserArgs, seq: ParserNode, exps: ParserNode[]): ArkExp {
  const res = []
  for (const [i, exp] of exps.entries()) {
    if (exp.children[0].ctorName === 'Lets' || exp.children[0].ctorName === 'Use') {
      const compiledLet = exp.toLet(a)
      const innerEnv = a.env.push(compiledLet.boundVars.map((bv) => bv[0]))
      let letBody: ArkExp
      if (i < exps.length - 1) {
        letBody = makeSequence({...a, env: innerEnv}, seq, exps.slice(i + 1))
      } else {
        letBody = new ArkLiteral(ArkNull())
      }
      res.push(addLoc(new ArkLet(compiledLet.boundVars, letBody), exp))
      break
    } else {
      res.push(exp.toExp(a))
    }
  }
  if (res.length === 1) {
    return res[0]
  }
  return addLoc(new ArkSequence(res), seq)
}

semantics.addOperation<ArkExp>('toExp(a)', {
  Sequence(exps, _sc) {
    return makeSequence(this.args.a, this, exps.asIteration().children)
  },

  PrimaryExp_paren(_open, exp, _close) {
    return exp.toExp(this.args.a)
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
      inits.set(elem.key, elem.exp)
    })
    return addLoc(new ArkMapLiteral(inits), this)
  },

  Object(type, _open, elems, _maybeComma, _close) {
    // TODO: compile the type, add to ArkObjectLiteral
    type.toType(this.args.a)
    const inits = new Map<string, ArkExp>()
    elems.asIteration().children.forEach((value) => {
      const elem = value.toDefinition(this.args.a)
      inits.set(elem.ident.sourceString, elem.exp)
    })
    return addLoc(new ArkObjectLiteral(inits), this)
  },

  PostfixExp_property(exp, _dot, property) {
    return makeProperty(this.args.a, this, exp, property)
  },
  PostfixExp_call(exp, args) {
    return addLoc(new ArkCall(exp.toExp(this.args.a), args.toArguments(this.args.a).args), this)
  },

  Ifs(ifs, _else, elseBlock) {
    const compiledIfs: ArkIf[] = (ifs.asIteration().children).map(
      (x) => x.toExp(this.args.a) as ArkIf,
    )
    if (elseBlock.children.length > 0) {
      compiledIfs.push(elseBlock.children[0].toExp(this.args.a) as ArkIf)
    }
    return makeIfChain(compiledIfs)
  },
  If(_if, cond, thenBlock) {
    return addLoc(new ArkIf(cond.toExp(this.args.a), thenBlock.toExp(this.args.a)), this)
  },

  Fn(type, body) {
    const paramStrings = type.toMethod(this.args.a)
    // TODO: Environment should contain typed params, not just strings
    const innerEnv = this.args.a.env.pushFrame(new Frame(paramStrings, []))
    const compiledBody = body.toExp({
      env: innerEnv, inLoop: false, inFn: true, inExp: false,
    })
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
      [[forVar, new ArkCall(symRef(loopEnv, '_for'), [])]],
      new ArkSequence([
        new ArkIf(
          new ArkCall(new ArkProperty(compiledForVar, '='), [new ArkLiteral(ArkNull())]),
          new ArkBreak(),
        ),
        compiledForBody,
      ]),
    )
    return new ArkLet([['_for', compiledIterator]], new ArkLoop(loopBody))
  },

  UnaryExp_bitwise_not(_not, exp) {
    return addLoc(
      new ArkCall(new ArkProperty(exp.toExp(this.args.a), '~'), []),
      this,
    )
  },
  UnaryExp_pos(_plus, exp) {
    return addLoc(
      new ArkCall(new ArkProperty(exp.toExp(this.args.a), 'pos'), []),
      this,
    )
  },
  UnaryExp_neg(_minus, exp) {
    return addLoc(
      new ArkCall(new ArkProperty(exp.toExp(this.args.a), 'neg'), []),
      this,
    )
  },

  ExponentExp_power(left, _power, right) {
    return addLoc(
      new ArkCall(new ArkProperty(left.toExp(this.args.a), '**'), [right.toExp(this.args.a)]),
      this,
    )
  },

  ProductExp_times(left, _times, right) {
    return addLoc(
      new ArkCall(new ArkProperty(left.toExp(this.args.a), '*'), [right.toExp(this.args.a)]),
      this,
    )
  },
  ProductExp_divide(left, _divide, right) {
    return addLoc(
      new ArkCall(new ArkProperty(left.toExp(this.args.a), '/'), [right.toExp(this.args.a)]),
      this,
    )
  },
  ProductExp_mod(left, _mod, right) {
    return addLoc(
      new ArkCall(new ArkProperty(left.toExp(this.args.a), '%'), [right.toExp(this.args.a)]),
      this,
    )
  },

  SumExp_plus(left, _plus, right) {
    return addLoc(
      new ArkCall(new ArkProperty(left.toExp(this.args.a), '+'), [right.toExp(this.args.a)]),
      this,
    )
  },
  SumExp_minus(left, _minus, right) {
    return addLoc(
      new ArkCall(new ArkProperty(left.toExp(this.args.a), '-'), [right.toExp(this.args.a)]),
      this,
    )
  },

  CompareExp_eq(left, _eq, right) {
    return addLoc(
      new ArkCall(new ArkProperty(left.toExp(this.args.a), '='), [right.toExp(this.args.a)]),
      this,
    )
  },
  CompareExp_neq(left, _neq, right) {
    return addLoc(
      new ArkCall(new ArkProperty(left.toExp(this.args.a), '!='), [right.toExp(this.args.a)]),
      this,
    )
  },
  CompareExp_lt(left, _lt, right) {
    return addLoc(
      new ArkCall(new ArkProperty(left.toExp(this.args.a), '<'), [right.toExp(this.args.a)]),
      this,
    )
  },
  CompareExp_leq(left, _leq, right) {
    return addLoc(
      new ArkCall(new ArkProperty(left.toExp(this.args.a), '<='), [right.toExp(this.args.a)]),
      this,
    )
  },
  CompareExp_gt(left, _gt, right) {
    return addLoc(
      new ArkCall(new ArkProperty(left.toExp(this.args.a), '>'), [right.toExp(this.args.a)]),
      this,
    )
  },
  CompareExp_geq(left, _geq, right) {
    return addLoc(
      new ArkCall(new ArkProperty(left.toExp(this.args.a), '>='), [right.toExp(this.args.a)]),
      this,
    )
  },

  BitwiseExp_and(left, _and, right) {
    return addLoc(
      new ArkCall(new ArkProperty(left.toExp(this.args.a), '&'), [right.toExp(this.args.a)]),
      this,
    )
  },
  BitwiseExp_or(left, _or, right) {
    return addLoc(
      new ArkCall(new ArkProperty(left.toExp(this.args.a), '|'), [right.toExp(this.args.a)]),
      this,
    )
  },
  BitwiseExp_xor(left, _xor, right) {
    return addLoc(
      new ArkCall(new ArkProperty(left.toExp(this.args.a), '^'), [right.toExp(this.args.a)]),
      this,
    )
  },
  BitwiseExp_lshift(left, _lshift, right) {
    return addLoc(
      new ArkCall(new ArkProperty(left.toExp(this.args.a), '<<'), [right.toExp(this.args.a)]),
      this,
    )
  },
  BitwiseExp_arshift(left, _arshift, right) {
    return addLoc(
      new ArkCall(new ArkProperty(left.toExp(this.args.a), '>>'), [right.toExp(this.args.a)]),
      this,
    )
  },
  BitwiseExp_lrshift(left, _lrshift, right) {
    return addLoc(
      new ArkCall(new ArkProperty(left.toExp(this.args.a), '>>>'), [right.toExp(this.args.a)]),
      this,
    )
  },

  LogicNotExp_not(_not, exp) {
    return addLoc(
      new ArkCall(new ArkProperty(exp.toExp(this.args.a), 'not'), []),
      this,
    )
  },

  LogicExp(node) {
    return node.toExp({...this.args.a, inExp: true})
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

  Assignment_ass(lvalue, _ass, exp) {
    const compiledLvalue = lvalue.toLval(this.args.a)
    const compiledValue = exp.toExp(this.args.a)
    return addLoc(new ArkSet(compiledLvalue, compiledValue), this)
  },

  Exp_await(_await, exp) {
    return addLoc(new ArkAwait(exp.toExp(this.args.a)), this)
  },

  Statement_break(_break, exp) {
    if (!this.args.a.inLoop) {
      throw new UrsaCompilerError(_break.source, 'break used outside a loop')
    }
    return addLoc(new ArkBreak(maybeVal(this.args.a, exp)), this)
  },
  Statement_continue(_continue) {
    if (!this.args.a.inLoop) {
      throw new UrsaCompilerError(_continue.source, 'continue used outside a loop')
    }
    return addLoc(new ArkContinue(), this)
  },
  Statement_launch(_await, exp) {
    return addLoc(new ArkLaunch(exp.toExp(this.args.a)), this)
  },
  Statement_return(return_, exp) {
    if (!this.args.a.inFn) {
      throw new UrsaCompilerError(return_.source, 'return used outside a function')
    } else if (this.args.a.inExp) {
      throw new UrsaCompilerError(return_.source, 'return may not be used inside an expression')
    }
    return addLoc(new ArkReturn(maybeVal(this.args.a, exp)), this)
  },

  Block(_open, seq, _close) {
    return seq.toExp(this.args.a)
  },

  ident(ident) {
    return addLoc(symRef(this.args.a.env, ident.sourceString), this)
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

function badLvalue(node: ParserNode): never {
  throw new UrsaCompilerError(node.source, 'Bad lvalue')
}

// The node passed to toLval is always a PostfixExp or PrimaryExp.
semantics.addOperation<ArkLexp>('toLval(a)', {
  _terminal() {
    badLvalue(this)
  },
  _nonterminal() {
    badLvalue(this)
  },

  PrimaryExp(exp) {
    return exp.toLval(this.args.a)
  },
  PrimaryExp_ident(sym) {
    return addLoc(symRef(this.args.a.env, sym.sourceString), this)
  },

  PostfixExp(exp) {
    return exp.toLval(this.args.a)
  },
  PostfixExp_property(exp, _dot, property) {
    return makeProperty(this.args.a, this, exp, property)
  },
  PostfixExp_primary(exp) {
    return exp.toLval(this.args.a)
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
  const args = {
    env, inLoop: false, inFn: false, atSeqTop: true,
  }
  return ast.toExp(args)
}

export async function runWithTraceback(ark: ArkState, compiledExp: ArkExp): Promise<ArkVal> {
  try {
    return await ark.run(compiledExp)
  } catch (e) {
    if (e instanceof ArkRuntimeError) {
      throw new UrsaRuntimeError(e.ark, e.sourceLoc as Interval, e.message, {cause: e})
    }
    throw e
  }
}
