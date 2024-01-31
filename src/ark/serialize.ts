// Serialize Ark code to JSON.
// © Reuben Thomas 2023-2024
// Released under the MIT license.

import {
  Ark, ArkConcreteVal, ArkUndefined, ArkNull, ArkSequence,
  ArkAnd, ArkOr, ArkIf, ArkLoop, ArkBreak, ArkContinue,
  ArkGet, ArkSet, ArkLet, ArkCall, ArkFn, ArkReturn,
  NativeObject, ArkObject, ArkList, ArkMap, ArkProperty,
  ArkLiteral, ArkListLiteral, ArkMapLiteral, ArkObjectLiteral,
  globals,
} from './interpreter.js'

export function valToJs(val: Ark): unknown {
  if (val instanceof NativeObject) {
    return val.obj
  }
  if (val.debug !== undefined) {
    const name = val.debug.name
    if (name !== undefined) {
      return name
    }
  }
  if (val instanceof ArkConcreteVal) {
    const rawVal: unknown = val.val
    if (typeof rawVal === 'string') {
      return ['str', val.val]
    }
    return val.val
  } else if (val instanceof ArkLiteral) {
    return valToJs(val.val)
  } else if (val instanceof ArkGet) {
    return ['get', valToJs(val.val)]
  } else if (val instanceof ArkFn) {
    return ['fn', [...val.params], valToJs(val.body)]
  } else if (val instanceof ArkObject || val instanceof ArkObjectLiteral) {
    const obj = {}
    for (const [k, v] of val.properties) {
      (obj as {[key: string]: unknown})[k] = valToJs(v)
    }
    return obj
  } else if (val instanceof ArkList || val instanceof ArkListLiteral) {
    return ['list', ...val.list.map(valToJs)]
  } else if (val instanceof ArkMap || val instanceof ArkMapLiteral) {
    const obj: unknown[] = ['map']
    for (const [k, v] of val.map) {
      obj.push([valToJs(k), valToJs(v)])
    }
    return obj
  } else if (val instanceof ArkLet) {
    return ['let', [...val.boundVars.map((bv) => [bv[0], valToJs(bv[1])])], valToJs(val.body)]
  } else if (val instanceof ArkCall) {
    return [valToJs(val.fn), ...val.args.map(valToJs)]
  } else if (val instanceof ArkSet) {
    return ['set', valToJs(val.ref), valToJs(val.val)]
  } else if (val instanceof ArkProperty) {
    if (val.obj instanceof ArkLiteral && val.obj.val === globals) {
      // Serialize globals as simply their name.
      return val.prop
    }
    return ['prop', val.prop, valToJs(val.obj)]
  } else if (val instanceof ArkSequence) {
    return ['seq', ...val.exps.map(valToJs)]
  } else if (val instanceof ArkIf) {
    const res = [
      'if',
      valToJs(val.cond),
      valToJs(val.thenExp),
    ]
    if (val.elseExp !== undefined) {
      res.push(valToJs(val.elseExp))
    }
    return res
  } else if (val instanceof ArkAnd) {
    return ['and', valToJs(val.left), valToJs(val.right)]
  } else if (val instanceof ArkOr) {
    return ['or', valToJs(val.left), valToJs(val.right)]
  } else if (val instanceof ArkLoop) {
    return ['loop', valToJs(val.body)]
  } else if (val instanceof ArkBreak) {
    return ['break', valToJs(val.val)]
  } else if (val instanceof ArkContinue) {
    return ['continue']
  } else if (val instanceof ArkReturn) {
    return ['return', valToJs(val.val)]
  } else if (val === ArkNull()) {
    return null
  } else if (val === ArkUndefined) {
    return undefined
  }
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return val.toString()
}

export function serializeVal(val: Ark) {
  return JSON.stringify(valToJs(val))
}
