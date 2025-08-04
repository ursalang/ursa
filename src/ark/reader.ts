// Compile JSON into Ark code.
// © Reuben Thomas 2023-2025
// Released under the MIT license.

import {Interval} from 'ohm-js'

import preludeJson from './prelude.json' with {type: 'json'}
import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
} from './util.js'
import {
  globals, ArkNull, ArkBoolean, ArkNumber, ArkString, ArkStruct, ArkUndefined,
  globalTypes,
} from './data.js'
import {ArkCompilerError} from './error.js'
import {ArkType} from './type.js'
import {
  ArkExp, ArkLvalue, ArkIf, ArkAnd, ArkOr, ArkSequence, ArkLoop, ArkBreak, ArkContinue,
  ArkSet, ArkLocal, ArkCapture, ArkListLiteral, ArkStructLiteral, ArkMapLiteral,
  ArkFn, ArkGenerator, ArkReturn, ArkYield,
  ArkProperty, ArkLet, ArkCall, ArkInvoke, ArkLiteral, ArkBoundVar, ArkNamedLoc,
  ArkGlobal,
} from './code.js'
import {
  Environment, Frame, Location,
} from './compiler-utils.js'
import {expToInst} from './flatten.js'
import {ArkState} from './interpreter.js'
import {typecheck} from './type-check.js'

export function checkParamList(params: string[], source?: Interval): string[] {
  if (new Set(params).size !== params.length) {
    throw new ArkCompilerError('Duplicate parameters in list', source)
  }
  return params
}

function getType(name: string): ArkType {
  const ty = globalTypes.get(name)
  if (ty === undefined) {
    throw new ArkCompilerError(`unknown type ${name}`)
  }
  return ty
}

export function symRef(env: Environment, name: string): ArkExp {
  let exp
  // Check whether the symbol is a local.
  const locals = env.top().locals
  const j = locals.map((l) => l?.name).lastIndexOf(name)
  if (j !== -1) {
    exp = new ArkLocal(j, locals[j]!)
  } else {
    // Otherwise, check if it's a capture.
    // Check whether we already have this capture.
    const captures = env.top().captures
    const k = captures.map((c) => c.name).lastIndexOf(name)
    if (k !== -1) {
      exp = new ArkCapture(k, captures[k])
    } else {
      // If not, see if it's on the stack to be captured.
      for (let i = 0; i < env.stack.length; i += 1) {
        const locals = env.stack[i].locals
        const j = locals.map((l) => l?.name).lastIndexOf(name)
        if (j !== -1) {
          const k = env.top().captures.length
          exp = new ArkCapture(k, locals[j]!)
          env.top().captures.push(locals[j]!)
          break
        }
      }
    }
  }
  // Finally, see if it's a global, and if not, error.
  if (exp === undefined) {
    const extern = env.externalSyms.get(name)
    if (extern === undefined || extern === ArkUndefined()) {
      throw new ArkCompilerError(`Undefined symbol ${name}`)
    }
    exp = new ArkGlobal(name, extern, extern.type)
  }
  exp.debug.name = name
  exp.debug.env = JSON.stringify(env)
  return exp
}

