// Generate instruction lists from ArkExps.
// © Reuben Thomas 2024
// Released under the GPL version 3, or (at your option) any later version.

import assert from 'assert'
import {Interval} from 'ohm-js'

import {
  ArkAnd, ArkAwait, ArkBoolean, ArkBreak, ArkCall, ArkCapture, ArkContinue, ArkDebugInfo,
  ArkExp, ArkFn, ArkIf, ArkLaunch, ArkLet, ArkListLiteral, ArkLiteral,
  ArkLocal, ArkLoop, ArkMapLiteral, ArkNamedLoc, ArkNull,
  ArkObjectLiteral, ArkOr, ArkProperty, ArkReturn, ArkSequence, ArkSet, ArkVal,
} from './interpreter.js'

export class ArkInst {
  private static nextId = 0

  private static debugEnumerable = process.env.DEBUG_ARK !== undefined

  public next: ArkInst | undefined

  public readonly id: symbol

  debug = new ArkDebugInfo()

  constructor(public sourceLoc: Interval | undefined) {
    Object.defineProperty(this, 'debug', {enumerable: ArkInst.debugEnumerable})
    Object.defineProperty(this, 'sourceLoc', {enumerable: ArkInst.debugEnumerable})
    this.id = Symbol.for(`$${ArkInst.nextId}`)
    ArkInst.nextId += 1
  }
}

export class ArkInsts {
  constructor(public insts: ArkInst[]) {
    assert(insts.length > 0)
    for (let i = 0; i < insts.length - 1; i += 1) {
      insts[i].next = insts[i + 1]
    }
  }

  get id() {
    return this.insts[this.insts.length - 1].id
  }
}

export class ArkLiteralInst extends ArkInst {
  constructor(sourceLoc: Interval | undefined, public val: ArkVal = ArkNull()) {
    super(sourceLoc)
  }
}

export class ArkLetCopyInst extends ArkInst {
  constructor(sourceLoc: Interval | undefined, public argId: symbol) {
    super(sourceLoc)
  }
}

export class ArkBlockOpenInst extends ArkInst {
  public matchingClose!: ArkBlockCloseInst
}

export class ArkLoopBlockOpenInst extends ArkBlockOpenInst {
  constructor(sourceLoc: Interval | undefined, public localsDepth: number) {
    super(sourceLoc)
  }
}

export class ArkLaunchBlockOpenInst extends ArkBlockOpenInst {}

export class ArkIfBlockOpenInst extends ArkBlockOpenInst {
  constructor(sourceLoc: Interval | undefined, public condId: symbol) {
    super(sourceLoc)
  }
}

export class ArkFnBlockOpenInst extends ArkBlockOpenInst {
  constructor(
    sourceLoc: Interval | undefined,
    public params: string[],
    public capturedVars: ArkNamedLoc[],
    public name?: string,
  ) {
    super(sourceLoc)
  }
}

export class ArkLetBlockOpenInst extends ArkBlockOpenInst {
  constructor(sourceLoc: Interval | undefined, public vars: string[], public valIds: symbol[]) {
    super(sourceLoc)
  }
}

export class ArkBlockCloseInst extends ArkInst {
  public matchingOpen!: ArkBlockOpenInst

  constructor(sourceLoc: Interval | undefined, public blockId: symbol) {
    super(sourceLoc)
  }
}

export class ArkLetBlockCloseInst extends ArkBlockCloseInst {}

export class ArkElseBlockInst extends ArkBlockCloseInst {
  public matchingClose!: ArkBlockCloseInst

  constructor(sourceLoc: Interval | undefined, public ifBlockId: symbol, blockId: symbol) {
    super(sourceLoc, blockId)
  }
}
export class ArkElseBlockCloseInst extends ArkBlockCloseInst {}

export class ArkLoopBlockCloseInst extends ArkBlockCloseInst {}
export class ArkLaunchBlockCloseInst extends ArkBlockCloseInst {}
export class ArkFnBlockCloseInst extends ArkBlockCloseInst {}

function block(
  sourceLoc: Interval | undefined,
  bodyInsts: ArkInsts,
  openInst = new ArkBlockOpenInst(sourceLoc),
  closeInst = new ArkBlockCloseInst(sourceLoc, bodyInsts.id),
): ArkInsts {
  openInst.matchingClose = closeInst
  closeInst.matchingOpen = openInst
  return new ArkInsts([
    openInst,
    ...bodyInsts.insts,
    closeInst,
  ])
}

