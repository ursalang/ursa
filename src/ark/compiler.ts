// Compile JSON into Ark code.
// © Reuben Thomas 2023-2024
// Released under the MIT license.

import assert from 'assert'

import preludeJson from './prelude.json' assert {type: 'json'}
import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
  ArkState, ArkExp, ArkValRef, intrinsics, globals,
  ArkIf, ArkAnd, ArkOr, ArkSequence, ArkLoop, ArkBreak, ArkContinue,
  ArkNull, ArkBoolean, ArkNumber, ArkString,
  ArkGet, ArkSet, ArkStackRef, ArkCaptureRef,
  ArkListLiteral, ArkObjectLiteral, ArkMapLiteral,
  ArkFn, ArkReturn, ArkProperty, ArkLet, ArkCall, ArkLiteral, ArkObject,
} from './interpreter.js'

export class ArkCompilerError extends Error { }

export class FreeVars extends Map<string, ArkStackRef> {
  merge(moreVars: FreeVars): FreeVars {
    for (const [name, symref] of moreVars) {
      this.set(name, symref)
    }
    return this
  }
}

type Frame = [(string | undefined)[], string[]]

export class Environment {
  // Each stack frame consists of a pair of local variables and captures.
  // Local variable names are undefined between the point where they are
  // allocated and the point at which they are declared.
  constructor(
    public stack: [Frame, ...Frame[]] = [[[], []]],
    public externalSyms: ArkObject = globals,
  ) { }

  push(items: (string | undefined)[]) {
    return new Environment(
      [[[...this.stack[0][0].slice(), ...items], this.stack[0][1]], ...this.stack.slice(1)],
    )
  }

  pushFrame(frame: [string[], string[]]) {
    return new Environment([frame, ...this.stack.slice()])
  }
}

export function checkParamList(params: string[]): string[] {
  if (new Set(params).size !== params.length) {
    throw new ArkCompilerError('Duplicate parameters in list')
  }
  return params
}

export function arkParamList(params: string[]): string[] {
  for (const param of params) {
    if (typeof param !== 'string') {
      throw new ArkCompilerError('Bad type in parameter list')
    }
  }
  return checkParamList(params)
}

export function arkBindingList(env: Environment, params: [string, unknown][]): [string, ArkExp][] {
  const bindings: [string, ArkExp][] = []
  for (const p of params) {
    if (!(p instanceof Array) || p.length !== 2 || typeof p[0] !== 'string') {
      throw new ArkCompilerError("invalid 'let' variable binding")
    }
  }
  const paramNames = arkParamList(params.map((p) => p[0]))
  for (const p of params) {
    bindings.push([p[0], doCompile(env.push(paramNames), p[1]).value])
  }
  return bindings
}

function listToVals(env: Environment, l: unknown[]): [ArkExp[], FreeVars] {
  const vals = []
  const freeVars = new FreeVars()
  for (const v of l) {
    const compiled = doCompile(env, v)
    vals.push(compiled.value)
    freeVars.merge(compiled.freeVars)
  }
  return [vals, freeVars]
}

export function symRef(env: Environment, name: string): CompiledArk {
  const val = intrinsics.get(name)
  if (val !== undefined) {
    return new CompiledArk(new ArkLiteral(val))
  }
  let ref
  for (let i = 0; i < env.stack.length; i += 1) {
    const j = env.stack[i][0].lastIndexOf(name)
    if (j !== -1) {
      ref = new ArkStackRef(i, j)
      break
    }
    if (i === 0) {
      const k = env.stack[0][1].lastIndexOf(name)
      if (k !== -1) {
        ref = new ArkCaptureRef(k)
        break
      }
    }
  }
  const freeVars = new FreeVars(ref instanceof ArkStackRef ? [[name, ref]] : [])
  if (ref instanceof ArkStackRef && ref.level > 0) {
    // Reference to outer stack level: capture it.
    const k = env.stack[0][1].length
    ref = new ArkCaptureRef(k)
    env.stack[0][1].push(name)
  }
  if (ref === undefined) {
    ref = env.externalSyms.get(name)
    if (ref === undefined) {
      throw new ArkCompilerError(`Undefined symbol ${name}`)
    }
  }
  ref.debug.name = name
  ref.debug.env = JSON.stringify(env)
  return new CompiledArk(new ArkLiteral(ref), freeVars)
}

