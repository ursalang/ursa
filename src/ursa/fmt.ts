// Ursa compiler.
// © Reuben Thomas 2023
// Released under the GPL version 3, or (at your option) any later version.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import {debug} from '../ark/interpreter.js'
import grammar, {
  Node, NonterminalNode, IterationNode, UrsaSemantics,
  // eslint-disable-next-line import/extensions
} from '../grammar/ursa.ohm-bundle.js'

export type FormatterOperations = {
  fmt(a: FormatterArgs): Span
  hfmt(a: FormatterArgs): Span
}

export type FormatterArgs = {
  maxWidth: number
  indentString: string
  simpleExpDepth: number
}

type FormatterNode = Node<FormatterOperations>

type FormatterNonterminalNode = NonterminalNode<FormatterArgs, FormatterOperations>

type FormatterIterationNode = IterationNode<FormatterOperations>

// Specify precise type so semantics can be precisely type-checked.
// eslint-disable-next-line max-len
export const semantics: UrsaSemantics<FormatterNode, FormatterNonterminalNode, FormatterIterationNode, FormatterOperations> = grammar.createSemantics<FormatterNode, FormatterNonterminalNode, FormatterIterationNode, FormatterOperations>()

function addSeparator(addTrailing: boolean, spans: (Span | string)[], sep: Span): Span[] {
  const res = spans.map((span) => sep.copy().prepend(span))
  if (!addTrailing && spans.length > 0) {
    res[spans.length - 1].content.pop()
  }
  return res
}

function formatHIter(args: FormatterArgs, node: FormatterNonterminalNode): Span[] {
  return node.asIteration().children.map((child) => child.hfmt(args))
}

function formatIter(args: FormatterArgs, node: FormatterNonterminalNode): Span[] {
  return node.asIteration().children.map((child) => child.fmt(args))
}

export class Span {
  private indentString = ''

  constructor(public content: (string | Span)[], protected stringSep: string = '') { }

  prepend(span: Span | string) {
    this.content.unshift(span)
    return this
  }

  append(span: Span | string) {
    this.content.push(span)
    return this
  }

  copy(): Span {
    const res = []
    for (const elem of this.content) {
      if (typeof elem === 'string') {
        res.push(elem)
      } else {
        res.push(elem.copy())
      }
    }
    return new Span([...res], this.stringSep)
  }

  toString(): string {
    const indent = this.indentString ?? ''
    const res = this.content.map((elem) => elem.toString())
      .filter((s) => s !== '')
      .join(this.stringSep)
      .replaceAll(this.stringSep, this.stringSep + indent)
    return res === '' ? '' : indent + res
  }

  width(): number {
    return Math.max(...this.toString().split('\n').map((line) => line.length))
  }

  indent(indentString: string) {
    this.indentString = indentString
    return this
  }
}

function TightSpan(content: (string | Span)[]) {
  return new Span(content)
}

function HSpan(content: (string | Span)[]) {
  return new Span(content, ' ')
}

function VSpan(content: (string | Span)[]) {
  return new Span(content, '\n')
}

function hfmtDelimitedList(
  args: FormatterArgs,
  openDelim: string,
  closeDelim: string,
  separator: Span,
  listNode: FormatterNonterminalNode,
) {
  return TightSpan([
    openDelim,
    HSpan([...addSeparator(false, formatHIter(args, listNode), separator)]),
    closeDelim,
  ])
}

function depth(node: FormatterNode): number {
  if (/^[a-z]/.test(node.ctorName)) {
    return 0
  }
  return Math.max(
    ...node.children.map((node, _index, _array) => 1 + depth(node)),
  )
}

