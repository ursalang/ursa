import assert from 'assert'
import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
  Val, intrinsics,
  Null, Bool, Num, Str, ValRef, StackRef, Ass, Get,
  ListLiteral, ObjLiteral, DictLiteral, SymRef,
  Fn, Fexpr, Prop, Let, Call, ConcreteVal,
} from './interp.js'

export class Namespace extends Map<string, Val> {
  constructor(inits: [string, Val][]) {
    super(inits)
    for (const [name, val] of inits) {
      Namespace.setName(name, val)
    }
  }

  private static setName(name: string, val: Val) {
    if (!(val instanceof ConcreteVal)) {
      val.debug.set('name', name)
    }
  }

  set(name: string, val: Val) {
    Namespace.setName(name, val)
    super.set(name, val)
    return this
  }
}

export class FreeVars extends Map<string, (StackRef | SymRef)[]> {
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

export class Environment {
  public stack: string[][]

  constructor(outerStack: string[][] = [[]]) {
    assert(outerStack.length > 0)
    this.stack = outerStack
  }

  push(items: string[]) {
    return new (this.constructor as any)(
      [[...this.stack[0].slice(), ...items], ...this.stack.slice(1)],
    )
  }

  pushFrame(frame: string[]) {
    return new (this.constructor as any)([frame, ...this.stack.slice()])
  }

  getIndex(sym: string): StackRef | undefined {
    for (let i = 0; i < this.stack.length; i += 1) {
      const j = this.stack[i].lastIndexOf(sym)
      if (j !== -1) {
        const ref = new StackRef(i, j)
        ref.debug.set('name', sym)
        ref.debug.set('env', JSON.stringify(this))
        return ref
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
    const compiled = doCompile(v, env)
    vals.push(compiled.value)
    freeVars.merge(compiled.freeVars)
  }
  return [vals, freeVars]
}

export function symRef(env: Environment, name: string): CompiledArk {
  const val = intrinsics.get(name)
  if (val !== undefined) {
    return new CompiledArk(val)
  }
  const ref = env.getIndex(name) ?? new SymRef(env, name)
  return new CompiledArk(ref, new FreeVars([[name, [ref]]]))
}

export class CompiledArk {
  constructor(public value: Val, public freeVars: FreeVars = new FreeVars()) {}
}

export class PartialCompiledArk extends CompiledArk {
  constructor(
    public value: Val,
    public freeVars: FreeVars = new FreeVars(),
    public boundVars: string[] = [],
  ) {
    super(value, freeVars)
  }
}

function doCompile(value: any, env: Environment): CompiledArk {
  if (value === null) {
    return new CompiledArk(Null())
  }
  if (typeof value === 'boolean') {
    return new CompiledArk(Bool(value))
  }
  if (typeof value === 'number') {
    return new CompiledArk(Num(value))
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
          return new CompiledArk(Str(value[1]))
        case 'let': {
          if (value.length !== 3) {
            throw new Error("invalid 'let'")
          }
          const params = paramList(value[1])
          const compiled = doCompile(value[2], env.push(params))
          params.forEach((p) => compiled.freeVars.delete(p))
          return new CompiledArk(new Let(params, compiled.value), compiled.freeVars)
        }
        case 'fn': {
          if (value.length !== 3) {
            throw new Error("invalid 'fn'")
          }
          const params = paramList(value[1])
          const compiled = doCompile(value[2], env.pushFrame(params))
          params.forEach((p) => compiled.freeVars.delete(p))
          return new CompiledArk(
            new Fn(params, compiled.freeVars, compiled.value),
            compiled.freeVars,
          )
        }
        case 'fexpr': {
          if (value.length !== 3) {
            throw new Error("invalid 'fexpr'")
          }
          const params = paramList(value[1])
          const compiled = doCompile(value[2], env.pushFrame(params))
          params.map((p) => compiled.freeVars.delete(p))
          return new CompiledArk(
            new Fexpr(params, compiled.freeVars, compiled.value),
            compiled.freeVars,
          )
        }
        case 'prop': {
          if (value.length !== 3) {
            throw new Error("invalid 'prop'")
          }
          const compiled = doCompile(value[2], env)
          const freeVars = new FreeVars().merge(compiled.freeVars)
          return new CompiledArk(new Prop(value[1], compiled.value), freeVars)
        }
        case 'ref': {
          if (value.length !== 2) {
            throw new Error("invalid 'ref'")
          }
          const compiled = doCompile(value[1], env)
          return new CompiledArk(new ValRef(compiled.value), compiled.freeVars)
        }
        case 'get': {
          if (value.length !== 2) {
            throw new Error("invalid 'get'")
          }
          const compiled = doCompile(value[1], env)
          return new CompiledArk(new Get(compiled.value), compiled.freeVars)
        }
        case 'set': {
          if (value.length !== 3) {
            throw new Error("invalid 'set'")
          }
          const compiledRef = doCompile(value[1], env)
          const compiledVal = doCompile(value[2], env)
          const freeVars = new FreeVars().merge(compiledVal.freeVars).merge(compiledRef.freeVars)
          return new CompiledArk(new Ass(compiledRef.value, compiledVal.value), freeVars)
        }
        case 'list': {
          const [elems, elemsFreeVars] = listToVals(env, value.slice(1))
          return new CompiledArk(new ListLiteral(elems), elemsFreeVars)
        }
        case 'map': {
          const inits = new Map<Val, Val>()
          const initsFreeVars = new FreeVars()
          for (const pair of value.slice(1)) {
            assert(pair instanceof Array && pair.length === 2)
            const compiledKey = doCompile(pair[0], env)
            const compiledVal = doCompile(pair[1], env)
            inits.set(compiledKey.value, compiledVal.value)
            initsFreeVars.merge(compiledKey.freeVars)
            initsFreeVars.merge(compiledVal.freeVars)
          }
          return new CompiledArk(new DictLiteral(inits), initsFreeVars)
        }
        case 'seq': {
          if (value.length === 2) {
            return doCompile(value[1], env)
          }
          const [elems, elemsFreeVars] = listToVals(env, value.slice(1))
          return new CompiledArk(new Call(intrinsics.get('seq')!, elems), elemsFreeVars)
        }
        default: {
          const compiledFn = doCompile(value[0], env)
          const [args, argsFreeVars] = listToVals(env, value.slice(1))
          const freeVars = new FreeVars().merge(argsFreeVars).merge(compiledFn.freeVars)
          return new CompiledArk(new Call(compiledFn.value, args), freeVars)
        }
      }
    }
  }
  if (typeof value === 'object') {
    const inits = new Map()
    const initsFreeVars = new FreeVars()
    for (const key in value) {
      if (Object.hasOwn(value, key)) {
        const compiled = doCompile(value[key], env)
        inits.set(key, compiled.value)
        initsFreeVars.merge(compiled.freeVars)
      }
    }
    return new CompiledArk(new ObjLiteral(inits), initsFreeVars)
  }
  throw new Error(`invalid value ${value}`)
}

export function compile(expr: string, env: Environment = new Environment()): CompiledArk {
  return doCompile(JSON.parse(expr), env)
}
