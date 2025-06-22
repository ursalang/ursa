// Ursa compiler.
// © Reuben Thomas 2023-2025
// Released under the GPL version 3, or (at your option) any later version.

import {Interval} from 'ohm-js'

import grammar, {
  Node, NonterminalNode, IterationNode, ThisNode,
  // eslint-disable-next-line import/extensions
} from '../grammar/ursa.ohm-bundle.js'
import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug, valToString,
} from '../ark/util.js'
import {
  ArkVal, ArkNull, ArkBoolean, ArkNumber, ArkString,
  ArkClosure, ArkGeneratorClosure,
  ArkUndefinedVal,
} from '../ark/data.js'
import {
  ArkBoundVar, ArkExp, ArkLvalue, ArkLiteral, ArkSequence, ArkIf, ArkLoop, ArkAnd, ArkOr,
  ArkObjectLiteral, ArkListLiteral, ArkMapLiteral,
  ArkCall, ArkInvoke, ArkLet, ArkFn, ArkGenerator, ArkProperty, ArkSet, ArkReturn, ArkYield,
  ArkBreak, ArkContinue, ArkAwait, ArkLaunch, ArkType, ArkFnType, ArkNamedLoc,
  globalTypes,
} from '../ark/code.js'
import {
  Frame, Environment, TypedLocation,
} from '../ark/compiler-utils.js'
import {ArkState, ArkRuntimeError} from '../ark/interpreter.js'
import {
  ArkCompilerError, symRef, checkParamList,
} from '../ark/reader.js'

type ParserOperations = {
  toExp(a: ParserArgs): ArkExp
  toLval(a: ParserArgs): ArkLvalue
  toDefinition(a: ParserArgs): Definition
  toKeyValue(a: ParserArgs): KeyValue
  toType(a: ParserArgs): ArkType
  toParam(a: ParserArgs): TypedLocation
  toLet(a: ParserArgs): LetBinding
}

type ParserArgs = {
  env: Environment
  inLoop?: boolean
  inFn?: boolean
  inGenerator?: boolean
}

type ParserNode = Node<ParserOperations>
type ParserNonterminalNode = NonterminalNode<ParserOperations>
type ParserIterationNode = IterationNode<ParserOperations>
type ParserThisNode = ThisNode<{a: ParserArgs}, ParserOperations>

// eslint-disable-next-line max-len
const semantics = grammar.createSemantics<ParserNode, ParserNonterminalNode, ParserIterationNode, ParserThisNode, ParserOperations>()

class UrsaError extends Error {
  constructor(source: Interval | undefined, message: string, options: ErrorOptions = {}) {
    super(`${source ? source.getLineAndColumnMessage() : '(unknown location)'}\n${message}`, options)
  }
}

export class UrsaCompilerError extends UrsaError {}

