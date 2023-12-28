// Ursa compiler.
// © Reuben Thomas 2023
// Released under the GPL version 3, or (at your option) any later version.

// eslint-disable-next-line import/extensions
import grammar, {Node, UrsaSemanticsArgs} from '../grammar/ursa.ohm-bundle.js'
import {semantics} from './compiler.js'

// FIXME: Format as tokens, then Exps in horizontal (wrapped) or vertical
// mode. Blocks & Sequences are always formatted vertically. For all other
// elements, get the length of the expression, compare to the line length
// (taking indentation into account), then if the line is too long, go into
// vertical mode for the current element, and recurse, trying to format each
// child as a horizontal element. Depending on the rule, position each
// formatted element appropriately.

function formatIter(args: UrsaSemanticsArgs, node: Node): string[] {
  return node.asIteration().children.map(
    (child) => (child as Node).fmt(args.indent, args.indentSize),
  )
}

function newlineAndIndent(indent: number): string {
  return `\n${' '.repeat(indent)}`
}

type FmtAction = (indent: number, indentSize: number) => string
semantics.addOperation<string>('fmt(indent, indentSize)', {
  _terminal() {
    return this.sourceString
  },
  identName(_start, _rest) {
    return this.sourceString
  },

  Sequence(exps, _sc) {
    return `${formatIter(this.args, exps).join(`${newlineAndIndent((this.args).indent)}`)}`
  },

  PrimaryExp_paren(_open, exp, _close) {
    return `(${(exp.fmt as FmtAction)(this.args.indent, (this.args).indentSize)})`
  },

  Definition(ident, _equals, value) {
    return `${(ident.fmt as FmtAction)((this.args).indent, (this.args).indentSize)} = ${(value.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}`
  },

  List(_open, elems, _maybeComma, _close) {
    return `[${formatIter(this.args, elems).join(', ')}]`
  },

  Map(_open, elems, _maybeComma, _close) {
    return `{${formatIter(this.args, elems).join(', ')}}`
  },
  KeyValue(key, _colon, value) {
    return `${(key.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}: ${(value.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}`
  },

  Object(_open, elems, _maybeComma, _close) {
    return `{${formatIter(this.args, elems).join(', ')}}`
  },

  PropertyExp_property(object, _dot, property) {
    return `${(object.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}.${(property.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}`
  },
  PropertyExp_index(object, _open, index, _close) {
    return `${(object.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}[${(index.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}]`
  },

  CallExp_index(object, _open, index, _close) {
    return `${(object.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}[${(index.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}]`
  },
  CallExp_property(exp, _dot, ident) {
    return `${(exp.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}.${(ident.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}`
  },
  CallExp_call(exp, args) {
    return `${(exp.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}${(args.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}`
  },
  CallExp_property_call(exp, args) {
    return `${(exp.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}${(args.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}`
  },
  Arguments(_open, args, _maybeComma, _close) {
    return `(${formatIter(this.args, args).join(', ')})`
  },

  Ifs(ifs, _else, elseBlock) {
    const formattedIfs = formatIter(this.args, ifs)
    if (elseBlock.children.length > 0) {
      const formattedElse = (elseBlock.children[0].fmt as FmtAction)(
        (this.args).indent,
        (this.args).indentSize,
      )
      formattedIfs.push(formattedElse)
    }
    return formattedIfs.join(' else ')
  },
  If(_if, cond, thenBlock) {
    return `if ${(cond.fmt as FmtAction)((this.args).indent, (this.args).indentSize)} ${(thenBlock.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}`
  },

  Fn(_fn, _open, params, _maybeComma, _close, body) {
    return `fn (${formatIter(this.args, params).join(', ')}) ${(body.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}`
  },

  Loop(_loop, body) {
    return `loop ${(body.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}`
  },

  For(_for, ident, _of, iterator, body) {
    return `for ${(ident.fmt as FmtAction)((this.args).indent, (this.args).indentSize)} of ${(iterator.fmt as FmtAction)((this.args).indent, (this.args).indentSize)} ${(body.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}`
  },

  UnaryExp_not(_not, exp) {
    return `not ${(exp.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}`
  },
  UnaryExp_bitwise_not(_not, exp) {
    return `~${(exp.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}`
  },
  UnaryExp_pos(_plus, exp) {
    return `+${(exp.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}`
  },
  UnaryExp_neg(_neg, exp) {
    return `-${(exp.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}`
  },

  ExponentExp_power(left, _power, right) {
    return `${(left.fmt as FmtAction)((this.args).indent, (this.args).indentSize)} ** ${(right.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}`
  },

  ProductExp_times(left, _times, right) {
    return `${(left.fmt as FmtAction)((this.args).indent, (this.args).indentSize)} * ${(right.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}`
  },
  ProductExp_divide(left, _divide, right) {
    return `${(left.fmt as FmtAction)((this.args).indent, (this.args).indentSize)} / ${(right.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}`
  },
  ProductExp_mod(left, _mod, right) {
    return `${(left.fmt as FmtAction)((this.args).indent, (this.args).indentSize)} % ${(right.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}`
  },

  SumExp_plus(left, _plus, right) {
    return `${(left.fmt as FmtAction)((this.args).indent, (this.args).indentSize)} + ${(right.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}`
  },
  SumExp_minus(left, _minus, right) {
    return `${(left.fmt as FmtAction)((this.args).indent, (this.args).indentSize)} - ${(right.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}`
  },

  CompareExp_eq(left, _eq, right) {
    return `${(left.fmt as FmtAction)((this.args).indent, (this.args).indentSize)} == ${(right.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}`
  },
  CompareExp_neq(left, _neq, right) {
    return `${(left.fmt as FmtAction)((this.args).indent, (this.args).indentSize)} != ${(right.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}`
  },
  CompareExp_lt(left, _lt, right) {
    return `${(left.fmt as FmtAction)((this.args).indent, (this.args).indentSize)} < ${(right.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}`
  },
  CompareExp_leq(left, _leq, right) {
    return `${(left.fmt as FmtAction)((this.args).indent, (this.args).indentSize)} <= ${(right.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}`
  },
  CompareExp_gt(left, _gt, right) {
    return `${(left.fmt as FmtAction)((this.args).indent, (this.args).indentSize)} > ${(right.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}`
  },
  CompareExp_geq(left, _ge, right) {
    return `${(left.fmt as FmtAction)((this.args).indent, (this.args).indentSize)} >= ${(right.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}`
  },

  BitwiseExp_and(left, _and, right) {
    return `${(left.fmt as FmtAction)((this.args).indent, (this.args).indentSize)} & ${(right.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}`
  },
  BitwiseExp_or(left, _or, right) {
    return `${(left.fmt as FmtAction)((this.args).indent, (this.args).indentSize)} | ${(right.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}`
  },
  BitwiseExp_xor(left, _xor, right) {
    return `${(left.fmt as FmtAction)((this.args).indent, (this.args).indentSize)} ^ ${(right.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}`
  },
  BitwiseExp_lshift(left, _lshift, right) {
    return `${(left.fmt as FmtAction)((this.args).indent, (this.args).indentSize)} << ${(right.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}`
  },
  BitwiseExp_arshift(left, _arshift, right) {
    return `${(left.fmt as FmtAction)((this.args).indent, (this.args).indentSize)} >> ${(right.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}`
  },
  BitwiseExp_lrshift(left, _lrshift, right) {
    return `${(left.fmt as FmtAction)((this.args).indent, (this.args).indentSize)} >>> ${(right.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}`
  },

  LogicExp_and(left, _and, right) {
    return `${(left.fmt as FmtAction)((this.args).indent, (this.args).indentSize)} and ${(right.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}`
  },
  LogicExp_or(left, _or, right) {
    return `${(left.fmt as FmtAction)((this.args).indent, (this.args).indentSize)} or ${(right.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}`
  },

  AssignmentExp_ass(lvalue, _ass, value) {
    return `${(lvalue.fmt as FmtAction)((this.args).indent, (this.args).indentSize)} := ${(value.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}`
  },

  Exp_break(_break, exp) {
    const formattedBreak = ['break']
    if (exp.children.length > 0) {
      formattedBreak.push((exp.children[0].fmt as FmtAction)(
        (this.args).indent,
        (this.args).indentSize,
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
        (this.args).indent,
        (this.args).indentSize,
      ))
    }
    return formattedReturn.join(' ')
  },

  Lets(lets) {
    return formatIter(this.args, lets).join(' and ')
  },
  Let(_let, definition) {
    return `let ${(definition.fmt as FmtAction)((this.args).indent, (this.args).indentSize)}`
  },

  Use(_use, pathList) {
    return `use ${formatIter(this.args, pathList).join('.')}`
  },

  Block(_open, seq, _close) {
    const newIndent = (this.args).indent + (this.args).indentSize
    return `{${newlineAndIndent(newIndent)}${(seq.fmt as FmtAction)(newIndent, (this.args).indentSize)}${newlineAndIndent((this.args).indent)}}`
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
