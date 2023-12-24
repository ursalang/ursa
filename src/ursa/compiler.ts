// Ursa compiler.
// © Reuben Thomas 2023
// Released under the GPL version 3, or (at your option) any later version.

import assert from 'assert'

import {Interval} from 'ohm-js'

import grammar, {
  Node, IterationNode, UrsaSemantics, NonterminalNode, UrsaOperations, UrsaSemanticsArgs,
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
  ArkBreak, ArkContinue,
} from '../ark/interpreter.js'
import {
  ArkCompilerError, FreeVars,
  CompiledArk, symRef, Environment, PartialCompiledArk, checkParamList,
} from '../ark/compiler.js'

// Specify precise type so semantics can be precisely type-checked.
export const semantics: UrsaSemantics = grammar.createSemantics()

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
    for (let i = 0; i < ark.stack.stack.length - 1; i += 1) {
      const callInfo = ark.stack.stack[i][2].source
      let fnName
      if (i < ark.stack.stack.length - 2) {
        const fnNameInfo = ark.stack.stack[i + 1][2].name
        if (fnNameInfo !== undefined) {
          fnName = fnNameInfo.debug.name
        }
        fnName = `in ${fnName}`
      } else {
        fnName = 'at top level'
      }
      // 'at top level'
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

export class PropertyValue extends AST {
  constructor(public key: string, public val: ArkExp) {
    super()
  }
}

export class KeyValue extends AST {
  constructor(public key: ArkExp, public val: ArkExp) {
    super()
  }
}

export class SingleLet extends AST {
  constructor(public id: Node, public node: Node) {
    super()
  }
}

export class Arguments extends AST {
  constructor(public args: ArkExp[]) {
    super()
  }
}

function maybeVal(env: Environment, exp: IterationNode, inFn: boolean): ArkExp {
  return exp.children.length > 0
    ? exp.children[0].toExp(env, true, inFn)
    : new ArkLiteral(ArkNull())
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
  val.debug.sourceLoc = node.source
  return val
}

function indexExp(expNode: NonterminalNode, isLval: boolean, object: Node, index: Node): ArkExp {
  const args = expNode.args
  const compiledObj = object.toExp(args.env, args.inLoop, args.inFn)
  const compiledIndex = index.toExp(args.env, args.inLoop, args.inFn)
  return addLoc(
    new ArkCall(
      new ArkGet(addLoc(new ArkProperty(isLval ? 'set' : 'get', compiledObj), object)),
      [compiledIndex],
    ),
    expNode,
  )
}

function makeProperty(args: UrsaSemanticsArgs, object: NonterminalNode, property: Node) {
  return addLoc(
    new ArkProperty(
      property.sourceString,
      object.toExp(args.env, args.inLoop, args.inFn),
    ),
    object,
  )
}

function makeIfChain(ifs: ArkIf[]): ArkIf {
  if (ifs.length > 1) {
    ifs[0].elseExp = makeIfChain(ifs.slice(1))
  }
  return ifs[0]
}

semantics.addOperation<PropertyValue>('toPropertyValue(env,inLoop,inFn)', {
  PropertyValue(ident, _colon, value) {
    return new PropertyValue(
      ident.sourceString,
      addLoc(
        value.toExp(this.args.env, this.args.inLoop, this.args.inFn),
        value,
      ),
    )
  },
})

semantics.addOperation<KeyValue>('toKeyValue(env,inLoop,inFn)', {
  KeyValue(key, _colon, value) {
    return new KeyValue(
      key.toExp(this.args.env, this.args.inLoop, this.args.inFn),
      addLoc(
        value.toExp(this.args.env, this.args.inLoop, this.args.inFn),
        value,
      ),
    )
  },
})

semantics.addOperation<Arguments>('toArguments(env,inLoop,inFn)', {
  Arguments(_open, args, _maybeComma, _close) {
    return new Arguments(
      args.asIteration().children.map(
        (x) => addLoc(
          x.toExp(this.args.env, this.args.inLoop, this.args.inFn),
          x,
        ),
      ),
    )
  },
})

semantics.addOperation<SingleLet>('toLet()', {
  Let(_let, ident, _eq, val) {
    return new SingleLet(ident, val)
  },
})

semantics.addOperation<ArkExp>('toExp(env,inLoop,inFn)', {
  Sequence(exps, _sc) {
    const boundVars = []
    for (const exp of exps.asIteration().children) {
      boundVars.push(...exp.boundVars)
    }
    const compiledExps = []
    const innerEnv = this.args.env.push(
      Array<undefined>(boundVars.length).fill(undefined),
    )
    const outerLocals = this.args.env.stack[0][0].length
    let nextLocal = 0
    for (const exp of exps.asIteration().children) {
      for (let i = 0; i < exp.boundVars.length; i += 1) {
        innerEnv.stack[0][0][outerLocals + nextLocal] = boundVars[nextLocal]
        nextLocal += 1
      }
      const compiledExp = exp.toExp(innerEnv, this.args.inLoop, this.args.inFn)
      compiledExps.push(compiledExp)
    }
    assert(nextLocal === boundVars.length)
    const compiledSeqBody = compiledExps.length === 1
      ? compiledExps[0]
      : new ArkSequence(compiledExps)
    const compiledSeq = boundVars.length > 0
      ? new ArkLet(boundVars, compiledSeqBody)
      : compiledSeqBody
    return addLoc(compiledSeq, this)
  },

  PrimaryExp_ident(_sym) {
    return addLoc(new ArkGet(this.symref(this.args.env).value), this)
  },
  PrimaryExp_paren(_open, exp, _close) {
    return addLoc(
      exp.toExp(this.args.env, this.args.inLoop, this.args.inFn),
      this,
    )
  },

  List(_open, elems, _maybeComma, _close) {
    return addLoc(
      new ArkListLiteral((elems.asIteration().children).map(
        (x) => x.toExp(this.args.env, this.args.inLoop, this.args.inFn),
      )),
      this,
    )
  },

  Object(_open, elems, _maybeComma, _close) {
    const inits = new Map<string, ArkExp>()
    elems.asIteration().children.forEach((value) => {
      const elem = value.toPropertyValue(this.args.env, this.args.inLoop, this.args.inFn)
      inits.set(elem.key, elem.val)
    })
    return addLoc(new ArkObjectLiteral(inits), this)
  },

  Map(_open, elems, _maybeComma, _close) {
    const inits = new Map<ArkExp, ArkExp>()
    elems.asIteration().children.forEach((value) => {
      const elem = value.toKeyValue(this.args.env, this.args.inLoop, this.args.inFn)
      inits.set(elem.key, elem.val)
    })
    return addLoc(new ArkMapLiteral(inits), this)
  },

  PropertyExp_index(object, _open, index, _close) {
    return indexExp(this, false, object, index)
  },
  PropertyExp_property(object, _dot, property) {
    return addLoc(new ArkGet(makeProperty(this.args, object, property)), this)
  },

  CallExp_index(object, _open, index, _close) {
    return indexExp(this, false, object, index)
  },
  CallExp_property(exp, _dot, ident) {
    return addLoc(new ArkGet(makeProperty(this.args, exp, ident)), this)
  },
  CallExp_call(exp, args) {
    return addLoc(
      new ArkCall(
        exp.toExp(this.args.env, this.args.inLoop, this.args.inFn),
        args.toArguments(this.args.env, this.args.inLoop, this.args.inFn).args,
      ),
      this,
    )
  },
  CallExp_property_call(exp, args) {
    return addLoc(
      new ArkCall(
        exp.toExp(this.args.env, this.args.inLoop, this.args.inFn),
        args.toArguments(this.args.env, this.args.inLoop, this.args.inFn).args,
      ),
      this,
    )
  },

  Ifs(ifs, _else, elseBlock) {
    const compiledIfs: ArkIf[] = (ifs.asIteration().children).map(
      (x) => addLoc(
        x.toExp(this.args.env, this.args.inLoop, this.args.inFn),
        x,
      ) as ArkIf,
    )
    if (elseBlock.children.length > 0) {
      compiledIfs.push(elseBlock.children[0].toExp(
        this.args.env,
        this.args.inLoop,
        this.args.inFn,
      ) as ArkIf)
    }
    return makeIfChain(compiledIfs)
  },
  If(_if, cond, thenBlock) {
    return addLoc(
      new ArkIf(
        cond.toExp(this.args.env, this.args.inLoop, this.args.inFn),
        thenBlock.toExp(this.args.env, this.args.inLoop, this.args.inFn),
      ),
      this,
    )
  },

  Fn(_fn, _open, params, _maybeComma, _close, body) {
    const paramStrings = listNodeToParamList(params)
    const innerEnv = this.args.env.pushFrame([paramStrings, []])
    const bodyFreeVars = body.freeVars(innerEnv)
    const compiledBody = body.toExp(innerEnv, false, true)
    paramStrings.forEach((p) => bodyFreeVars.delete(p))
    return addLoc(new ArkFn(paramStrings, [...bodyFreeVars.values()], compiledBody), this)
  },

  Loop(_loop, body) {
    return addLoc(
      new ArkLoop(body.toExp(this.args.env, true, this.args.inFn)),
      this,
    )
  },

  For(_for, ident, _of, iterator, body) {
    const forVar = ident.sourceString
    const innerEnv = this.args.env.push(['_for'])
    const compiledIterator = iterator.toExp(innerEnv, this.args.inLoop, this.args.inFn)
    const loopEnv = innerEnv.push([forVar])
    const compiledForVar = symRef(loopEnv, forVar).value
    const compiledForBody = body.toExp(loopEnv, true, this.args.inFn)
    const loopBody = new ArkLet(
      [forVar],
      new ArkSequence([
        new ArkSet(compiledForVar, new ArkCall(new ArkGet(symRef(loopEnv, '_for').value), [])),
        new ArkIf(
          new ArkCall(new ArkLiteral(intrinsics.get('=')), [new ArkGet(compiledForVar), new ArkLiteral(ArkNull())]),
          new ArkBreak(),
        ),
        compiledForBody,
      ]),
    )
    const letBody = new ArkSequence([
      new ArkSet(symRef(innerEnv, '_for').value, compiledIterator),
      new ArkLoop(loopBody),
    ])
    return new ArkLet(['_for'], letBody)
  },

  UnaryExp_not(_not, exp) {
    return addLoc(new ArkCall(
      new ArkLiteral(intrinsics.get('not')),
      [exp.toExp(this.args.env, this.args.inLoop, this.args.inFn)],
    ), this)
  },
  UnaryExp_bitwise_not(_not, exp) {
    return addLoc(new ArkCall(
      new ArkLiteral(intrinsics.get('~')),
      [exp.toExp(this.args.env, this.args.inLoop, this.args.inFn)],
    ), this)
  },
  UnaryExp_pos(_plus, exp) {
    return addLoc(new ArkCall(
      new ArkLiteral(intrinsics.get('pos')),
      [exp.toExp(this.args.env, this.args.inLoop, this.args.inFn)],
    ), this)
  },
  UnaryExp_neg(_minus, exp) {
    return addLoc(new ArkCall(
      new ArkLiteral(intrinsics.get('neg')),
      [exp.toExp(this.args.env, this.args.inLoop, this.args.inFn)],
    ), this)
  },

  ExponentExp_power(left, _power, right) {
    return addLoc(new ArkCall(
      new ArkLiteral(intrinsics.get('**')),
      [
        left.toExp(this.args.env, this.args.inLoop, this.args.inFn),
        right.toExp(this.args.env, this.args.inLoop, this.args.inFn),
      ],
    ), this)
  },

  ProductExp_times(left, _times, right) {
    return addLoc(new ArkCall(
      new ArkLiteral(intrinsics.get('*')),
      [
        left.toExp(this.args.env, this.args.inLoop, this.args.inFn),
        right.toExp(this.args.env, this.args.inLoop, this.args.inFn),
      ],
    ), this)
  },
  ProductExp_divide(left, _divide, right) {
    return addLoc(new ArkCall(
      new ArkLiteral(intrinsics.get('/')),
      [
        left.toExp(this.args.env, this.args.inLoop, this.args.inFn),
        right.toExp(this.args.env, this.args.inLoop, this.args.inFn),
      ],
    ), this)
  },
  ProductExp_mod(left, _mod, right) {
    return addLoc(new ArkCall(
      new ArkLiteral(intrinsics.get('%')),
      [
        left.toExp(this.args.env, this.args.inLoop, this.args.inFn),
        right.toExp(this.args.env, this.args.inLoop, this.args.inFn),
      ],
    ), this)
  },

  SumExp_plus(left, _plus, right) {
    return addLoc(new ArkCall(
      new ArkLiteral(intrinsics.get('+')),
      [
        left.toExp(this.args.env, this.args.inLoop, this.args.inFn),
        right.toExp(this.args.env, this.args.inLoop, this.args.inFn),
      ],
    ), this)
  },
  SumExp_minus(left, _minus, right) {
    return addLoc(new ArkCall(
      new ArkLiteral(intrinsics.get('-')),
      [
        left.toExp(this.args.env, this.args.inLoop, this.args.inFn),
        right.toExp(this.args.env, this.args.inLoop, this.args.inFn),
      ],
    ), this)
  },

  CompareExp_eq(left, _eq, right) {
    return addLoc(new ArkCall(
      new ArkLiteral(intrinsics.get('=')),
      [
        left.toExp(this.args.env, this.args.inLoop, this.args.inFn),
        right.toExp(this.args.env, this.args.inLoop, this.args.inFn),
      ],
    ), this)
  },
  CompareExp_neq(left, _neq, right) {
    return addLoc(new ArkCall(
      new ArkLiteral(intrinsics.get('!=')),
      [
        left.toExp(this.args.env, this.args.inLoop, this.args.inFn),
        right.toExp(this.args.env, this.args.inLoop, this.args.inFn),
      ],
    ), this)
  },
  CompareExp_lt(left, _lt, right) {
    return addLoc(new ArkCall(
      new ArkLiteral(intrinsics.get('<')),
      [
        left.toExp(this.args.env, this.args.inLoop, this.args.inFn),
        right.toExp(this.args.env, this.args.inLoop, this.args.inFn),
      ],
    ), this)
  },
  CompareExp_leq(left, _leq, right) {
    return addLoc(new ArkCall(
      new ArkLiteral(intrinsics.get('<=')),
      [
        left.toExp(this.args.env, this.args.inLoop, this.args.inFn),
        right.toExp(this.args.env, this.args.inLoop, this.args.inFn),
      ],
    ), this)
  },
  CompareExp_gt(left, _gt, right) {
    return addLoc(new ArkCall(
      new ArkLiteral(intrinsics.get('>')),
      [
        left.toExp(this.args.env, this.args.inLoop, this.args.inFn),
        right.toExp(this.args.env, this.args.inLoop, this.args.inFn),
      ],
    ), this)
  },
  CompareExp_geq(left, _geq, right) {
    return addLoc(new ArkCall(
      new ArkLiteral(intrinsics.get('>=')),
      [
        left.toExp(this.args.env, this.args.inLoop, this.args.inFn),
        right.toExp(this.args.env, this.args.inLoop, this.args.inFn),
      ],
    ), this)
  },

  BitwiseExp_and(left, _and, right) {
    return addLoc(new ArkCall(
      new ArkLiteral(intrinsics.get('&')),
      [
        left.toExp(this.args.env, this.args.inLoop, this.args.inFn),
        right.toExp(this.args.env, this.args.inLoop, this.args.inFn),
      ],
    ), this)
  },
  BitwiseExp_or(left, _or, right) {
    return addLoc(new ArkCall(
      new ArkLiteral(intrinsics.get('|')),
      [
        left.toExp(this.args.env, this.args.inLoop, this.args.inFn),
        right.toExp(this.args.env, this.args.inLoop, this.args.inFn),
      ],
    ), this)
  },
  BitwiseExp_xor(left, _xor, right) {
    return addLoc(new ArkCall(
      new ArkLiteral(intrinsics.get('^')),
      [
        left.toExp(this.args.env, this.args.inLoop, this.args.inFn),
        right.toExp(this.args.env, this.args.inLoop, this.args.inFn),
      ],
    ), this)
  },
  BitwiseExp_lshift(left, _lshift, right) {
    return addLoc(new ArkCall(
      new ArkLiteral(intrinsics.get('<<')),
      [
        left.toExp(this.args.env, this.args.inLoop, this.args.inFn),
        right.toExp(this.args.env, this.args.inLoop, this.args.inFn),
      ],
    ), this)
  },
  BitwiseExp_arshift(left, _arshift, right) {
    return addLoc(new ArkCall(
      new ArkLiteral(intrinsics.get('>>')),
      [
        left.toExp(this.args.env, this.args.inLoop, this.args.inFn),
        right.toExp(this.args.env, this.args.inLoop, this.args.inFn),
      ],
    ), this)
  },
  BitwiseExp_lrshift(left, _lrshift, right) {
    return addLoc(new ArkCall(
      new ArkLiteral(intrinsics.get('>>>')),
      [
        left.toExp(this.args.env, this.args.inLoop, this.args.inFn),
        right.toExp(this.args.env, this.args.inLoop, this.args.inFn),
      ],
    ), this)
  },

  LogicExp_and(left, _and, right) {
    return addLoc(
      new ArkAnd(
        left.toExp(this.args.env, this.args.inLoop, this.args.inFn),
        right.toExp(this.args.env, this.args.inLoop, this.args.inFn),
      ),
      this,
    )
  },
  LogicExp_or(left, _or, right) {
    return addLoc(
      new ArkOr(
        left.toExp(this.args.env, this.args.inLoop, this.args.inFn),
        right.toExp(this.args.env, this.args.inLoop, this.args.inFn),
      ),
      this,
    )
  },

  AssignmentExp_ass(lvalue, _ass, value) {
    const compiledLvalue = lvalue.toLval(this.args.env, this.args.inLoop, this.args.inFn)
    const compiledValue = value.toExp(this.args.env, this.args.inLoop, this.args.inFn)
    if (compiledLvalue instanceof ArkCall
      && compiledLvalue.fn instanceof ArkGet
      && compiledLvalue.fn.val instanceof ArkProperty
      && compiledLvalue.fn.val.prop === 'set') {
      compiledLvalue.args.push(compiledValue)
      return compiledLvalue
    }
    return addLoc(new ArkSet(compiledLvalue, compiledValue), this)
  },

  Exp_break(_break, exp) {
    if (!this.args.inLoop) {
      throw new UrsaCompilerError(_break.source, 'break used outside a loop')
    }
    return addLoc(new ArkBreak(
      maybeVal(this.args.env, exp, this.args.inFn),
    ), this)
  },
  Exp_continue(_continue) {
    if (!this.args.inLoop) {
      throw new UrsaCompilerError(_continue.source, 'continue used outside a loop')
    }
    return addLoc(new ArkContinue(), this)
  },
  Exp_return(_return, exp) {
    if (!this.args.inFn) {
      throw new UrsaCompilerError(_return.source, 'return used outside a function')
    }
    return addLoc(new ArkReturn(
      maybeVal(this.args.env, exp, this.args.inFn),
    ), this)
  },

  Lets(lets) {
    const parsedLets = []
    const letIds: string[] = []
    for (const l of (lets.asIteration().children)) {
      const parsedLet = l.toLet()
      parsedLets.push(parsedLet)
      if (letIds.includes(parsedLet.id.sourceString)) {
        throw new UrsaCompilerError(this.source, `Duplicate identifier in let: ${parsedLet.id.sourceString}`)
      }
      letIds.push(parsedLet.id.sourceString)
    }
    const assignments = parsedLets.map(
      (l) => new ArkSet(
        l.id.symref(this.args.env).value,
        l.node.toExp(this.args.env, this.args.inLoop, this.args.inFn),
      ),
    )
    const compiled = assignments.length > 1
      ? new ArkSequence(assignments)
      : assignments[0]
    return addLoc(compiled, this)
  },

  Use(_use, pathList) {
    const path = pathList.asIteration().children
    const ident = path[path.length - 1]
    // For path x.y.z, compile `let z = x.use(y.z)`
    const compiledUse = new ArkSequence([
      new ArkSet(
        ident.symref(this.args.env).value,
        new ArkCall(
          new ArkGet(addLoc(new ArkProperty('use', new ArkGet(path[0].symref(this.args.env).value)), this)),
          path.slice(1).map((id) => new ArkLiteral(ArkString(id.sourceString))),
        ),
      ),
    ])
    return addLoc(compiledUse, this)
  },

  Block(_open, seq, _close) {
    return addLoc(seq.toExp(this.args.env, this.args.inLoop, this.args.inFn), this)
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

  literalString(_open, _str, _close) {
    return addLoc(new ArkLiteral(ArkString(_str.sourceString)), this)
  },
})

semantics.addOperation<ArkExp>('toLval(env,inLoop,inFn)', {
  PrimaryExp_ident(_sym) {
    return addLoc(this.symref(this.args.env).value, this)
  },

  PropertyExp_index(object, _open, index, _close) {
    return indexExp(this, true, object, index)
  },
  PropertyExp_property(object, _dot, property) {
    return makeProperty(this.args, object, property)
  },

  CallExp_index(object, _open, index, _close) {
    return indexExp(this, true, object, index)
  },
  CallExp_property(exp, _dot, ident) {
    return makeProperty(this.args, exp, ident)
  },
})

function mergeBoundVars(children: Node[]): string[] {
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

  Fn(_fn, _open, _params, _maybeComma, _close, _body) {
    return []
  },

  Let(_let, ident, _eq, _val) {
    return [ident.sourceString]
  },

  Use(_use, pathList) {
    const path = pathList.asIteration().children
    const ident = path[path.length - 1]
    return [ident.sourceString]
  },
})

function mergeFreeVars(env: Environment, children: Node[]): FreeVars {
  const freeVars = new FreeVars()
  children.forEach((child) => freeVars.merge(child.freeVars(env)))
  return freeVars
}

semantics.addOperation<Map<string, unknown>>('freeVars(env)', {
  _terminal() {
    return new FreeVars()
  },
  _nonterminal(...children) {
    return mergeFreeVars(this.args.env, children)
  },
  _iter(...children) {
    return mergeFreeVars(this.args.env, children)
  },

  Sequence(exps, _sc) {
    const freeVars = new FreeVars()
    const boundVars: string[] = []
    exps.asIteration().children.forEach((exp) => {
      boundVars.push(...exp.boundVars)
      freeVars.merge(exp.freeVars(this.args.env.push(boundVars)))
    })
    boundVars.forEach((b: string) => freeVars.delete(b))
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

  Fn(_fn, _open, params, _maybeComma, _close, body) {
    const paramStrings = params.asIteration().children.map((x) => x.sourceString)
    const innerEnv = this.args.env.pushFrame([[...paramStrings], []])
    const freeVars = new FreeVars().merge(body.freeVars(innerEnv))
    paramStrings.forEach((p) => freeVars.delete(p))
    return freeVars
  },

  Lets(lets) {
    const letIds = lets.asIteration().children.map((x) => x.children[1].sourceString)
    const innerEnv = this.args.env.push(letIds)
    const freeVars = new FreeVars()
    for (const l of lets.asIteration().children) {
      freeVars.merge((l.children[3] as Node).freeVars(innerEnv))
    }
    for (const id of letIds) {
      freeVars.delete(id)
    }
    return freeVars
  },

  For(_for, ident, _of, iterator, body) {
    const forVar = ident.sourceString
    const innerEnv = this.args.env.push(['_for'])
    const loopEnv = innerEnv.push([forVar])
    const freeVars = new FreeVars().merge(iterator.freeVars(innerEnv))
      .merge(body.freeVars(loopEnv))
    freeVars.delete(forVar)
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
  const ast = semantics(matchResult) as UrsaOperations
  const compiled = ast.toExp(env, false, false)
  const freeVars = ast.freeVars(env)
  env.externalSyms.properties.forEach((_val, id) => freeVars.delete(id))
  return new PartialCompiledArk(compiled, freeVars, ast.boundVars)
}

export async function runWithTraceback(ark: ArkState, compiledVal: CompiledArk): Promise<ArkVal> {
  try {
    return await ark.run(compiledVal)
  } catch (e) {
    if (e instanceof ArkRuntimeError) {
      throw new UrsaRuntimeError(ark, e.sourceLoc as Interval, e.message)
    }
    throw e
  }
}
