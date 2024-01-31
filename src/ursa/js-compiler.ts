// Ursa compiler.
// © Reuben Thomas 2023-2024
// Released under the GPL version 3, or (at your option) any later version.

import grammar, {
  Node, NonterminalNode, IterationNode, ThisNode,
  // eslint-disable-next-line import/extensions
} from '../grammar/ursa.ohm-bundle.js'
import {UrsaCompilerError} from './compiler.js'
import {ArkCompilerError, checkParamList} from '../ark/compiler.js'

type ParserArgs = {
  inLoop?: boolean
  inFn?: boolean
}

type ParserOperations = {
  toExp(a: ParserArgs): string
  toDefinition(a: ParserArgs): [string, string]
}

type ParserNode = Node<ParserOperations>
type ParserNonterminalNode = NonterminalNode<ParserOperations>
type ParserIterationNode = IterationNode<ParserOperations>
type ParserThisNode = ThisNode<{a: ParserArgs}, ParserOperations>

function maybeVal(a: ParserArgs, exp: ParserIterationNode): string {
  return exp.children.length > 0
    ? exp.children[0].toExp(a)
    : 'null'
}

function makeInits(
  a: ParserArgs,
  elems: ParserNonterminalNode,
  open: string,
  sep: string,
  close: string,
) {
  return elems.asIteration().children.map((elem) => {
    const [prop, value] = elem.toDefinition(a)
    return `${open}${prop}${sep}${value}${close}`
  })
}

function makeIfChain(ifs: string[]): string {
  if (ifs.length > 1) {
    ifs[0] += ` else ${makeIfChain(ifs.slice(1))}`
  }
  return ifs[0]
}

// eslint-disable-next-line max-len
const semantics = grammar.createSemantics<ParserNode, ParserNonterminalNode, ParserIterationNode, ParserThisNode, ParserOperations>()

semantics.addOperation<[string, string]>('toDefinition(a)', {
  Definition(ident, _equals, value) {
    return [ident.sourceString, value.toExp(this.args.a)]
  },
})

