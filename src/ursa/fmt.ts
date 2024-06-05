// Ursa compiler.
// © Reuben Thomas 2023
// Released under the GPL version 3, or (at your option) any later version.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import {debug} from '../ark/eval.js'
import grammar, {
  Node, NonterminalNode, IterationNode, ThisNode,
  // eslint-disable-next-line import/extensions
} from '../grammar/ursa.ohm-bundle.js'

type FormatterOperations = {
  fmt(a: FormatterArgs): Span
}

type FormatterArgs = {
  maxWidth: number
  indentString: string
  simpleExpDepth: number
  horizontalOnly?: boolean
}

type FormatterNode = Node<FormatterOperations>
type FormatterNonterminalNode = NonterminalNode<FormatterOperations>
type FormatterIterationNode = IterationNode<FormatterOperations>
type FormatterThisNode = ThisNode<{a: FormatterArgs}, FormatterOperations>

// eslint-disable-next-line max-len
const semantics = grammar.createSemantics<FormatterNode, FormatterNonterminalNode, FormatterIterationNode, FormatterThisNode, FormatterOperations>()

function depth(node: FormatterNode): number {
  if (/^[a-z]/.test(node.ctorName)) {
    return 0
  }
  return Math.max(
    ...node.children.map((node, _index, _array) => 1 + depth(node)),
  )
}

type SpanContent = string | Span

function narrowed(a: FormatterArgs): FormatterArgs {
  return {...a, maxWidth: a.maxWidth - a.indentString.length}
}

export type SpanOpts = {
  stringSep: string
  indentString: string
}

export class Span {
  protected options: SpanOpts

  constructor(protected content: SpanContent[], options: Partial<SpanOpts> = {}) {
    this.options = {
      stringSep: '',
      indentString: '',
      ...options,
    }
  }

  toString(): string {
    const res = this.content.map((elem) => elem.toString())
      .filter((s) => s !== '')
      .join(this.options.stringSep)
      .replaceAll(this.options.stringSep, this.options.stringSep + this.options.indentString)
    return res === '' ? '' : this.options.indentString + res
  }

  width(): number {
    return Math.max(...this.toString().split('\n').map((line) => line.length))
  }

  indent(indentString: string) {
    this.options.indentString = indentString
    return this
  }
}

export type ListSpanOpts = {
  addTrailingWhenVertical?: boolean
}

class ListSpan extends Span {
  protected listOptions: ListSpanOpts

  constructor(
    content: SpanContent[],
    private sep: string,
    private spanMaker: (content: SpanContent[]) => Span,
    options: Partial<SpanOpts & ListSpanOpts> = {},
  ) {
    super(content, options)
    this.listOptions = {
      addTrailingWhenVertical: false,
      ...options,
    }
  }

  toString() {
    const newContent = []
    for (const span of this.content) {
      newContent.push(this.spanMaker([span, this.sep]))
    }
    if (this.content.length > 0 && !(this.listOptions.addTrailingWhenVertical && this.options.stringSep === '\n')) {
      newContent.pop()
      newContent.push(this.content[this.content.length - 1])
    }
    return new Span(newContent, this.options).toString()
  }
}

function tightSpan(content: SpanContent[]) {
  return new Span(content)
}

function hSpan(content: SpanContent[]) {
  return new Span(content, {stringSep: ' '})
}

function vSpan(content: SpanContent[]) {
  return new Span(content, {stringSep: '\n'})
}

function tryFormats(
  a: FormatterArgs,
  hFormatter: (a: FormatterArgs) => Span,
  vFormatters: ((a: FormatterArgs, span: Span) => Span)[],
): Span {
  let res = hFormatter({...a, horizontalOnly: true})
  const width = res.width()
  if (a.horizontalOnly || width <= a.maxWidth) {
    return res
  }
  for (const f of vFormatters) {
    res = f(a, res)
    const width = res.width()
    if (width <= a.maxWidth) {
      break
    }
  }
  return res
}

function fmtIter(a: FormatterArgs, node: FormatterNonterminalNode): Span[] {
  return node.asIteration().children.map((child) => child.fmt(a))
}

