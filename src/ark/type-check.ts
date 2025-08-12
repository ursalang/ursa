// Type-check ArkExps.
// © Reuben Thomas 2025
// Released under the MIT license.

import assert from 'assert'

import {Interval} from 'ohm-js'

import {
  ArkAnd, ArkAwait, ArkBreak, ArkCall, ArkExp, ArkFn, ArkIf,
  ArkInvoke, ArkLaunch, ArkLet, ArkListLiteral, ArkLoop, ArkMapLiteral,
  ArkStructLiteral, ArkOr, ArkReturn, ArkSequence, ArkSet, ArkYield, ArkProperty,
} from './code.js'
import {
  ArkBooleanTraitType,
} from './data.js'
import {ArkCompilerError} from './error.js'
import {
  typeName, ArkType, ArkFnType, ArkUnknownType, ArkNonterminatingType, ArkAnyType,
  ArkSelfType, ArkStructType, ArkTraitType, ArkUnionType, ArkUndefinedType, ArkTypeVariable,
} from './type.js'
import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
} from './util.js'

export function typeEquals(
  t1_: ArkType,
  t2_: ArkType,
  sourceLoc: Interval | undefined,
  selfType?: ArkType,
): boolean {
  const t1 = t1_ === ArkSelfType ? selfType : t1_
  const t2 = t2_ === ArkSelfType ? selfType : t2_
  if (t1 === t2) {
    return true
  }
  if (t1 === undefined || t2 === undefined) {
    throw new ArkCompilerError('Self does not exist in this context', sourceLoc)
  } else if (t1 === ArkUnknownType || t2 === ArkUnknownType) {
    return false // Unknown only matches itself
  } else if (t1 === ArkAnyType || t2 === ArkAnyType) {
    return true // Any matches anything
  } else if ((t1 instanceof ArkTypeVariable && t2 instanceof ArkTypeVariable)
    || (t1 instanceof ArkStructType && t2 instanceof ArkStructType)
    || (t1 instanceof ArkTraitType && t2 instanceof ArkTraitType)) {
    return t1.name === t2.name
  } else if (t1 instanceof ArkFnType && t2 instanceof ArkFnType) {
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
  } else if (t1 instanceof ArkUnionType && t2 instanceof ArkUnionType) {
    // Search t2 for a match for each type in t1.
    // TODO: improve efficiency.
    for (const ty1 of t1.types) {
      let match = false
      for (const ty2 of t2.types) {
        if (typeEquals(ty1, ty2, sourceLoc, selfType)) {
          match = true
          break
        }
      }
      if (!match) {
        return false
      }
    }
    return true
  }
  return false
}

