// Ursa compiler.
// © Reuben Thomas 2023
// Released under the MIT license.

import {Node} from 'ohm-js'

// eslint-disable-next-line import/extensions
import grammar from '../grammar/ursa.ohm-bundle.js'
import {semantics} from './compiler.js'

function formatIter(args: FmtArgs, node: Node): string[] {
  return node.asIteration().children.map(
    (child) => (child.fmt as FmtAction)(args.indent, args.indentSize),
  )
}

function newlineAndIndent(indent: number): string {
  return `\n${' '.repeat(indent)}`
}

type FmtAction = (indent: number, indentSize: number) => string
type FmtArgs = {
  indent: number,
  indentSize: number,
}
semantics.addOperation<string>('fmt(indent, indentSize)', {
  _terminal() {
    return this.sourceString
  },
  identName(_start, _rest) {
    return this.sourceString
  },

  Sequence(exps, _sc) {
    return `${formatIter(this.args as FmtArgs, exps).join(`${newlineAndIndent((this.args as FmtArgs).indent)}`)}`
  },

  PrimaryExp_paren(_open, exp, _close) {
    return `(${(exp.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)})`
  },

  // FIXME: decide whether to put on more than one line
  List(_open, elems, _maybeComma, _close) {
    return `[${formatIter(this.args as FmtArgs, elems).join(', ')}]`
  },

  // FIXME: decide whether to put on more than one line
  Object(_open, elems, _maybeComma, _close) {
    return `{${formatIter(this.args as FmtArgs, elems).join(', ')}}`
  },
  PropertyValue(ident, _colon, value) {
    return `${(ident.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)} : ${(value.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}`
  },

  // FIXME: decide whether to put on more than one line
  Map(_open, elems, _maybeComma, _close) {
    return `{${formatIter(this.args as FmtArgs, elems).join(', ')}}`
  },
  KeyValue(key, _colon, value) {
    return `${(key.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)} : ${(value.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}`
  },

  PropertyExp_property(object, _dot, property) {
    return `${(object.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}.${(property.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}`
  },
  PropertyExp_index(object, _open, index, _close) {
    return `${(object.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}[${(index.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}]`
  },

  CallExp_index(object, _open, index, _close) {
    return `${(object.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}[${(index.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}]`
  },
  CallExp_property(exp, _dot, ident) {
    return `${(exp.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}.${(ident.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}`
  },
  CallExp_call(exp, args) {
    return `${(exp.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}(${(args.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)})`
  },
  CallExp_property_call(exp, args) {
    return `${(exp.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}(${(args.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)})`
  },
  // FIXME: decide whether to put on more than one line; if so, add commas
  Arguments(_open, args, _maybeComma, _close) {
    return `(${formatIter(this.args as FmtArgs, args).join(', ')})`
  },
  Ifs(ifs, _else, elseBlock) {
    const formattedIfs = formatIter(this.args as FmtArgs, ifs)
    if (elseBlock.children.length > 0) {
      formattedIfs.push('else', (elseBlock.children[0].fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize))
    }
    return formattedIfs.join(newlineAndIndent((this.args as FmtArgs).indent))
  },
  If(_if, cond, thenBlock) {
    return `if ${(cond.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)} ${(thenBlock.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}`
  },

  Fn(_fn, _open, params, _maybeComma, _close, body) {
    return `fn (${formatIter(this.args as FmtArgs, params).join(', ')}) ${(body.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}`
  },

  Loop(_loop, body) {
    return `loop ${(body.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}`
  },

  For(_for, ident, _of, iterator, body) {
    return `for ${(ident.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)} of ${(iterator.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)} ${(body.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}`
  },

  UnaryExp_not(_not, exp) {
    return `not ${(exp.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}`
  },
  UnaryExp_bitwise_not(_not, exp) {
    return `~${(exp.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}`
  },
  UnaryExp_pos(_plus, exp) {
    return `+${(exp.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}`
  },
  UnaryExp_neg(_neg, exp) {
    return `-${(exp.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}`
  },

  ExponentExp_power(left, _power, right) {
    return `${(left.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)} ** ${(right.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}`
  },

  ProductExp_times(left, _times, right) {
    return `${(left.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)} * ${(right.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}`
  },
  ProductExp_divide(left, _divide, right) {
    return `${(left.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)} / ${(right.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}`
  },
  ProductExp_mod(left, _mod, right) {
    return `${(left.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)} % ${(right.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}`
  },

  SumExp_plus(left, _plus, right) {
    return `${(left.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)} + ${(right.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}`
  },
  SumExp_minus(left, _minus, right) {
    return `${(left.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)} - ${(right.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}`
  },

  CompareExp_eq(left, _eq, right) {
    return `${(left.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)} == ${(right.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}`
  },
  CompareExp_neq(left, _neq, right) {
    return `${(left.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)} != ${(right.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}`
  },
  CompareExp_lt(left, _lt, right) {
    return `${(left.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)} < ${(right.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}`
  },
  CompareExp_leq(left, _leq, right) {
    return `${(left.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)} <= ${(right.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}`
  },
  CompareExp_gt(left, _gt, right) {
    return `${(left.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)} > ${(right.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}`
  },
  CompareExp_geq(left, _ge, right) {
    return `${(left.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)} >= ${(right.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}`
  },

  BitwiseExp_and(left, _and, right) {
    return `${(left.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)} & ${(right.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}`
  },
  BitwiseExp_or(left, _or, right) {
    return `${(left.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)} | ${(right.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}`
  },
  BitwiseExp_xor(left, _xor, right) {
    return `${(left.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)} ^ ${(right.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}`
  },
  BitwiseExp_lshift(left, _lshift, right) {
    return `${(left.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)} << ${(right.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}`
  },
  BitwiseExp_arshift(left, _arshift, right) {
    return `${(left.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)} >> ${(right.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}`
  },
  BitwiseExp_lrshift(left, _lrshift, right) {
    return `${(left.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)} >>> ${(right.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}`
  },

  LogicExp_and(left, _and, right) {
    return `${(left.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)} and ${(right.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}`
  },
  LogicExp_or(left, _or, right) {
    return `${(left.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)} or ${(right.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}`
  },

  AssignmentExp_ass(lvalue, _ass, value) {
    return `${(lvalue.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)} := ${(value.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}`
  },

  Exp_break(_break, exp) {
    const formattedBreak = ['break']
    if (exp.children.length > 0) {
      formattedBreak.push((exp.children[0].fmt as FmtAction)(
        (this.args as FmtArgs).indent,
        (this.args as FmtArgs).indentSize,
      ))
    }
    return formattedBreak.join(' ')
  },
  Exp_continue(_continue) {
    return 'continue'
  },
  Exp_return(_return, exp) {
    const formattedReturn = ['return']
    if (exp.children.length > 0) {
      formattedReturn.push((exp.children[0].fmt as FmtAction)(
        (this.args as FmtArgs).indent,
        (this.args as FmtArgs).indentSize,
      ))
    }
    return formattedReturn.join(' ')
  },

  Lets(lets) {
    return formatIter(this.args as FmtArgs, lets).join(' and ')
  },
  Let(_let, ident, _eq, val) {
    return `let ${(ident.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)} = ${(val.fmt as FmtAction)((this.args as FmtArgs).indent, (this.args as FmtArgs).indentSize)}`
  },

  Use(_use, pathList) {
    return `use ${formatIter(this.args as FmtArgs, pathList).join('.')}`
  },

  Block(_open, seq, _close) {
    const newIndent = (this.args as FmtArgs).indent + (this.args as FmtArgs).indentSize
    return `{${newlineAndIndent(newIndent)}${(seq.fmt as FmtAction)(newIndent, (this.args as FmtArgs).indentSize)}${newlineAndIndent((this.args as FmtArgs).indent)}}`
  },

  number(_) {
    return this.sourceString
  },

  string(_open, _str, _close) {
    return this.sourceString
  },

  literalString(_open, _str, _close) {
    return this.sourceString
  },
})

export function format(
  expr: string,
  indentSize: number = 4,
  startRule?: string,
): string {
  const matchResult = grammar.match(expr, startRule)
  if (matchResult.failed()) {
    throw new Error(matchResult.message)
  }
  const ast = semantics(matchResult)
  return `${(ast.fmt as FmtAction)(0, indentSize)}\n`
}
