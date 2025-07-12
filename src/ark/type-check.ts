// Type-check ArkExps.
// © Reuben Thomas 2025
// Released under the GPL version 3, or (at your option) any later version.

import assert, {AssertionError} from 'assert'

import {
  ArkAnd, ArkAwait, ArkBreak, ArkCall, ArkExp, ArkFn, ArkIf,
  ArkInvoke, ArkLaunch, ArkLet, ArkListLiteral, ArkLoop, ArkMapLiteral,
  ArkObjectLiteral, ArkOr, ArkReturn, ArkSequence, ArkSet, ArkYield, ArkProperty,
} from './code.js'
import {
  ArkVal, ArkObjectBase, ArkBooleanVal, ArkUndefinedVal, ArkCallable,
} from './data.js'
import {ArkType, ArkFnType, ArkGenericType} from './type.js'
import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
  Class,
} from './util.js'
import {ArkCompilerError} from './error.js'

function isSubtypeOf(t: ArkType, u: ArkType) {
  if (t instanceof ArkGenericType) {
    if (!(u instanceof ArkGenericType)) {
      return false
    }
    throw new Error('FIXME: subtype relation for generics!')
  }

  // A non-generic type is not a subtype of any generic
  if (u instanceof ArkGenericType) {
    return false
  }

  // Subtype relation for unparametrized types.
  let ty = t
  for (; ;) {
    if (ty === u) {
      return true
    }
    if (ty === ArkVal) {
      break
    }
    ty = Object.getPrototypeOf(ty) as Class<ArkVal>
  }
  return false
}

export function typeEquals(t1: ArkType, t2: ArkType) {
  if (t1 === t2) {
    return true
  }
  if (t1 === ArkVal || t2 === ArkVal) {
    // ArkVal (Any) matches anything
    return true
  }
  if ((t1 === ArkCallable && t2 instanceof ArkFnType)
    || (t1 instanceof ArkFnType && t2 === ArkCallable)) {
    // ArkCallable matches any ArkFnType
    return true
  }
  // FIXME: compare ArkFnType
  return false
}

export function typecheck(exp: ArkExp) {
  assert(exp.type !== ArkUndefinedVal)
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
    if (exp.fn.type !== ArkVal && exp.fn.type !== ArkCallable) {
      if (!(exp.fn.type instanceof ArkFnType)) {
        throw new ArkCompilerError('Invalid call', exp.sourceLoc)
      }
      if (exp.fn.type.params !== undefined) {
        const paramTypes = exp.fn.type.typeParameters
        if (paramTypes.length !== exp.args.length) {
          throw new ArkCompilerError(`Function has ${paramTypes.length} parameters but ${exp.args.length} arguments supplied`, exp.sourceLoc)
        }
        for (let i = 0; i < exp.args.length; i += 1) {
          if (!typeEquals(exp.args[i].type, paramTypes[i])) {
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
    for (const v of exp.properties.values()) {
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
    if (exp.cond.type !== ArkVal && exp.cond.type !== ArkBooleanVal) {
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
    if ((exp.left.type !== ArkVal && exp.left.type !== ArkBooleanVal)
      || (exp.right.type !== ArkVal && exp.right.type !== ArkBooleanVal)) {
      throw new ArkCompilerError('Arguments to `and\' must be Bool', exp.sourceLoc)
    }
  } else if (exp instanceof ArkOr) {
    typecheck(exp.left)
    typecheck(exp.right)
    // FIXME: Use typeEquals
    if ((exp.left.type !== ArkVal && exp.left.type !== ArkBooleanVal)
      || (exp.right.type !== ArkVal && exp.right.type !== ArkBooleanVal)) {
      throw new ArkCompilerError('Arguments to `or\' must be Bool', exp.sourceLoc)
    }
  } else if (exp instanceof ArkLoop) {
    typecheck(exp.body)
  } else if (exp instanceof ArkProperty) {
    if (exp.obj.type !== ArkVal && !isSubtypeOf(exp.obj.type, ArkObjectBase)) {
      // Using 'assert' here hangs the program!
      throw new AssertionError({message: 'bad ArkVal'})
    }
  }
}
