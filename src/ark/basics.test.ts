// Ark tests of basics using inline source snippets.
// © Reuben Thomas 2023-2025
// Released under the MIT license.

import test from 'ava'

import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
} from './util.js'
import {
  ArkBooleanVal, ArkNumberVal, ArkStringVal, ArkList, ArkMap, ArkVal,
} from './data.js'
import {ArkState} from './interpreter.js'
import {compile} from './reader.js'

import {testArkGroup as testGroup} from '../testutil.js'
import {expToInst} from './flatten.js'

test('Undefined symbol', (t) => {
  const error = t.throws(() => new ArkState(expToInst(compile(['f']))))
  t.not(error, undefined)
  t.is(error.message, 'Undefined symbol f')
})

testGroup('Concrete values', [
  ['4', 4, ArkNumberVal],
  ['["str","hello é"]', 'hello é', ArkStringVal],
])

testGroup('Intrinsics', [
  ['["invoke",3,"add",4]', 7, ArkNumberVal],
  ['["invoke",["invoke",3,"add",4],"mul",5]', 35, ArkNumberVal],
  ['"pi"', Math.PI, ArkNumberVal],
  ['["seq","pi",["invoke",3,"add",5]]', 8, ArkNumberVal],
  ['["invoke",["invoke",3,"add",4],"equals",7]', true, ArkBooleanVal],
  ['["invoke",true,"not"]', false, ArkBooleanVal],
  ['["invoke",2,"bitwiseNot"]', -3, ArkNumberVal],
  ['["invoke",34,"bitwiseAnd",48]', 32, ArkNumberVal],
  ['["invoke",34,"bitwiseOr",48]', 50, ArkNumberVal],
  ['["invoke",34,"bitwiseXor",48]', 18, ArkNumberVal],
  ['["invoke",34,"shiftLeft",4]', 544, ArkNumberVal],
  ['["invoke",-34,"shiftRight",4]', -3, ArkNumberVal],
  ['["invoke",34,"shiftRightArith",4]', 2, ArkNumberVal],
])

testGroup('Sequences', [
  ['["seq","pi",["invoke",3,"add",4]]', 7, ArkNumberVal],
])

testGroup('Conditionals', [
  ['["if",false,3,4]', 4, ArkNumberVal],
  ['["if",true,3,4]', 3, ArkNumberVal],
  ['["if",["invoke",["invoke",3,"add",4],"equals",7],1,0]', 1, ArkNumberVal],
  ['["or",false,true]', true, ArkBooleanVal],
  ['["and",true,true]', true, ArkBooleanVal],
])

test('Bare break', (t) => {
  const error = t.throws(() => new ArkState(expToInst(compile(['break']))).run())
  t.not(error, undefined)
  t.is(error.message, 'break outside loop')
})

testGroup('loop and break', [
  ['["loop",["break",3]]', 3, ArkNumberVal],
])

testGroup('let', [
  ['["let",[["const","a","Num",3]],"a"]', 3, ArkNumberVal],
])

testGroup('Objects', [
  ['{"a":1,"=":2,"!=":3}', {a: 1, '=': 2, '!=': 3}, ArkVal],
])

testGroup('Lists', [
  ['["list",1,2,3]', [1, 2, 3], ArkList],
  ['["invoke",["list",1,2,3],"len"]', 3, ArkNumberVal],
  ['["invoke",["list",4,5,6],"get",1]', 5, ArkNumberVal],
  ['["invoke",["list",4,5,6],"set",1,2]', [4, 2, 6], ArkList],
])

testGroup('Maps', [
  ['["seq",["map",[["str","a"],1],[["str","b"],["invoke",2,"add",0]],[3,4]]]', new Map<unknown, unknown>([['a', 1], ['b', 2], [3, 4]]), ArkMap],
])