function doCompile(env: Environment, value: unknown, outerFn?: ArkFn, outerLoop?: ArkLoop): ArkExp {
  function bindingList(
    env: Environment,
    params: [string, string, string, unknown][],
  ): ArkBoundVar[] {
    const bindings: ArkBoundVar[] = []
    for (const p of params) {
      if (!(p instanceof Array) || p.length !== 4
        || typeof p[0] !== 'string' || ['const', 'var'].includes(p[1]) || typeof p[2] !== 'string') {
        throw new ArkCompilerError(`invalid let variable binding ${p}`)
      }
    }
    const boundLocations = params.map((p) => new Location(p[1], getType(p[2]), p[0] === 'var'))
    checkParamList(boundLocations.map((l) => l.name))
    const indexBase = env.top().locals.length
    for (const [i, l] of boundLocations.entries()) {
      bindings.push(new ArkBoundVar(
        l,
        indexBase + i,
        doCompile(env.push(boundLocations), params[i][3], outerFn, outerLoop),
      ))
    }
    return bindings
  }

  function listToVals(env: Environment, l: unknown[]): ArkExp[] {
    return l.map((elem) => doCompile(env, elem, outerFn, outerLoop))
  }

  if (value === null) {
    return new ArkLiteral(ArkNull())
  }
  if (typeof value === 'boolean') {
    return new ArkLiteral(ArkBoolean(value))
  }
  if (typeof value === 'number') {
    return new ArkLiteral(ArkNumber(value))
  }
  if (typeof value === 'string') {
    return symRef(env, value)
  }
  if (value instanceof Array) {
    if (value.length > 0) {
      switch (value[0]) {
        case 'str':
          if (value.length !== 2 || typeof value[1] !== 'string') {
            throw new ArkCompilerError(`Invalid 'str' ${value}`)
          }
          return new ArkLiteral(ArkString(value[1]))
        case 'let': {
          if (value.length !== 3 || !(value[1] instanceof Array)) {
            throw new ArkCompilerError("Invalid 'let'")
          }
          const params = bindingList(env, value[1] as [string, string, string, unknown][])
          const compiled = doCompile(
            env.push(params.map((p) => p.location)),
            value[2],
            outerFn,
            outerLoop,
          )
          return new ArkLet(params, compiled)
        }
        case 'fn':
        case 'gen': {
          if (value.length !== 4 || !(value[1] instanceof Array) || typeof value[2] !== 'string') {
            throw new ArkCompilerError(`Invalid '${value[0]}'`)
          }
          const params = value[1].map(
            (p) => {
              if (!(p instanceof Array) || p.length !== 2 || typeof p[0] !== 'string' || typeof p[1] !== 'string') {
                throw new ArkCompilerError('Invalid function parameter')
              }
              return new Location(p[0], getType(p[1]), false)
            },
          )
          checkParamList(params.map((p) => p.name))
          const innerEnv = env.pushFrame(new Frame(params, []))
          const fn = new (value[0] === 'fn' ? ArkFn : ArkGenerator)(
            params,
            getType(value[2]),
            [],
            new ArkExp(),
          )
          fn.body = doCompile(innerEnv, value[3], fn, outerLoop)
          fn.capturedVars = innerEnv.top().captures.map((c) => symRef(env, c.name) as ArkNamedLoc)
          return fn
        }
        case 'prop': {
          if (value.length !== 3 || typeof value[1] !== 'string') {
            throw new ArkCompilerError("Invalid 'prop'")
          }
          const compiled = doCompile(env, value[2], outerFn, outerLoop)
          return new ArkProperty(compiled, value[1])
        }
        case 'set': {
          if (value.length !== 3) {
            throw new ArkCompilerError("Invalid 'set'")
          }
          const compiledRef = doCompile(env, value[1], outerFn, outerLoop)
          if (!(compiledRef instanceof ArkLvalue)) {
            throw new ArkCompilerError('Invalid lvalue')
          }
          if (compiledRef instanceof ArkNamedLoc && !compiledRef.location.isVar) {
            throw new ArkCompilerError("Cannot assign to non-'var'")
          }
          const compiledVal = doCompile(env, value[2], outerFn, outerLoop)
          return new ArkSet(compiledRef, compiledVal)
        }
        case 'list': {
          const elems = listToVals(env, value.slice(1))
          return new ArkListLiteral(elems)
        }
        case 'map': {
          const inits = new Map<ArkExp, ArkExp>()
          for (const pair of value.slice(1)) {
            if (!(pair instanceof Array && pair.length === 2)) {
              throw new ArkCompilerError('Invalid map element')
            }
            const compiledKey = doCompile(env, pair[0], outerFn, outerLoop)
            const compiledVal = doCompile(env, pair[1], outerFn, outerLoop)
            inits.set(compiledKey, compiledVal)
          }
          return new ArkMapLiteral(inits)
        }
        case 'seq': {
          if (value.length === 2) {
            return doCompile(env, value[1], outerFn, outerLoop)
          }
          const elems = listToVals(env, value.slice(1))
          return new ArkSequence(elems)
        }
        case 'if': {
          if (value.length < 3 || value.length > 4) {
            throw new ArkCompilerError("Invalid 'if'")
          }
          const compiledCond = doCompile(env, value[1], outerFn, outerLoop)
          const compiledThen = doCompile(env, value[2], outerFn, outerLoop)
          let compiledElse
          if (value.length === 4) {
            compiledElse = doCompile(env, value[3], outerFn, outerLoop)
          }
          return new ArkIf(compiledCond, compiledThen, compiledElse)
        }
        case 'and': {
          if (value.length !== 3) {
            throw new ArkCompilerError("Invalid 'and'")
          }
          const compiledLeft = doCompile(env, value[1], outerFn, outerLoop)
          const compiledRight = doCompile(env, value[2], outerFn, outerLoop)
          return new ArkAnd(compiledLeft, compiledRight)
        }
        case 'or': {
          if (value.length !== 3) {
            throw new ArkCompilerError("Invalid 'or'")
          }
          const compiledLeft = doCompile(env, value[1], outerFn, outerLoop)
          const compiledRight = doCompile(env, value[2], outerFn, outerLoop)
          return new ArkOr(compiledLeft, compiledRight)
        }
        case 'loop': {
          if (value.length !== 2) {
            throw new ArkCompilerError("Invalid 'loop'")
          }
          const loop = new ArkLoop(new ArkExp(), env.top().locals.length)
          loop.body = doCompile(env, value[1], outerFn, loop)
          return loop
        }
        case 'break': {
          if (value.length < 1 || value.length > 2) {
            throw new ArkCompilerError("Invalid 'break'")
          }
          if (outerLoop === undefined) {
            throw new ArkCompilerError('break used outside a loop')
          }
          if (value.length === 2) {
            const compiledBody = doCompile(env, value[1], outerFn, outerLoop)
            return new ArkBreak(outerLoop, compiledBody)
          }
          return new ArkBreak(outerLoop)
        }
        case 'continue': {
          if (value.length !== 2) {
            throw new ArkCompilerError("Invalid 'continue'")
          }
          return new ArkContinue()
        }
        case 'return':
        case 'yield': {
          if (value.length < 1 || value.length > 2) {
            throw new ArkCompilerError(`Invalid '${value[0]}'`)
          }
          if (outerFn === undefined) {
            throw new ArkCompilerError(`${value[0]} used outside a function`)
          }
          const Constructor = value[0] === 'return' ? ArkReturn : ArkYield
          if (value.length === 2) {
            const compiledBody = doCompile(env, value[1], outerFn, outerLoop)
            return new Constructor(outerFn, compiledBody)
          }
          return new Constructor(outerFn)
        }
        case 'invoke': {
          if (value.length < 3 || typeof value[2] !== 'string') {
            throw new ArkCompilerError("Invalid 'invoke'")
          }
          const compiledObj = doCompile(env, value[1], outerFn, outerLoop)
          const args = listToVals(env, value.slice(3))
          return new ArkInvoke(compiledObj, value[2], args)
        }
        default: {
          const compiledFn = doCompile(env, value[0], outerFn, outerLoop)
          const args = listToVals(env, value.slice(1))
          return new ArkCall(compiledFn, args)
        }
      }
    }
  }
  if (typeof value === 'object') {
    const inits = new Map<string, ArkExp>()
    for (const key in value) {
      if (Object.hasOwn(value, key)) {
        const compiled = doCompile(
          env,
          (value as {[key: string]: unknown})[key],
          outerFn,
          outerLoop,
        )
        inits.set(key, compiled)
      }
    }
    return new ArkStructLiteral(inits)
  }
  throw new ArkCompilerError(`Invalid value ${value}`)
}

export function compile(expr: unknown, env = new Environment()): ArkExp {
  const exp = doCompile(env, expr)
  typecheck(exp)
  return exp
}

// Compile the prelude and add its values to the globals
const prelude = expToInst(compile(preludeJson))
const preludeObj = await new ArkState(prelude).run() as ArkStruct
preludeObj.members.forEach((val, sym) => globals.set(sym, val))
