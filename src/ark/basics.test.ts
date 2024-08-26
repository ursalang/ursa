// Ark tests of basics using inline source snippets.
// © Reuben Thomas 2023-2024
// Released under the MIT license.

import test from 'ava'

import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
} from './util.js'
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
  ['4', 4],
  ['["str","hello é"]', 'hello é'],
])

testGroup('Intrinsics', [
  ['["invoke",3,"add",4]', 7],
  ['["invoke",["invoke",3,"add",4],"mul",5]', 35],
  ['"pi"', Math.PI],
  ['["seq","pi",["invoke",3,"add",5]]', 8],
  ['["invoke",["invoke",3,"add",4],"equals",7]', true],
  ['["invoke",true,"not"]', false],
  ['["invoke",2,"bitwiseNot"]', -3],
  ['["invoke",34,"bitwiseAnd",48]', 32],
  ['["invoke",34,"bitwiseOr",48]', 50],
  ['["invoke",34,"bitwiseXor",48]', 18],
  ['["invoke",34,"shiftLeft",4]', 544],
  ['["invoke",-34,"shiftRight",4]', -3],
  ['["invoke",34,"shiftRightArith",4]', 2],
])

testGroup('Sequences', [
  ['["seq","pi",["invoke",3,"add",4]]', 7],
])

testGroup('Conditionals', [
  ['["if",false,3,4]', 4],
  ['["if",true,3,4]', 3],
  ['["if",["invoke",["invoke",3,"add",4],"equals",7],1,0]', 1],
  ['["or",1,2]', true],
  ['["and",1,2]', 2],
])

test('Bare break', (t) => {
  const error = t.throws(() => new ArkState(expToInst(compile(['break']))).run())
  t.not(error, undefined)
  t.is(error.message, 'break outside loop')
})

testGroup('loop and break', [
  ['["loop",["break",3]]', 3],
])

testGroup('let', [
  ['["let",[["const","a",3]],"a"]', 3],
])

testGroup('Objects', [
  ['{"a":1,"=":2,"!=":3}', {a: 1, '=': 2, '!=': 3}],
])

testGroup('Lists', [
  ['["list",1,2,3]', [1, 2, 3]],
  ['["invoke",["list",1,2,3],"len"]', 3],
  ['["invoke",["list",4,5,6],"get",1]', 5],
  ['["invoke",["list",4,5,6],"set",1,2]', [4, 2, 6]],
])

testGroup('Maps', [
  ['["seq",["map",[["str","a"],1],[["str","b"],["invoke",2,"add",0]],[3,4]]]', new Map<unknown, unknown>([['a', 1], ['b', 2], [3, 4]])],
])