semantics.addOperation<Span>('hfmt(a)', {
  _terminal() {
    return TightSpan([this.sourceString])
  },
  _iter(...children) {
    return HSpan(children.map((child) => child.hfmt(this.args.a)))
  },

  identName(_start, _rest) {
    return TightSpan([this.sourceString])
  },

  Sequence(exps, _sc) {
    return HSpan(addSeparator(false, formatHIter(this.args.a, exps), TightSpan([';'])))
  },

  PrimaryExp_paren(_open, exp, _close) {
    return TightSpan(['(', HSpan([exp.hfmt(this.args.a)]), ')'])
  },

  Definition(ident, _equals, value) {
    return HSpan([ident.hfmt(this.args.a), '=', value.hfmt(this.args.a)])
  },

  List(_open, elems, _maybeComma, _close) {
    return hfmtDelimitedList(this.args.a, '[', ']', TightSpan([',']), elems)
  },

  Map(_open, elems, _maybeComma, _close) {
    return hfmtDelimitedList(this.args.a, '{', '}', TightSpan([',']), elems)
  },
  KeyValue(key, _colon, value) {
    return HSpan([TightSpan([key.hfmt(this.args.a), ':']), value.hfmt(this.args.a)])
  },

  Object(_open, elems, _maybeComma, _close) {
    return hfmtDelimitedList(this.args.a, '{', '}', TightSpan([';']), elems)
  },

  PropertyExp_property(object, _dot, property) {
    return TightSpan([object.hfmt(this.args.a), '.', property.hfmt(this.args.a)])
  },
  PropertyExp_index(object, _open, index, _close) {
    return TightSpan([object.hfmt(this.args.a), '[', index.hfmt(this.args.a), ']'])
  },

  CallExp_index(object, _open, index, _close) {
    return TightSpan([object.hfmt(this.args.a), '[', index.hfmt(this.args.a), ']'])
  },
  CallExp_property(exp, _dot, ident) {
    return TightSpan([exp.hfmt(this.args.a), '.', ident.hfmt(this.args.a)])
  },
  CallExp_call(exp, args) {
    return TightSpan([exp.hfmt(this.args.a), args.hfmt(this.args.a)])
  },
  CallExp_property_call(exp, args) {
    return TightSpan([exp.hfmt(this.args.a), args.hfmt(this.args.a)])
  },
  Arguments(_open, args, _maybeComma, _close) {
    return hfmtDelimitedList(this.args.a, '(', ')', TightSpan([',']), args)
  },

  Ifs(ifs, _else, elseBlock) {
    const formattedIfs = formatHIter(this.args.a, ifs)
    if (elseBlock.children.length > 0) {
      const formattedElse = elseBlock.children[0].hfmt(this.args.a)
      formattedIfs.push(formattedElse)
    }
    return HSpan(addSeparator(false, formattedIfs, HSpan(['else'])))
  },
  If(_if, cond, thenBlock) {
    return HSpan(['if', cond.hfmt(this.args.a), thenBlock.hfmt(this.args.a)])
  },

  Fn(_fn, _open, params, _maybeComma, _close, body) {
    return HSpan([
      TightSpan(['fn', hfmtDelimitedList(this.args.a, '(', ')', TightSpan([',']), params)]),
      body.hfmt(this.args.a),
    ])
  },

  Loop(_loop, body) {
    return HSpan(['loop', body.hfmt(this.args.a)])
  },

  For(_for, ident, _of, iterator, body) {
    return HSpan([
      'for',
      ident.hfmt(this.args.a),
      'of',
      iterator.hfmt(this.args.a),
      body.hfmt(this.args.a),
    ])
  },

  UnaryExp_not(_not, exp) {
    return HSpan(['not', exp.hfmt(this.args.a)])
  },
  UnaryExp_bitwise_not(_not, exp) {
    return TightSpan(['~', exp.hfmt(this.args.a)])
  },
  UnaryExp_pos(_plus, exp) {
    return TightSpan(['+', exp.hfmt(this.args.a)])
  },
  UnaryExp_neg(_neg, exp) {
    return TightSpan(['-', exp.hfmt(this.args.a)])
  },

  ExponentExp_power(left, _power, right) {
    return HSpan([left.hfmt(this.args.a), '**', right.hfmt(this.args.a)])
  },

  ProductExp_times(left, _times, right) {
    return HSpan([left.hfmt(this.args.a), '*', right.hfmt(this.args.a)])
  },
  ProductExp_divide(left, _divide, right) {
    return HSpan([left.hfmt(this.args.a), '/', right.hfmt(this.args.a)])
  },
  ProductExp_mod(left, _mod, right) {
    return HSpan([left.hfmt(this.args.a), '%', right.hfmt(this.args.a)])
  },

  SumExp_plus(left, _plus, right) {
    return HSpan([left.hfmt(this.args.a), '+', right.hfmt(this.args.a)])
  },
  SumExp_minus(left, _minus, right) {
    return HSpan([left.hfmt(this.args.a), '-', right.hfmt(this.args.a)])
  },

  CompareExp_eq(left, _eq, right) {
    return HSpan([left.hfmt(this.args.a), '==', right.hfmt(this.args.a)])
  },
  CompareExp_neq(left, _neq, right) {
    return HSpan([left.hfmt(this.args.a), '!=', right.hfmt(this.args.a)])
  },
  CompareExp_lt(left, _lt, right) {
    return HSpan([left.hfmt(this.args.a), '<', right.hfmt(this.args.a)])
  },
  CompareExp_leq(left, _leq, right) {
    return HSpan([left.hfmt(this.args.a), '<=', right.hfmt(this.args.a)])
  },
  CompareExp_gt(left, _gt, right) {
    return HSpan([left.hfmt(this.args.a), '>', right.hfmt(this.args.a)])
  },
  CompareExp_geq(left, _ge, right) {
    return HSpan([left.hfmt(this.args.a), '>=', right.hfmt(this.args.a)])
  },

  BitwiseExp_and(left, _and, right) {
    return HSpan([left.hfmt(this.args.a), '&', right.hfmt(this.args.a)])
  },
  BitwiseExp_or(left, _or, right) {
    return HSpan([left.hfmt(this.args.a), '|', right.hfmt(this.args.a)])
  },
  BitwiseExp_xor(left, _xor, right) {
    return HSpan([left.hfmt(this.args.a), '^', right.hfmt(this.args.a)])
  },
  BitwiseExp_lshift(left, _lshift, right) {
    return HSpan([left.hfmt(this.args.a), '<<', right.hfmt(this.args.a)])
  },
  BitwiseExp_arshift(left, _arshift, right) {
    return HSpan([left.hfmt(this.args.a), '>>', right.hfmt(this.args.a)])
  },
  BitwiseExp_lrshift(left, _lrshift, right) {
    return HSpan([left.hfmt(this.args.a), '>>>', right.hfmt(this.args.a)])
  },

  LogicExp_and(left, _and, right) {
    return HSpan([left.hfmt(this.args.a), 'and', right.hfmt(this.args.a)])
  },
  LogicExp_or(left, _or, right) {
    return HSpan([left.hfmt(this.args.a), 'or', right.hfmt(this.args.a)])
  },

  AssignmentExp_ass(lvalue, _ass, value) {
    return HSpan([lvalue.hfmt(this.args.a), ':=', value.hfmt(this.args.a)])
  },

  Exp_break(_break, exp) {
    const formattedBreak = HSpan(['break'])
    if (exp.children.length > 0) {
      formattedBreak.append(exp.children[0].hfmt(this.args.a))
    }
    return formattedBreak
  },
  Exp_continue(_continue) {
    return HSpan(['continue'])
  },
  Exp_return(_return, exp) {
    const formattedReturn = HSpan(['return'])
    if (exp.children.length > 0) {
      formattedReturn.append(exp.children[0].hfmt(this.args.a))
    }
    return formattedReturn
  },

  Lets(lets) {
    return HSpan(addSeparator(false, formatHIter(this.args.a, lets), HSpan(['and'])))
  },
  Let(_let, definition) {
    return HSpan(['let', definition.hfmt(this.args.a)])
  },

  Use(_use, pathList) {
    return HSpan([
      'use',
      TightSpan([...addSeparator(false, formatHIter(this.args.a, pathList), TightSpan(['.']))]),
    ])
  },

  Block(_open, seq, _close) {
    if (seq.children[0].asIteration().children.length === 1) {
      const exp = seq.children[0].asIteration().children[0]
      if (exp.ctorName === 'Exp' && depth(exp) < this.args.a.simpleExpDepth) {
        return TightSpan(['{', seq.hfmt(this.args.a), '}'])
      }
    }
    return VSpan([
      '{',
      VSpan([seq.fmt(this.args.a)]).indent(this.args.a.indentString),
      '}',
    ])
  },

  number(_) {
    return TightSpan([this.sourceString])
  },

  string(_open, _str, _close) {
    return TightSpan([this.sourceString])
  },

  literalString(_open, _str, _close) {
    return TightSpan([this.sourceString])
  },
})

