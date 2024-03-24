// Generate instruction lists from ArkExps.
// © Reuben Thomas 2024
// Released under the GPL version 3, or (at your option) any later version.

import assert from 'assert'
import {Interval} from 'ohm-js'

import {
  ArkAnd, ArkAwait, ArkBoolean, ArkBreak, ArkCall, ArkContinue, ArkExp, ArkFn,
  ArkIf, ArkLaunch, ArkLet, ArkLexp, ArkListLiteral, ArkLiteral,
  ArkLoop, ArkMapLiteral, ArkNull,
  ArkObjectLiteral, ArkOr, ArkProperty, ArkReturn, ArkSequence, ArkSet, ArkVal,
} from './interpreter.js'

export class ArkInst {
  constructor(public sourceLoc: Interval | undefined) {}
}

export class ArkValInst extends ArkInst {
  constructor(sourceLoc: Interval | undefined, public id: symbol) {
    super(sourceLoc)
  }
}

export class ArkSymInst extends ArkValInst {
  static id = 0

  constructor(sourceLoc: Interval | undefined) {
    super(sourceLoc, Symbol(`$${ArkSymInst.id}`))
    ArkSymInst.id += 1
  }
}

export class ArkInsts {
  constructor(public insts: ArkInst[]) {
    assert(insts.length > 0)
  }

  get id() {
    return (this.insts[this.insts.length - 1] as ArkValInst).id
  }
}

export class ArkLiteralInst extends ArkSymInst {
  constructor(sourceLoc: Interval | undefined, public val: ArkVal = ArkNull()) {
    super(sourceLoc)
  }
}

export class ArkCopyInst extends ArkSymInst {
  constructor(sourceLoc: Interval | undefined, public src: symbol, public dest: string) {
    super(sourceLoc)
  }
}

export class ArkLetCopyInst extends ArkSymInst {
  constructor(sourceLoc: Interval | undefined, public argId: symbol) {
    super(sourceLoc)
  }
}

export class ArkBlockOpenInst extends ArkSymInst {
  public matchingClose?: ArkBlockCloseInst
}

export class ArkLoopBlockOpenInst extends ArkBlockOpenInst {}
export class ArkLaunchBlockOpenInst extends ArkBlockOpenInst {}

export class ArkElseBlockOpenInst extends ArkBlockOpenInst {
  constructor(sourceLoc: Interval | undefined, public skipAfterInst?: ArkInst) {
    super(sourceLoc)
  }
}

export class ArkIfBlockOpenInst extends ArkBlockOpenInst {
  constructor(
    sourceLoc: Interval | undefined,
    public condId: symbol,
    public skipAfterInst?: ArkInst,
  ) {
    super(sourceLoc)
  }
}

export class ArkFnBlockOpenInst extends ArkBlockOpenInst {
  constructor(
    sourceLoc: Interval | undefined,
    public params: string [],
    public capturedVars: ArkLexp[],
    public name?: string,
  ) {
    super(sourceLoc)
  }
}

export class ArkLetBlockOpenInst extends ArkBlockOpenInst {
  constructor(sourceLoc: Interval | undefined, public vars: string[]) {
    super(sourceLoc)
  }
}

export class ArkBlockCloseInst extends ArkValInst {
  public matchingOpen?: ArkBlockOpenInst

  constructor(sourceLoc: Interval | undefined, id: symbol, public blockId: symbol) {
    super(sourceLoc, id)
  }
}

export class ArkLaunchBlockCloseInst extends ArkBlockCloseInst {}
export class ArkFnBlockCloseInst extends ArkBlockCloseInst {}

export function block(
  sourceLoc: Interval | undefined,
  bodyInsts: ArkInsts,
  openInst = new ArkBlockOpenInst(sourceLoc),
  closeInst = new ArkBlockCloseInst(sourceLoc, openInst.id, bodyInsts.id),
): ArkInsts {
  openInst.matchingClose = closeInst
  closeInst.matchingOpen = openInst
  return new ArkInsts([
    openInst,
    ...bodyInsts.insts,
    new ArkLetCopyInst(sourceLoc, bodyInsts.id),
    closeInst,
  ])
}

