// Serialize Ark code to JSON.
// © Reuben Thomas 2023-2024
// Released under the MIT license.

import {
  Ark, ArkConcreteVal, ArkUndefined, ArkNull, ArkSequence,
  ArkAnd, ArkOr, ArkIf, ArkLoop, ArkBreak, ArkContinue,
  ArkSet, ArkLet, ArkCall, ArkFn, ArkReturn,
  NativeObject, ArkObject, ArkList, ArkMap, ArkProperty,
  ArkLiteral, ArkListLiteral, ArkMapLiteral, ArkObjectLiteral,
  globals,
} from './interpreter.js'

export function valToJs(val: Ark, externalSyms = globals) {
  function doValToJs(val: Ark): unknown {
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
      return doValToJs(val.val)
    } else if (val instanceof ArkFn) {
      return ['fn', [...val.params], doValToJs(val.body)]
    } else if (val instanceof ArkObject || val instanceof ArkObjectLiteral) {
      const obj = {}
      for (const [k, v] of val.properties) {
        (obj as {[key: string]: unknown})[k] = doValToJs(v)
      }
      return obj
    } else if (val instanceof ArkList || val instanceof ArkListLiteral) {
      return ['list', ...val.list.map(doValToJs)]
    } else if (val instanceof ArkMap || val instanceof ArkMapLiteral) {
      const obj: unknown[] = ['map']
      for (const [k, v] of val.map) {
        obj.push([doValToJs(k), doValToJs(v)])
      }
      return obj
    } else if (val instanceof ArkLet) {
      return ['let', [...val.boundVars.map((bv) => [bv[0], doValToJs(bv[1])])], doValToJs(val.body)]
    } else if (val instanceof ArkCall) {
      return [doValToJs(val.fn), ...val.args.map(doValToJs)]
    } else if (val instanceof ArkSet) {
      return ['set', doValToJs(val.lexp), doValToJs(val.exp)]
    } else if (val instanceof ArkProperty) {
      if (val.obj instanceof ArkLiteral && val.obj.val === externalSyms) {
        // Serialize globals as simply their name.
        return val.prop
      }
      return ['prop', val.prop, doValToJs(val.obj)]
    } else if (val instanceof ArkSequence) {
      return ['seq', ...val.exps.map(doValToJs)]
    } else if (val instanceof ArkIf) {
      const res = [
        'if',
        doValToJs(val.cond),
        doValToJs(val.thenExp),
      ]
      if (val.elseExp !== undefined) {
        res.push(doValToJs(val.elseExp))
      }
      return res
    } else if (val instanceof ArkAnd) {
      return ['and', doValToJs(val.left), doValToJs(val.right)]
    } else if (val instanceof ArkOr) {
      return ['or', doValToJs(val.left), doValToJs(val.right)]
    } else if (val instanceof ArkLoop) {
      return ['loop', doValToJs(val.body)]
    } else if (val instanceof ArkBreak) {
      return ['break', doValToJs(val.exp)]
    } else if (val instanceof ArkContinue) {
      return ['continue']
    } else if (val instanceof ArkReturn) {
      return ['return', doValToJs(val.exp)]
    } else if (val === ArkNull()) {
      return null
    } else if (val === ArkUndefined) {
      return undefined
    }
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    return val.toString()
  }

  return doValToJs(val)
}

export function serializeVal(val: Ark, externalSyms?: ArkObject) {
  return JSON.stringify(valToJs(val, externalSyms))
}
