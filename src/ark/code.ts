// Compiled Ark code.
// © Reuben Thomas 2023-2025
// Released under the MIT license.

import {Interval} from 'ohm-js'

import {Location} from './compiler-utils.js'
import {
  ArkNull, ArkVal, ArkObjectBase, ArkTypedId, NativeObject,
  ArkNullTraitType, ArkBooleanTraitType, ArkListTraitType, ArkMapTraitType,
  ArkObjectTraitType,
} from './data.js'
import {ArkCompilerError} from './error.js'
import {
  ArkType, ArkFnType, ArkAnyType, ArkUnknownType,
  ArkStructType, ArkMemberType, ArkInstantiatedType, ArkUnionType,
} from './type.js'
import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
} from './util.js'

export class ArkDebugInfo {
  uid: number | undefined

  name: string | undefined

  env: string | undefined
}

export abstract class ArkExp {
  static nextId = 0

  static debugEnumerable = process.env.DEBUG_ARK !== undefined

  // eslint-disable-next-line class-methods-use-this
  get type(): ArkType {
    return ArkUnknownType
  }

  constructor(public sourceLoc?: Interval) {
    Object.defineProperty(this, 'debug', {enumerable: ArkExp.debugEnumerable})
    Object.defineProperty(this, 'sourceLoc', {enumerable: ArkExp.debugEnumerable})
    this.debug.uid = ArkExp.nextId
    ArkExp.nextId += 1
  }

  debug = new ArkDebugInfo()
}

export class ArkLiteral extends ArkExp {
  get type() {
    return this.val.type
  }

  constructor(public val: ArkVal = ArkNull(), sourceLoc?: Interval) {
    super(sourceLoc)
  }
}

export class ArkGlobal extends ArkExp {
  get type() {
    return this._type
  }

  constructor(public name: string, public val: ArkVal, public _type: ArkType) {
    super()
  }
}

export class ArkLaunch extends ArkExp {
  get type() {
    return this.exp.type // FIXME: should be Operation<T>
  }

  constructor(public exp: ArkExp, sourceLoc?: Interval) {
    super(sourceLoc)
  }
}

export class ArkAwait extends ArkExp {
  get type() {
    return this.exp.type // FIXME: should be T where exp is Operation<T>
  }

  constructor(public exp: ArkExp, sourceLoc?: Interval) {
    super(sourceLoc)
  }
}

export class ArkBreak extends ArkExp {
  get type() {
    return this.exp.type
  }

  constructor(public exp: ArkExp = new ArkLiteral(ArkNull()), sourceLoc?: Interval) {
    super(sourceLoc)
  }
}

export class ArkContinue extends ArkExp {
  // eslint-disable-next-line class-methods-use-this
  get type() {
    return ArkNullTraitType
  }
}

export class ArkReturn extends ArkExp {
  get type() {
    return this.exp.type
  }

  constructor(public exp: ArkExp = new ArkLiteral(ArkNull()), sourceLoc?: Interval) {
    super(sourceLoc)
  }
}

export class ArkYield extends ArkReturn {}

export class ArkFn extends ArkExp {
  _type: ArkFnType

  get type() {
    return this._type
  }

  constructor(
    public params: ArkTypedId[],
    public returnType: ArkType,
    public capturedVars: ArkNamedLoc[],
    public body: ArkExp,
    sourceLoc?: Interval,
  ) {
    super(sourceLoc)
    this._type = new ArkFnType(false, params, returnType)
  }
}
export class ArkGenerator extends ArkFn {
  constructor(
    params: ArkTypedId[],
    returnType: ArkType,
    capturedVars: ArkNamedLoc[],
    body: ArkExp,
    sourceLoc?: Interval,
  ) {
    super(params, returnType, capturedVars, body, sourceLoc)
    this._type = new ArkFnType(
      false,
      this.type.params,
      // FIXME: function is variadic because on the first call it takes zero
      // arguments, and on subsequent calls one. We need different types!
      new ArkFnType(false, undefined, this.type.returnType),
    ) // FIXME return type
  }
}

export class ArkCall extends ArkExp {
  get type() {
    if (this.fn.type === ArkAnyType) {
      return ArkAnyType
    }
    if (this.fn.type instanceof ArkFnType) {
      if (this.fn.type.returnType === ArkAnyType) {
        return ArkAnyType
      } else {
        return this.fn.type.returnType
      }
    } else {
      return this.fn.type
    }
  }

  constructor(public fn: ArkExp, public args: ArkExp[], sourceLoc?: Interval) {
    super(sourceLoc)
  }
}

export class ArkInvoke extends ArkExp {
  get type() {
    const ty = this.obj.type
    if (typeof ty === 'string' || ty instanceof ArkFnType) {
      return ArkAnyType
    } else if (ty instanceof ArkInstantiatedType) {
      throw new ArkCompilerError('Implement generics: attempt to invoke on instantiated type!')
    } else if (ty instanceof ArkUnionType) {
      throw new ArkCompilerError('FIXME: implement ArkInvoke on unions')
    } else if (ty instanceof ArkStructType) {
      const method = ty.getMethod(this.prop)
      if (method === undefined) {
        throw new ArkCompilerError(`Invalid method \`${this.prop}'`, this.sourceLoc)
      }
      return method.type.returnType
    } else {
      const method = ty.getMethod(this.prop)
      if (method === undefined) {
        throw new ArkCompilerError(`Invalid method \`${this.prop}'`, this.sourceLoc)
      }
      return method.type.returnType
    }
  }

