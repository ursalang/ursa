// Serialize Ark code to JSON.
// © Reuben Thomas 2023
// Released under the GPL version 3, or (at your option) any later version.

import {FreeVars, PartialCompiledArk} from './parser.js'
import {
  ArkVal, ArkValRef, ArkConcreteVal,
  ArkUndefined, ArkNull, ArkSequence,
  ArkAnd, ArkOr, ArkIf, ArkLoop,
  ArkGet, ArkSet, ArkLet, ArkCall, ArkFn,
  NativeObject, ArkObject, ArkList, ArkMap, ArkProperty, ArkPropertyRef,
  ArkLiteral, ArkListLiteral, ArkMapLiteral, ArkObjectLiteral,
  ArkStackRef, ArkCaptureRef,
} from './interpreter.js'

export function valToJs(val: ArkVal): any {
  if (val.debug !== undefined) {
    const name = val.debug.get('name')
    if (name !== undefined) {
      return name
    }
  }
  if (val instanceof ArkConcreteVal) {
    const rawVal = val.val
    if (typeof rawVal === 'string') {
      return ['str', val.val]
    }
    return val.val
  } else if (val instanceof ArkLiteral) {
    return valToJs(val.val)
  } else if (val instanceof ArkPropertyRef) {
    return ['ref', ['prop', valToJs(val.obj), val.prop]]
  } else if (val instanceof ArkStackRef || val instanceof ArkCaptureRef) {
    return 'foo'
  } else if (val instanceof ArkValRef) {
    return ['ref', valToJs(val.val)]
  } else if (val instanceof ArkGet) {
    return ['get', valToJs(val.val)]
  } else if (val instanceof ArkFn) {
    return ['fn', ['params', ...val.params], valToJs(val.body)]
  } else if (val instanceof ArkObject || val instanceof ArkObjectLiteral) {
    const obj = {}
    for (const [k, v] of val.val) {
      (obj as any)[k] = valToJs(v)
    }
    return obj
  } else if (val instanceof ArkList || val instanceof ArkListLiteral) {
    return ['list', ...val.list.map(valToJs)]
  } else if (val instanceof ArkMap || val instanceof ArkMapLiteral) {
    const obj: any[] = ['map']
    for (const [k, v] of val.map) {
      obj.push([valToJs(k), valToJs(v)])
    }
    return obj
  } else if (val instanceof ArkLet) {
    return ['let', ['params', ...val.boundVars], valToJs(val.body)]
  } else if (val instanceof ArkCall) {
    return [valToJs(val.fn), ...val.args.map(valToJs)]
  } else if (val instanceof ArkSet) {
    return ['set', valToJs(val.ref), valToJs(val.val)]
  } else if (val instanceof ArkProperty) {
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
  } else if (val === ArkNull()) {
    return null
  } else if (val === ArkUndefined) {
    return undefined
  } else if (val instanceof NativeObject) {
    const obj = {}
    for (const k in val.obj) {
      if (Object.hasOwn(val.obj, k)) {
        (obj as any)[k] = valToJs((val.obj as any)[k])
      }
    }
    return obj
  }
  return val.toString()
}

export function serializeVal(val: ArkVal) {
  return JSON.stringify(valToJs(val))
}

function freeVarsToJs(freeVars: FreeVars) {
  const obj: {[key: string]: {}} = {}
  for (const [sym, ref] of freeVars) {
    obj[sym] = valToJs(ref)
  }
  return obj
}

export function serializeCompiledArk(compiled: PartialCompiledArk): string {
  return JSON.stringify([
    valToJs(compiled.value),
    freeVarsToJs(compiled.freeVars),
    compiled.boundVars,
  ])
}
