// Type-check ArkExps.
// © Reuben Thomas 2025
// Released under the MIT license.

import assert from 'assert'

import {Interval} from 'ohm-js'

import {
  ArkAnd, ArkAwait, ArkBreak, ArkCall, ArkExp, ArkFn, ArkIf,
  ArkInvoke, ArkLaunch, ArkLet, ArkListLiteral, ArkLoop, ArkMapLiteral,
  ArkObjectLiteral, ArkOr, ArkReturn, ArkSequence, ArkSet, ArkYield, ArkProperty,
} from './code.js'
import {
  ArkBooleanTraitType,
} from './data.js'
import {
  ArkType, ArkFnType, ArkUnknownType, ArkNonterminatingType, ArkAnyType,
  ArkSelfType, ArkStructType, ArkTraitType, ArkUnionType,
} from './type.js'
import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
} from './util.js'
import {ArkCompilerError} from './error.js'

export function typeEquals(
  t1_: ArkType,
  t2_: ArkType,
  sourceLoc: Interval | undefined,
  selfType?: ArkType,
) {
  const t1 = t1_ === ArkSelfType ? selfType : t1_
  const t2 = t2_ === ArkSelfType ? selfType : t2_
  if (t1 === undefined || t2 === undefined) {
    throw new ArkCompilerError('Self does not exist in this context', sourceLoc)
  }
  if (t1 === ArkUnknownType || t2 === ArkUnknownType) {
    return false // Unknown doesn't match anything
  }
  if (t1 === t2) {
    return true
  }
  if (t1 === ArkAnyType || t2 === ArkAnyType) {
    return true // Any matches anything
  }
  if (t1 instanceof ArkFnType && t2 instanceof ArkFnType) {
    if (!typeEquals(t1.returnType, t2.returnType, sourceLoc, selfType)) {
      return false
    }
    if (t1.params !== undefined && t2.params !== undefined) {
      if (t1.params.length !== t2.params.length) {
        return false
      }
      for (let i = 0; i < t1.params.length; i += 1) {
        if (!typeEquals(t1.params[i].type, t2.params[i].type, sourceLoc, selfType)) {
          return false
        }
      }
    }
    return true
  }
  // FIXME: Check unions
  return false
}

function makeUnion(ty: ArkType, extraTy: ArkType, sourceLoc?: Interval): ArkType {
  assert(ty !== ArkSelfType && extraTy !== ArkSelfType)
  // T ∪ T = T
  if (ty === extraTy) {
    return ty
  }
  // Any ∪ T = Any
  if (ty === ArkAnyType || extraTy === ArkAnyType) {
    return ArkAnyType
  }
  // Unknown | Nonterminating ∪ T = T
  if (ty === ArkUnknownType || ty === ArkNonterminatingType) {
    return extraTy
  }
  if (extraTy === ArkUnknownType || ty === ArkNonterminatingType) {
    return ty
  }
  // Take union of two regular types
  if (!(ty instanceof ArkUnionType) && !(extraTy instanceof ArkUnionType)) {
    if (typeEquals(ty, extraTy, sourceLoc)) {
      return ty
    }
    return new ArkUnionType(new Set([ty, extraTy]))
  }
  // Take union of Union type and non-Union type
  if (ty instanceof ArkUnionType && !(extraTy instanceof ArkUnionType)) {
    return new ArkUnionType(new Set([extraTy, ...ty.types]))
  }
  if (extraTy instanceof ArkUnionType && !(ty instanceof ArkUnionType)) {
    return new ArkUnionType(new Set([...extraTy.types, ty]))
  }
  // Take union of two Union types
  assert(ty instanceof ArkUnionType && extraTy instanceof ArkUnionType)
  return new ArkUnionType(new Set([...ty.types, ...extraTy.types]))
}

function checkArgsMatchParams(
  fnType: ArkType,
  args: ArkExp[],
  sourceLoc: Interval | undefined,
  selfType?: ArkType,
) {
  if (fnType === ArkAnyType) {
    return
  }
  if (!(fnType instanceof ArkFnType)) {
    throw new ArkCompilerError('Invalid call', sourceLoc)
  }
  if (fnType.params !== undefined) {
    const paramTypes = fnType.params
    if (paramTypes.length !== args.length) {
      throw new ArkCompilerError(`Function has ${paramTypes.length} parameters but ${args.length} arguments supplied`, sourceLoc)
    }
    for (let i = 0; i < args.length; i += 1) {
      if (!typeEquals(args[i].type, paramTypes[i].type, sourceLoc, selfType)) {
        throw new ArkCompilerError(`Type of parameter ${i + 1} does not match type of argument`, sourceLoc) // FIXME: implement type → name
      }
    }
  }
}

