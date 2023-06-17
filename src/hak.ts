import {IterationNode} from 'ohm-js'
import {
  AST, Val, Null, Bool, Num, Str, Sym, List, DictLiteral, Obj, Call, Let,
} from './haklisp'
import grammar, {HakSemantics} from './hak.ohm-bundle'

// Specify precise type so semantics can be precisely type-checked.
const semantics: HakSemantics = grammar.createSemantics()

class KeyValue extends AST {
  constructor(public key: Val, public val: Val) {
    super()
  }
}

function maybeValue(exp: IterationNode): Val {
  return exp.children.length > 0 ? exp.children[0].toAST() : new Null()
}

semantics.addOperation<AST>('toAST()', {
  If(_if, e_cond, e_then, _else, e_else) {
    const args: Val[] = [e_cond.toAST(), e_then.toAST()]
    if (e_else.children.length > 0) {
      args.push(e_else.children[0].toAST())
    }
    return new Call(new Sym('if'), args)
  },
  Fn(_fn, _open, params, _close, body) {
    return new Call(
      new Sym('fn'),
      [
        new List(params.asIteration().children.map((value, _i, _arr) => value.toAST())),
        body.toAST(),
      ],
    )
  },
  CallExp_call(exp, _open, args, _close) {
    return new Call(
      exp.toAST(),
      args.asIteration().children.map((value, _i, _arr) => value.toAST()),
    )
  },
  IndexExp_index(object, _open, index, _close) {
    return new Call(new Sym('prop'), [new Call(new Sym('quote'), [new Sym('get')]), object.toAST(), index.toAST()])
  },
  Loop(_loop, e_body) {
    return new Call(new Sym('loop'), [e_body.toAST()])
  },
  Let(_let, ident, _eq, value, body) {
    return new Let(new Obj(new Map([[ident.sourceString, value.toAST()]])), body.toAST())
  },
  Assignment_index(callExp, _open, index, _close, _eq, value) {
    return new Call(new Sym('prop'), [
      new Call(new Sym('quote'), [new Sym('set')]),
      callExp.toAST(),
      index.toAST(),
      value.toAST(),
    ])
  },
  Assignment_ident(sym, _eq, value) {
    return new Call(new Sym('set'), [new Call(new Sym('quote'), [new Sym(sym.sourceString)]), value.toAST()])
  },
  LogicExp_and(left, _and, right) {
    return new Call(new Sym('and'), [left.toAST(), right.toAST()])
  },
  LogicExp_or(left, _or, right) {
    return new Call(new Sym('or'), [left.toAST(), right.toAST()])
  },
  LogicExp_not(_not, exp) {
    return new Call(new Sym('not'), [exp.toAST()])
  },
  CompareExp_eq(left, _eq, right) {
    return new Call(new Sym('='), [left.toAST(), right.toAST()])
  },
  CompareExp_neq(left, _neq, right) {
    return new Call(new Sym('!='), [left.toAST(), right.toAST()])
  },
  CompareExp_lt(left, _le, right) {
    return new Call(new Sym('<'), [left.toAST(), right.toAST()])
  },
  CompareExp_leq(left, _leq, right) {
    return new Call(new Sym('<='), [left.toAST(), right.toAST()])
  },
  CompareExp_gt(left, _gt, right) {
    return new Call(new Sym('>'), [left.toAST(), right.toAST()])
  },
  CompareExp_geq(left, _geq, right) {
    return new Call(new Sym('>='), [left.toAST(), right.toAST()])
  },
  ArithmeticExp_plus(left, _plus, right) {
    return new Call(new Sym('+'), [left.toAST(), right.toAST()])
  },
  ArithmeticExp_minus(left, _minus, right) {
    return new Call(new Sym('-'), [left.toAST(), right.toAST()])
  },
  ProductExp_times(left, _times, right) {
    return new Call(new Sym('*'), [left.toAST(), right.toAST()])
  },
  ProductExp_divide(left, _divide, right) {
    return new Call(new Sym('/'), [left.toAST(), right.toAST()])
  },
  ProductExp_mod(left, _mod, right) {
    return new Call(new Sym('%'), [left.toAST(), right.toAST()])
  },
  ExponentExp_power(left, _power, right) {
    return new Call(new Sym('**'), [left.toAST(), right.toAST()])
  },
  PrimaryExp_paren(_open, exp, _close) {
    return exp.toAST()
  },
  Block(_open, seq, _close) {
    return maybeValue(seq)
  },
  List(_open, elems, _close) {
    return new List(elems.asIteration().children.map((value, _i, _arr) => value.toAST()))
  },
  Dict(_open, elems, _close) {
    const inits = new Map<Val, Val>()
    for (const elem of elems.asIteration().children.map((value, _i, _arr) => value.toAST())) {
      inits.set((elem as KeyValue).key, (elem as KeyValue).val)
    }
    return new DictLiteral(inits)
  },
  KeyValue(key, _colon, value) {
    return new KeyValue(key.toAST(), value.toAST())
  },
  UnaryExp_pos(_plus, exp) {
    return new Call(new Sym('pos'), [exp.toAST()])
  },
  UnaryExp_neg(_minus, exp) {
    return new Call(new Sym('neg'), [exp.toAST()])
  },
  PropertyExp_property(object, _dot, property) {
    return new Call(new Sym('prop'), [new Call(new Sym('quote'), [property.toAST()]), object.toAST()])
  },
  PrimaryExp_break(_break, exp) {
    return new Call(new Sym('break'), [maybeValue(exp)])
  },
  PrimaryExp_return(_return, exp) {
    return new Call(new Sym('return'), [maybeValue(exp)])
  },
  PrimaryExp_continue(_continue) {
    return new Call(new Sym('continue'), [])
  },
  PrimaryExp_null(_null) {
    return new Null()
  },
  Sequence(exp) {
    return exp.toAST()
  },
  Sequence_seq(e_first, _sep, e_rest, _maybe_sep) {
    return new Call(new Sym('seq'), [e_first.toAST(), e_rest.toAST()])
  },
  ident(_l, _ns) {
    return new Sym(this.sourceString)
  },
  bool(flag) {
    return new Bool(flag.sourceString === 'true')
  },
  number(_) {
    return new Num(parseFloat(this.sourceString))
  },
  string(_open, str, _close) {
    return new Str(str.sourceString)
  },
})

// eslint-disable-next-line import/prefer-default-export
export function toVal(expr: string): Val {
  const matchResult = grammar.match(expr)
  return semantics(matchResult).toAST()
}
