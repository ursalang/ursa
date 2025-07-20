// Ark types.
// © Reuben Thomas 2025
// Released under the MIT license.

import assert from 'assert'

import {type ArkTypedId} from './data.js'

export type ArkType =
  ArkStructType | ArkTraitType | ArkFnType |
  ArkUnionType | ArkInstantiatedType | ArkTypeVariable

// FIXME: use symbol, not string
type ArkTypeVariable = string

export const ArkUnknownType = 'Unknown'
export const ArkAnyType = 'Any'
export const ArkSelfType = 'Self'

export class ArkMemberType {
  constructor(
    public type: ArkType,
    public isVar: boolean = false,
  ) {}
}

export class ArkStructType {
  constructor(
    // public superType: ArkStructType,
    public members: Map<string, ArkMemberType>,
    public traits: Set<ArkTraitType> = new Set(),
    public typeParameters: Set<ArkTypeVariable> = new Set(),
  ) {}

  public getMethod(name: string): ArkMethodType | undefined {
    for (const t of this.traits) {
      const m = t.getMethod(name)
      if (m !== undefined) {
        return m
      }
    }
    return undefined
  }
}

export class ArkMethodType {
  constructor(
    public type: ArkFnType,
    public isPub: boolean = false,
  ) {}
}

export class ArkTraitType {
  constructor(
    public name: string,
    public methods: Map<string, ArkMethodType> = new Map(),
    public superTraits: Set<ArkTraitType> = new Set(),
    public typeParameters: Set<ArkTypeVariable> = new Set(),
  ) {}

  public getMethod(name: string): ArkMethodType | undefined {
    const m = this.methods.get(name)
    if (m !== undefined) {
      return m
    }
    for (const s of this.superTraits) {
      const m = s.methods.get(name)
      if (m !== undefined) {
        return m
      }
    }
    return undefined
  }
}

export class ArkInstantiatedType {
  constructor(
    public baseType: ArkStructType | ArkTraitType | ArkFnType,
    public typeArguments: Map<string, ArkType> = new Map(),
  ) {
    for (const ty of baseType.typeParameters) {
      assert(typeArguments.get(ty))
    }
  }
}

// FIXME: just a trait with one method, 'call'
export class ArkFnType {
  constructor(
    public isGenerator: boolean,
    public params: ArkTypedId[] | undefined,
    public returnType: ArkType,
    public typeParameters: Set<string> = new Set(),
  ) {}
}

export class ArkUnionType {
  constructor(
    public types: ArkType[],
  ) {}
}
