import {
  ArkState, Bool, ConcreteVal, Dict, DictLiteral, List, ListLiteral,
  NativeFn, NativeObj, Null, Num, Obj, Str, Val,
} from './interp.js'

export class ArkFromJsError extends Error {}

export function fromJs(x: any, thisObj?: Object): Val {
  if (x === null || x === undefined) {
    return Null()
  }
  if (typeof x === 'boolean') {
    return Bool(x)
  }
  if (typeof x === 'number') {
    return Num(x)
  }
  if (typeof x === 'string') {
    return Str(x)
  }
  if (typeof x === 'function') {
    const fn = thisObj ? x.bind(thisObj) : x
    const nativeFn = new NativeFn(
      (_ark: ArkState, ...args: Val[]) => fromJs(fn(...args.map(toJs))),
    )
    nativeFn.debug.set('name', x.name)
    return nativeFn
  }
  if (x instanceof Array) {
    return new ListLiteral(x)
  }
  if (x instanceof Map) {
    return new DictLiteral(x)
  }
  if (typeof x === 'object') {
    return new NativeObj(x)
  }
  throw new ArkFromJsError(`Cannot convert JavaScript value ${x}`)
}

export function toJs(val: Val): any {
  if (val instanceof ConcreteVal) {
    return val.val
  } else if (val instanceof Obj) {
    const obj = {}
    for (const [k, v] of val.val) {
      (obj as any)[k] = toJs(v)
    }
    return obj
  } else if (val instanceof Dict) {
    const jsMap = new Map<any, Val>()
    for (const [k, v] of val.map) {
      jsMap.set(toJs(k), toJs(v))
    }
    return jsMap
  } else if (val instanceof List) {
    return val.list.map(toJs)
  }
  return val
}
