// Serialize Ark code to JSON.
// © Reuben Thomas 2023-2025
// Released under the MIT license.

import {
  ArkVal, ArkConcreteVal, ArkNull, ArkOperation, ArkList, ArkMap, ArkStruct,
  ArkUndefined, NativeStruct, typeToStr,
} from './data.js'
import {
  ArkExp, ArkSequence,
  ArkAnd, ArkOr, ArkIf, ArkLoop, ArkBreak, ArkContinue, ArkInvoke,
  ArkSet, ArkLet, ArkCall, ArkFn, ArkGenerator, ArkReturn, ArkProperty,
  ArkLiteral, ArkListLiteral, ArkMapLiteral, ArkStructLiteral, ArkYield,
  ArkGlobal,
} from './code.js'
import {ArkTypeConstant} from './type.js'

export function valToJs(val: ArkVal | ArkExp) {
  function doValToJs(val: ArkVal | ArkExp): unknown {
    if (val instanceof NativeStruct) {
      return val.obj
    }
    if (val instanceof ArkExp && val.debug !== undefined) {
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
    } else if (val instanceof ArkGlobal) {
      return val.name
    } else if (val instanceof ArkFn) {
      return [
        val instanceof ArkGenerator ? 'gen' : 'fn',
        val.params.map((l) => [l.name, typeToStr(l.type)]),
        typeToStr(val.returnType),
        doValToJs(val.body),
      ]
    } else if (val instanceof ArkStructLiteral) {
      const obj = {}
      for (const [k, v] of val.members) {
        (obj as {[key: string]: unknown})[k] = doValToJs(v)
      }
      return obj
    } else if (val instanceof ArkStruct) {
      const obj = {}
      if (val.type instanceof ArkTypeConstant) {
        throw new Error(`cannot serialize struct of type ${val.type}`)
      }
      for (const [k, _] of val.type.members) {
        (obj as {[key: string]: unknown})[k] = doValToJs(val.get(k))
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
      return ['let', [...val.boundVars.map(
        (bv) => [
          bv.location.isVar ? 'var' : 'const',
          bv.location.name, typeToStr(bv.location.type), doValToJs(bv.init)],
      )], doValToJs(val.body)]
    } else if (val instanceof ArkCall) {
      return [doValToJs(val.fn), ...val.args.map(doValToJs)]
    } else if (val instanceof ArkInvoke) {
      return ['invoke', doValToJs(val.obj), val.prop, ...val.args.map(doValToJs)]
    } else if (val instanceof ArkSet) {
      return ['set', doValToJs(val.lexp), doValToJs(val.exp)]
    } else if (val instanceof ArkProperty) {
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
    } else if (val instanceof ArkYield) {
      return ['yield', doValToJs(val.exp)]
    } else if (val instanceof ArkReturn) {
      return ['return', doValToJs(val.exp)]
    } else if (val instanceof ArkOperation) {
      // FIXME: Can we properly serialize a promise?
      return ['promise']
    } else if (val === ArkNull()) {
      return null
    } else if (val === ArkUndefined()) {
      return undefined
    }
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    return val.toString()
  }

  return doValToJs(val)
}

export function serializeVal(val: ArkVal | ArkExp) {
  return JSON.stringify(valToJs(val))
}
