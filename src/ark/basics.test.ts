// Ark tests of basics using inline source snippets.
// © Reuben Thomas 2023-2025
// Released under the MIT license.

import test from 'ava'

import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
} from './util.js'
import {
  ArkBooleanType, ArkNumberType, ArkStringType,
  ArkListType, ArkMapType,
} from './data.js'
import {ArkState} from './interpreter.js'
import {compile} from './reader.js'

import {testArkGroup as testGroup} from '../testutil.js'
import {expToInst} from './flatten.js'
import {ArkAnyType} from './type.js'

test('Undefined symbol', (t) => {
  const error = t.throws(() => new ArkState(expToInst(compile(['f']))))
  t.not(error, undefined)
  t.is(error.message, 'Undefined symbol f')
})

testGroup('Concrete values', [
  ['4', 4, ArkNumberType],
  ['["str","hello é"]', 'hello é', ArkStringType],
])

testGroup('Intrinsics', [
  ['["invoke",3,"add",4]', 7, ArkNumberType],
  ['["invoke",["invoke",3,"add",4],"mul",5]', 35, ArkNumberType],
  ['"pi"', Math.PI, ArkNumberType],
  ['["seq","pi",["invoke",3,"add",5]]', 8, ArkNumberType],
  ['["invoke",["invoke",3,"add",4],"equals",7]', true, ArkBooleanType],
  ['["invoke",true,"not"]', false, ArkBooleanType],
  ['["invoke",2,"bitwiseNot"]', -3, ArkNumberType],
  ['["invoke",34,"bitwiseAnd",48]', 32, ArkNumberType],
  ['["invoke",34,"bitwiseOr",48]', 50, ArkNumberType],
  ['["invoke",34,"bitwiseXor",48]', 18, ArkNumberType],
  ['["invoke",34,"shiftLeft",4]', 544, ArkNumberType],
  ['["invoke",-34,"shiftRight",4]', -3, ArkNumberType],
  ['["invoke",34,"shiftRightArith",4]', 2, ArkNumberType],
])

testGroup('Sequences', [
  ['["seq","pi",["invoke",3,"add",4]]', 7, ArkNumberType],
])

testGroup('Conditionals', [
  ['["if",false,3,4]', 4, ArkNumberType],
  ['["if",true,3,4]', 3, ArkNumberType],
  ['["if",["invoke",["invoke",3,"add",4],"equals",7],1,0]', 1, ArkNumberType],
  ['["or",false,true]', true, ArkBooleanType],
  ['["and",true,true]', true, ArkBooleanType],
])

test('Bare break', (t) => {
  const error = t.throws(() => new ArkState(expToInst(compile(['break']))).run())
  t.not(error, undefined)
  t.is(error.message, 'break used outside a loop')
})

testGroup('loop and break', [
  ['["loop",["break",3]]', 3, ArkNumberType],
])

testGroup('let', [
  ['["let",[["const","a","Num",3]],"a"]', 3, ArkNumberType],
])

testGroup('Structs', [
  ['{"a":1,"=":2,"!=":3}', {a: 1, '=': 2, '!=': 3}, ArkAnyType],
])

testGroup('Lists', [
  ['["list",1,2,3]', [1, 2, 3], ArkListType],
  ['["invoke",["list",1,2,3],"len"]', 3, ArkNumberType],
  ['["invoke",["list",4,5,6],"get",1]', 5, ArkNumberType],
  ['["invoke",["list",4,5,6],"set",1,2]', [4, 2, 6], ArkListType],
])

testGroup('Maps', [
  ['["seq",["map",[["str","a"],1],[["str","b"],["invoke",2,"add",0]],[3,4]]]', new Map<unknown, unknown>([['a', 1], ['b', 2], [3, 4]]), ArkMapType],
])