function ifElseBlock(
  sourceLoc: Interval | undefined,
  cond: ArkExp,
  thenExp: ArkExp,
  elseExp?: ArkExp,
  innerLoop?: ArkLoopBlockOpenInst,
  innerFn?: ArkFnBlockOpenInst,
): ArkInsts {
  const condInsts = flattenExp(cond, innerLoop, innerFn)
  const thenInsts = flattenExp(thenExp, innerLoop, innerFn)
  const ifOpenInst = new ArkIfBlockOpenInst(thenExp.sourceLoc, condInsts.id)
  const blockInsts = block(sourceLoc, thenInsts, ifOpenInst)
  const ifElseInsts = [...condInsts.insts, ...blockInsts.insts]
  if (elseExp !== undefined) {
    const elseInsts = flattenExp(elseExp, innerLoop, innerFn)
    const elseInst = new ArkElseBlockInst(
      elseExp.sourceLoc,
      thenInsts.id,
      elseInsts.id,
    )
    elseInst.matchingOpen = ifOpenInst
    const elseBlockInsts = block(
      elseExp.sourceLoc,
      elseInsts,
      elseInst,
      new ArkElseBlockCloseInst(elseExp.sourceLoc, elseInsts.id),
    )
    ifOpenInst.matchingClose = elseInst
    ifElseInsts.pop() // Remove original block close instruction
    ifElseInsts.push(
      ...elseBlockInsts.insts,
      new ArkLetCopyInst(elseExp.sourceLoc, elseInst.id),
    )
  }
  return new ArkInsts(ifElseInsts)
}

function loopBlock(
  sourceLoc: Interval | undefined,
  localsDepth: number,
  bodyExp: ArkExp,
  innerFn?: ArkFnBlockOpenInst,
): ArkInsts {
  const loopInst = new ArkLoopBlockOpenInst(sourceLoc, localsDepth)
  const bodyInsts = flattenExp(bodyExp, loopInst, innerFn)
  return block(
    sourceLoc,
    bodyInsts,
    loopInst,
    new ArkLoopBlockCloseInst(loopInst.sourceLoc, bodyInsts.id),
  )
}

export class ArkAwaitInst extends ArkInst {
  constructor(sourceLoc: Interval | undefined, public argId: symbol) {
    super(sourceLoc)
  }
}

export class ArkContinueInst extends ArkInst {
  constructor(
    sourceLoc: Interval | undefined,
    public loopInst: ArkLoopBlockOpenInst,
  ) {
    super(sourceLoc)
  }
}

export class ArkBreakInst extends ArkInst {
  constructor(
    sourceLoc: Interval | undefined,
    public argId: symbol,
    public loopInst: ArkLoopBlockOpenInst,
  ) {
    super(sourceLoc)
  }
}

export class ArkReturnInst extends ArkInst {
  constructor(
    sourceLoc: Interval | undefined,
    public argId: symbol,
    public fnInst: ArkFnBlockOpenInst,
  ) {
    super(sourceLoc)
  }
}

export class ArkCallInst extends ArkInst {
  constructor(
    sourceLoc: Interval | undefined,
    public fnId: symbol,
    public argIds: symbol[],
    public name?: string,
  ) {
    super(sourceLoc)
  }
}

export class ArkSetInst extends ArkInst {
  constructor(sourceLoc: Interval | undefined, public lexpId: symbol, public valId: symbol) {
    super(sourceLoc)
  }
}
export class ArkSetLocalInst extends ArkSetInst {
  constructor(
    sourceLoc: Interval | undefined,
    lexpId: symbol,
    public lexpIndex: number,
    valId: symbol,
  ) {
    super(sourceLoc, lexpId, valId)
  }
}
export class ArkSetCaptureInst extends ArkSetLocalInst {}

export class ArkSetPropertyInst extends ArkInst {
  constructor(
    sourceLoc: Interval | undefined,
    public lexpId: symbol,
    public prop: string,
    public valId: symbol,
  ) {
    super(sourceLoc)
  }
}

export class ArkObjectLiteralInst extends ArkInst {
  constructor(sourceLoc: Interval | undefined, public properties: Map<string, symbol>) {
    super(sourceLoc)
  }
}

export class ArkListLiteralInst extends ArkInst {
  constructor(sourceLoc: Interval | undefined, public valIds: symbol[]) {
    super(sourceLoc)
  }
}

export class ArkMapLiteralInst extends ArkInst {
  constructor(sourceLoc: Interval | undefined, public map: Map<symbol, symbol>) {
    super(sourceLoc)
  }
}

export class ArkLocalInst extends ArkInst {
  constructor(sourceLoc: Interval | undefined, public index: number, public name: string) {
    super(sourceLoc)
  }
}
export class ArkCaptureInst extends ArkLocalInst {}

