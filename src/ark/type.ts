// Ark types.
// © Reuben Thomas 2025
// Released under the MIT license.

import assert from 'assert'

import {ArkCallable, typeToStr} from './data.js'
import {ArkCompilerError} from './error.js'
import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
} from './util.js'

export class ArkImpl {
  // FIXME: Add associated types etc.
  constructor(public methods: Map<string, ArkCallable> = new Map()) {}
}

export abstract class ArkType {
  public impls = new Map<ArkTrait, ArkImpl>()

  // FIXME: check types of implementation against trait.
  // FIXME: Instead of SelfTrait, take a one-off trait and again check
  // against the impl.
  public implement(trait: ArkTrait, impl: ArkImpl) {
    // FIXME: error if already impl'd
    this.impls.set(trait, impl)
  }

  // FIXME: formalize overriding, access to specific impls etc.
  public getMethod(name: string): ArkCallable | undefined {
    for (const [_, impl] of this.impls) {
      for (const [impl_name, method] of impl.methods) {
        if (impl_name === name) {
          return method
        }
      }
    }
    return undefined
  }
}

export class ArkTypedId {
  constructor(public name: string, public type: ArkType) {}
}

function instantiateTypeVars(
  typeParameters: Map<string, ArkType>,
  substs: Map<string, ArkType>,
): Map<string, ArkType> {
  const newTypeParams: Map<string, ArkType> = new Map()
  for (const [name, ty] of typeParameters) {
    let newTy = ty
    if (substs.has(name)) {
      newTy = substs.get(name)!
    }
    newTypeParams.set(name, newTy)
  }
  return newTypeParams
}

export abstract class ArkParametricType<T extends ArkParametricType<T>> extends ArkType {
  constructor(public typeParameters: Map<string, ArkType> = new Map()) {
    super()
  }

  public isGeneric(): boolean {
    return this.typeParameters.size > 0
  }

  public abstract instantiate(substs: Map<string, ArkType>): T
}

export class ArkTypeVariable extends ArkType {
  // FIXME: use symbol, not string
  constructor(public name: string) {
    super()
  }
}

// ts-unused-exports:disable-next-line
export class ArkTypeConstant extends ArkType {
  // FIXME: use symbol, not string
  constructor(public name: string) {
    super()
  }
}

export const ArkUndefinedType = new ArkTypeConstant('Undefined')
export const ArkUnknownType = new ArkTypeConstant('Unknown')
export const ArkNonterminatingType = new ArkTypeConstant('Nonterminating')
export const ArkAnyType = new ArkTypeConstant('Any')
export const ArkSelfType = new ArkTypeConstant('Self')

export class ArkStructType extends ArkParametricType<ArkStructType> {
  constructor(
    public name: string,
    // FIXME: public superType: ArkStructType,
    public members: Map<string, ArkType>,
    typeParameters: Map<string, ArkType> = new Map(),
  ) {
    super(typeParameters)
  }

  public instantiate(substs: Map<string, ArkType>) {
    const newMembers = new Map<string, ArkType>()
    for (const [name, ty] of this.members) {
      let newType = ty
      if (ty instanceof ArkParametricType && ty.isGeneric()) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        newType = ty.instantiate(substs)
      }
      newMembers.set(name, newType)
    }
    const newTy = new ArkStructType(
      this.name,
      newMembers,
      instantiateTypeVars(this.typeParameters, substs),
    )
    const newImpls = new Map<ArkTrait, ArkImpl>()
    for (const [trait, impl] of this.impls) {
      newImpls.set(trait.instantiate(substs), impl)
    }
    newTy.impls = newImpls
    return newTy
  }

  public getMethodType(name: string): ArkMethodType | undefined {
    for (const [trait, _] of this.impls) {
      const ty = trait.getMethodType(name)
      if (ty !== undefined) {
        return ty
      }
    }
    return undefined
  }
}

export class ArkEnumType extends ArkParametricType<ArkEnumType> {
  constructor(
    public name: string,
    public variants: Map<string, ArkType>,
    public traits: Set<ArkTrait> = new Set(),
    typeParameters: Map<string, ArkType> = new Map(),
  ) {
    super(typeParameters)
  }

  public instantiate(substs: Map<string, ArkType>) {
    const newVariants = new Map<string, ArkType>()
    for (const [name, ty] of this.variants) {
      let newType = ty
      if (ty instanceof ArkParametricType && ty.isGeneric()) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        newType = ty.instantiate(substs)
      }
      newVariants.set(name, newType)
    }
    const newTraits = new Set<ArkTrait>()
    for (const t of this.traits) {
      newTraits.add(t.instantiate(substs))
    }
    return new ArkEnumType(
      this.name,
      newVariants,
      newTraits,
      instantiateTypeVars(this.typeParameters, substs),
    )
  }
}

