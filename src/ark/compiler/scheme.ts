// Compile Ark code to Scheme.
// © Reuben Thomas 2026
// Released under the MIT license.

import fs from 'fs-extra'
import path from 'path'
import {fileURLToPath} from 'url'

import {
  ArkVal, ArkConcreteVal, ArkNull, ArkOperation, ArkList, ArkMap, ArkStruct,
  ArkUndefined, NativeStruct,
} from '../data.js'
import {
  ArkExp, ArkSequence,
  ArkAnd, ArkOr, ArkIf, ArkLoop, ArkBreak, ArkContinue, ArkInvoke,
  ArkSet, ArkLet, ArkCall, ArkFn, ArkGenerator, ArkReturn, ArkProperty,
  ArkLiteral, ArkListLiteral, ArkMapLiteral, ArkStructLiteral, ArkYield,
  ArkGlobal,
} from '../code.js'

// eslint-disable-next-line @typescript-eslint/naming-convention
const __dirname = fileURLToPath(new URL('.', import.meta.url))

type Sexp = Sexp[] | string

function sexpToString(val: Sexp): string {
  if (typeof val === 'string') {
    return val
  }
  const strList = []
  for (const elem of val) {
    strList.push(sexpToString(elem))
  }
  return `(${strList.join(" ")})`
}

export function valToScheme(val: ArkVal | ArkExp) {
  function doValToSexp(val: ArkVal | ArkExp): Sexp {
    if (val instanceof NativeStruct) {
      throw new Error("cannot compile NativeStruct to Scheme")
    }
    if (val instanceof ArkExp && val.debug !== undefined) {
      const name = val.debug.name
      if (name !== undefined) {
        return name
      }
    }
    if (val === ArkNull()) {
      return "'()"
    } else if (val instanceof ArkConcreteVal) {
      const rawVal: unknown = val.val
      if (typeof rawVal === 'string') {
        return JSON.stringify(val.val)
      }
      return `${val.val}`
    } else if (val instanceof ArkLiteral) {
      return doValToSexp(val.val)
    } else if (val instanceof ArkGlobal) {
      return val.name
    } else if (val instanceof ArkFn) {
      return [
        val instanceof ArkGenerator ? 'gen' : 'lambda',
        val.params.map((l) => l.name),
        doValToSexp(val.body),
      ]
    } else if (val instanceof ArkStructLiteral) {
      const obj: Sexp = ['struct_literal']
      for (const [k, v] of val.members) {
        obj.push([k, doValToSexp(v)])
      }
      return obj
    } else if (val instanceof ArkStruct) {
      const obj: Sexp = ['struct']
      for (const [k, v] of (val.constructor as typeof ArkStruct).members) {
        obj.push([k, doValToSexp(v)])
      }
      return obj
    } else if (val instanceof ArkList || val instanceof ArkListLiteral) {
      return ['list', ...val.list.map(doValToSexp)]
    } else if (val instanceof ArkMap || val instanceof ArkMapLiteral) {
      const obj: Sexp = ['map']
      for (const [k, v] of val.map) {
        obj.push([doValToSexp(k), doValToSexp(v)])
      }
      return obj
    } else if (val instanceof ArkLet) {
      return ['letrec', [...val.boundVars.map(
        (bv) => [bv.location.name, doValToSexp(bv.init)],
      )], doValToSexp(val.body)]
    } else if (val instanceof ArkCall) {
      return [doValToSexp(val.fn), ...val.args.map(doValToSexp)]
    } else if (val instanceof ArkInvoke) {
      return [val.prop, doValToSexp(val.obj), ...val.args.map(doValToSexp)]
    } else if (val instanceof ArkSet) {
      return ['set!', doValToSexp(val.lexp), doValToSexp(val.exp)]
    } else if (val instanceof ArkProperty) {
      return ['prop', val.prop, doValToSexp(val.obj)]
    } else if (val instanceof ArkSequence) {
      return ['begin', ...val.exps.map(doValToSexp)]
    } else if (val instanceof ArkIf) {
      const res = [
        'if',
        doValToSexp(val.cond),
        doValToSexp(val.thenExp),
      ]
      if (val.elseExp !== undefined) {
        res.push(doValToSexp(val.elseExp))
      }
      return res
    } else if (val instanceof ArkAnd) {
      return ['and', doValToSexp(val.left), doValToSexp(val.right)]
    } else if (val instanceof ArkOr) {
      return ['or', doValToSexp(val.left), doValToSexp(val.right)]
    } else if (val instanceof ArkLoop) {
      return ['while', '#t', doValToSexp(val.body)]
    } else if (val instanceof ArkBreak) {
      return ['break', doValToSexp(val.exp)]
    } else if (val instanceof ArkContinue) {
      return ['continue']
    } else if (val instanceof ArkYield) {
      return ['yield', doValToSexp(val.exp)]
    } else if (val instanceof ArkReturn) {
      return ['return', doValToSexp(val.exp)]
    } else if (val instanceof ArkOperation) {
      // FIXME: Can we properly serialize a promise?
      return ['promise']
    } else if (val === ArkUndefined()) {
      return 'undefined'
    }
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    return val.toString()
  }

  // Return string representation
  return sexpToString(doValToSexp(val))
}

export const preludeScheme = fs.readFileSync(path.join(__dirname, 'prelude.scm'), {encoding: 'utf-8'})
