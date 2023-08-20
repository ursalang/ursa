import assert from 'assert'
import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
  Val, intrinsics,
  Null, Bool, Num, Str,
  List, Obj, DictLiteral, SymRef,
  Fn, Fexpr, Prop, Let, Ref, Call, EnvironmentVal, bindArgsToParams,
} from './interp.js'

function jsParamList(params: any[]) {
  if (params.length === 0 || params[0] !== 'params') {
    throw new Error(`invalid parameter list ${params}`)
  }
  for (const param of params.slice(1)) {
    if (typeof param !== 'string') {
      throw new Error(`bad parameter list ${params}`)
    }
  }
  return params.slice(1)
}

function setDifference<T>(setA: Set<T>, setB: Set<T>) {
  const difference = new Set(setA)
  for (const elem of setB) {
    difference.delete(elem)
  }
  return difference
}

function setsUnion<T>(...sets: Set<T>[]): Set<T> {
  return new Set(sets.flatMap((s) => [...s.values()]))
}

// Get free variables, and check arity of intrinsics calls.
// FIXME: memoize this function in toVal.
export function freeVars(value: any): Set<string> {
  if (typeof value === 'string') {
    return new Set([value])
  }
  if (typeof value !== 'object') {
    return new Set()
  }
  if (!(value instanceof Array) || value.length === 0) {
    return setsUnion(...Object.values(value).map(freeVars))
  }
  // Use enum for intrinsics.
  switch (value[0]) {
    case 'str':
      if (value.length < 2) {
        throw new Error("invalid 'str'")
      }
      return new Set()
    case 'let':
    case 'fn':
    case 'fexpr': {
      if (value.length !== 3) {
        throw new Error(`invalid '${value[0]}'`)
      }
      return setDifference(freeVars(value[2]), freeVars(value[1]))
    }
    case 'prop':
      if (value.length < 3) {
        throw new Error(`invalid 'prop' ${value}`)
      }
      return setsUnion(...value.slice(2).map(freeVars))
    case 'ref':
      if (value.length < 2) {
        throw new Error(`invalid '${value[0]}'`)
      }
    // eslint-disable-next-line no-fallthrough
    case 'map':
    case 'list':
    case 'seq':
    case 'params':
      return setsUnion(...value.slice(1).map(freeVars))
    default:
      return setsUnion(...value.map(freeVars))
  }
}

function toVal(env: EnvironmentVal, value: any): Val {
  if (value === null) {
    return new Null()
  }
  if (typeof value === 'boolean') {
    return new Bool(value)
  }
  if (typeof value === 'number') {
    return new Num(value)
  }
  if (typeof value === 'string') {
    return new SymRef(env, value)
  }
  if (value instanceof Array) {
    if (value.length > 0) {
      // FIXME: Use keywords as an enum for this switch
      switch (value[0]) {
        case 'str':
          if (value.length !== 2 || typeof value[1] !== 'string') {
            throw new Error(`invalid 'str' ${value}`)
          }
          return new Str(value[1])
        case 'let': {
          if (value.length !== 3) {
            throw new Error("invalid 'let'")
          }
          const params = jsParamList(value[1])
          const paramBinding = bindArgsToParams(params, [])
          return new Let(params, toVal(env.extend(paramBinding), value[2]))
        }
        case 'fn': {
          if (value.length !== 3) {
            throw new Error("invalid 'fn'")
          }
          const params = jsParamList(value[1])
          const paramBinding = bindArgsToParams(params, [])
          return new Fn(params, freeVars(value), toVal(env.extend(paramBinding), value[2]))
        }
        case 'fexpr': {
          if (value.length !== 3) {
            throw new Error("invalid 'fexpr'")
          }
          const params = jsParamList(value[1])
          const paramBinding = bindArgsToParams(params, [])
          return new Fexpr(params, freeVars(value), toVal(env.extend(paramBinding), value[2]))
        }
        case 'prop': {
          if (value.length < 3) {
            throw new Error(`invalid 'prop' ${value}`)
          }
          return new Prop(value[1], toVal(env, value[2]), value.slice(3).map((v) => toVal(env, v)))
        }
        case 'ref':
          if (value.length !== 2) {
            throw new Error("invalid 'ref'")
          }
          return new Ref(toVal(env, value[1]))
        case 'list':
          return new List(value.slice(1).map((v) => toVal(env, v)))
        case 'map': {
          const inits = new Map<Val, Val>()
          for (const pair of value.slice(1)) {
            assert(pair instanceof Array && pair.length === 2)
            inits.set(toVal(env, pair[0]), toVal(env, pair[1]))
          }
          return new DictLiteral(inits)
        }
        case 'seq':
          return new Call(intrinsics.seq, value.slice(1).map((v) => toVal(env, v)))
        default:
          return new Call(new SymRef(env, value[0]), value.slice(1).map((v) => toVal(env, v)))
      }
    }
  }
  if (typeof value === 'object') {
    const inits: {[key: string]: any} = {}
    for (const key in value) {
      if (Object.hasOwn(value, key)) {
        inits[key] = toVal(env, value[key])
      }
    }
    return new Obj(inits)
  }
  throw new Error(`invalid value ${value}`)
}

export function jsonToVal(expr: string): Val {
  return toVal(new EnvironmentVal([]), JSON.parse(expr))
}