function fmtDelimitedList(
  a: FormatterArgs,
  openDelim: string,
  closeDelim: string,
  separator: string,
  spanMaker: (content: SpanContent[]) => Span,
  listNode: FormatterNonterminalNode,
) {
  return tryFormats(
    a,
    () => new Span([
      openDelim,
      new ListSpan(fmtIter(a, listNode), separator, spanMaker, {stringSep: ' '}),
      closeDelim,
    ]),
    [() => new Span([
      openDelim,
      new ListSpan(fmtIter(narrowed(a), listNode), separator, spanMaker, {stringSep: '\n', indentString: a.indentString, addTrailingWhenVertical: true}),
      closeDelim,
    ]),
    () => new Span([
      openDelim,
      new ListSpan(fmtIter(narrowed(a), listNode), separator, spanMaker, {stringSep: '\n', indentString: a.indentString, addTrailingWhenVertical: true}),
      closeDelim,
    ], {stringSep: '\n'})],
  )
}

function fmtIndented(
  a: FormatterArgs,
  listNode: FormatterNonterminalNode,
): Span {
  const narrowedA = narrowed(a)
  return vSpan(
    listNode.asIteration().children.map((child) => child.fmt(narrowedA)),
  ).indent(a.indentString)
}

function fmtUnary(
  a: FormatterArgs,
  op: string,
  spanMaker: (content: (string | Span)[]) => Span,
  node: FormatterNonterminalNode,
): Span {
  return tryFormats(
    a,
    () => spanMaker([op, node.fmt(a)]),
    [(a) => vSpan([new Span([op, '(']), node.fmt(narrowed(a)).indent(a.indentString), ')'])],
  )
}

function fmtBinary(
  a: FormatterArgs,
  op: string,
  left: FormatterNonterminalNode,
  right: FormatterNonterminalNode,
): Span {
  return tryFormats(
    a,
    () => hSpan([left.fmt(a), op, right.fmt(a)]),
    [(a) => vSpan([
      '(',
      vSpan([left.fmt(narrowed(a)), hSpan([op, right.fmt(narrowed(a))])]).indent(a.indentString),
      ')',
    ])],
  )
}

function fmtIfs(
  a: FormatterArgs,
  ifs: FormatterNonterminalNode,
  elseBlock: FormatterNonterminalNode,
): Span {
  const formattedIfs = ifs.asIteration().children.map((child) => child.fmt(a))
  if (elseBlock.children.length > 0) {
    const formattedElse = elseBlock.children[0].fmt(a)
    formattedIfs.push(formattedElse)
  }
  return new ListSpan(formattedIfs, 'else', hSpan, {stringSep: '\n'})
}

// Return list of 0 or 1 Spans.
function fmtOptional(a: FormatterArgs, maybeNode: FormatterNonterminalNode) {
  if (maybeNode.children.length > 0) {
    return [maybeNode.children[0].fmt(a)]
  }
  return []
}

function fmtMaybeType(
  a: FormatterArgs,
  innerSpans: SpanContent[],
  maybeType: FormatterIterationNode,
) {
  if (maybeType.children.length > 0) {
    innerSpans.push(':')
  }
  const outerSpans = [new Span(innerSpans)]
  if (maybeType.children.length > 0) {
    outerSpans.push(maybeType.children[0].children[1].fmt(a))
  }
  return outerSpans
}