export function typecheck(exp: ArkExp): ArkCompilerError[] {
  const errors: ArkCompilerError[] = []

  function safeTypeEquals(
    t1_: ArkType,
    t2_: ArkType,
    sourceLoc: Interval | undefined,
    selfType?: ArkType,
  ): boolean {
    try {
      return typeEquals(t1_, t2_, sourceLoc, selfType)
    } catch (e) {
      if (e instanceof ArkCompilerError) {
        errors.push(e)
      }
      return false
    }
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
      if (safeTypeEquals(ty, extraTy, sourceLoc)) {
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
      errors.push(new ArkCompilerError('Invalid call', sourceLoc))
    } else if (fnType.params !== undefined) {
      const paramTypes = fnType.params
      if (paramTypes.length !== args.length) {
        errors.push(new ArkCompilerError(`Function with ${paramTypes.length} parameters passed ${args.length} arguments`, sourceLoc))
      }
      for (let i = 0; i < args.length; i += 1) {
        if (!safeTypeEquals(args[i].type, paramTypes[i].type, sourceLoc, selfType)) {
          errors.push(new ArkCompilerError(`Expecting ${typeName(paramTypes[i].type, selfType)} found ${typeName(args[i].type, selfType)}`, args[i].sourceLoc))
        }
      }
    }
  }

  function doTypecheck(exp: ArkExp) {
    if (exp instanceof ArkLaunch) {
      doTypecheck(exp.exp)
    } else if (exp instanceof ArkAwait) {
      doTypecheck(exp.exp)
    } else if (exp instanceof ArkBreak) {
      doTypecheck(exp.exp)
      exp.loop.type = makeUnion(exp.loop.type, exp.type, exp.sourceLoc)
    } else if (exp instanceof ArkYield) {
      doTypecheck(exp.exp)
      // FIXME: Type-check generators
      // if (!typeEquals_(exp.type, exp.fn.returnType, exp.sourceLoc)) {
      // eslint-disable-next-line max-len
      //   errors.push(new ArkCompilerError('Type of `yield\' expression does not match function return type'))
      // }
    } else if (exp instanceof ArkReturn) {
      doTypecheck(exp.exp)
      // FIXME: Type-check generators
      if (!exp.fn.type.isGenerator && !safeTypeEquals(exp.type, exp.fn.returnType, exp.sourceLoc)) {
        errors.push(new ArkCompilerError('Type of `return\' expression does not match function return type', exp.sourceLoc))
      }
    } else if (exp instanceof ArkFn) {
      doTypecheck(exp.body)
      if (exp.body.type !== ArkNonterminatingType
        && !safeTypeEquals(exp.returnType, exp.body.type, exp.sourceLoc)) {
        errors.push(new ArkCompilerError('Type of function body does not match function return type', exp.sourceLoc))
      }
    } else if (exp instanceof ArkCall) {
      doTypecheck(exp.fn)
      exp.args.map((a) => doTypecheck(a))
      checkArgsMatchParams(exp.fn.type, exp.args, exp.sourceLoc)
    } else if (exp instanceof ArkInvoke) {
      if (exp.type === ArkUndefinedType) {
        errors.push(new ArkCompilerError(`No method ${typeName(exp.type)}.${exp.prop}`, exp.sourceLoc))
      } else {
        doTypecheck(exp.obj)
        exp.args.map((a) => doTypecheck(a))
        const objTy = exp.obj.type
        if (objTy !== ArkAnyType) { // Can't assume anything about Any values
          if (!(objTy instanceof ArkStructType || objTy instanceof ArkTraitType)) {
            errors.push(new ArkCompilerError('Invalid method invocation', exp.sourceLoc))
          } else {
            const method = objTy.getMethod(exp.prop)
            if (method === undefined) {
              errors.push(new ArkCompilerError(`Invalid method \`${exp.prop}'`, exp.sourceLoc))
            } else {
              checkArgsMatchParams(method.type, [exp.obj, ...exp.args], exp.sourceLoc, objTy)
            }
          }
        }
      }
    } else if (exp instanceof ArkSet) {
      if (!safeTypeEquals(exp.lexp.type, exp.type, exp.sourceLoc)) {
        errors.push(new ArkCompilerError('Type error in assignment', exp.sourceLoc))
      }
    } else if (exp instanceof ArkStructLiteral) {
      for (const v of exp.members.values()) {
        doTypecheck(v)
      }
      // FIXME: Check items are of correct type
    } else if (exp instanceof ArkListLiteral) {
      for (const v of exp.list) {
        doTypecheck(v)
      }
      // FIXME: Check items are of correct type
    } else if (exp instanceof ArkMapLiteral) {
      for (const [k, v] of exp.map) {
        doTypecheck(k)
        doTypecheck(v)
      }
      // FIXME: Check items are of correct type
    } else if (exp instanceof ArkLet) {
      doTypecheck(exp.body)
      exp.boundVars.map((bv) => doTypecheck(bv.init))
    } else if (exp instanceof ArkSequence) {
      exp.exps.map(doTypecheck)
    } else if (exp instanceof ArkIf) {
      doTypecheck(exp.cond)
      if (!safeTypeEquals(exp.cond.type, ArkBooleanTraitType, exp.sourceLoc)) {
        errors.push(new ArkCompilerError('Condition of `if\' must be Bool', exp.sourceLoc))
      }
      doTypecheck(exp.thenExp)
      exp.type = exp.thenExp.type
      if (exp.elseExp !== undefined) {
        doTypecheck(exp.elseExp)
        exp.type = makeUnion(exp.type, exp.elseExp.type, exp.sourceLoc)
      }
    } else if (exp instanceof ArkAnd) {
      doTypecheck(exp.left)
      doTypecheck(exp.right)
      if (!safeTypeEquals(exp.left.type, ArkBooleanTraitType, exp.sourceLoc)
        || !safeTypeEquals(exp.right.type, ArkBooleanTraitType, exp.sourceLoc)) {
        errors.push(new ArkCompilerError('Arguments to `and\' must be Bool', exp.sourceLoc))
      }
    } else if (exp instanceof ArkOr) {
      doTypecheck(exp.left)
      doTypecheck(exp.right)
      if (!safeTypeEquals(exp.left.type, ArkBooleanTraitType, exp.sourceLoc)
        || !safeTypeEquals(exp.right.type, ArkBooleanTraitType, exp.sourceLoc)) {
        errors.push(new ArkCompilerError('Arguments to `or\' must be Bool', exp.sourceLoc))
      }
    } else if (exp instanceof ArkLoop) {
      doTypecheck(exp.body)
    } else if (exp instanceof ArkProperty) {
      doTypecheck(exp.obj)
      if (exp.type === ArkUndefinedType) {
        errors.push(new ArkCompilerError(`Invalid property \`${exp.prop}'`, exp.sourceLoc))
      }
    }
    assert(exp.type !== ArkUnknownType)
  }

  doTypecheck(exp)
  return errors
}