// The first argument must be `this` from a Semantics operation, so it
// contains `.args`.
function hfmt(node: FormatterNonterminalNode) {
  const hRes = node.hfmt(node.args.a)
  if (hRes.width() > node.args.a.maxWidth) {
    return undefined
  }
  return hRes
}

function narrowed(args: FormatterArgs): FormatterArgs {
  return {...args, maxWidth: args.maxWidth - args.indentString.length}
}

function maybeVfmt(
  args: FormatterArgs,
  parentNode: FormatterNonterminalNode,
  callback: () => Span,
) {
  const hRes = hfmt(parentNode)
  if (hRes) {
    return hRes
  }
  const hvRes = callback()
  if (hvRes.width() <= args.maxWidth) {
    return hvRes
  }
  return VSpan(hvRes.content)
}

function vfmtDelimitedList(
  args: FormatterArgs,
  openDelim: string,
  closeDelim: string,
  separator: Span,
  parentNode: FormatterNonterminalNode,
  listNode: FormatterNonterminalNode,
) {
  return maybeVfmt(
    args,
    parentNode,
    () => TightSpan([
      openDelim,
      VSpan(
        addSeparator(true, formatIter(narrowed(args), listNode), separator),
      ).indent(args.indentString),
      closeDelim,
    ]),
  )
}

