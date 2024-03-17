import {toJs} from './ffi.js'
import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
  ArkState, ArkFrameDebugInfo, ArkFrame,
  ArkVal, ArkUndefined, ArkNullVal, ArkNull,
  ArkExp, ArkLexp, pushLets, ArkLet,
  ArkRuntimeError, ArkNonLocalReturn, ArkBreak, ArkBreakException,
  ArkLaunch, ArkLiteral, ArkPromise, ArkAwait,
  ArkContinue, ArkContinueException, ArkReturn, ArkReturnException,
  ArkFn, ArkCallable, ArkClosure, ArkCall, NativeFn, NativeAsyncFn,
  ArkRef, ArkLocal, ArkCapture,
  makeLocals, ArkSet, ArkSequence, ArkIf, ArkAnd, ArkOr, ArkLoop,
  ArkAbstractObjectBase, ArkObjectLiteral, ArkObject,
  ArkListLiteral, ArkList, ArkMapLiteral, ArkMap,
  ArkProperty, ArkPropertyRef, ArkPropertyRefError,
} from './interpreter.js'

export async function evalArk(ark: ArkState, exp: ArkExp): Promise<ArkVal> {
  if (exp instanceof ArkLiteral) {
    return Promise.resolve(exp.val)
  } else if (exp instanceof ArkLaunch) {
    return Promise.resolve(new ArkPromise(evalArk(ark, exp.exp)))
  } else if (exp instanceof ArkAwait) {
    const promise = await evalArk(ark, exp.exp)
    if (!(promise instanceof ArkPromise)) {
      throw new ArkRuntimeError(ark, "Attempt to 'await' non-Promise", exp)
    }
    const res = await promise.promise
    return res
  } else if (exp instanceof ArkBreak) {
    throw new ArkBreakException(await evalArk(ark, exp.exp))
  } else if (exp instanceof ArkContinue) {
    throw new ArkContinueException()
  } else if (exp instanceof ArkReturn) {
    throw new ArkReturnException(await evalArk(ark, exp.exp))
  } else if (exp instanceof ArkFn) {
    const captures = []
    for (const v of exp.capturedVars) {
      captures.push(await evalRef(ark, v))
    }
    return new ArkClosure(exp.params, captures, exp.body)
  } else if (exp instanceof ArkCall) {
    const fn = exp.fn
    let sym: ArkRef | undefined
    if (fn instanceof ArkLocal || fn instanceof ArkCapture) {
      sym = await evalRef(ark, fn)
    }
    const fnVal = await evalArk(ark, fn)
    if (!(fnVal instanceof ArkCallable)) {
      throw new ArkRuntimeError(ark, 'Invalid call', exp)
    }
    const evaluatedArgs = []
    for (const arg of exp.args) {
      evaluatedArgs.push(await evalArk(ark, arg))
    }
    const locals = makeLocals(fnVal.params, evaluatedArgs)
    const debugInfo = new ArkFrameDebugInfo(sym, exp)
    return call(new ArkState(new ArkFrame(locals, fnVal.captures, debugInfo), ark), fnVal)
  } else if (exp instanceof ArkSet) {
    const ref = await evalRef(ark, exp.lexp)
    const res = await evalArk(ark, exp.exp)
    const oldVal = ref.get()
    if (oldVal !== ArkUndefined
      && oldVal.constructor !== ArkNullVal
      && res.constructor !== oldVal.constructor) {
      throw new ArkRuntimeError(ark, 'Assignment to different type', exp)
    }
    ref.set(res)
    return res
  } else if (exp instanceof ArkObjectLiteral) {
    const inits = new Map<string, ArkVal>()
    for (const [k, v] of exp.properties) {
      inits.set(k, await evalArk(ark, v))
    }
    return new ArkObject(inits)
  } else if (exp instanceof ArkListLiteral) {
    const evaluatedList = []
    for (const e of exp.list) {
      evaluatedList.push(await evalArk(ark, e))
    }
    return new ArkList(evaluatedList)
  } else if (exp instanceof ArkMapLiteral) {
    const evaluatedMap = new Map<ArkVal, ArkVal>()
    for (const [k, v] of exp.map) {
      evaluatedMap.set(await evalArk(ark, k), await evalArk(ark, v))
    }
    return new ArkMap(evaluatedMap)
  } else if (exp instanceof ArkLet) {
    const nLets = await pushLets(ark, exp.boundVars)
    let res: ArkVal
    try {
      res = await evalArk(ark, exp.body)
    } catch (e) {
      if (e instanceof ArkNonLocalReturn) {
        ark.pop(nLets)
      }
      throw e
    }
    ark.pop(nLets)
    return res
  } else if (exp instanceof ArkSequence) {
    let res: ArkVal = ArkNull()
    for (const e of exp.exps) {
      res = await evalArk(ark, e)
    }
    return res
  } else if (exp instanceof ArkIf) {
    const condVal = await evalArk(ark, exp.cond)
    let res: ArkVal
    if (toJs(condVal)) {
      res = await evalArk(ark, exp.thenExp)
    } else {
      res = exp.elseExp ? await evalArk(ark, exp.elseExp) : ArkNull()
    }
    return res
  } else if (exp instanceof ArkAnd) {
    const leftVal = await evalArk(ark, exp.left)
    if (toJs(leftVal)) {
      return evalArk(ark, exp.right)
    }
    return leftVal
  } else if (exp instanceof ArkOr) {
    const leftVal = await evalArk(ark, exp.left)
    if (toJs(leftVal)) {
      return leftVal
    }
    return evalArk(ark, exp.right)
  } else if (exp instanceof ArkLoop) {
    for (; ;) {
      try {
        await evalArk(ark, exp.body)
      } catch (e) {
        if (e instanceof ArkBreakException) {
          return e.val
        }
        if (!(e instanceof ArkContinueException)) {
          throw e
        }
      }
    }
  } else if (exp instanceof ArkLexp) {
    return (await evalRef(ark, exp)).get()
  }
  throw new Error('invalid ArkExp')
}

async function evalRef(ark: ArkState, lexp: ArkLexp): Promise<ArkRef> {
  if (lexp instanceof ArkLocal) {
    return Promise.resolve(ark.frame.locals[lexp.index])
  } else if (lexp instanceof ArkCapture) {
    return Promise.resolve(ark.frame.captures[lexp.index])
  } else if (lexp instanceof ArkProperty) {
    const obj = await evalArk(ark, lexp.obj)
    if (!(obj instanceof ArkAbstractObjectBase)) {
      throw new ArkRuntimeError(ark, 'Attempt to read property of non-object', lexp)
    }
    try {
      return new ArkPropertyRef(obj, lexp.prop)
    } catch (e) {
      if (e instanceof ArkPropertyRefError) {
        throw new ArkRuntimeError(ark, e.message, lexp)
      }
    }
  }
  throw new Error('invalid ArkLexp')
}

export async function call(ark: ArkState, callable: ArkCallable): Promise<ArkVal> {
  if (callable instanceof ArkClosure) {
    try {
      return await evalArk(ark, callable.body)
    } catch (e) {
      if (e instanceof ArkReturnException) {
        return e.val
      }
      throw e
    }
  } else if (callable instanceof NativeFn) {
    const args = ark.frame.locals.map((ref) => ref.get())
    return Promise.resolve(callable.body(...args))
  } else if (callable instanceof NativeAsyncFn) {
    const args = ark.frame.locals.map((ref) => ref.get())
    return callable.body(...args)
  }
  throw new Error('invalid ArkCallable')
}
