// Ark types.
// © Reuben Thomas 2025
// Released under the MIT license.

import assert from 'assert'

import {type ArkCallable} from './data.js'
import {Class} from './util.js'

export type ArkType = ArkStructType | ArkTrait | ArkInstantiatedType | ArkTypeVariable

export type ArkTypeVariable = Symbol

export class ArkMemberType {
  constructor(
    public isVar: boolean,
    public isPub: boolean,
    public type: ArkType,
  ) {}
}

export class ArkStructType {
  constructor(
    // public superType: ArkStructType,
    public typeParameters: Set<ArkTypeVariable>,
    public members: Map<Symbol, ArkMemberType> = new Map(),
  ) {}
}

export class ArkTrait {
  constructor(
    public typeParameters: Set<ArkTypeVariable>,
    public methods: Map<Symbol, ArkFnType> = new Map(),
  ) {}
}

export class ArkInstantiatedType {
  constructor(
    public baseType: ArkStructType | ArkTrait | ArkFnType,
    public typeArguments: Map<Symbol, ArkType> = new Map(),
  ) {
    for (const ty in baseType.typeParameters) {
      assert(typeArguments.get(ty))
    }
  }
}

// FIXME: just a trait with one method, 'call'
export class ArkFnType {
  constructor(
    public Constructor: Class<ArkCallable>,
    public typeParameters: Map<Symbol, ArkType>,
    public returnType: ArkType,
  ) {}
}

export class ArkUnionType extends ArkInstantiatedType {}
