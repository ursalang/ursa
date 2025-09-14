// Ark types.
// © Reuben Thomas 2025
// Released under the MIT license.

import assert from 'assert'

import {Namespace} from './compiler-utils.js'
import {type ArkCallable} from './data.js'
import {ArkCompilerError} from './error.js'
import {debug} from './util.js'

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
    for (const impl of this.impls.values()) {
      for (const [implName, method] of impl.methods) {
        if (implName === name) {
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

export class ArkParametricType<T extends ArkParametricType<T>> extends ArkType {
  constructor(public typeParameters = new Namespace<ArkType>()) {
    super()
  }
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
    public members: Namespace<ArkType>,
    typeParameters = new Namespace<ArkType>(),
  ) {
    super(typeParameters)
  }

  public getMethodType(name: string): ArkMethodType | undefined {
    for (const trait of this.impls.keys()) {
      const ty = trait.getMethodType(name)
      if (ty !== undefined) {
        return ty
      }
    }
    return undefined
  }
}

export class ArkInstantiatedStructType extends ArkStructType {
  constructor(baseType: ArkStructType, substs: Namespace<ArkType>) {
    super(baseType.name, baseType.members, baseType.typeParameters.with(substs))
    this.impls = baseType.impls
  }
}

export class ArkEnumType extends ArkParametricType<ArkEnumType> {
  constructor(
    public name: string,
    public variants: Namespace<ArkType>,
    public traits: Set<ArkTrait> = new Set(),
    typeParameters = new Namespace<ArkType>(),
  ) {
    super(typeParameters)
  }
}

export class ArkInstantiatedEnumType extends ArkEnumType {
  constructor(baseType: ArkEnumType, substs: Namespace<ArkType>) {
    super(
      baseType.name,
      baseType.variants,
      baseType.traits,
      baseType.typeParameters.with(substs),
    )
    this.impls = baseType.impls
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
    typeParameters = new Namespace<ArkType>(),
  ) {
    super(typeParameters)
  }

  public getMethodType(name: string): ArkMethodType | undefined {
    const m = this.methods.get(name)
    if (m !== undefined) {
      return m
    }
    for (const trait of this.impls.keys()) {
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

export class ArkInstantiatedTrait extends ArkTrait {
  constructor(baseType: ArkTrait, substs: Namespace<ArkType>) {
    super(
      baseType.name,
      baseType.methods,
      baseType.superTraits,
      baseType.typeParameters.with(substs),
    )
    this.impls = baseType.impls
  }
}

// FIXME: just a trait with one method, 'call'?
export class ArkFnType extends ArkParametricType<ArkFnType> {
  constructor(
    public isGenerator: boolean,
    public params: ArkTypedId[] | undefined,
    public returnType: ArkType,
    typeParameters = new Namespace<ArkType>(),
  ) {
    super(typeParameters)
  }
}

export class ArkInstantiatedFnType extends ArkFnType {
  constructor(baseType: ArkFnType, substs: Namespace<ArkType>) {
    super(
      baseType.isGenerator,
      baseType.params,
      baseType.returnType,
      baseType.typeParameters.with(substs),
    )
    this.impls = baseType.impls
  }
}

function paramsToStr(params: Namespace<ArkType>): string {
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
  } else {
    assert(ty instanceof ArkFnType)
    // FIXME: Use 'where' syntax
    const types = []
    for (const t of ty.params ?? []) {
      types.push(typeName(t.type, selfType))
    }
    const paramsStr = paramsToStr(ty.typeParameters)
    return `fn${paramsStr} (${types.join(', ')}): ${typeName(ty.returnType, selfType)}`
  }
}

export function typeToStr(ty: ArkType) {
  switch (ty) {
    case ArkUnknownType:
      return 'Unknown'
    case ArkAnyType:
      return 'Any'
    default:
  }
  if (ty instanceof ArkFnType) {
    return 'Fn'
  } else if (ty instanceof ArkStructType || ty instanceof ArkTrait) {
    return ty.name
  }
  debug(ty)
  throw new Error('unknown type')
}