semantics.addOperation<Span>('fmt(a)', {
  _terminal() {
    return new Span([this.sourceString])
  },
  identName(_start, _rest) {
    return new Span([this.sourceString])
  },

  // Horizontal output of short sequences is handled by the Block rule.
  Sequence(exps, _sc) {
    return vSpan(exps.asIteration().children.map((child) => child.fmt(this.args.a)))
  },

  PrimaryExp_paren(_open, exp, _close) {
    return tryFormats(
      this.args.a,
      (a) => new Span(['(', hSpan([exp.fmt(a)]), ')']),
      [(a) => vSpan(['(', vSpan([exp.fmt(narrowed(a))]).indent(a.indentString), ')'])],
    )
  },

  Definition(ident, initializer) {
    return hSpan([ident.fmt(this.args.a), initializer.fmt(this.args.a)])
  },
  Initializer(_equals, value) {
    return hSpan(['=', value.fmt(this.args.a)])
  },

  List(_open, elems, _maybeComma, _close) {
    return fmtDelimitedList(this.args.a, '[', ']', ',', tightSpan, elems)
  },

  Map(_open, elems, _maybeComma, _close) {
    return fmtDelimitedList(this.args.a, '{', '}', ',', tightSpan, elems)
  },
  KeyValue(key, _colon, value) {
    return tryFormats(
      this.args.a,
      (a) => hSpan([new Span([key.fmt(a), ':']), value.fmt(a)]),
      [(a) => vSpan([new Span([key.fmt(a), ':']), value.fmt(a)])],
    )
  },

  Object(type, _open, elems, _maybeComma, _close) {
    return hSpan([type.fmt(this.args.a), fmtDelimitedList(this.args.a, '{', '}', ';', tightSpan, elems)])
  },

  PostfixExp_property(exp, _dot, ident) {
    return tryFormats(
      this.args.a,
      (a) => new Span([exp.fmt(a), '.', ident.fmt(a)]),
      [(a) => vSpan([exp.fmt(a), new Span(['.', ident.fmt(a)])])],
    )
  },
  PostfixExp_call(exp, args) {
    return tryFormats(
      this.args.a,
      (a) => new Span([exp.fmt(a), args.fmt(a)]),
      [(a) => vSpan([exp.fmt(a), args.fmt(a)])],
    )
  },
  Arguments(_open, args, _maybeComma, _close) {
    return fmtDelimitedList(this.args.a, '(', ')', ',', tightSpan, args)
  },

  Ifs(ifs, _else, elseBlock) {
    return fmtIfs(this.args.a, ifs, elseBlock)
  },
  If(_if, cond, thenBlock) {
    return tryFormats(
      this.args.a,
      (a) => hSpan(['if', cond.fmt(a), thenBlock.fmt(a)]),
      [(a) => vSpan(['if', cond.fmt(a), thenBlock.fmt(a)])],
    )
  },

  Fn(type, body) {
    return tryFormats(
      this.args.a,
      (a) => hSpan([type.fmt(a), body.fmt(a)]),
      [(a) => vSpan([type.fmt(a), body.fmt(a)])],
    )
  },
  FnType(_fn, _open, params, _maybeComma, _close, maybeType) {
    return tryFormats(
      this.args.a,
      (a) => hSpan(fmtMaybeType(
        a,
        ['fn', fmtDelimitedList(a, '(', ')', ',', tightSpan, params)],
        maybeType,
      )),
      [(a) => vSpan(fmtMaybeType(
        a,
        ['fn', fmtDelimitedList(a, '(', ')', ',', tightSpan, params)],
        maybeType,
      )),
      ],
    )
  },
  Param(ident, maybeType) {
    return hSpan(fmtMaybeType(
      this.args.a,
      [ident.fmt(this.args.a)],
      maybeType,
    ))
  },

  Loop(_loop, body) {
    return hSpan(['loop', body.fmt(this.args.a)])
  },

  For(_for, ident, _of, iterator, body) {
    return tryFormats(
      this.args.a,
      (a) => hSpan(['for', ident.fmt(a), 'of', iterator.fmt(a), body.fmt(a)]),
      [(a) => vSpan([
        hSpan(['for', ident.fmt(a), 'of', iterator.fmt(a)]),
        vSpan([body.fmt(a)])])],
    )
  },

  UnaryExp_bitwise_not(_not, exp) {
    return fmtUnary(this.args.a, '~', tightSpan, exp)
  },
  UnaryExp_pos(_plus, exp) {
    return fmtUnary(this.args.a, '+', tightSpan, exp)
  },
  UnaryExp_neg(_neg, exp) {
    return fmtUnary(this.args.a, '-', tightSpan, exp)
  },

  ExponentExp_power(left, _power, right) {
    return fmtBinary(this.args.a, '**', left, right)
  },

  ProductExp_times(left, _times, right) {
    return fmtBinary(this.args.a, '*', left, right)
  },
  ProductExp_divide(left, _divide, right) {
    return fmtBinary(this.args.a, '/', left, right)
  },
  ProductExp_mod(left, _mod, right) {
    return fmtBinary(this.args.a, '%', left, right)
  },

  SumExp_plus(left, _plus, right) {
    return fmtBinary(this.args.a, '+', left, right)
  },
  SumExp_minus(left, _minus, right) {
    return fmtBinary(this.args.a, '-', left, right)
  },

  CompareExp_eq(left, _eq, right) {
    return fmtBinary(this.args.a, '==', left, right)
  },
  CompareExp_neq(left, _neq, right) {
    return fmtBinary(this.args.a, '!=', left, right)
  },
  CompareExp_lt(left, _lt, right) {
    return fmtBinary(this.args.a, '<', left, right)
  },
  CompareExp_leq(left, _leq, right) {
    return fmtBinary(this.args.a, '<=', left, right)
  },
  CompareExp_gt(left, _gt, right) {
    return fmtBinary(this.args.a, '>', left, right)
  },
  CompareExp_geq(left, _ge, right) {
    return fmtBinary(this.args.a, '>=', left, right)
  },

  BitwiseExp_and(left, _and, right) {
    return fmtBinary(this.args.a, '&', left, right)
  },
  BitwiseExp_or(left, _or, right) {
    return fmtBinary(this.args.a, '|', left, right)
  },
  BitwiseExp_xor(left, _xor, right) {
    return fmtBinary(this.args.a, '^', left, right)
  },
  BitwiseExp_lshift(left, _lshift, right) {
    return fmtBinary(this.args.a, '<<', left, right)
  },
  BitwiseExp_arshift(left, _arshift, right) {
    return fmtBinary(this.args.a, '>>', left, right)
  },
  BitwiseExp_lrshift(left, _lrshift, right) {
    return fmtBinary(this.args.a, '>>>', left, right)
  },

  LogicNotExp_not(_not, exp) {
    return fmtUnary(this.args.a, 'not', hSpan, exp)
  },

  LogicExp_and(left, _and, right) {
    return fmtBinary(this.args.a, 'and', left, right)
  },
  LogicExp_or(left, _or, right) {
    return fmtBinary(this.args.a, 'or', left, right)
  },

  Assignment_ass(lvalue, _ass, exp) {
    return fmtBinary(this.args.a, ':=', lvalue, exp)
  },

  Exp_await(_await, exp) {
    return tryFormats(
      this.args.a,
      (a) => hSpan(['await', exp.fmt(a)]),
      [(a) => hSpan(['await', exp.fmt(a)])],
    )
  },

  Statement_break(_break, exp) {
    return tryFormats(
      this.args.a,
      (a) => hSpan(['break', ...fmtOptional(a, exp)]),
      [(a) => hSpan(['break', ...fmtOptional(a, exp)])],
    )
  },
  Statement_continue(_continue) {
    return hSpan(['continue'])
  },
  Statement_launch(_await, exp) {
    return tryFormats(
      this.args.a,
      (a) => hSpan(['launch', exp.fmt(a)]),
      [(a) => hSpan(['launch', exp.fmt(a)])],
    )
  },
  Statement_return(_return, exp) {
    return tryFormats(
      this.args.a,
      (a) => hSpan(['return', ...fmtOptional(a, exp)]),
      [(a) => hSpan(['return', ...fmtOptional(a, exp)])],
    )
  },

  Lets(lets) {
    return tryFormats(
      this.args.a,
      (a) => new ListSpan(fmtIter(a, lets), 'and', hSpan, {stringSep: ' '}),
      [(a) => new ListSpan(fmtIter(a, lets), 'and', hSpan, {stringSep: ' '})],
    )
  },
  Let(_let, definition) {
    return tryFormats(
      this.args.a,
      (a) => hSpan(['let', definition.fmt(a)]),
      [(a) => vSpan(['let', definition.fmt(a)])],
    )
  },

  Use(_use, path) {
    return tryFormats(
      this.args.a,
      (a) => hSpan(['use', path.fmt(a)]),
      [(a) => vSpan(['use', path.fmt(a)])],
    )
  },

  Block(_open, seq, _close) {
    if (seq.children[0].asIteration().children.length === 1) {
      const exp = seq.children[0].asIteration().children[0]
      if (exp.ctorName === 'Exp' && depth(exp) < this.args.a.simpleExpDepth) {
        return new Span(['{', seq.fmt(this.args.a), '}'])
      }
    }
    return vSpan(['{', fmtIndented(this.args.a, seq.children[0]), '}'])
  },

  NamedType(path, maybeTypeArgs) {
    return hSpan([path.fmt(this.args.a), ...fmtOptional(this.args.a, maybeTypeArgs)])
  },
  Type_intersection(typeList) {
    return tryFormats(
      this.args.a,
      (a) => new ListSpan(fmtIter(a, typeList), '+', hSpan),
      [(a) => new ListSpan(fmtIter(a, typeList), '+', vSpan)],
    )
  },
  TypeParams(_open, params, _maybeCommaAngle, _close) {
    return fmtDelimitedList(this.args.a, '<', '>', ',', hSpan, params)
  },
  TypeParam(ident, maybeType) {
    return hSpan(fmtMaybeType(
      this.args.a,
      [ident.fmt(this.args.a)],
      maybeType,
    ))
  },
  TypeArgs(_open, args, _maybeComma, _close) {
    return fmtDelimitedList(this.args.a, '<', '>', ',', hSpan, args)
  },

  Class(_class, ident, typeParams, type, _open, members, _sc, _close) {
    return hSpan([
      'class',
      ident.fmt(this.args.a),
      new Span([typeParams.fmt(this.args.a), ':']),
      type.children[1].fmt(this.args.a),
      vSpan(['{', fmtIndented(this.args.a, members), '}']),
    ])
  },
  ClassField(maybePub, maybeStatic, maybeVar, ident, maybeType, maybeInit) {
    return hSpan([
      ...fmtOptional(this.args.a, maybePub),
      ...fmtOptional(this.args.a, maybeStatic),
      ...fmtOptional(this.args.a, maybeVar),
      ...fmtMaybeType(this.args.a, [ident.fmt(this.args.a)], maybeType),
      ...fmtOptional(this.args.a, maybeInit),
    ])
  },
  ClassMethod(maybePub, maybeStatic, ident, maybeTypeParams, _eq, fn) {
    return hSpan([
      ...fmtOptional(this.args.a, maybePub),
      ...fmtOptional(this.args.a, maybeStatic),
      ident.fmt(this.args.a),
      ...fmtOptional(this.args.a, maybeTypeParams),
      '=',
      fn.fmt(this.args.a),
    ])
  },

  Trait(_trait, ident, typeParams, type, _open, members, _sc, _close) {
    return hSpan([
      'trait',
      ident.fmt(this.args.a),
      typeParams.fmt(this.args.a),
      ':',
      type.children[1].fmt(this.args.a),
      vSpan(['{', fmtIndented(this.args.a, members), '}']),
    ])
  },
  TraitField(maybeVar, ident, type) {
    const spans = []
    if (maybeVar.children.length > 0) {
      spans.push('var')
    }
    return hSpan([...spans, ident.fmt(this.args.a), type.fmt(this.args.a)])
  },
  TraitMethod(ident, maybeTypeParams, fnType) {
    return hSpan([
      ident.fmt(this.args.a),
      new Span([hSpan(fmtOptional(this.args.a, maybeTypeParams)), ':']),
      fnType.fmt(this.args.a),
    ])
  },

  Path(pathList) {
    return new ListSpan(fmtIter(this.args.a, pathList), '.', tightSpan)
  },

  number(_) {
    return new Span([this.sourceString])
  },

  string(_open, _str, _close) {
    return new Span([this.sourceString])
  },

  literalString(_open, _str, _close) {
    return new Span([this.sourceString])
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