function fmtUnary(
  args: FormatterArgs,
  op: string,
  parentNode: FormatterNonterminalNode,
  node: FormatterNonterminalNode,
) {
  return hfmt(parentNode) ?? VSpan([TightSpan([op, '(']), node.fmt(args), ')'])
}

function fmtBinary(
  args: FormatterArgs,
  op: string,
  parentNode: FormatterNonterminalNode,
  left: FormatterNonterminalNode,
  right: FormatterNonterminalNode,
) {
  return hfmt(parentNode) ?? VSpan(['(', left.fmt(args), HSpan([op, right.fmt(args)]), ')'])
}

semantics.addOperation<Span>('fmt(a)', {
  _terminal() {
    return TightSpan([this.sourceString])
  },
  identName(_start, _rest) {
    return TightSpan([this.sourceString])
  },

  // Horizontal output of short sequences is handled by the Block rule.
  Sequence(exps, _sc) {
    return VSpan(formatIter(this.args.a, exps))
  },

  PrimaryExp_paren(_open, exp, _close) {
    return hfmt(this)
      ?? VSpan(['(', VSpan([exp.fmt(narrowed(this.args.a))]).indent(this.args.a.indentString), ')'])
  },

  Definition(ident, _colon, value) {
    return maybeVfmt(
      this.args.a,
      this,
      () => HSpan([HSpan([ident.fmt(this.args.a), '=']), value.fmt(this.args.a)]),
    )
  },

  List(_open, elems, _maybeComma, _close) {
    return vfmtDelimitedList(this.args.a, '[', ']', TightSpan([',']), this, elems)
  },

  Object(_open, elems, _maybeComma, _close) {
    return vfmtDelimitedList(this.args.a, '{', '}', TightSpan([';']), this, elems)
  },

  Map(_open, elems, _maybeComma, _close) {
    return vfmtDelimitedList(this.args.a, '{', '}', TightSpan([',']), this, elems)
  },
  KeyValue(key, _colon, value) {
    return hfmt(this) ?? VSpan([TightSpan([key.fmt(this.args.a), ':']), value.fmt(this.args.a)])
  },

  PropertyExp_property(object, _dot, property) {
    return hfmt(this) ?? VSpan([object.fmt(this.args.a), TightSpan(['.', property.fmt(this.args.a)])])
  },
  PropertyExp_index(object, _open, index, _close) {
    return hfmt(this) ?? VSpan([TightSpan([object.fmt(this.args.a), '[']), index.fmt(this.args.a), ']'])
  },

  CallExp_index(object, _open, index, _close) {
    return hfmt(this) ?? VSpan([TightSpan([object.fmt(this.args.a), '[']), index.fmt(this.args.a), ']'])
  },
  CallExp_property(exp, _dot, ident) {
    return hfmt(this) ?? VSpan([exp.fmt(this.args.a), TightSpan(['.', ident.fmt(this.args.a)])])
  },
  CallExp_call(exp, args) {
    return hfmt(this) ?? VSpan([exp.fmt(this.args.a), args.fmt(this.args.a)])
  },
  CallExp_property_call(exp, args) {
    return hfmt(this) ?? TightSpan([exp.fmt(this.args.a), args.fmt(this.args.a)])
  },
  Arguments(_open, args, _maybeComma, _close) {
    return vfmtDelimitedList(this.args.a, '(', ')', TightSpan([',']), this, args)
  },

  Ifs(ifs, _else, elseBlock) {
    const hRes = hfmt(this)
    if (hRes) {
      return hRes
    }
    const formattedIfs = formatIter(this.args.a, ifs)
    if (elseBlock.children.length > 0) {
      const formattedElse = elseBlock.children[0].fmt(this.args.a)
      formattedIfs.push(formattedElse)
    }
    return VSpan(addSeparator(false, formattedIfs, VSpan(['else'])))
  },
  If(_if, cond, thenBlock) {
    return hfmt(this) ?? VSpan(['if', cond.fmt(this.args.a), thenBlock.fmt(this.args.a)])
  },

  Fn(_fn, _open, params, _maybeComma, _close, body) {
    return hfmt(this) ?? VSpan([
      TightSpan(['fn', '(']),
      VSpan(addSeparator(
        true,
        formatIter(narrowed(this.args.a), params),
        TightSpan([',']),
      )).indent(this.args.a.indentString),
      ')',
      body.fmt(this.args.a),
    ])
  },

  Loop(_loop, body) {
    return hfmt(this) ?? VSpan(['loop', body.fmt(this.args.a)])
  },

  For(_for, ident, _of, iterator, body) {
    return hfmt(this)
      ?? VSpan([
        HSpan(['for', ident.fmt(this.args.a), 'of', iterator.fmt(this.args.a)]),
        VSpan([body.fmt(this.args.a)])])
  },

  UnaryExp_not(_not, exp) {
    return fmtUnary(this.args.a, 'not', this, exp)
  },
  UnaryExp_bitwise_not(_not, exp) {
    return fmtUnary(this.args.a, '~', this, exp)
  },
  UnaryExp_pos(_plus, exp) {
    return fmtUnary(this.args.a, '+', this, exp)
  },
  UnaryExp_neg(_neg, exp) {
    return fmtUnary(this.args.a, '-', this, exp)
  },

  ExponentExp_power(left, _power, right) {
    return fmtBinary(this.args.a, '**', this, left, right)
  },

  ProductExp_times(left, _times, right) {
    return fmtBinary(this.args.a, '*', this, left, right)
  },
  ProductExp_divide(left, _divide, right) {
    return fmtBinary(this.args.a, '/', this, left, right)
  },
  ProductExp_mod(left, _mod, right) {
    return fmtBinary(this.args.a, '%', this, left, right)
  },

  SumExp_plus(left, _plus, right) {
    return fmtBinary(this.args.a, '+', this, left, right)
  },
  SumExp_minus(left, _minus, right) {
    return fmtBinary(this.args.a, '-', this, left, right)
  },

  CompareExp_eq(left, _eq, right) {
    return fmtBinary(this.args.a, '=', this, left, right)
  },
  CompareExp_neq(left, _neq, right) {
    return fmtBinary(this.args.a, '!=', this, left, right)
  },
  CompareExp_lt(left, _lt, right) {
    return fmtBinary(this.args.a, '<', this, left, right)
  },
  CompareExp_leq(left, _leq, right) {
    return fmtBinary(this.args.a, '<=', this, left, right)
  },
  CompareExp_gt(left, _gt, right) {
    return fmtBinary(this.args.a, '>', this, left, right)
  },
  CompareExp_geq(left, _ge, right) {
    return fmtBinary(this.args.a, '>=', this, left, right)
  },

  BitwiseExp_and(left, _and, right) {
    return fmtBinary(this.args.a, '&', this, left, right)
  },
  BitwiseExp_or(left, _or, right) {
    return fmtBinary(this.args.a, '|', this, left, right)
  },
  BitwiseExp_xor(left, _xor, right) {
    return fmtBinary(this.args.a, '^', this, left, right)
  },
  BitwiseExp_lshift(left, _lshift, right) {
    return fmtBinary(this.args.a, '<<', this, left, right)
  },
  BitwiseExp_arshift(left, _arshift, right) {
    return fmtBinary(this.args.a, '>>', this, left, right)
  },
  BitwiseExp_lrshift(left, _lrshift, right) {
    return fmtBinary(this.args.a, '>>>', this, left, right)
  },

  LogicExp_and(left, _and, right) {
    return fmtBinary(this.args.a, 'and', this, left, right)
  },
  LogicExp_or(left, _or, right) {
    return fmtBinary(this.args.a, 'or', this, left, right)
  },

  AssignmentExp_ass(lvalue, _ass, value) {
    return hfmt(this) ?? VSpan([lvalue.fmt(this.args.a), ':=', value.fmt(this.args.a)])
  },

  Exp_break(_break, exp) {
    const hRes = hfmt(this)
    if (hRes) {
      return hRes
    }
    const formattedBreak = VSpan(['break'])
    if (exp.children.length > 0) {
      formattedBreak.append(exp.children[0].fmt(this.args.a))
    }
    return formattedBreak
  },
  Exp_continue(_continue) {
    return HSpan(['continue'])
  },
  Exp_return(_return, exp) {
    const hRes = hfmt(this)
    if (hRes) {
      return hRes
    }
    const formattedReturn = VSpan(['return'])
    if (exp.children.length > 0) {
      formattedReturn.append(exp.children[0].fmt(this.args.a))
    }
    return formattedReturn
  },

  Lets(lets) {
    return hfmt(this) ?? VSpan(addSeparator(false, formatIter(this.args.a, lets), VSpan(['and'])))
  },
  Let(_let, definition) {
    return hfmt(this) ?? VSpan(['let', definition.fmt(this.args.a)])
  },

  Use(_use, pathList) {
    return hfmt(this) ?? VSpan(['use', ...addSeparator(false, formatIter(this.args.a, pathList), TightSpan(['.']))])
  },

  Block(_open, seq, _close) {
    return hfmt(this) ?? VSpan(['{', VSpan([seq.fmt(this.args.a)]).indent(this.args.a.indentString), '}'])
  },

  number(_) {
    return hfmt(this) ?? VSpan([this.sourceString])
  },

  string(_open, _str, _close) {
    return hfmt(this) ?? VSpan([this.sourceString])
  },

  literalString(_open, _str, _close) {
    return hfmt(this) ?? VSpan([this.sourceString])
  },
})

export function format(
  expr: string,
  maxWidth: number = 80,
  indentString: string = '    ',
  simpleExpDepth: number = 0,
  startRule?: string,
): string {
  const matchResult = grammar.match(expr, startRule)
  if (matchResult.failed()) {
    throw new Error(matchResult.message)
  }
  const ast = semantics(matchResult)
  return `${ast.fmt({maxWidth, indentString, simpleExpDepth})}\n`
}
