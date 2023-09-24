import assert from 'assert'
import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
  Val, intrinsics,
  Null, Bool, Num, Str, Ref, Ass,
  List, Obj, DictLiteral, SymRef,
  Fn, Fexpr, Prop, Let, Call, StackLocation, Stack,
} from './interp.js'

export type Namespace = Map<string, Val>

export class FreeVars extends Map<string, SymRef[]> {
  merge(moreVars: FreeVars): FreeVars {
    for (const [name, symrefs] of moreVars) {
      if (!this.has(name)) {
        this.set(name, [])
      }
      this.get(name)!.push(...symrefs)
    }
    return this
  }
}

export class Environment extends Stack<string> {
  getIndex(sym: string): StackLocation | undefined {
    for (let i = 0; i < this.stack.length; i += 1) {
      const j = this.stack[i].indexOf(sym)
      if (j !== -1) {
        return new StackLocation(i, j)
      }
    }
    return undefined
  }
}

function paramList(params: any[]): string[] {
  if (params.length === 0 || params[0] !== 'params') {
    throw new Error(`invalid parameter list ${params}`)
  }
  const paramList = params.slice(1)
  for (const param of paramList) {
    if (typeof param !== 'string') {
      throw new Error(`bad type in list ${params}`)
    }
  }
  if (new Set(paramList).size !== paramList.length) {
    throw new Error(`duplicate parameters in list ${params}`)
  }
  return paramList
}

function listToVals(env: Environment, l: any[]): [Val[], FreeVars] {
  const vals = []
  const freeVars = new FreeVars()
  for (const v of l) {
    const [val, fv] = doCompile(v, env)
    vals.push(val)
    freeVars.merge(fv)
  }
  return [vals, freeVars]
}

export function symRef(env: Environment, name: string): CompiledArk {
  const val = intrinsics[name]
  if (val !== undefined) {
    return [val, new FreeVars()]
  }
  const symref = new SymRef(env, name)
  return [symref, new FreeVars([[name, [symref]]])]
}

export type CompiledArk = [value: Val, freeVars: FreeVars]

function doCompile(value: any, env: Environment): CompiledArk {
  if (value === null) {
    return [new Null(), new FreeVars()]
  }
  if (typeof value === 'boolean') {
    return [new Bool(value), new FreeVars()]
  }
  if (typeof value === 'number') {
    return [new Num(value), new FreeVars()]
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
          return [new Str(value[1]), new FreeVars()]
        case 'let': {
          if (value.length !== 3) {
            throw new Error("invalid 'let'")
          }
          const params = paramList(value[1])
          const [body, freeVars] = doCompile(value[2], env.push(params))
          params.forEach((p) => freeVars.delete(p))
          return [new Let(params, body), freeVars]
        }
        case 'fn': {
          if (value.length !== 3) {
            throw new Error("invalid 'fn'")
          }
          const params = paramList(value[1])
          const [body, freeVars] = doCompile(value[2], env.pushFrame(params))
          params.forEach((p) => freeVars.delete(p))
          return [new Fn(params, freeVars, body), freeVars]
        }
        case 'fexpr': {
          if (value.length !== 3) {
            throw new Error("invalid 'fexpr'")
          }
          const params = paramList(value[1])
          const [body, freeVars] = doCompile(value[2], env.pushFrame(params))
          params.map((p) => freeVars.delete(p))
          return [new Fexpr(params, freeVars, body), freeVars]
        }
        case 'prop': {
          if (value.length !== 3) {
            throw new Error("invalid 'prop'")
          }
          const [ref, refFreeVars] = doCompile(value[2], env)
          const freeVars = new FreeVars().merge(refFreeVars)
          return [new Prop(value[1], ref), freeVars]
        }
        case 'ref': {
          if (value.length !== 2) {
            throw new Error("invalid 'ref'")
          }
          const [val, freeVars] = doCompile(value[1], env)
          return [new Ref(val), freeVars]
        }
        case 'set': {
          if (value.length !== 3) {
            throw new Error("invalid 'set'")
          }
          const [ref, refFreeVars] = doCompile(value[1], env)
          const [val, valFreeVars] = doCompile(value[2], env)
          const freeVars = new FreeVars().merge(valFreeVars).merge(refFreeVars)
          return [new Ass(ref, val), freeVars]
        }
        case 'list': {
          const [elems, elemsFreeVars] = listToVals(env, value.slice(1))
          return [new List(elems), elemsFreeVars]
        }
        case 'map': {
          const inits = new Map<Val, Val>()
          const initsFreeVars = new FreeVars()
          for (const pair of value.slice(1)) {
            assert(pair instanceof Array && pair.length === 2)
            const [key, keyFreeVars] = doCompile(pair[0], env)
            const [val, valFreeVars] = doCompile(pair[1], env)
            inits.set(key, val)
            initsFreeVars.merge(keyFreeVars)
            initsFreeVars.merge(valFreeVars)
          }
          return [new DictLiteral(inits), initsFreeVars]
        }
        case 'seq': {
          if (value.length === 2) {
            return doCompile(value[1], env)
          }
          const [elems, elemsFreeVars] = listToVals(env, value.slice(1))
          return [new Call(intrinsics.seq, elems), elemsFreeVars]
        }
        default: {
          const [fn, fnFreeVars] = doCompile(value[0], env)
          const [args, argsFreeVars] = listToVals(env, value.slice(1))
          const freeVars = new FreeVars().merge(argsFreeVars).merge(fnFreeVars)
          return [new Call(fn, args), freeVars]
        }
      }
    }
  }
  if (typeof value === 'object') {
    const inits: {[key: string]: any} = {}
    const initsFreeVars = new FreeVars()
    for (const key in value) {
      if (Object.hasOwn(value, key)) {
        const [val, freeVars] = doCompile(value[key], env)
        inits[key] = val
        initsFreeVars.merge(freeVars)
      }
    }
    return [new Obj(inits), initsFreeVars]
  }
  throw new Error(`invalid value ${value}`)
}

export function compile(expr: string, env: Environment = new Environment()): CompiledArk {
  return doCompile(JSON.parse(expr), env)
}