semantics.addOperation<string>('toExp(a)', {
  Sequence(exps, _sc) {
    // FIXME: Add intermediate result variable.
    return exps.asIteration().children.map((exp) => exp.toExp(this.args.a)).join('; ')
  },

  PrimaryExp_ident(sym) {
    return sym.sourceString
  },
  PrimaryExp_paren(_open, exp, _close) {
    return `(${exp.toExp(this.args.a)})`
  },

  Definition(ident, _equals, value) {
    return `${ident.sourceString} = ${value.toExp(this.args.a)}`
  },

  List(_open, elems, _maybeComma, _close) {
    return `[${(elems.asIteration().children).map((x) => x.toExp(this.args.a)).join(', ')}]`
  },

  Map(_open, elems, _maybeComma, _close) {
    return `new Map([${makeInits(this.args.a, elems, '[', ', ', '],')}])`
  },
  KeyValue(key, _colon, value) {
    return `[${key.toExp(this.args.a)}, ${value.toExp(this.args.a)}]`
  },

  Object(_type, _open, elems, _maybeComma, _close) {
    // TODO: compile the type.
    return `{${makeInits(this.args.a, elems, '', ': ', ',')}}`
  },

  PropertyExp_property(object, _dot, property) {
    return `${object.toExp(this.args.a)}.${property.toExp(this.args.a)}`
  },

  CallExp_property(exp, _dot, ident) {
    return `${exp.toExp(this.args.a)}.${ident.sourceString}`
  },
  CallExp_call(exp, args) {
    return `${exp.toExp(this.args.a)}${args.toExp(this.args.a)}`
  },
  CallExp_property_call(exp, args) {
    return `${exp.toExp(this.args.a)}${args.toExp(this.args.a)}`
  },
  Arguments(_open, args, _maybeComma, _close) {
    const compiledArgs = args.asIteration().children.map((arg) => arg.toExp(this.args.a))
    return `(${compiledArgs.join(', ')})`
  },

  Ifs(ifs, _else, elseBlock) {
    const compiledIfs = (ifs.asIteration().children).map(
      (x) => x.toExp(this.args.a),
    )
    if (elseBlock.children.length > 0) {
      compiledIfs.push(elseBlock.children[0].toExp(this.args.a))
    }
    return makeIfChain(compiledIfs)
  },
  If(_if, cond, thenBlock) {
    return `if (${cond.toExp(this.args.a)}) ${thenBlock.toExp(this.args.a)}`
  },

  Fn(type, body) {
    const paramStrings = type.toExp(this.args.a)
    // TODO: Environment should contain typed params, not just strings
    const compiledBody = body.toExp({inLoop: false, inFn: true})
    // TODO: ArkFn should be an ArkObject which contains one method.
    return `(${paramStrings}) => ${compiledBody}`
  },
  FnType(_fn, _open, params, _maybeComma, _close, _maybeType) {
    const parsedParams = params.asIteration().children.map((p) => p.toExp(this.args.a))
    try {
      checkParamList(parsedParams)
    } catch (e) {
      if (!(e instanceof ArkCompilerError)) {
        throw e
      }
      throw new UrsaCompilerError(params.source, e.message)
    }
    // FIXME: Compile types.
    return parsedParams.join(', ')
  },
  Param(ident, _maybeType) {
    // FIXME: Compile types.
    return ident.sourceString
  },

  Loop(_loop, body) {
    return `for (;;) ${body.toExp(this.args.a)}`
  },

  For(_for, ident, _of, iterator, body) {
    return `for (var ${ident.sourceString} of ${iterator.toExp(this.args.a)}) ${body.toExp(this.args.a)}`
  },

  UnaryExp_bitwise_not(_not, exp) {
    return `~${exp.toExp(this.args.a)}`
  },
  UnaryExp_pos(_plus, exp) {
    return `+${exp.toExp(this.args.a)}`
  },
  UnaryExp_neg(_minus, exp) {
    return `-${exp.toExp(this.args.a)}`
  },

  ExponentExp_power(left, _power, right) {
    return `${left.toExp(this.args.a)} ** ${right.toExp(this.args.a)}`
  },

  ProductExp_times(left, _times, right) {
    return `${left.toExp(this.args.a)} * ${right.toExp(this.args.a)}`
  },
  ProductExp_divide(left, _divide, right) {
    return `${left.toExp(this.args.a)} / ${right.toExp(this.args.a)}`
  },
  ProductExp_mod(left, _mod, right) {
    return `${left.toExp(this.args.a)} % ${right.toExp(this.args.a)}`
  },

  SumExp_plus(left, _plus, right) {
    return `${left.toExp(this.args.a)} + ${right.toExp(this.args.a)}`
  },
  SumExp_minus(left, _minus, right) {
    return `${left.toExp(this.args.a)} - ${right.toExp(this.args.a)}`
  },

  CompareExp_eq(left, _eq, right) {
    return `${left.toExp(this.args.a)} === ${right.toExp(this.args.a)}`
  },
  CompareExp_neq(left, _neq, right) {
    return `${left.toExp(this.args.a)} !== ${right.toExp(this.args.a)}`
  },
  CompareExp_lt(left, _lt, right) {
    return `${left.toExp(this.args.a)} < ${right.toExp(this.args.a)}`
  },
  CompareExp_leq(left, _leq, right) {
    return `${left.toExp(this.args.a)} <= ${right.toExp(this.args.a)}`
  },
  CompareExp_gt(left, _gt, right) {
    return `${left.toExp(this.args.a)} > ${right.toExp(this.args.a)}`
  },
  CompareExp_geq(left, _geq, right) {
    return `${left.toExp(this.args.a)} >= ${right.toExp(this.args.a)}`
  },

  BitwiseExp_and(left, _and, right) {
    return `${left.toExp(this.args.a)} & ${right.toExp(this.args.a)}`
  },
  BitwiseExp_or(left, _or, right) {
    return `${left.toExp(this.args.a)} | ${right.toExp(this.args.a)}`
  },
  BitwiseExp_xor(left, _xor, right) {
    return `${left.toExp(this.args.a)} ^ ${right.toExp(this.args.a)}`
  },
  BitwiseExp_lshift(left, _lshift, right) {
    return `${left.toExp(this.args.a)} << ${right.toExp(this.args.a)}`
  },
  BitwiseExp_arshift(left, _arshift, right) {
    return `${left.toExp(this.args.a)} >> ${right.toExp(this.args.a)}`
  },
  BitwiseExp_lrshift(left, _lrshift, right) {
    return `${left.toExp(this.args.a)} >>> ${right.toExp(this.args.a)}`
  },

  LogicNotExp_not(_not, exp) {
    return `!${exp.toExp(this.args.a)}`
  },

  LogicExp_and(left, _and, right) {
    return `${left.toExp(this.args.a)} and ${right.toExp(this.args.a)}`
  },
  LogicExp_or(left, _or, right) {
    return `${left.toExp(this.args.a)} or ${right.toExp(this.args.a)}`
  },

  AssignmentExp_ass(lvalue, _ass, value) {
    return `${lvalue.toExp(this.args.a)} = ${value.toExp(this.args.a)}`
  },

  Exp_break(_break, _exp) {
    if (!this.args.a.inLoop) {
      throw new UrsaCompilerError(_break.source, 'break used outside a loop')
    }
    // FIXME: compile exp
    return 'break'
  },
  Exp_continue(_continue) {
    if (!this.args.a.inLoop) {
      throw new UrsaCompilerError(_continue.source, 'continue used outside a loop')
    }
    return 'continue'
  },
  Exp_return(_return, exp) {
    if (!this.args.a.inFn) {
      throw new UrsaCompilerError(_return.source, 'return used outside a function')
    }
    return `return ${maybeVal(this.args.a, exp)}`
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
    const parsedLets: [string, string][] = []
    for (const l of lets.asIteration().children) {
      const identValue = l.children[1].toDefinition(this.args.a)
      parsedLets.push(identValue)
    }
    return parsedLets.map(([ident, value]) => `let ${ident} = ${value}`).join('; ')
  },

  Use(_use, pathList) {
    const path = pathList.asIteration().children
    return `use ${path.map((elem) => elem.sourceString).join('.')}`
  },

  Block(_open, seq, _close) {
    return `{${seq.toExp(this.args.a)}}`
  },

  // This rule is not used for symbol references, but for property and
  // parameter names.
  ident(_ident) {
    return this.sourceString
  },

  null(_null) {
    return 'null'
  },

  bool(flag) {
    return flag.sourceString
  },

  number(_) {
    return this.sourceString
  },

  string(_open, _str, _close) {
    // FIXME: Parse string properly
    // eslint-disable-next-line no-eval
    return eval(this.sourceString) as string
  },

  literalString(_open, str, _close) {
    return str.sourceString
  },
})

export function compile(
  expr: string,
  startRule?: string,
): string {
  const matchResult = grammar.match(expr, startRule)
  if (matchResult.failed()) {
    throw new Error(matchResult.message)
  }
  const ast = semantics(matchResult)
  const args = {inLoop: false, inFn: false}
  return ast.toExp(args)
}
