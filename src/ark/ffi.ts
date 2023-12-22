// Ark FFI to JavaScript.
// © Reuben Thomas 2023
// Released under the MIT license.

import {
  ArkVal, ArkNull, ArkBoolean, ArkNumber, ArkObject, ArkString,
  ArkConcreteVal, ArkMap, ArkList, NativeFn, NativeObject,
} from './interpreter.js'

export class ArkFromJsError extends Error {}

export function fromJs(x: unknown, thisObj?: object): ArkVal {
  if (x === null || x === undefined) {
    return ArkNull()
  }
  if (typeof x === 'boolean') {
    return ArkBoolean(x)
  }
  if (typeof x === 'number') {
    return ArkNumber(x)
  }
  if (typeof x === 'string') {
    return ArkString(x)
  }
  if (typeof x === 'function') {
    // eslint-disable-next-line max-len
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/ban-types
    const fn: Function = thisObj ? x.bind(thisObj) : x
    const nativeFn = new NativeFn(
      [],
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      (...args: ArkVal[]) => fromJs(fn(...args.map(toJs))),
    )
    nativeFn.debug.name = x.name
    return nativeFn
  }
  if (x instanceof Array) {
    return new ArkList(x as [])
  }
  if (x instanceof Map) {
    const map = new Map<ArkVal, ArkVal>()
    for (const [k, v] of x) {
      map.set(fromJs(k), fromJs(v))
    }
    return new ArkMap(map)
  }
  if (typeof x === 'object') {
    return new NativeObject(x)
  }
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  throw new ArkFromJsError(`Cannot convert JavaScript value ${x}`)
}

export function toJs(val: ArkVal): unknown {
  if (val instanceof ArkConcreteVal) {
    return val.val
  } else if (val instanceof ArkObject) {
    const obj: {[key: string]: unknown} = {}
    for (const [k, v] of val.properties) {
      obj[k] = toJs(v)
    }
    return obj
  } else if (val instanceof ArkMap) {
    const jsMap = new Map<unknown, unknown>()
    for (const [k, v] of val.map) {
      jsMap.set(toJs(k), toJs(v))
    }
    return jsMap
  } else if (val instanceof ArkList) {
    return val.list.map(toJs)
  }
  return val
}
