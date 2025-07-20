// Type-check ArkExps.
// © Reuben Thomas 2025
// Released under the GPL version 3, or (at your option) any later version.

import assert from 'assert'

import {
  ArkAnd, ArkAwait, ArkBreak, ArkCall, ArkExp, ArkFn, ArkIf,
  ArkInvoke, ArkLaunch, ArkLet, ArkListLiteral, ArkLoop, ArkMapLiteral,
  ArkObjectLiteral, ArkOr, ArkReturn, ArkSequence, ArkSet, ArkYield, ArkProperty,
} from './code.js'
import {
  ArkBooleanTraitType,
} from './data.js'
import {
  ArkType, ArkFnType, ArkUnknownType, ArkAnyType,
} from './type.js'
import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
} from './util.js'
import {ArkCompilerError} from './error.js'

export function typeEquals(t1: ArkType, t2: ArkType) {
  if (t1 === t2) {
    return true
  }
  if (t1 === ArkAnyType || t2 === ArkAnyType) {
    // Any matches anything
    return true
  }
  if (t1 instanceof ArkFnType && t2 instanceof ArkFnType) {
    // FIXME: compare ArkFnType
    return true
  }
  return false
}

export function typecheck(exp: ArkExp) {
  assert(exp.type !== ArkUnknownType)
  if (exp instanceof ArkLaunch) {
    typecheck(exp.exp)
  } else if (exp instanceof ArkAwait) {
    typecheck(exp.exp)
  } else if (exp instanceof ArkBreak) {
    typecheck(exp.exp)
  } else if (exp instanceof ArkYield) {
    typecheck(exp.exp)
  } else if (exp instanceof ArkReturn) {
    typecheck(exp.exp)
    // FIXME: Need to have access to function type
  } else if (exp instanceof ArkFn) {
    typecheck(exp.body)
    // Check body against return type
  } else if (exp instanceof ArkCall) {
    typecheck(exp.fn)
    exp.args.map((a) => typecheck(a))
    if (exp.fn.type !== ArkAnyType && !(exp.fn.type instanceof ArkFnType)) {
      if (!(exp.fn.type instanceof ArkFnType)) {
        throw new ArkCompilerError('Invalid call', exp.sourceLoc)
      }
      if (exp.fn.type.params !== undefined) {
        const paramTypes = exp.fn.type.params
        if (paramTypes.length !== exp.args.length) {
          throw new ArkCompilerError(`Function has ${paramTypes.length} parameters but ${exp.args.length} arguments supplied`, exp.sourceLoc)
        }
        for (let i = 0; i < exp.args.length; i += 1) {
          if (!typeEquals(exp.args[i].type, paramTypes[i].type)) {
            throw new ArkCompilerError(`Type of parameter ${i + 1} does not match type of argument`, exp.sourceLoc) // FIXME: implement type → name
          }
        }
      }
    }
  } else if (exp instanceof ArkInvoke) {
    exp.args.map((a) => typecheck(a))
    // FIXME: similar to ArkCall
  } else if (exp instanceof ArkSet) {
    if (!typeEquals(exp.lexp.type, exp.type)) {
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
    // FIXME: Use typeEquals
    if (exp.cond.type !== ArkAnyType && exp.cond.type !== ArkBooleanTraitType) {
      throw new ArkCompilerError('Condition of `if\' must be Bool', exp.sourceLoc)
    }
    typecheck(exp.thenExp)
    if (exp.elseExp !== undefined) {
      typecheck(exp.elseExp)
    }
    // FIXME: iff the 'if''s value is used, check type of thenExp matches
    // that of elseExp.
  } else if (exp instanceof ArkAnd) {
    typecheck(exp.left)
    typecheck(exp.right)
    // FIXME: Use typeEquals
    if ((exp.left.type !== ArkAnyType && exp.left.type !== ArkBooleanTraitType)
      || (exp.right.type !== ArkAnyType && exp.right.type !== ArkBooleanTraitType)) {
      throw new ArkCompilerError('Arguments to `and\' must be Bool', exp.sourceLoc)
    }
  } else if (exp instanceof ArkOr) {
    typecheck(exp.left)
    typecheck(exp.right)
    // FIXME: Use typeEquals
    if ((exp.left.type !== ArkAnyType && exp.left.type !== ArkBooleanTraitType)
      || (exp.right.type !== ArkAnyType && exp.right.type !== ArkBooleanTraitType)) {
      throw new ArkCompilerError('Arguments to `or\' must be Bool', exp.sourceLoc)
    }
  } else if (exp instanceof ArkLoop) {
    typecheck(exp.body)
  } else if (exp instanceof ArkProperty) {
    //
  }
}