export class UrsaRuntimeError extends UrsaError {
  constructor(public ark: ArkState, source: Interval, message: string, options: ErrorOptions = {}) {
    super(source, message, options)
    const trace = []
    // Exclude top level stack frame from trace-back.
    for (let state: ArkState = ark; state.outerState !== undefined; state = state.outerState) {
      const callerName = state.outerState.frame.debug.callerName
      let fnLocation
      if (state.outerState.outerState !== undefined) {
        const fnName = callerName ?? '(anonymous function)'
        fnLocation = `in ${fnName}`
      } else {
        fnLocation = 'at top level'
      }
      const sourceLoc = state.frame.debug.sourceLoc
      if (sourceLoc !== undefined) {
        const line = sourceLoc.getLineAndColumn()
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
class AST {}

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
  constructor(public boundVars: ArkBoundVar[]) {
    super()
  }
}

function symRefWithSource(env: Environment, name: string, source: Interval): ArkLvalue {
  const lval = symRef(env, name)
  lval.sourceLoc = source
  return lval
}

function maybeVal(a: ParserArgs, exp: ParserIterationNode): ArkExp {
  return exp.children.length > 0
    ? exp.children[0].toExp(a)
    : new ArkLiteral(ArkNull())
}

function makeProperty(
  a: ParserArgs,
  exp: ParserNode,
  object: ParserNonterminalNode,
  property: ParserNode,
) {
  return new ArkProperty(object.toExp(a), property.sourceString, exp.source)
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

semantics.addOperation<TypedLocation>('toParam(a)', {
  Param(ident, typeAnnotation) {
    const ty = typeAnnotation.children[1].toType(this.args.a)
    return new TypedLocation(ident.sourceString, ty, false)
  },
})

semantics.addOperation<LetBinding>('toLet(a)', {
  Lets(lets) {
    const letIds: string[] = []
    const letVars: boolean[] = []
    for (const l of (lets.asIteration().children)) {
      const ident = l.children[1].children[0].sourceString
      const isVar = l.children[0].ctorName === 'var'
      letVars.push(isVar)
      if (letIds.includes(ident)) {
        throw new UrsaCompilerError(this.source, `Duplicate identifier in let: ${ident}`)
      }
      letIds.push(ident)
    }
    // FIXME: fix type
    const locations = letIds.map(
      (id, n) => new TypedLocation(id, ArkUndefinedVal, letVars[n]),
    )
    const innerEnv = this.args.a.env.push(locations)
    const parsedLets = []
    for (const l of lets.asIteration().children) {
      const definition = l.children[1].toDefinition({...this.args.a, env: innerEnv})
      parsedLets.push(definition)
    }
    const indexBase = this.args.a.env.top().locals.length
    return new LetBinding(
      parsedLets.map(
        (def, index) => new ArkBoundVar(
          def.ident.sourceString,
          ArkUndefinedVal, // FIXME
          letVars[index],
          indexBase + index,
          def.exp,
        ),
      ),
    )
  },

  Use(_use, pathList) {
    const path = pathList.asIteration().children
    const ident = path[path.length - 1]
    // For path x.y.z, compile `let z = x.use("y", "z")`
    const innerEnv = this.args.a.env.push([
      new TypedLocation(ident.sourceString, ArkVal, false)])
    const libValue = path[0].toExp({...this.args.a, env: innerEnv})
    const useProperty = new ArkProperty(libValue, 'use', this.source)
    const useCallArgs = path.slice(1).map((id) => new ArkLiteral(ArkString(id.sourceString)))
    const useCall = new ArkCall(useProperty, useCallArgs, this.source)
    const index = this.args.a.env.top().locals.length
    // FIXME: Type
    return new LetBinding([
      new ArkBoundVar(ident.sourceString, ArkVal, false, index, useCall),
    ])
  },
})

function makeSequence(a: ParserArgs, seq: ParserNode, exps: ParserNode[]): ArkExp {
  const res = []
  for (const [i, exp] of exps.entries()) {
    if (exp.children[0].ctorName === 'Lets' || exp.children[0].ctorName === 'Use') {
      const compiledLet = exp.toLet(a)
      const innerEnv = a.env.push(
        compiledLet.boundVars.map((bv) => new TypedLocation(bv.name, bv.type, bv.isVar)),
      )
      let letBody: ArkExp
      if (i < exps.length - 1) {
        letBody = makeSequence({...a, env: innerEnv}, seq, exps.slice(i + 1))
      } else {
        letBody = new ArkLiteral(ArkNull())
      }
      res.push(new ArkLet(compiledLet.boundVars, letBody, exp.source))
      break
    } else {
      res.push(exp.toExp(a))
    }
  }
  if (res.length === 1) {
    return res[0]
  }
  return new ArkSequence(res, seq.source)
}

function makeArguments(a: ParserArgs, args: ParserNode): Arguments {
  return new Arguments(
    args.asIteration().children.map((x) => x.toExp(a)),
  )
}

semantics.addOperation<ArkExp>('toExp(a)', {
  Sequence(exps, _sc) {
    return makeSequence(this.args.a, this, exps.asIteration().children)
  },

  PrimaryExp_paren(_open, exp, _close) {
    return exp.toExp(this.args.a)
  },

  List(_open, elems, _maybeComma, _close) {
    return new ArkListLiteral((elems.asIteration().children).map(
      (x) => x.toExp(this.args.a),
    ), this.source)
  },

  Map(_open, elems, _maybeComma, _close) {
    const inits = new Map<ArkExp, ArkExp>()
    elems.asIteration().children.forEach((value) => {
      const elem = value.toKeyValue(this.args.a)
      inits.set(elem.key, elem.exp)
    })
    return new ArkMapLiteral(inits, this.source)
  },

  Object(maybeType, _open, elems, _maybeComma, _close) {
    // TODO: compile the type, add to ArkObjectLiteral
    if (maybeType.children.length > 0) {
      maybeType.children[0].toType(this.args.a)
    }
    const inits = new Map<string, ArkExp>()
    elems.asIteration().children.forEach((value) => {
      const elem = value.toDefinition(this.args.a)
      inits.set(elem.ident.sourceString, elem.exp)
    })
    return new ArkObjectLiteral(inits, this.source)
  },

  PostfixExp_property(exp, _dot, property) {
    return makeProperty(this.args.a, this, exp, property)
  },
  PostfixExp_invoke(exp, _dot, property, _spaces, _open, args, _maybeComma, _close) {
    return new ArkInvoke(
      exp.toExp(this.args.a),
      property.sourceString,
      makeArguments(this.args.a, args).args,
      this.source,
    )
  },
  PostfixExp_call(exp, _spaces, _open, args, _maybeComma, _close) {
    return new ArkCall(exp.toExp(this.args.a), makeArguments(this.args.a, args).args, this.source)
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
    return new ArkIf(cond.toExp(this.args.a), thenBlock.toExp(this.args.a), undefined, this.source)
  },

  Fn(ty, body) {
    const fnType = ty.toType(this.args.a) as ArkFnType
    // TODO: Environment should contain typed params, not just strings
    const innerEnv = this.args.a.env.pushFrame(
      new Frame(fnType.params, []),
    )
    const compiledBody = body.toExp({
      env: innerEnv,
      inLoop: false,
      inFn: true,
      inGenerator: fnType.Constructor === ArkGeneratorClosure,
    })
    // TODO: ArkFn should be an ArkObject which contains one method.
    const CodeConstructor = fnType.Constructor === ArkGeneratorClosure ? ArkGenerator : ArkFn
    return new CodeConstructor(
      fnType.params,
      fnType.returnType,
      innerEnv.top().captures.map(
        (c) => symRef(this.args.a.env, c.name) as ArkNamedLoc,
      ),
      compiledBody,
      this.source,
    )
  },

  Loop(_loop, body) {
    return new ArkLoop(
      body.toExp({...this.args.a, inLoop: true}),
      this.args.a.env.top().locals.length,
      this.source,
    )
  },

  For(_for, ident, _in, iterator, body) {
    const iterVar = ident.sourceString
    // FIXME: type of $iter
    const innerEnv = this.args.a.env.push([new TypedLocation('$iter', ArkVal, false)])
    const compiledIterator = iterator.toExp({...this.args.a, env: innerEnv})
    // FIXME: type of iterVar
    const loopEnv = innerEnv.push([new TypedLocation(iterVar, ArkVal, false)])
    const compiledIterVar = symRef(loopEnv, iterVar)
    const compiledForBody = body.toExp({...this.args.a, env: loopEnv, inLoop: true})
    const innerIndex = innerEnv.top().locals.length
    const loopBody = new ArkLet(
      // FIXME: fix type of iterVar
      [new ArkBoundVar(iterVar, ArkVal, false, innerIndex, new ArkCall(symRefWithSource(loopEnv, '$iter', iterator.source), [], this.source))],
      new ArkSequence([
        new ArkIf(
          new ArkInvoke(compiledIterVar, 'equals', [new ArkLiteral(ArkNull())], this.source),
          new ArkBreak(),
        ),
        compiledForBody,
      ]),
      this.source,
    )
    const localsDepth = this.args.a.env.top().locals.length
    return new ArkLet([new ArkBoundVar('$iter', ArkVal, false, localsDepth, compiledIterator)], new ArkLoop(loopBody, localsDepth + 1), this.source)
  },

  UnaryExp_bitwise_not(_not, exp) {
    return new ArkInvoke(exp.toExp(this.args.a), 'bitwiseNot', [], this.source)
  },
  UnaryExp_pos(_plus, exp) {
    return new ArkInvoke(exp.toExp(this.args.a), 'pos', [], this.source)
  },
  UnaryExp_neg(_minus, exp) {
    return new ArkInvoke(exp.toExp(this.args.a), 'neg', [], this.source)
  },

  ExponentExp_power(left, _power, right) {
    return new ArkInvoke(left.toExp(this.args.a), 'exp', [right.toExp(this.args.a)], this.source)
  },

  ProductExp_times(left, _times, right) {
    return new ArkInvoke(left.toExp(this.args.a), 'mul', [right.toExp(this.args.a)], this.source)
  },
  ProductExp_divide(left, _divide, right) {
    return new ArkInvoke(left.toExp(this.args.a), 'div', [right.toExp(this.args.a)], this.source)
  },
  ProductExp_mod(left, _mod, right) {
    return new ArkInvoke(left.toExp(this.args.a), 'mod', [right.toExp(this.args.a)], this.source)
  },

  SumExp_plus(left, _plus, right) {
    return new ArkInvoke(left.toExp(this.args.a), 'add', [right.toExp(this.args.a)], this.source)
  },
  SumExp_minus(left, _minus, right) {
    return new ArkInvoke(left.toExp(this.args.a), 'sub', [right.toExp(this.args.a)], this.source)
  },

  CompareExp_eq(left, _eq, right) {
    return new ArkInvoke(left.toExp(this.args.a), 'equals', [right.toExp(this.args.a)], this.source)
  },
  CompareExp_neq(left, _neq, right) {
    return new ArkInvoke(left.toExp(this.args.a), 'notEquals', [right.toExp(this.args.a)], this.source)
  },
  CompareExp_lt(left, _lt, right) {
    return new ArkInvoke(left.toExp(this.args.a), 'lt', [right.toExp(this.args.a)], this.source)
  },
  CompareExp_leq(left, _leq, right) {
    return new ArkInvoke(left.toExp(this.args.a), 'leq', [right.toExp(this.args.a)], this.source)
  },
  CompareExp_gt(left, _gt, right) {
    return new ArkInvoke(left.toExp(this.args.a), 'gt', [right.toExp(this.args.a)], this.source)
  },
  CompareExp_geq(left, _geq, right) {
    return new ArkInvoke(left.toExp(this.args.a), 'geq', [right.toExp(this.args.a)], this.source)
  },

  BitwiseExp_and(left, _and, right) {
    return new ArkInvoke(left.toExp(this.args.a), 'bitwiseAnd', [right.toExp(this.args.a)], this.source)
  },
  BitwiseExp_or(left, _or, right) {
    return new ArkInvoke(left.toExp(this.args.a), 'bitwiseOr', [right.toExp(this.args.a)], this.source)
  },
  BitwiseExp_xor(left, _xor, right) {
    return new ArkInvoke(left.toExp(this.args.a), 'bitwiseXor', [right.toExp(this.args.a)], this.source)
  },
  BitwiseExp_lshift(left, _lshift, right) {
    return new ArkInvoke(left.toExp(this.args.a), 'shiftLeft', [right.toExp(this.args.a)], this.source)
  },
  BitwiseExp_arshift(left, _arshift, right) {
    return new ArkInvoke(left.toExp(this.args.a), 'shiftRight', [right.toExp(this.args.a)], this.source)
  },
  BitwiseExp_lrshift(left, _lrshift, right) {
    return new ArkInvoke(left.toExp(this.args.a), 'shiftRightArith', [right.toExp(this.args.a)], this.source)
  },

  LogicNotExp_not(_not, exp) {
    return new ArkInvoke(exp.toExp(this.args.a), 'not', [], this.source)
  },

  LogicExp(node) {
    return node.toExp({...this.args.a})
  },
  LogicExp_and(left, _and, right) {
    return new ArkAnd(left.toExp(this.args.a), right.toExp(this.args.a), this.source)
  },
  LogicExp_or(left, _or, right) {
    return new ArkOr(left.toExp(this.args.a), right.toExp(this.args.a), this.source)
  },

  Assignment_ass(lvalue, _ass, exp) {
    const compiledLvalue = lvalue.toLval(this.args.a)
    const compiledValue = exp.toExp(this.args.a)
    if (compiledLvalue instanceof ArkNamedLoc && !compiledLvalue.isVar) {
      throw new UrsaCompilerError(lvalue.source, "Cannot assign to non-'var'")
    }
    return new ArkSet(compiledLvalue, compiledValue, this.source)
  },

  Exp_await(_await, exp) {
    return new ArkAwait(exp.toExp(this.args.a), this.source)
  },

  Exp_yield(yield_, exp) {
    if (!this.args.a.inGenerator) {
      throw new UrsaCompilerError(yield_.source, 'yield may only be used in a generator')
    }
    return new ArkYield(maybeVal(this.args.a, exp), this.source)
  },

  Exp_launch(_launch, exp) {
    return new ArkLaunch(exp.toExp(this.args.a), this.source)
  },

  Statement_break(_break, exp) {
    if (!this.args.a.inLoop) {
      throw new UrsaCompilerError(_break.source, 'break used outside a loop')
    }
    return new ArkBreak(maybeVal(this.args.a, exp), this.source)
  },
  Statement_continue(_continue) {
    if (!this.args.a.inLoop) {
      throw new UrsaCompilerError(_continue.source, 'continue used outside a loop')
    }
    return new ArkContinue(this.source)
  },
  Statement_return(return_, exp) {
    if (!this.args.a.inFn) {
      throw new UrsaCompilerError(return_.source, 'return used outside a function')
    }
    return new ArkReturn(maybeVal(this.args.a, exp), this.source)
  },

  Block(_open, seq, _close) {
    return seq.toExp(this.args.a)
  },

  ident(ident) {
    return symRefWithSource(this.args.a.env, ident.sourceString, this.source)
  },

  null(_null) {
    return new ArkLiteral(ArkNull(), this.source)
  },

  bool(flag) {
    return new ArkLiteral(ArkBoolean(flag.sourceString === 'true'), this.source)
  },

  number(_) {
    return new ArkLiteral(ArkNumber(parseFloat(this.sourceString)), this.source)
  },

  string(_open, _str, _close) {
    // FIXME: Parse string properly
    // eslint-disable-next-line no-eval
    return new ArkLiteral(ArkString(eval(this.sourceString) as string), this.source)
  },

  literalString(_open, str, _close) {
    return new ArkLiteral(ArkString(str.sourceString), this.source)
  },
})

semantics.addOperation<ArkType>('toType(a)', {
  NamedType(ident, _typeArgs) {
    const basicTy = globalTypes.get(ident.sourceString)
    if (basicTy === undefined) {
      throw new UrsaCompilerError(ident.source, 'Bad type')
    }
    // TODO
    // let paramTypes: ArkType[] = []
    // if (typeArgs.children.length > 0) {
    //   paramTypes = typeArgs.children[0].children[1].asIteration().children.map(
    //     (child) => child.toType(this.args.a),
    //   )
    // }
    return basicTy // TODO: use parameter types
  },

  // TODO: return types along with parameter names, and return type.
  FnType(fn, _open, params, _maybeComma, _close, typeAnnotation) {
    const parsedParams = params.asIteration().children.map((p) => p.toParam(this.args.a))
    try {
      checkParamList(parsedParams.map((p) => p.name))
    } catch (e) {
      if (!(e instanceof ArkCompilerError)) {
        throw e
      }
      throw new UrsaCompilerError(params.source, e.message)
    }
    const returnType = typeAnnotation.children[1].toType(this.args.a)
    return new ArkFnType(fn.ctorName === 'fn' ? ArkClosure : ArkGeneratorClosure, [], parsedParams, returnType)
  },
})

function badLvalue(node: ParserNode): never {
  throw new UrsaCompilerError(node.source, 'Bad lvalue')
}

// The node passed to toLval is always a PostfixExp or PrimaryExp.
semantics.addOperation<ArkLvalue>('toLval(a)', {
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
    return symRefWithSource(this.args.a.env, sym.sourceString, this.source)
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

export async function runWithTraceback(ark: ArkState): Promise<ArkVal> {
  try {
    return await ark.run()
  } catch (e) {
    if (e instanceof ArkRuntimeError) {
      throw new UrsaRuntimeError(e.ark, e.sourceLoc as Interval, e.message, {cause: e})
    }
    throw e
  }
}
