import assert from 'assert'
import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
  Val, intrinsics,
  Null, Bool, Num, Str,
  List, Obj, DictLiteral, SymRef,
  Fn, Fexpr, Prop, Let, Ref, Call, Environment, bindArgsToParams,
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

function listToVals(env: Environment, l: any): [Val[], Set<string>[]] {
  const compiledList: [Val, Set<string>][] = l.map((v: any) => doCompile(v, env))
  return [
    compiledList.map(([a, _fv]) => a), compiledList.map(([_a, fv]) => fv),
  ]
}

export function symRef(env: Environment, name: string): [Val, Set<string>] {
  const val = intrinsics[name]
  if (val) {
    return [val, new Set()]
  }
  return [new SymRef(name), new Set([name])]
}

export type CompiledArk = [value: Val, freeVars: Set<string>]

function doCompile(value: any, env: Environment = new Environment([])): CompiledArk {
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
    return symRef(env, value)
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
          const [body, freeVars] = doCompile(value[2], env.extend(paramBinding))
          return [new Let(params, body), setDifference(freeVars, new Set(params))]
        }
        case 'fn': {
          if (value.length !== 3) {
            throw new Error("invalid 'fn'")
          }
          const params = paramList(value[1])
          const paramBinding = bindArgsToParams(params, [])
          const [body, freeVars] = doCompile(value[2], env.extend(paramBinding))
          const fnFreeVars = setDifference(freeVars, new Set(params))
          return [new Fn(params, fnFreeVars, body), fnFreeVars]
        }
        case 'fexpr': {
          if (value.length !== 3) {
            throw new Error("invalid 'fexpr'")
          }
          const params = paramList(value[1])
          const paramBinding = bindArgsToParams(params, [])
          const [body, freeVars] = doCompile(env.extend(paramBinding), value[2])
          const fexprFreeVars = setDifference(freeVars, new Set(params))
          return [new Fexpr(params, fexprFreeVars, body), fexprFreeVars]
        }
        case 'prop': {
          if (value.length < 3) {
            throw new Error("invalid 'prop'")
          }
          const [ref, refFreeVars] = doCompile(value[2], env)
          const [args, argsFreeVars] = listToVals(env, value.slice(3))
          return [new Prop(value[1], ref, args), setsUnion(refFreeVars, ...argsFreeVars)]
        }
        case 'ref': {
          if (value.length !== 2) {
            throw new Error("invalid 'ref'")
          }
          const [val, freeVars] = doCompile(value[1], env)
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
            const [key, keyFreeVars] = doCompile(pair[0], env)
            const [val, valFreeVars] = doCompile(pair[1], env)
            inits.set(key, val)
            initsFreeVars.push(keyFreeVars)
            initsFreeVars.push(valFreeVars)
          }
          return [new DictLiteral(inits), setsUnion(...initsFreeVars)]
        }
        case 'seq': {
          if (value.length === 2) {
            return doCompile(value[1], env)
          }
          const [elems, elemsFreeVars] = listToVals(env, value.slice(1))
          return [new Call(intrinsics.seq, elems), setsUnion(...elemsFreeVars)]
        }
        default: {
          const [fn, fnFreeVars] = symRef(env, value[0])
          const [args, argsFreeVars] = listToVals(env, value.slice(1))
          return [
            new Call(fn, args),
            setsUnion(fnFreeVars, ...argsFreeVars),
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
        const [val, freeVars] = doCompile(value[key], env)
        inits[key] = val
        initsFreeVars.push(freeVars)
      }
    }
    return [new Obj(inits), setsUnion(...initsFreeVars)]
  }
  throw new Error(`invalid value ${value}`)
}

export function compile(expr: string, env: Environment = new Environment([])): CompiledArk {
  return doCompile(JSON.parse(expr), env)
}