export class ArkPropertyInst extends ArkInst {
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
    return block(
      exp.sourceLoc,
      insts,
      new ArkLaunchBlockOpenInst(exp.sourceLoc),
      new ArkLaunchBlockCloseInst(exp.sourceLoc, insts.id),
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
    if (innerLoop === undefined) {
      throw new Error('continue outside loop')
    }
    return new ArkInsts([new ArkContinueInst(exp.sourceLoc, innerLoop)])
  } else if (exp instanceof ArkReturn) {
    if (innerFn === undefined) {
      throw new Error('return outside function')
    }
    const insts = flattenExp(exp.exp, innerLoop, innerFn)
    return new ArkInsts([...insts.insts, new ArkReturnInst(exp.sourceLoc, insts.id, innerFn)])
  } else if (exp instanceof ArkFn) {
    const fnInst = new ArkFnBlockOpenInst(exp.sourceLoc, exp.params, exp.capturedVars, sym)
    const bodyInsts = flattenExp(exp.body, innerLoop, fnInst)
    bodyInsts.insts.push(new ArkReturnInst(exp.sourceLoc, bodyInsts.id, fnInst))
    return block(
      exp.sourceLoc,
      bodyInsts,
      fnInst,
      new ArkFnBlockCloseInst(exp.sourceLoc, bodyInsts.id),
    )
  } else if (exp instanceof ArkCall) {
    const argInsts = exp.args.map((exp) => flattenExp(exp, innerLoop, innerFn))
    const argIds = argInsts.map((insts) => insts.id)
    const fnInsts = flattenExp(exp.fn, innerLoop, innerFn)
    return new ArkInsts([
      ...argInsts.map((i) => i.insts).flat(),
      ...fnInsts.insts,
      new ArkCallInst(exp.fn.sourceLoc, fnInsts.id, argIds, exp.fn.debug.name),
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
    let SetInst
    if (exp.lexp instanceof ArkLocal) {
      SetInst = ArkSetLocalInst
    } else if (exp.lexp instanceof ArkCapture) {
      SetInst = ArkSetCaptureInst
    } else {
      throw new Error('bad ArkLvalue')
    }
    return new ArkInsts([
      ...insts.insts,
      new SetInst(exp.sourceLoc, Symbol.for(exp.lexp.debug.name!), exp.lexp.index, insts.id),
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
    const bvIds: symbol[] = []
    for (const bv of exp.boundVars) {
      const bvInsts = flattenExp(bv[2], innerLoop, innerFn, bv[0])
      insts.push(
        ...bvInsts.insts,
        new ArkSetLocalInst(exp.sourceLoc, Symbol.for(bv[0]), bv[1], bvInsts.id),
      )
      bvIds.push(bvInsts.id)
    }
    const bodyInsts = flattenExp(exp.body, innerLoop, innerFn)
    insts.push(...bodyInsts.insts)
    const blockInsts = new ArkInsts(insts)
    return block(
      exp.sourceLoc,
      blockInsts,
      new ArkLetBlockOpenInst(exp.sourceLoc, exp.boundVars.map((bv) => bv[0]), bvIds),
      new ArkLetBlockCloseInst(exp.sourceLoc, blockInsts.id),
    )
  } else if (exp instanceof ArkSequence) {
    if (exp.exps.length === 0) {
      return new ArkInsts([new ArkLiteralInst(exp.sourceLoc, ArkNull())])
    }
    const seqInsts = exp.exps.map((exp) => flattenExp(exp, innerLoop, innerFn))
    return new ArkInsts(seqInsts.map((insts) => insts.insts).flat())
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
      new ArkLiteral(ArkBoolean(true)),
      exp.right,
      innerLoop,
      innerFn,
    )
  } else if (exp instanceof ArkLoop) {
    return loopBlock(exp.sourceLoc, exp.localsDepth, exp.body, innerFn)
  } else if (exp instanceof ArkProperty) {
    const objInsts = flattenExp(exp.obj, innerLoop, innerFn)
    return new ArkInsts([
      ...objInsts.insts,
      new ArkPropertyInst(exp.sourceLoc, objInsts.id, exp.prop),
    ])
  } else if (exp instanceof ArkLocal) {
    return new ArkInsts([new ArkLocalInst(exp.sourceLoc, exp.index, exp.name)])
  } else if (exp instanceof ArkCapture) {
    return new ArkInsts([new ArkCaptureInst(exp.sourceLoc, exp.index, exp.name)])
  } else {
    throw new Error('invalid ArkExp')
  }
}
