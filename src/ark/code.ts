// Compiled Ark code.
// © Reuben Thomas 2023-2025
// Released under the MIT license.

import {Interval} from 'ohm-js'

import {AssertionError} from 'assert'
import {
  ArkCallable, ArkNull, ArkVal, ArkUndefinedVal,
  ArkObject, ArkList, ArkMap,
  ArkObjectBase, ArkTypedId,
} from './data.js'
import {ArkType, ArkFnType, ArkGenericType} from './type.js'
import {Class, debug} from './util.js'

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

  type: ArkType = ArkUndefinedVal
}

export class ArkLiteral extends ArkExp {
  constructor(public val: ArkVal = ArkNull()) {
    super()
    this.type = val.type
  }
}

export class ArkGlobal extends ArkExp {
  constructor(public name: string, public val: ArkVal, public type: ArkType) {
    super()
  }
}

export class ArkLaunch extends ArkExp {
  constructor(public exp: ArkExp) {
    super()
    this.type = exp.type // FIXME: should be Operation<T>
  }
}

export class ArkAwait extends ArkExp {
  constructor(public exp: ArkExp) {
    super()
    this.type = exp.type // FIXME: should be T where exp is Operation<T>
  }
}

export class ArkBreak extends ArkExp {
  constructor(public exp: ArkExp = new ArkLiteral(ArkNull())) {
    super()
    this.type = exp.type
  }
}

export class ArkContinue extends ArkExp {}

export class ArkReturn extends ArkExp {
  constructor(public exp: ArkExp = new ArkLiteral(ArkNull())) {
    super()
    this.type = exp.type
  }
}

export class ArkYield extends ArkReturn {}

export class ArkFn extends ArkExp {
  constructor(
    public params: ArkTypedId[],
    public returnType: ArkType,
    public capturedVars: ArkNamedLoc[],
    public body: ArkExp,
  ) {
    super()
    this.type = new ArkFnType(ArkCallable, params, returnType)
  }
}
export class ArkGenerator extends ArkFn {}

function isSubtypeOf(t: ArkType, u: ArkType) {
  if (t instanceof ArkGenericType) {
    if (!(u instanceof ArkGenericType)) {
      return false
    }
    throw new Error('FIXME: subtype relation for generics!')
  }

  // A non-generic type is not a subtype of any generic
  if (u instanceof ArkGenericType) {
    return false
  }

  // Subtype relation for unparametrized types.
  let ty = t
  for (; ;) {
    if (ty === u) {
      return true
    }
    if (ty === ArkVal) {
      break
    }
    ty = Object.getPrototypeOf(ty) as Class<ArkVal>
  }
  return false
}
export class ArkCall extends ArkExp {
  constructor(public fn: ArkExp, public args: ArkExp[]) {
    super()
    if (fn.type === ArkVal) {
      this.type = ArkVal
      return
    }
    if (!(fn.type instanceof ArkFnType)) {
      throw new Error('ArkCall.fn must be of type ArkFnType')
    }
    // FIXME: have a way to specify that arity is unknown
    if (fn.type.returnType === ArkVal) {
      this.type = ArkVal
      return
    }
    const paramTypes = fn.type.typeParameters
    if (paramTypes.length !== args.length) {
      debug(fn)
      throw new Error(`ArkCall.fn has ${paramTypes.length} parameters but ${args.length} arguments supplied`)
    }
    for (let i = 0; i < args.length; i += 1) {
      if (args[i].type !== paramTypes[i]) {
        throw new Error(`ArkCall.fn parameter ${i} does not match type of argument`) // FIXME: implement type → name
      }
    }
    this.type = fn.type.returnType
  }
}

export class ArkInvoke extends ArkExp {
  constructor(public obj: ArkExp, public prop: string, public args: ArkExp[]) {
    super()
  }
}

export abstract class ArkLvalue extends ArkExp {}

export abstract class ArkNamedLoc extends ArkLvalue {
  constructor(public index: number, public id: ArkTypedId, public isVar: boolean) {
    super()
    this.type = id.type
  }
}
export class ArkLocal extends ArkNamedLoc {}
export class ArkCapture extends ArkNamedLoc {}

export class ArkSet extends ArkExp {
  constructor(public lexp: ArkLvalue, public exp: ArkExp) {
    super()
    this.type = exp.type
  }
}

export class ArkObjectLiteral extends ArkExp {
  constructor(public properties: Map<string, ArkExp>) {
    super()
    this.type = ArkObject
  }
}

export class ArkProperty extends ArkLvalue {
  constructor(public obj: ArkExp, public prop: string) {
    super()
    if (obj.type === ArkVal) {
      this.type = ArkVal
    } else {
      if (!isSubtypeOf(obj.type, ArkObjectBase)) {
        // Using simple 'assert' here hangs the program!
        throw new AssertionError({message: 'bad object type'})
      }
      // eslint-disable-next-line max-len
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, max-len
      let propVal: ArkVal | undefined = ((obj.type as any).methods as Map<string, ArkCallable>).get(prop)
      if (propVal === undefined) {
        if (obj instanceof ArkGlobal && obj.val instanceof ArkObjectBase) {
          propVal = obj.val.properties.get(prop)
        }
        if (propVal === undefined) {
          throw new Error(`property ${prop} does not exist`) // FIXME: add name of object type
        }
      }
      this.type = propVal.type
    }
  }
}

export class ArkListLiteral extends ArkExp {
  constructor(public list: ArkExp[]) {
    super()
    this.type = ArkList // FIXME Generics
  }
}

export class ArkMapLiteral extends ArkExp {
  constructor(public map: Map<ArkExp, ArkExp>) {
    super()
    this.type = ArkMap // FIXME Generics
  }
}

export class ArkBoundVar {
  constructor(
    public name: string,
    public type: ArkType,
    public isVar: boolean,
    public index: number,
    public init: ArkExp,
  ) {}
}

export class ArkLet extends ArkExp {
  constructor(public boundVars: ArkBoundVar[], public body: ArkExp) {
    super()
    this.type = body.type
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
