// Compiled Ark code.
// © Reuben Thomas 2023-2024
// Released under the MIT license.

import {Interval} from 'ohm-js'

import {
  ArkCallable, ArkNull, ArkVal,
} from './data.js'
import {type ArkState} from './interpreter.js'

export class ArkDebugInfo {
  uid: number | undefined

  name: string | undefined

  env: string | undefined
}

export abstract class ArkExp {
  static nextId = 0

  static debugEnumerable = process.env.DEBUG_ARK !== undefined

  constructor() {
    Object.defineProperty(this, 'debug', {enumerable: ArkExp.debugEnumerable})
    Object.defineProperty(this, 'sourceLoc', {enumerable: ArkExp.debugEnumerable})
    this.debug.uid = ArkExp.nextId
    ArkExp.nextId += 1
  }

  debug = new ArkDebugInfo()

  sourceLoc?: Interval
}

export class ArkLiteral extends ArkExp {
  constructor(public val: ArkVal = ArkNull()) {
    super()
  }
}

export class ArkLaunch extends ArkExp {
  constructor(public exp: ArkExp) {
    super()
  }
}

export class ArkAwait extends ArkExp {
  constructor(public exp: ArkExp) {
    super()
  }
}

export class ArkBreak extends ArkExp {
  constructor(public exp: ArkExp = new ArkLiteral(ArkNull())) {
    super()
  }
}

export class ArkContinue extends ArkExp {}

export class ArkReturn extends ArkExp {
  constructor(public exp: ArkExp = new ArkLiteral(ArkNull())) {
    super()
  }
}

export class ArkYield extends ArkReturn {}

export class ArkContinuation extends ArkCallable {
  public done = false

  constructor(public state: ArkState) {
    super(['x'])
  }
}

export class ArkFn extends ArkExp {
  constructor(public params: string[], public capturedVars: ArkCapture[], public body: ArkExp) {
    super()
  }
}
export class ArkGenerator extends ArkFn {}

export class ArkFnType {
  constructor(public Constructor: typeof ArkFn, public params: string[]) {}
}

export class ArkCall extends ArkExp {
  constructor(public fn: ArkExp, public args: ArkExp[]) {
    super()
  }
}

export class ArkInvoke extends ArkExp {
  constructor(public obj: ArkExp, public prop: string, public args: ArkExp[]) {
    super()
  }
}

export abstract class ArkLvalue extends ArkExp {}

export abstract class ArkNamedLoc extends ArkLvalue {
  constructor(public index: number, public name: string, public isVar: boolean) {
    super()
  }
}
export class ArkLocal extends ArkNamedLoc {}
export class ArkCapture extends ArkNamedLoc {}

export class ArkSet extends ArkExp {
  constructor(public lexp: ArkLvalue, public exp: ArkExp) {
    super()
  }
}

export class ArkObjectLiteral extends ArkExp {
  constructor(public properties: Map<string, ArkExp>) {
    super()
  }
}

export class ArkProperty extends ArkLvalue {
  constructor(public obj: ArkExp, public prop: string) {
    super()
  }
}

export class ArkListLiteral extends ArkExp {
  constructor(public list: ArkExp[]) {
    super()
  }
}

export class ArkMapLiteral extends ArkExp {
  constructor(public map: Map<ArkExp, ArkExp>) {
    super()
  }
}

export class ArkBoundVar {
  constructor(
    public name: string,
    public isVar: boolean,
    public index: number,
    public init: ArkExp,
  ) {}
}

export class ArkLet extends ArkExp {
  constructor(public boundVars: ArkBoundVar[], public body: ArkExp) {
    super()
  }
}

export class ArkSequence extends ArkExp {
  constructor(public exps: ArkExp[]) {
    super()
  }
}

export class ArkIf extends ArkExp {
  constructor(public cond: ArkExp, public thenExp: ArkExp, public elseExp?: ArkExp) {
    super()
  }
}

export class ArkAnd extends ArkExp {
  constructor(public left: ArkExp, public right: ArkExp) {
    super()
  }
}

export class ArkOr extends ArkExp {
  constructor(public left: ArkExp, public right: ArkExp) {
    super()
  }
}

export class ArkLoop extends ArkExp {
  constructor(public body: ArkExp, public localsDepth: number) {
    super()
  }
}
