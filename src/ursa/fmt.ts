// Ursa compiler.
// © Reuben Thomas 2023
// Released under the GPL version 3, or (at your option) any later version.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import {debug} from '../ark/interpreter.js'
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

// FIXME: put optional args in an options object
export class Span {
  constructor(protected content: SpanContent[], public stringSep = '', protected indentString = '') {}

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
    const res = this.content.map((elem) => elem.toString())
      .filter((s) => s !== '')
      .join(this.stringSep)
      .replaceAll(this.stringSep, this.stringSep + this.indentString)
    return res === '' ? '' : this.indentString + res
  }

  width(): number {
    return Math.max(...this.toString().split('\n').map((line) => line.length))
  }

  indent(indentString: string) {
    this.indentString = indentString
    return this
  }
}

class ListSpan extends Span {
  constructor(content: SpanContent[], private sep: string, private spanMaker: (content: SpanContent[]) => Span, stringSep?: string, indentString?: string, private addTrailingWhenVertical = false) {
    super(content, stringSep, indentString)
  }

  toString() {
    const newContent = []
    for (const span of this.content) {
      newContent.push(this.spanMaker([span, this.sep]))
    }
    if (this.content.length > 0 && !(this.addTrailingWhenVertical && this.stringSep === '\n')) {
      newContent.pop()
      newContent.push(this.content[this.content.length - 1])
    }
    return new Span(newContent, this.stringSep, this.indentString).toString()
  }
}

function tightSpan(content: SpanContent[]) {
  return new Span(content)
}

function hSpan(content: SpanContent[]) {
  return new Span(content, ' ')
}

function vSpan(content: SpanContent[]) {
  return new Span(content, '\n')
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

// Call tryFormats, adding an additional fallback that replaces the
// outermost Span of the vertical formatter's result, presumed to be
// horizontal, with a VSpan.
function tryFormatsExtraV(
  a: FormatterArgs,
  hFormatter: (a: FormatterArgs) => Span,
  vFormatters: ((a: FormatterArgs, span: Span) => Span)[],
) {
  return tryFormats(
    a,
    hFormatter,
    [
      ...vFormatters,
      (_a, span) => {
        span.stringSep = '\n'
        return span
      },
    ],
  )
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
  return tryFormatsExtraV(
    a,
    () => new Span([
      openDelim,
      new ListSpan(fmtIter(a, listNode), separator, spanMaker, ' '),
      closeDelim,
    ]),
    [() => new Span([
      openDelim,
      new ListSpan(fmtIter(narrowed(a), listNode), separator, spanMaker, '\n', a.indentString, true),
      closeDelim,
    ])],
  )
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
  return new ListSpan(formattedIfs, 'else', hSpan, '\n')
}

function fmtKeywordMaybeExp(
  a: FormatterArgs,
  keyword: string,
  exp: FormatterNonterminalNode,
): Span {
  if (exp.children.length > 0) {
    return hSpan([keyword, exp.children[0].fmt(a)])
  }
  return hSpan([keyword])
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

  Definition(ident, _colon, value) {
    return hSpan([ident.fmt(this.args.a), '=', value.fmt(this.args.a)])
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

  Object(_open, elems, _maybeComma, _close) {
    return fmtDelimitedList(this.args.a, '{', '}', ';', tightSpan, elems)
  },

  PropertyExp_property(object, _dot, property) {
    return tryFormats(
      this.args.a,
      (a) => new Span([object.fmt(a), '.', property.fmt(a)]),
      [(a) => vSpan([object.fmt(a), new Span(['.', property.fmt(a)])])],
    )
  },

  CallExp_property(exp, _dot, ident) {
    return tryFormats(
      this.args.a,
      (a) => new Span([exp.fmt(a), '.', ident.fmt(a)]),
      [(a) => vSpan([exp.fmt(a), new Span(['.', ident.fmt(a)])])],
    )
  },
  CallExp_call(exp, args) {
    return tryFormats(
      this.args.a,
      (a) => new Span([exp.fmt(a), args.fmt(a)]),
      [(a) => vSpan([exp.fmt(a), args.fmt(a)])],
    )
  },
  CallExp_property_call(exp, args) {
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

  Fn(_fn, _open, params, _maybeComma, _close, body) {
    return tryFormats(
      this.args.a,
      (a) => hSpan([
        new Span(['fn', fmtDelimitedList(a, '(', ')', ',', tightSpan, params)]),
        body.fmt(a),
      ]),
      [(a) => vSpan([
        new Span(['fn', fmtDelimitedList(a, '(', ')', ',', tightSpan, params)]),
        body.fmt(a),
      ])],
    )
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

  UnaryExp_not(_not, exp) {
    return fmtUnary(this.args.a, 'not', hSpan, exp)
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

  LogicExp_and(left, _and, right) {
    return fmtBinary(this.args.a, 'and', left, right)
  },
  LogicExp_or(left, _or, right) {
    return fmtBinary(this.args.a, 'or', left, right)
  },

  AssignmentExp_ass(lvalue, _ass, value) {
    return fmtBinary(this.args.a, ':=', lvalue, value)
  },

  Exp_break(_break, exp) {
    return tryFormats(
      this.args.a,
      (a) => fmtKeywordMaybeExp(a, 'break', exp),
      [(a) => fmtKeywordMaybeExp(a, 'break', exp)],
    )
  },
  Exp_continue(_continue) {
    return hSpan(['continue'])
  },
  Exp_return(_return, exp) {
    return tryFormats(
      this.args.a,
      (a) => fmtKeywordMaybeExp(a, 'return', exp),
      [(a) => fmtKeywordMaybeExp(a, 'return', exp)],
    )
  },

  Lets(lets) {
    return tryFormats(
      this.args.a,
      (a) => new ListSpan(fmtIter(a, lets), 'and', hSpan, ' '),
      [(a) => new ListSpan(fmtIter(a, lets), 'and', hSpan, ' ')],
    )
  },
  Let(_let, definition) {
    return tryFormats(
      this.args.a,
      (a) => hSpan(['let', definition.fmt(a)]),
      [(a) => vSpan(['let', definition.fmt(a)])],
    )
  },

  Use(_use, pathList) {
    return tryFormats(
      this.args.a,
      (a) => hSpan(['use', new ListSpan(fmtIter(a, pathList), '.', tightSpan)]),
      [(a) => vSpan(['use', new ListSpan(fmtIter(a, pathList), '.', tightSpan)])],
    )
  },

  Block(_open, seq, _close) {
    if (seq.children[0].asIteration().children.length === 1) {
      const exp = seq.children[0].asIteration().children[0]
      if (exp.ctorName === 'Exp' && depth(exp) < this.args.a.simpleExpDepth) {
        return new Span(['{', seq.fmt(this.args.a), '}'])
      }
    }
    return vSpan(['{', vSpan([seq.fmt(narrowed(this.args.a))]).indent(this.args.a.indentString), '}'])
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
