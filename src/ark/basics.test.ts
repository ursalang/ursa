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
  const error = t.throws(() => new ArkState(expToInst(compile(['f']))).run())
  t.not(error, undefined)
  t.is(error.message, 'Undefined symbol f')
})

testGroup('Concrete values', [
  ['4', 4],
  ['["str","hello é"]', 'hello é'],
])

testGroup('Intrinsics', [
  ['[["prop","add",3],4]', 7],
  ['[["prop","mul",[["prop","add",3],4]],5]', 35],
  ['"pi"', Math.PI],
  ['["seq","pi",[["prop","add",3],5]]', 8],
  ['[["prop","equals",[["prop","add",3],4]],7]', true],
  ['[["prop","not",true]]', false],
  ['[["prop","bitwiseNot",2]]', -3],
  ['[["prop","bitwiseAnd",34],48]', 32],
  ['[["prop","bitwiseOr",34],48]', 50],
  ['[["prop","bitwiseXor",34],48]', 18],
  ['[["prop","shiftLeft",34],4]', 544],
  ['[["prop","shiftRight",-34],4]', -3],
  ['[["prop","shiftRightArith",34],4]', 2],
])

testGroup('Sequences', [
  ['["seq","pi",[["prop","add",3],4]]', 7],
])

testGroup('Conditionals', [
  ['["if",false,3,4]', 4],
  ['["if",true,3,4]', 3],
  ['["if",[["prop","equals",[["prop","add",3],4]],7],1,0]', 1],
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
  ['["let",[["a",false,3]],"a"]', 3],
])

testGroup('Objects', [
  ['{"a":1,"=":2,"!=":3}', {a: 1, '=': 2, '!=': 3}],
])

testGroup('Lists', [
  ['["list",1,2,3]', [1, 2, 3]],
  ['[["prop","len",["list",1,2,3]]]', 3],
  ['[["prop","get",["list",4,5,6]],1]', 5],
  ['[["prop","set",["list",4,5,6]],1,2]', [4, 2, 6]],
])

testGroup('Maps', [
  ['["seq",["map",[["str","a"],1],[["str","b"],[["prop","add",2],0]],[3,4]]]', new Map<unknown, unknown>([['a', 1], ['b', 2], [3, 4]])],
])
