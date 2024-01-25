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
  ArkGet, ArkSet, ArkLocalRef, ArkCaptureRef,
  ArkListLiteral, ArkObjectLiteral, ArkMapLiteral,
  ArkFn, ArkReturn, ArkProperty, ArkLet, ArkCall, ArkLiteral, ArkObject,
} from './interpreter.js'

export class ArkCompilerError extends Error {}

export class Frame {
  constructor(
    // Local variable names are undefined between the point where they are
    // allocated and the point at which they are declared.
    public locals: (string | undefined)[],
    public captures: string[],
  ) {}
}

export class Environment {
  constructor(
    public stack: [Frame, ...Frame[]] = [new Frame([], [])],
    public externalSyms: ArkObject = globals,
  ) {}

  top() {
    return this.stack[0]
  }

  push(items: (string | undefined)[]) {
    return new Environment(
      [
        new Frame(
          [...this.top().locals, ...items],
          this.top().captures,
        ),
        ...this.stack.slice(1),
      ],
      this.externalSyms,
    )
  }

  pushFrame(frame: Frame) {
    return new Environment([frame, ...this.stack], this.externalSyms)
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
      throw new ArkCompilerError('invalid let variable binding')
    }
  }
  const paramNames = arkParamList(params.map((p) => p[0]))
  for (const p of params) {
    bindings.push([p[0], doCompile(env.push(paramNames), p[1])])
  }
  return bindings
}

function listToVals(env: Environment, l: unknown[]): ArkExp[] {
  return l.map((elem) => doCompile(env, elem))
}

export function symRef(env: Environment, name: string): ArkExp {
  // Check whether the symbol is an intrinsic.
  const val = intrinsics.get(name)
  if (val !== undefined) {
    return new ArkLiteral(val)
  }
  let ref
  // Check whether the symbol is a local.
  const j = env.top().locals.lastIndexOf(name)
  if (j !== -1) {
    ref = new ArkLocalRef(j)
  } else {
    // Otherwise, check if it's a capture.
    // Check whether we already have this capture.
    const k = env.top().captures.lastIndexOf(name)
    if (k !== -1) {
      ref = new ArkCaptureRef(k)
    } else {
      // If not, see if it's on the stack to be captured.
      for (let i = 0; i < env.stack.length; i += 1) {
        const j = env.stack[i].locals.lastIndexOf(name)
        if (j !== -1) {
          const k = env.top().captures.length
          ref = new ArkCaptureRef(k)
          env.top().captures.push(name)
          break
        }
      }
    }
  }
  // Finally, see if it's a global, and if not, error.
  if (ref === undefined) {
    ref = env.externalSyms.get(name)
    if (ref === undefined) {
      throw new ArkCompilerError(`Undefined symbol ${name}`)
    }
  }
  ref.debug.name = name
  ref.debug.env = JSON.stringify(env)
  return new ArkLiteral(ref)
}