export class CompiledArk {
  constructor(public value: ArkExp, public freeVars: FreeVars = new FreeVars()) { }
}

export class PartialCompiledArk extends CompiledArk {
  constructor(
    public value: ArkExp,
    public freeVars: FreeVars = new FreeVars(),
    public boundVars: string[] = [],
  ) {
    super(value, freeVars)
  }
}

function doCompile(env: Environment, value: unknown): CompiledArk {
  if (value === null) {
    return new CompiledArk(new ArkLiteral(ArkNull()))
  }
  if (typeof value === 'boolean') {
    return new CompiledArk(new ArkLiteral(ArkBoolean(value)))
  }
  if (typeof value === 'number') {
    return new CompiledArk(new ArkLiteral(ArkNumber(value)))
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
          return new CompiledArk(new ArkLiteral(ArkString(value[1])))
        case 'let': {
          if (value.length !== 3 || !(value[1] instanceof Array)) {
            throw new ArkCompilerError("Invalid 'let'")
          }
          const params = arkBindingList(env, value[1] as [string, unknown][])
          const compiled = doCompile(env.push(params.map((p) => p[0])), value[2])
          params.forEach((p) => compiled.freeVars.delete(p[0]))
          return new CompiledArk(new ArkLet(params, compiled.value), compiled.freeVars)
        }
        case 'fn': {
          if (value.length !== 3 || !(value[1] instanceof Array)) {
            throw new ArkCompilerError("Invalid 'fn'")
          }
          const params = arkParamList(value[1] as string[])
          const compiled = doCompile(env.pushFrame([params, []]), value[2])
          params.forEach((p) => compiled.freeVars.delete(p))
          return new CompiledArk(
            new ArkFn(params, [...compiled.freeVars.values()].flat(), compiled.value),
            compiled.freeVars,
          )
        }
        case 'prop': {
          if (value.length !== 3 || typeof value[1] !== 'string') {
            throw new ArkCompilerError("Invalid 'prop'")
          }
          const compiled = doCompile(env, value[2])
          return new CompiledArk(new ArkProperty(value[1], compiled.value), compiled.freeVars)
        }
        case 'ref': {
          if (value.length !== 2) {
            throw new ArkCompilerError("Invalid 'ref'")
          }
          const compiled = doCompile(env, value[1])
          return new CompiledArk(new ArkLiteral(compiled.value), compiled.freeVars)
        }
        case 'get': {
          if (value.length !== 2) {
            throw new ArkCompilerError("Invalid 'get'")
          }
          const compiled = doCompile(env, value[1])
          return new CompiledArk(new ArkGet(compiled.value), compiled.freeVars)
        }
        case 'set': {
          if (value.length !== 3) {
            throw new ArkCompilerError("Invalid 'set'")
          }
          const compiledRef = doCompile(env, value[1])
          const compiledVal = doCompile(env, value[2])
          const freeVars = new FreeVars(compiledVal.freeVars).merge(compiledRef.freeVars)
          return new CompiledArk(new ArkSet(compiledRef.value, compiledVal.value), freeVars)
        }
        case 'list': {
          const [elems, elemsFreeVars] = listToVals(env, value.slice(1))
          return new CompiledArk(new ArkListLiteral(elems), elemsFreeVars)
        }
        case 'map': {
          const inits = new Map<ArkExp, ArkExp>()
          const initsFreeVars = new FreeVars()
          for (const pair of value.slice(1)) {
            assert(pair instanceof Array && pair.length === 2)
            const compiledKey = doCompile(env, pair[0])
            const compiledVal = doCompile(env, pair[1])
            inits.set(compiledKey.value, compiledVal.value)
            initsFreeVars.merge(compiledKey.freeVars)
            initsFreeVars.merge(compiledVal.freeVars)
          }
          return new CompiledArk(new ArkMapLiteral(inits), initsFreeVars)
        }
        case 'seq': {
          if (value.length === 2) {
            return doCompile(env, value[1])
          }
          const [elems, elemsFreeVars] = listToVals(env, value.slice(1))
          return new CompiledArk(new ArkSequence(elems), elemsFreeVars)
        }
        case 'if': {
          if (value.length < 3 || value.length > 4) {
            throw new ArkCompilerError("Invalid 'if'")
          }
          const compiledCond = doCompile(env, value[1])
          const compiledThen = doCompile(env, value[2])
          const freeVars = new FreeVars(compiledCond.freeVars).merge(compiledThen.freeVars)
          let compiledElse
          if (value.length === 4) {
            compiledElse = doCompile(env, value[3])
            freeVars.merge(compiledElse.freeVars)
          }
          return new CompiledArk(new ArkIf(
            compiledCond.value,
            compiledThen.value,
            compiledElse ? compiledElse.value : undefined,
          ), freeVars)
        }
        case 'and': {
          if (value.length !== 3) {
            throw new ArkCompilerError("Invalid 'and'")
          }
          const compiledLeft = doCompile(env, value[1])
          const compiledRight = doCompile(env, value[2])
          const freeVars = new FreeVars(compiledLeft.freeVars).merge(compiledRight.freeVars)
          return new CompiledArk(new ArkAnd(compiledLeft.value, compiledRight.value), freeVars)
        }
        case 'or': {
          if (value.length !== 3) {
            throw new ArkCompilerError("Invalid 'or'")
          }
          const compiledLeft = doCompile(env, value[1])
          const compiledRight = doCompile(env, value[2])
          const freeVars = new FreeVars(compiledLeft.freeVars).merge(compiledRight.freeVars)
          return new CompiledArk(new ArkOr(compiledLeft.value, compiledRight.value), freeVars)
        }
        case 'loop': {
          if (value.length !== 2) {
            throw new ArkCompilerError("Invalid 'loop'")
          }
          const compiledBody = doCompile(env, value[1])
          return new CompiledArk(new ArkLoop(compiledBody.value), compiledBody.freeVars)
        }
        case 'break': {
          if (value.length < 1 || value.length > 2) {
            throw new ArkCompilerError("Invalid 'break'")
          }
          if (value.length === 2) {
            const compiledBody = doCompile(env, value[1])
            return new CompiledArk(new ArkBreak(compiledBody.value), compiledBody.freeVars)
          }
          return new CompiledArk(new ArkBreak())
        }
        case 'continue': {
          if (value.length !== 2) {
            throw new ArkCompilerError("Invalid 'continue'")
          }
          return new CompiledArk(new ArkContinue())
        }
        case 'return': {
          if (value.length < 1 || value.length > 2) {
            throw new ArkCompilerError("Invalid 'return'")
          }
          if (value.length === 2) {
            const compiledBody = doCompile(env, value[1])
            return new CompiledArk(new ArkReturn(compiledBody.value), compiledBody.freeVars)
          }
          return new CompiledArk(new ArkReturn())
        }
        default: {
          const compiledFn = doCompile(env, value[0])
          const [args, argsFreeVars] = listToVals(env, value.slice(1))
          const freeVars = argsFreeVars.merge(compiledFn.freeVars)
          return new CompiledArk(new ArkCall(compiledFn.value, args), freeVars)
        }
      }
    }
  }
  if (typeof value === 'object') {
    const inits = new Map<string, ArkExp>()
    const initsFreeVars = new FreeVars()
    for (const key in value) {
      if (Object.hasOwn(value, key)) {
        const compiled = doCompile(env, (value as {[key: string]: unknown})[key])
        inits.set(key, compiled.value)
        initsFreeVars.merge(compiled.freeVars)
      }
    }
    return new CompiledArk(new ArkObjectLiteral(inits), initsFreeVars)
  }
  throw new ArkCompilerError(`Invalid value ${value}`)
}

export function compile(
  expr: unknown,
  env: Environment = new Environment(),
): CompiledArk {
  const compiled = doCompile(env, expr)
  env.externalSyms.properties.forEach((_val, id) => compiled.freeVars.delete(id))
  return compiled
}

// Compile the prelude and add its values to the globals
const ark = new ArkState()
const prelude = compile(preludeJson)
const preludeObj = await prelude.value.eval(ark) as ArkObject
for (const [sym, val] of preludeObj.properties) {
  globals.set(sym, new ArkValRef(val))
}
