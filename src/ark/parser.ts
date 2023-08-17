import {Node} from 'ohm-js'
// eslint-disable-next-line import/extensions
import grammar, {ArkSemantics} from './ark.ohm-bundle.js'

import {
  Val, intrinsics,
  Null, Bool, Num, Str,
  List, Obj, Prop, DictLiteral,
  Fn, Fexpr, bindArgsToParams,
  Let, Ref, SymRef, Call, EnvironmentVal,
} from './interp.js'

// Specify precise type so semantics can be precisely type-checked.
const semantics: ArkSemantics = grammar.createSemantics()

// Base class for parsing the language, extended directly by classes used
// only during parsing.
export class AST {}

class KeyValue extends AST {
  constructor(public key: AST, public val: AST) {
    super()
  }
}

class PropertyValue extends AST {
  constructor(public key: string, public val: AST) {
    super()
  }
}

semantics.addOperation<AST>('toAST(env)', {
  Program(atoms) {
    if (atoms.children.length === 0) {
      return new Null()
    }
    return new Call(intrinsics.seq, atoms.children.map((value) => value.toAST(this.args.env)))
  },
  Atom_stmt(_open, stmt, _close) {
    return stmt.toAST(this.args.env)
  },
  Object(_open, elems, _close) {
    const inits: {[key: string]: any} = {}
    for (const elem of elems.children.map((value) => value.toAST(this.args.env))) {
      inits[(elem as PropertyValue).key] = (elem as PropertyValue).val as Val
    }
    return new Obj(inits)
  },
  PropertyValue(sym, _colon, val) {
    return new PropertyValue(sym.sourceString, val.toAST(this.args.env))
  },
  Stmt_call(exp, args) {
    return new Call(
      exp.toAST(this.args.env),
      args.children.map((value) => value.toAST(this.args.env)),
    )
  },
  Stmt_let(_let, params, body) {
    const paramList = params.toAST(this.args.env)
    const paramBinding = bindArgsToParams(paramList, [])
    return new Let(paramList, body.toAST(this.args.env.extend(paramBinding)))
  },
  Stmt_fn(_fn, params, body) {
    const paramList = params.toAST(this.args.env)
    const paramBinding = bindArgsToParams(paramList, [])
    return new Fn(
      paramList,
      this.freeVars,
      body.toAST(this.args.env.extend(paramBinding)),
    )
  },
  Stmt_fexpr(_fn, params, body) {
    const paramBinding = bindArgsToParams(params.toAST(this.args.env), [])
    return new Fexpr(
      params.toAST(this.args.env),
      this.freeVars,
      body.toAST(this.args.env.extend(paramBinding)),
    )
  },
  Stmt_ref(_quote, sym) {
    return new Ref(sym.toAST(this.args.env))
  },
  Stmt_prop(_prop, prop, ref, rest) {
    const propName = prop.sourceString
    const refVal = ref.toAST(this.args.env)
    return new Prop(
      propName,
      refVal,
      rest.children.map((value: Node) => value.toAST(this.args.env)),
    )
  },
  ParamList(_open, params, _close) {
    return params.children.map((name) => name.sourceString)
  },
  List(_open, elems, _close) {
    const inits: Val[] = []
    for (const elem of elems.children.map((value) => value.toAST(this.args.env))) {
      inits.push(elem)
    }
    return new List(inits)
  },
  Map(_open, elems, _close) {
    const inits = new Map<Val, Val>()
    for (const elem of elems.children.map((value) => value.toAST(this.args.env))) {
      inits.set((elem as KeyValue).key as Val, (elem as KeyValue).val as Val)
    }
    return new DictLiteral(inits)
  },
  KeyValue(key, _colon, value) {
    return new KeyValue(key.toAST(this.args.env), value.toAST(this.args.env))
  },
  Literal_null(_null) {
    return new Null()
  },
  symbol_alphanum(_l, _ns) {
    return new SymRef(this.args.env, this.sourceString)
  },
  symbol_punct(_p) {
    return new SymRef(this.args.env, this.sourceString)
  },
  bool(flag) {
    return new Bool(flag.sourceString === 'true')
  },
  number(_) {
    return new Num(parseFloat(this.sourceString))
  },
  string(_open, _str, _close) {
    // FIXME: Parse string properly
    // eslint-disable-next-line no-eval
    return new Str(eval(this.sourceString))
  },
})

export function mergeFreeVars(children: Node[]): Set<string> {
  return new Set<string>(children.flatMap((child) => [...child.freeVars]))
}

export function setDifference<T>(setA: Set<T>, setB: Set<T>) {
  const difference = new Set(setA)
  for (const elem of setB) {
    difference.delete(elem)
  }
  return difference
}

semantics.addAttribute<Set<string>>('freeVars', {
  _terminal() {
    return new Set()
  },
  _nonterminal(...children) {
    return mergeFreeVars(children)
  },
  _iter(...children) {
    return mergeFreeVars(children)
  },
  Stmt_let(_let, binding, body) {
    return setDifference(body.freeVars, binding.freeVars)
  },
  Stmt_fn(_fn, params, body) {
    return setDifference(body.freeVars, params.freeVars)
  },
  Stmt_prop(_prop, _propName, ref, rest) {
    return mergeFreeVars([ref, rest])
  },
  symbol_alphanum(_l, _ns) {
    return new Set<string>([this.sourceString])
  },
  symbol_punct(_p) {
    return new Set([this.sourceString])
  },
})

export function toVal(expr: string): Val {
  const matchResult = grammar.match(expr)
  if (matchResult.failed()) {
    throw new Error(matchResult.message)
  }
  return semantics(matchResult).toAST(new EnvironmentVal([]))
}