function doCompile(env: Environment, value: unknown): ArkExp {
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
          const params = arkBindingList(env, value[1] as [string, unknown][])
          const compiled = doCompile(env.push(params.map((p) => p[0])), value[2])
          return new ArkLet(params, compiled)
        }
        case 'fn': {
          if (value.length !== 3 || !(value[1] instanceof Array)) {
            throw new ArkCompilerError("Invalid 'fn'")
          }
          const params = arkParamList(value[1] as string[])
          const innerEnv = env.pushFrame(new Frame(params, []))
          const compiled = doCompile(innerEnv, value[2])
          return new ArkFn(params, innerEnv.stack[0].captures.map((c) => symRef(env, c)), compiled)
        }
        case 'prop': {
          if (value.length !== 3 || typeof value[1] !== 'string') {
            throw new ArkCompilerError("Invalid 'prop'")
          }
          const compiled = doCompile(env, value[2])
          return new ArkProperty(value[1], compiled)
        }
        case 'ref': {
          if (value.length !== 2) {
            throw new ArkCompilerError("Invalid 'ref'")
          }
          const compiled = doCompile(env, value[1])
          return new ArkLiteral(compiled)
        }
        case 'get': {
          if (value.length !== 2) {
            throw new ArkCompilerError("Invalid 'get'")
          }
          const compiled = doCompile(env, value[1])
          return new ArkGet(compiled)
        }
        case 'set': {
          if (value.length !== 3) {
            throw new ArkCompilerError("Invalid 'set'")
          }
          const compiledRef = doCompile(env, value[1])
          const compiledVal = doCompile(env, value[2])
          return new ArkSet(compiledRef, compiledVal)
        }
        case 'list': {
          const elems = listToVals(env, value.slice(1))
          return new ArkListLiteral(elems)
        }
        case 'map': {
          const inits = new Map<ArkExp, ArkExp>()
          for (const pair of value.slice(1)) {
            assert(pair instanceof Array && pair.length === 2)
            const compiledKey = doCompile(env, pair[0])
            const compiledVal = doCompile(env, pair[1])
            inits.set(compiledKey, compiledVal)
          }
          return new ArkMapLiteral(inits)
        }
        case 'seq': {
          if (value.length === 2) {
            return doCompile(env, value[1])
          }
          const elems = listToVals(env, value.slice(1))
          return new ArkSequence(elems)
        }
        case 'if': {
          if (value.length < 3 || value.length > 4) {
            throw new ArkCompilerError("Invalid 'if'")
          }
          const compiledCond = doCompile(env, value[1])
          const compiledThen = doCompile(env, value[2])
          let compiledElse
          if (value.length === 4) {
            compiledElse = doCompile(env, value[3])
          }
          return new ArkIf(compiledCond, compiledThen, compiledElse)
        }
        case 'and': {
          if (value.length !== 3) {
            throw new ArkCompilerError("Invalid 'and'")
          }
          const compiledLeft = doCompile(env, value[1])
          const compiledRight = doCompile(env, value[2])
          return new ArkAnd(compiledLeft, compiledRight)
        }
        case 'or': {
          if (value.length !== 3) {
            throw new ArkCompilerError("Invalid 'or'")
          }
          const compiledLeft = doCompile(env, value[1])
          const compiledRight = doCompile(env, value[2])
          return new ArkOr(compiledLeft, compiledRight)
        }
        case 'loop': {
          if (value.length !== 2) {
            throw new ArkCompilerError("Invalid 'loop'")
          }
          const compiledBody = doCompile(env, value[1])
          return new ArkLoop(compiledBody)
        }
        case 'break': {
          if (value.length < 1 || value.length > 2) {
            throw new ArkCompilerError("Invalid 'break'")
          }
          if (value.length === 2) {
            const compiledBody = doCompile(env, value[1])
            return new ArkBreak(compiledBody)
          }
          return new ArkBreak()
        }
        case 'continue': {
          if (value.length !== 2) {
            throw new ArkCompilerError("Invalid 'continue'")
          }
          return new ArkContinue()
        }
        case 'return': {
          if (value.length < 1 || value.length > 2) {
            throw new ArkCompilerError("Invalid 'return'")
          }
          if (value.length === 2) {
            const compiledBody = doCompile(env, value[1])
            return new ArkReturn(compiledBody)
          }
          return new ArkReturn()
        }
        default: {
          const compiledFn = doCompile(env, value[0])
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
        const compiled = doCompile(env, (value as {[key: string]: unknown})[key])
        inits.set(key, compiled)
      }
    }
    return new ArkObjectLiteral(inits)
  }
  throw new ArkCompilerError(`Invalid value ${value}`)
}

export function compile(expr: unknown, env = new Environment()): ArkExp {
  return doCompile(env, expr)
}

// Compile the prelude and add its values to the globals
const ark = new ArkState()
const prelude = compile(preludeJson)
const preludeObj = await prelude.eval(ark) as ArkObject
for (const [sym, val] of preludeObj.properties) {
  globals.set(sym, new ArkValRef(val))
}