export function typecheck(exp: ArkExp) {
  if (exp instanceof ArkLaunch) {
    typecheck(exp.exp)
  } else if (exp instanceof ArkAwait) {
    typecheck(exp.exp)
  } else if (exp instanceof ArkBreak) {
    typecheck(exp.exp)
    exp.loop.type = makeUnion(exp.loop.type, exp.type, exp.sourceLoc)
  } else if (exp instanceof ArkYield) {
    typecheck(exp.exp)
    // FIXME: Type-check generators
    // if (!typeEquals(exp.type, exp.fn.returnType, exp.sourceLoc)) {
    // eslint-disable-next-line max-len
    //   throw new ArkCompilerError('Type of `yield\' expression does not match function return type')
    // }
  } else if (exp instanceof ArkReturn) {
    typecheck(exp.exp)
    // FIXME: Type-check generators
    if (!exp.fn.type.isGenerator && !typeEquals(exp.type, exp.fn.returnType, exp.sourceLoc)) {
      throw new ArkCompilerError('Type of `return\' expression does not match function return type')
    }
  } else if (exp instanceof ArkFn) {
    typecheck(exp.body)
    if (exp.body.type !== ArkNonterminatingType
      && !typeEquals(exp.returnType, exp.body.type, exp.sourceLoc)) {
      throw new ArkCompilerError('Type of function body does not match function return type', exp.sourceLoc)
    }
  } else if (exp instanceof ArkCall) {
    typecheck(exp.fn)
    exp.args.map((a) => typecheck(a))
    checkArgsMatchParams(exp.fn.type, exp.args, exp.sourceLoc)
  } else if (exp instanceof ArkInvoke) {
    typecheck(exp.obj)
    exp.args.map((a) => typecheck(a))
    const objTy = exp.obj.type
    if (objTy !== ArkAnyType) { // Can't assume anything about Any values
      if (!(objTy instanceof ArkStructType || objTy instanceof ArkTraitType)) {
        throw new ArkCompilerError('Invalid method invocation', exp.sourceLoc)
      }
      const method = objTy.getMethod(exp.prop)
      if (method === undefined) {
        throw new ArkCompilerError(`Invalid method \`${exp.prop}'`, exp.sourceLoc)
      }
      checkArgsMatchParams(method.type, [exp.obj, ...exp.args], exp.sourceLoc, objTy)
    }
  } else if (exp instanceof ArkSet) {
    if (!typeEquals(exp.lexp.type, exp.type, exp.sourceLoc)) {
      throw new ArkCompilerError('Type error in assignment', exp.sourceLoc)
    }
  } else if (exp instanceof ArkObjectLiteral) {
    for (const v of exp.members.values()) {
      typecheck(v)
    }
  } else if (exp instanceof ArkListLiteral) {
    for (const v of exp.list) {
      typecheck(v)
    }
  } else if (exp instanceof ArkMapLiteral) {
    for (const [k, v] of exp.map) {
      typecheck(k)
      typecheck(v)
    }
  } else if (exp instanceof ArkLet) {
    typecheck(exp.body)
    exp.boundVars.map((bv) => typecheck(bv.init))
  } else if (exp instanceof ArkSequence) {
    exp.exps.map(typecheck)
  } else if (exp instanceof ArkIf) {
    typecheck(exp.cond)
    if (!typeEquals(exp.cond.type, ArkBooleanTraitType, exp.sourceLoc)) {
      throw new ArkCompilerError('Condition of `if\' must be Bool', exp.sourceLoc)
    }
    typecheck(exp.thenExp)
    exp.type = exp.thenExp.type
    if (exp.elseExp !== undefined) {
      typecheck(exp.elseExp)
      exp.type = makeUnion(exp.type, exp.elseExp.type, exp.sourceLoc)
    }
  } else if (exp instanceof ArkAnd) {
    typecheck(exp.left)
    typecheck(exp.right)
    if (!typeEquals(exp.left.type, ArkBooleanTraitType, exp.sourceLoc)
      || !typeEquals(exp.right.type, ArkBooleanTraitType, exp.sourceLoc)) {
      throw new ArkCompilerError('Arguments to `and\' must be Bool', exp.sourceLoc)
    }
  } else if (exp instanceof ArkOr) {
    typecheck(exp.left)
    typecheck(exp.right)
    if (!typeEquals(exp.left.type, ArkBooleanTraitType, exp.sourceLoc)
      || !typeEquals(exp.right.type, ArkBooleanTraitType, exp.sourceLoc)) {
      throw new ArkCompilerError('Arguments to `or\' must be Bool', exp.sourceLoc)
    }
  } else if (exp instanceof ArkLoop) {
    typecheck(exp.body)
  } else if (exp instanceof ArkProperty) {
    // FIXME
  }
  assert(exp.type !== ArkUnknownType)
}