export class ArkMethodType {
  constructor(
    public type: ArkFnType,
    public isPub: boolean = false,
  ) {}
}

export class ArkTrait extends ArkParametricType<ArkTrait> {
  constructor(
    public name: string,
    public methods: Map<string, ArkMethodType> = new Map(),
    public superTraits: Set<ArkTrait> = new Set(),
    typeParameters: Map<string, ArkType> = new Map(),
  ) {
    super(typeParameters)
  }

  public instantiate(substs: Map<string, ArkType>) {
    const newMethods = new Map<string, ArkMethodType>()
    for (const [name, m] of this.methods) {
      const newMethodType = new ArkMethodType(m.type.instantiate(substs), m.isPub)
      newMethods.set(name, newMethodType)
    }
    const newSuperTraits = new Set<ArkTrait>()
    for (const t of this.superTraits) {
      newSuperTraits.add(t.instantiate(substs))
    }
    // FIXME: copy and instantiate impls as for structs
    return new ArkTrait(
      this.name,
      newMethods,
      newSuperTraits,
      instantiateTypeVars(this.typeParameters, substs),
    )
  }

  public getMethodType(name: string): ArkMethodType | undefined {
    const m = this.methods.get(name)
    if (m !== undefined) {
      return m
    }
    for (const [trait, _] of this.impls) {
      const ty = trait.getMethodType(name)
      if (ty !== undefined) {
        return ty
      }
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

// FIXME: just a trait with one method, 'call'?
export class ArkFnType extends ArkParametricType<ArkFnType> {
  constructor(
    public isGenerator: boolean,
    public params: ArkTypedId[] | undefined,
    public returnType: ArkType,
    typeParameters: Map<string, ArkType> = new Map(),
  ) {
    super(typeParameters)
  }

  public instantiate(substs: Map<string, ArkType>) {
    let newParams: ArkTypedId[] | undefined
    if (this.params !== undefined) {
      newParams = []
      for (const p of this.params) {
        let newType = p.type
        if (p.type instanceof ArkTypeVariable && substs.has(p.type.name)) {
          newType = substs.get(p.type.name)!
        } else if (p.type instanceof ArkParametricType && p.type.isGeneric()) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          newType = p.type.instantiate(substs)
        }
        newParams.push(new ArkTypedId(p.name, newType))
      }
    }
    let newReturnType = this.returnType
    if (newReturnType instanceof ArkTypeVariable && substs.has(newReturnType.name)) {
      newReturnType = substs.get(newReturnType.name)!
    } else if (newReturnType instanceof ArkParametricType && newReturnType.isGeneric()) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      newReturnType = newReturnType.instantiate(substs)
    }
    return new ArkFnType(
      this.isGenerator,
      newParams,
      newReturnType,
      instantiateTypeVars(this.typeParameters, substs),
    )
  }
}

export class ArkUnionType extends ArkType {
  constructor(public types: Set<ArkType>) {
    super()
  }
}

function paramsToStr(params: Map<string, ArkType>): string {
  let paramsStr = ''
  if (params.size > 0) {
    const types = []
    for (const t of params.values()) {
      types.push(typeToStr(t))
    }
    paramsStr = `<${types.join(', ')}>`
  }
  return paramsStr
}

export function typeName(ty: ArkType, selfType?: ArkType): string {
  if (ty === ArkSelfType) {
    if (selfType === undefined) {
      throw new ArkCompilerError('Self does not exist in this context')
    } else {
      return typeName(selfType)
    }
  } else if (ty instanceof ArkTypeVariable || ty instanceof ArkTypeConstant) {
    return ty.name
  } else if (ty instanceof ArkStructType || ty instanceof ArkTrait) {
    return `${ty.name}${paramsToStr(ty.typeParameters)}`
  } else if (ty instanceof ArkFnType) {
    // FIXME: Use 'where' syntax
    const types = []
    for (const t of ty.params ?? []) {
      types.push(typeName(t.type, selfType))
    }
    const paramsStr = paramsToStr(ty.typeParameters)
    return `fn${paramsStr} (${types.join(', ')}): ${typeName(ty.returnType, selfType)}`
  } else {
    assert(ty instanceof ArkUnionType)
    const types = []
    for (const t of ty.types) {
      types.push(typeName(t, selfType))
    }
    return `Union<${types.join(', ')}>`
  }
}
