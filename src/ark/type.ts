// Ark types.
// © Reuben Thomas 2025
// Released under the MIT license.

import {
  type ArkObject, type ArkCallable, type ArkTypedId, type ArkVal,
} from './data.js'
import {Class} from './util.js'

// FIXME: Make this a class so it can have an isSubtypeOf method
export type ArkType = Class<ArkVal> | ArkObject | ArkGenericType

export class ArkGenericType {
  constructor(
    public Constructor: Class<ArkVal>,
    public typeParameters: ArkType[] = [],
    // TODO: public traits
  ) {}
}

// export class ArkFieldType extends ArkType {
//   constructor(public isVar: boolean, public type: ArkType) {
//   super()
//   }
// }

export class ArkFnType extends ArkGenericType {
  constructor(
    public Constructor: Class<ArkCallable>,
    public params: ArkTypedId[] | undefined,
    public returnType: ArkType,
  ) {
    super(Constructor, (params ?? []).map((p) => p.type))
  }
}

export class ArkUnionType extends ArkGenericType {}