export function ifElseBlock(
  sourceLoc: Interval | undefined,
  cond: ArkExp,
  thenExp?: ArkExp,
  elseExp?: ArkExp,
  innerLoop?: ArkLoopBlockOpenInst,
  innerFn?: ArkFnBlockOpenInst,
): ArkInsts {
  const condInsts = new ArkInsts(flattenExp(cond, innerLoop, innerFn).insts)
  const thenInsts = thenExp
    ? flattenExp(thenExp, innerLoop, innerFn)
    : new ArkInsts([new ArkLetCopyInst(cond.sourceLoc, condInsts.id)])
  let elseBlockInsts
  const ifOpenInst = new ArkIfBlockOpenInst(
    thenExp ? thenExp.sourceLoc : cond.sourceLoc,
    condInsts.id,
    thenInsts.insts.length > 0 ? thenInsts.insts[thenInsts.insts.length - 1] : undefined,
  )
  const blockInsts = block(sourceLoc, thenInsts, ifOpenInst)
  if (elseExp !== undefined) {
    const elseInsts = flattenExp(elseExp, innerLoop, innerFn)
    elseBlockInsts = block(
      elseExp.sourceLoc,
      elseInsts,
      new ArkElseBlockOpenInst(
        elseExp.sourceLoc,
        elseInsts.insts.length > 0 ? elseInsts.insts[elseInsts.insts.length - 1] : undefined,
      ),
      new ArkBlockCloseInst(elseExp.sourceLoc, ifOpenInst.id, elseInsts.id),
    )
  }
  const ifElseInsts = [...condInsts.insts, ...blockInsts.insts]
  if (elseBlockInsts !== undefined) {
    ifElseInsts.push(...elseBlockInsts.insts)
  }
  return new ArkInsts(ifElseInsts)
}

export function loopBlock(
  sourceLoc: Interval | undefined,
  bodyExp: ArkExp,
  innerFn?: ArkFnBlockOpenInst,
): ArkInsts {
  const loopInst = new ArkLoopBlockOpenInst(sourceLoc)
  return block(sourceLoc, flattenExp(bodyExp, loopInst, innerFn), loopInst)
}

export class ArkBinaryInst extends ArkSymInst {
  constructor(sourceLoc: Interval | undefined, public leftId: symbol, public rightId: symbol) {
    super(sourceLoc)
  }
}

export class ArkAwaitInst extends ArkLetCopyInst {}
export class ArkBreakInst extends ArkLetCopyInst {
  constructor(
    sourceLoc: Interval | undefined,
    argId: symbol,
    public loopInst: ArkLoopBlockOpenInst,
  ) {
    super(sourceLoc, argId)
  }
}
export class ArkReturnInst extends ArkLetCopyInst {
  constructor(
    sourceLoc: Interval | undefined,
    argId: symbol,
    public loopInst: ArkLoopBlockOpenInst,
  ) {
    super(sourceLoc, argId)
  }
}

export class ArkContinueInst extends ArkLiteralInst {}

export class ArkCallInst extends ArkSymInst {
  constructor(sourceLoc: Interval | undefined, public fnId: symbol, public argIds: symbol[]) {
    super(sourceLoc)
  }
}

export class ArkSetInst extends ArkSymInst {
  constructor(sourceLoc: Interval | undefined, public lexpId: string, public valId: symbol) {
    super(sourceLoc)
  }
}

export class ArkSetPropertyInst extends ArkSymInst {
  constructor(
    sourceLoc: Interval | undefined,
    public lexpId: symbol,
    public prop: string,
    public valId: symbol,
  ) {
    super(sourceLoc)
  }
}

export class ArkObjectLiteralInst extends ArkSymInst {
  constructor(sourceLoc: Interval | undefined, public properties: Map<string, symbol>) {
    super(sourceLoc)
  }
}