  constructor(
    public obj: ArkExp,
    public prop: string,
    public args: ArkExp[],
    sourceLoc?: Interval,
  ) {
    super(sourceLoc)
  }
}

export abstract class ArkLvalue extends ArkExp {}

export abstract class ArkNamedLoc extends ArkLvalue {
  get type() {
    return this.location.type
  }

  constructor(
    public index: number,
    public location: Location,
    sourceLoc?: Interval,
  ) {
    super(sourceLoc)
  }
}
export class ArkLocal extends ArkNamedLoc {}
export class ArkCapture extends ArkNamedLoc {}

export class ArkSet extends ArkExp {
  get type() {
    return this.exp.type
  }

  constructor(public lexp: ArkLvalue, public exp: ArkExp, sourceLoc?: Interval) {
    super(sourceLoc)
  }
}

export class ArkObjectLiteral extends ArkExp {
  _type: ArkType

  get type() {
    return this._type
  }

  constructor(public members: Map<string, ArkExp>, sourceLoc?: Interval) {
    super(sourceLoc)
    const memberTypes = new Map<string, ArkMemberType>()
    for (const [k, v] of members.entries()) {
      memberTypes.set(k, new ArkMemberType(v.type, true))
    }
    this._type = new ArkStructType(memberTypes, new Set([ArkObjectTraitType]))
  }
}

export class ArkProperty extends ArkLvalue {
  get type() {
    if (this.obj.type === ArkAnyType) {
      return ArkAnyType
    } else {
      let propVal: ArkVal | undefined
      if (this.obj instanceof NativeObject) {
        propVal = this.obj.get(this.prop)
      }
      if (propVal === undefined) {
        if (this.obj instanceof ArkGlobal && this.obj.val instanceof ArkObjectBase) {
          propVal = this.obj.val.members.get(this.prop)
          if (propVal === undefined) {
            throw new ArkCompilerError(`Invalid property \`${this.prop}'`, this.sourceLoc)
          }
          return propVal.type
        } else if (this.obj.type instanceof ArkStructType) {
          propVal = this.obj.type.members.get(this.prop)
          if (propVal === undefined) {
            throw new ArkCompilerError(`Invalid property \`${this.prop}'`, this.sourceLoc)
          }
          return propVal.type
        }
      }
      if (propVal === undefined) {
        return ArkAnyType
      }
    }
    return ArkUnknownType
  }

  constructor(public obj: ArkExp, public prop: string, sourceLoc?: Interval) {
    super(sourceLoc)
  }
}

export class ArkListLiteral extends ArkExp {
  // eslint-disable-next-line class-methods-use-this
  get type() {
    return ArkListTraitType // FIXME Generics
  }

  constructor(public list: ArkExp[], sourceLoc?: Interval) {
    super(sourceLoc)
  }
}

export class ArkMapLiteral extends ArkExp {
  // eslint-disable-next-line class-methods-use-this
  get type() {
    return ArkMapTraitType // FIXME Generics
  }

  constructor(public map: Map<ArkExp, ArkExp>, sourceLoc?: Interval) {
    super(sourceLoc)
  }
}

export class ArkBoundVar {
  constructor(
    public location: Location,
    public index: number,
    public init: ArkExp,
  ) {}
}

export class ArkLet extends ArkExp {
  get type() {
    return this.body.type
  }

  constructor(public boundVars: ArkBoundVar[], public body: ArkExp, sourceLoc?: Interval) {
    super(sourceLoc)
  }
}

export class ArkSequence extends ArkExp {
  get type() {
    const len = this.exps.length
    return len === 0 ? ArkNullTraitType : this.exps[this.exps.length - 1].type
  }

  constructor(public exps: ArkExp[], sourceLoc?: Interval) {
    super(sourceLoc)
  }
}

export class ArkIf extends ArkExp {
  get type() {
    return this.thenExp.type
  }

  constructor(
    public cond: ArkExp,
    public thenExp: ArkExp,
    public elseExp?: ArkExp,
    sourceLoc?: Interval,
  ) {
    super(sourceLoc)
  }
}

export class ArkAnd extends ArkExp {
  // eslint-disable-next-line class-methods-use-this
  get type() {
    return ArkBooleanTraitType
  }

  constructor(public left: ArkExp, public right: ArkExp, sourceLoc?: Interval) {
    super(sourceLoc)
  }
}

export class ArkOr extends ArkExp {
  // eslint-disable-next-line class-methods-use-this
  get type() {
    return ArkBooleanTraitType
  }

  constructor(public left: ArkExp, public right: ArkExp, sourceLoc?: Interval) {
    super(sourceLoc)
  }
}

export class ArkLoop extends ArkExp {
  get type() {
    return this.body.type
  }

  constructor(public body: ArkExp, public localsDepth: number, sourceLoc?: Interval) {
    super(sourceLoc)
  }
}
