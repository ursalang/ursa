import assert from 'assert'
import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
  Val, intrinsics,
  Null, Bool, Num, Str,
  List, Obj, DictLiteral, SymRef,
  Fn, Fexpr, Prop, Let, Ref, Call, EnvironmentVal, bindArgsToParams,
} from './interp.js'

function paramList(params: any[]): string[] {
  if (params.length === 0 || params[0] !== 'params') {
    throw new Error(`invalid parameter list ${params}`)
  }
  // FIXME: Check params are unique
  for (const param of params.slice(1)) {
    if (typeof param !== 'string') {
      throw new Error(`bad type in list ${params}`)
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

function listToVals(env: EnvironmentVal, l: any): [Val[], Set<string>[]] {
  const compiledList: [Val, Set<string>][] = l.map((v: any) => toVal(env, v))
  return [
    compiledList.map(([a, _fv]) => a), compiledList.map(([_a, fv]) => fv),
  ]
}

function toVal(env: EnvironmentVal, value: any): [Val, Set<string>] {
  if (value === null) {
    return [new Null(), new Set()]
  }
  if (typeof value === 'boolean') {
    return [new Bool(value), new Set()]
  }
  if (typeof value === 'number') {
    return [new Num(value), new Set()]
  }
  if (typeof value === 'string') {
    return [new SymRef(env, value), new Set([value])]
  }
  if (value instanceof Array) {
    if (value.length > 0) {
      switch (value[0]) {
        case 'str':
          if (value.length !== 2 || typeof value[1] !== 'string') {
            throw new Error(`invalid 'str' ${value}`)
          }
          return [new Str(value[1]), new Set()]
        case 'let': {
          if (value.length !== 3) {
            throw new Error("invalid 'let'")
          }
          const params = paramList(value[1])
          const paramBinding = bindArgsToParams(params, [])
          const [body, freeVars] = toVal(env.extend(paramBinding), value[2])
          return [new Let(params, body), setDifference(freeVars, new Set(params))]
        }
        case 'fn': {
          if (value.length !== 3) {
            throw new Error("invalid 'fn'")
          }
          const params = paramList(value[1])
          const paramBinding = bindArgsToParams(params, [])
          const [body, freeVars] = toVal(env.extend(paramBinding), value[2])
          const fnFreeVars = setDifference(freeVars, new Set(params))
          return [new Fn(params, fnFreeVars, body), fnFreeVars]
        }
        case 'fexpr': {
          if (value.length !== 3) {
            throw new Error("invalid 'fexpr'")
          }
          const params = paramList(value[1])
          const paramBinding = bindArgsToParams(params, [])
          const [body, freeVars] = toVal(env.extend(paramBinding), value[2])
          const fexprFreeVars = setDifference(freeVars, new Set(params))
          return [new Fexpr(params, fexprFreeVars, body), fexprFreeVars]
        }
        case 'prop': {
          if (value.length < 3) {
            throw new Error("invalid 'prop'")
          }
          const [ref, refFreeVars] = toVal(env, value[2])
          const [args, argsFreeVars] = listToVals(env, value.slice(3))
          return [new Prop(value[1], ref, args), setsUnion(refFreeVars, ...argsFreeVars)]
        }
        case 'ref': {
          if (value.length !== 2) {
            throw new Error("invalid 'ref'")
          }
          const [val, freeVars] = toVal(env, value[1])
          return [new Ref(val), freeVars]
        }
        case 'list': {
          const [elems, elemsFreeVars] = listToVals(env, value.slice(1))
          return [new List(elems), setsUnion(...elemsFreeVars)]
        }
        case 'map': {
          const inits = new Map<Val, Val>()
          const initsFreeVars = []
          for (const pair of value.slice(1)) {
            assert(pair instanceof Array && pair.length === 2)
            const [key, keyFreeVars] = toVal(env, pair[0])
            const [val, valFreeVars] = toVal(env, pair[1])
            inits.set(key, val)
            initsFreeVars.push(keyFreeVars)
            initsFreeVars.push(valFreeVars)
          }
          return [new DictLiteral(inits), setsUnion(...initsFreeVars)]
        }
        case 'seq': {
          if (value.length === 2) {
            return toVal(env, value[1])
          }
          const [elems, elemsFreeVars] = listToVals(env, value.slice(1))
          return [new Call(intrinsics.seq, elems), setsUnion(...elemsFreeVars)]
        }
        default: {
          const [args, argsFreeVars] = listToVals(env, value.slice(1))
          return [
            new Call(new SymRef(env, value[0]), args),
            setsUnion(new Set<string>([value[0] as string]), ...argsFreeVars),
          ]
        }
      }
    }
  }
  if (typeof value === 'object') {
    const inits: {[key: string]: any} = {}
    const initsFreeVars = []
    for (const key in value) {
      if (Object.hasOwn(value, key)) {
        const [val, freeVars] = toVal(env, value[key])
        inits[key] = val
        initsFreeVars.push(freeVars)
      }
    }
    return [new Obj(inits), setsUnion(...initsFreeVars)]
  }
  throw new Error(`invalid value ${value}`)
}

export function jsonToVal(expr: string): Val {
  const [val, freeVars] = toVal(new EnvironmentVal([]), JSON.parse(expr))
  // debug(freeVars)
  // assert(freeVars.size === 0)
  return val
}