export class ArkListLiteralInst extends ArkSymInst {
  constructor(sourceLoc: Interval | undefined, public valIds: symbol[]) {
    super(sourceLoc)
  }
}

export class ArkMapLiteralInst extends ArkSymInst {
  constructor(sourceLoc: Interval | undefined, public map: Map<symbol, symbol>) {
    super(sourceLoc)
  }
}

export class ArkLexpInst extends ArkSymInst {
  constructor(sourceLoc: Interval | undefined, public lexp: ArkLexp) {
    super(sourceLoc)
  }
}

export class ArkPropertyInst extends ArkSymInst {
  constructor(sourceLoc: Interval | undefined, public objId: symbol, public prop: string) {
    super(sourceLoc)
  }
}

export function flattenExp(
  exp: ArkExp,
  innerLoop?: ArkLoopBlockOpenInst,
  innerFn?: ArkFnBlockOpenInst,
  sym?: string,
): ArkInsts {
  if (exp instanceof ArkLiteral) {
    return new ArkInsts([new ArkLiteralInst(exp.sourceLoc, exp.val)])
  } else if (exp instanceof ArkLaunch) {
    const insts = flattenExp(exp.exp, innerLoop, innerFn)
    const openInst = new ArkLaunchBlockOpenInst(exp.sourceLoc)
    return block(
      exp.sourceLoc,
      insts,
      openInst,
      new ArkLaunchBlockCloseInst(exp.sourceLoc, openInst.id, insts.id),
    )
  } else if (exp instanceof ArkAwait) {
    const insts = flattenExp(exp.exp, innerLoop, innerFn)
    return new ArkInsts([...insts.insts, new ArkAwaitInst(exp.sourceLoc, insts.id)])
  } else if (exp instanceof ArkBreak) {
    const insts = flattenExp(exp.exp, innerLoop, innerFn)
    if (innerLoop === undefined) {
      throw new Error('break outside loop')
    }
    return new ArkInsts([...insts.insts, new ArkBreakInst(exp.sourceLoc, insts.id, innerLoop)])
  } else if (exp instanceof ArkContinue) {
    return new ArkInsts([new ArkContinueInst(exp.sourceLoc)])
  } else if (exp instanceof ArkReturn) {
    if (innerFn === undefined) {
      throw new Error('return outside function')
    }
    const insts = flattenExp(exp.exp, innerLoop, innerFn)
    return new ArkInsts([...insts.insts, new ArkReturnInst(exp.sourceLoc, insts.id, innerFn)])
  } else if (exp instanceof ArkFn) {
    const fnInst = new ArkFnBlockOpenInst(exp.sourceLoc, exp.params, exp.capturedVars, sym)
    const bodyInsts = flattenExp(exp.body, innerLoop, fnInst)
    return block(
      exp.sourceLoc,
      bodyInsts,
      fnInst,
      new ArkFnBlockCloseInst(exp.sourceLoc, fnInst.id, bodyInsts.id),
    )
  } else if (exp instanceof ArkCall) {
    const argInsts = exp.args.map((exp) => flattenExp(exp, innerLoop, innerFn))
    const argIds = argInsts.map((insts) => insts.id)
    const fnInsts = flattenExp(exp.fn, innerLoop, innerFn)
    return new ArkInsts([
      ...argInsts.map((i) => i.insts).flat(),
      ...fnInsts.insts,
      new ArkCallInst(exp.fn.sourceLoc, fnInsts.id, argIds),
    ])
  } else if (exp instanceof ArkSet) {
    const insts = flattenExp(exp.exp, innerLoop, innerFn)
    if (exp.lexp instanceof ArkProperty) {
      const objInsts = flattenExp(exp.lexp.obj, innerLoop, innerFn)
      return new ArkInsts([
        ...objInsts.insts,
        ...insts.insts,
        new ArkSetPropertyInst(exp.lexp.sourceLoc, objInsts.id, exp.lexp.prop, insts.id),
      ])
    }
    return new ArkInsts([
      ...insts.insts,
      new ArkSetInst(exp.sourceLoc, exp.lexp.debug.name!, insts.id),
    ])
  } else if (exp instanceof ArkObjectLiteral) {
    const insts: ArkInst[] = []
    const valMap = new Map([...exp.properties.entries()].map(
      ([prop, exp]) => {
        const valInsts = flattenExp(exp, innerLoop, innerFn)
        insts.push(...valInsts.insts)
        return [prop, valInsts.id]
      },
    ))
    return new ArkInsts([...insts, new ArkObjectLiteralInst(exp.sourceLoc, valMap)])
  } else if (exp instanceof ArkListLiteral) {
    const valInsts = exp.list.map((v) => flattenExp(v, innerLoop, innerFn))
    const valIds = valInsts.map((insts) => insts.id)
    return new ArkInsts([
      ...valInsts.map((insts) => insts.insts).flat(),
      new ArkListLiteralInst(exp.sourceLoc, valIds),
    ])
  } else if (exp instanceof ArkMapLiteral) {
    const insts: ArkInst[] = []
    const valMap = new Map([...exp.map.entries()].map(
      ([key, val]) => {
        const keyInsts = flattenExp(key, innerLoop, innerFn)
        insts.push(...keyInsts.insts)
        const valInsts = flattenExp(val, innerLoop, innerFn)
        insts.push(...valInsts.insts)
        return [keyInsts.id, valInsts.id]
      },
    ))
    return new ArkInsts([...insts, new ArkMapLiteralInst(exp.sourceLoc, valMap)])
  } else if (exp instanceof ArkLet) {
    const insts: ArkInst[] = []
    exp.boundVars.forEach((bv) => {
      const bvInsts = flattenExp(bv[1], innerLoop, innerFn, bv[0])
      insts.push(...bvInsts.insts, new ArkCopyInst(exp.sourceLoc, bvInsts.id, bv[0]))
    })
    const bodyInsts = flattenExp(exp.body, innerLoop, innerFn)
    insts.push(...bodyInsts.insts)
    return block(
      exp.sourceLoc,
      new ArkInsts(insts),
      new ArkLetBlockOpenInst(exp.sourceLoc, exp.boundVars.map((bv) => bv[0])),
    )
  } else if (exp instanceof ArkSequence) {
    if (exp.exps.length === 0) {
      return new ArkInsts([new ArkLiteralInst(exp.sourceLoc, ArkNull())])
    }
    const seqInsts = exp.exps.map((exp) => flattenExp(exp, innerLoop, innerFn))
    const seqId = seqInsts[seqInsts.length - 1].id
    return new ArkInsts(
      [...seqInsts.map((insts) => insts.insts).flat(), new ArkLetCopyInst(exp.sourceLoc, seqId)],
    )
  } else if (exp instanceof ArkIf) {
    return ifElseBlock(exp.sourceLoc, exp.cond, exp.thenExp, exp.elseExp, innerLoop, innerFn)
  } else if (exp instanceof ArkAnd) {
    return ifElseBlock(
      exp.sourceLoc,
      exp.left,
      exp.right,
      new ArkLiteral(ArkBoolean(false)),
      innerLoop,
      innerFn,
    )
  } else if (exp instanceof ArkOr) {
    return ifElseBlock(
      exp.sourceLoc,
      exp.left,
      undefined,
      exp.right,
      innerLoop,
      innerFn,
    )
  } else if (exp instanceof ArkLoop) {
    return loopBlock(exp.sourceLoc, exp.body, innerFn)
  } else if (exp instanceof ArkProperty) {
    const objInsts = flattenExp(exp.obj, innerLoop, innerFn)
    return new ArkInsts([
      ...objInsts.insts,
      new ArkPropertyInst(exp.sourceLoc, objInsts.id, exp.prop),
    ])
  } else if (exp instanceof ArkLexp) {
    return new ArkInsts([new ArkLexpInst(exp.sourceLoc, exp)])
  } else {
    throw new Error('invalid ArkExp')
  }
}
