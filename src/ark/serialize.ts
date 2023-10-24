import {
  Ass, Call, ConcreteVal, Dict, Fexpr, Fn, Get, Let, List,
  NativeFexpr, NativeObj, Null, Obj, Prop, PropRef, SymRef, Val, ValRef,
} from './interp.js'

export function serialize(val: Val) {
  function doSerialize(val: Val): any {
    if (val instanceof SymRef || val instanceof NativeFexpr) {
      return val.debug.get('name')
    } else if (val instanceof ConcreteVal) {
      const rawVal = val.val
      if (typeof rawVal === 'string') {
        return ['str', val.val]
      }
      return val.val
    } else if (val instanceof PropRef) {
      return ['ref', ['prop', doSerialize(val.obj), val.prop]]
    } else if (val instanceof ValRef) {
      return ['ref', doSerialize(val.val)]
    } else if (val instanceof Get) {
      return ['get', doSerialize(val.val)]
    } else if (val instanceof Fn) {
      return ['fn', ['params', ...val.params], doSerialize(val.body)]
    } else if (val instanceof Fexpr) {
      return ['fexpr', ['params', ...val.params], doSerialize(val.body)]
    } else if (val instanceof Obj) {
      const obj = {}
      for (const [k, v] of val.val) {
        (obj as any)[k] = doSerialize(v)
      }
      return obj
    } else if (val instanceof NativeObj) {
      const obj = {}
      for (const k in val.obj) {
        if (Object.hasOwn(val.obj, k)) {
          (obj as any)[k] = doSerialize((val.obj as any)[k])
        }
      }
      return obj
    } else if (val instanceof Dict) {
      const obj: any[] = ['map']
      for (const [k, v] of val.map) {
        obj.push([doSerialize(k), doSerialize(v)])
      }
      return obj
    } else if (val instanceof List) {
      return ['list', ...val.list.map(doSerialize)]
    } else if (val instanceof Let) {
      return ['let', ['params', ...val.boundVars], doSerialize(val.body)]
    } else if (val instanceof Call) {
      return [doSerialize(val.fn), ...val.args.map(doSerialize)]
    } else if (val instanceof Ass) {
      return ['set', doSerialize(val.ref), doSerialize(val.val)]
    } else if (val instanceof Prop) {
      return ['prop', val.prop, doSerialize(val.ref)]
    } else if (val === undefined || val === null) {
      return Null()
    }
    return val.toString()
  }
  return JSON.stringify(doSerialize(val))
}
