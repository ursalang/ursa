// Ark tests of basics using inline source snippets.
// © Reuben Thomas 2023-2025
// Released under the MIT license.

import test from 'ava'

import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
} from './util.js'
import {
  ArkBooleanTraitType, ArkNumberTraitType, ArkStringTraitType,
  ArkListTraitType, ArkMapTraitType,
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
  ['4', 4, ArkNumberTraitType],
  ['["str","hello é"]', 'hello é', ArkStringTraitType],
])

testGroup('Intrinsics', [
  ['["invoke",3,"add",4]', 7, ArkNumberTraitType],
  ['["invoke",["invoke",3,"add",4],"mul",5]', 35, ArkNumberTraitType],
  ['"pi"', Math.PI, ArkNumberTraitType],
  ['["seq","pi",["invoke",3,"add",5]]', 8, ArkNumberTraitType],
  ['["invoke",["invoke",3,"add",4],"equals",7]', true, ArkBooleanTraitType],
  ['["invoke",true,"not"]', false, ArkBooleanTraitType],
  ['["invoke",2,"bitwiseNot"]', -3, ArkNumberTraitType],
  ['["invoke",34,"bitwiseAnd",48]', 32, ArkNumberTraitType],
  ['["invoke",34,"bitwiseOr",48]', 50, ArkNumberTraitType],
  ['["invoke",34,"bitwiseXor",48]', 18, ArkNumberTraitType],
  ['["invoke",34,"shiftLeft",4]', 544, ArkNumberTraitType],
  ['["invoke",-34,"shiftRight",4]', -3, ArkNumberTraitType],
  ['["invoke",34,"shiftRightArith",4]', 2, ArkNumberTraitType],
])

testGroup('Sequences', [
  ['["seq","pi",["invoke",3,"add",4]]', 7, ArkNumberTraitType],
])

testGroup('Conditionals', [
  ['["if",false,3,4]', 4, ArkNumberTraitType],
  ['["if",true,3,4]', 3, ArkNumberTraitType],
  ['["if",["invoke",["invoke",3,"add",4],"equals",7],1,0]', 1, ArkNumberTraitType],
  ['["or",false,true]', true, ArkBooleanTraitType],
  ['["and",true,true]', true, ArkBooleanTraitType],
])

test('Bare break', (t) => {
  const error = t.throws(() => new ArkState(expToInst(compile(['break']))).run())
  t.not(error, undefined)
  t.is(error.message, 'break outside loop')
})

testGroup('loop and break', [
  ['["loop",["break",3]]', 3, ArkNumberTraitType],
])

testGroup('let', [
  ['["let",[["const","a","Num",3]],"a"]', 3, ArkNumberTraitType],
])

testGroup('Objects', [
  ['{"a":1,"=":2,"!=":3}', {a: 1, '=': 2, '!=': 3}, ArkAnyType],
])

testGroup('Lists', [
  ['["list",1,2,3]', [1, 2, 3], ArkListTraitType],
  ['["invoke",["list",1,2,3],"len"]', 3, ArkNumberTraitType],
  ['["invoke",["list",4,5,6],"get",1]', 5, ArkNumberTraitType],
  ['["invoke",["list",4,5,6],"set",1,2]', [4, 2, 6], ArkListTraitType],
])

testGroup('Maps', [
  ['["seq",["map",[["str","a"],1],[["str","b"],["invoke",2,"add",0]],[3,4]]]', new Map<unknown, unknown>([['a', 1], ['b', 2], [3, 4]]), ArkMapTraitType],
])
