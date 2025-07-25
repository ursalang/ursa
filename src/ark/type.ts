// Ark types.
// © Reuben Thomas 2025
// Released under the MIT license.

import {type ArkCallable, type ArkTypedId} from './data.js'
import {Class} from './util.js'

export type ArkType = ArkStructType | ArkTrait | ArkFnType | ArkUnionType | ArkTypeVariable
// | ArkInstantiatedType | ArkTypeVariable

type ArkTypeVariable = string

class ArkMemberType {
  constructor(
    public isVar: boolean,
    public isPub: boolean,
    public type: ArkType,
  ) {}
}

export class ArkStructType {
  constructor(
    // public superType: ArkStructType,
    public members: Map<string, ArkMemberType>,
    public typeParameters: Set<ArkTypeVariable> = new Set(),
  ) {}
}

export class ArkTrait {
  constructor(
    public methods: Map<string, ArkFnType> = new Map(),
    public typeParameters: Set<ArkTypeVariable> = new Set(),
  ) {}
}

// export class ArkInstantiatedType {
//   constructor(
//     public baseType: ArkStructType | ArkTrait | ArkFnType,
//     public typeArguments: Map<string, ArkType> = new Map(),
//   ) {
//     for (const ty of baseType.typeParameters) {
//       assert(typeArguments.get(ty))
//     }
//   }
// }

// FIXME: just a trait with one method, 'call'
export class ArkFnType {
  constructor(
    public Constructor: Class<ArkCallable>,
    public params: ArkTypedId[],
    public returnType: ArkType,
    public typeParameters: Set<string> = new Set(),
  ) {}
}

export class ArkUnionType {
  constructor(
    public types: ArkType[],
  ) {}
}
