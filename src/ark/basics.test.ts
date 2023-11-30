// Ark tests of basics using inline source snippets.
// © Reuben Thomas 2023
// Released under the GPL version 3, or (at your option) any later version.

import test from 'ava'

import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
  ArkBreakException, ArkState,
} from './interpreter.js'
import {toJs} from './ffi.js'
import {compile} from './parser.js'

import {testGroup} from './testutil.js'

Error.stackTraceLimit = Infinity

testGroup('Concrete values', [
  ['4', 4],
  ['["str","hello é"]', 'hello é'],
])

testGroup('Intrinsics', [
  ['["+",3,4]', 7],
  ['["*",["+",3,4],5]', 35],
  ['["get","pi"]', Math.PI],
  ['["seq",["get","pi"],["+",3,5]]', 8],
  ['["=",["+",3,4],7]', true],
  ['["not",2]', false],
  ['["~",2]', -3],
  ['["&",34,48]', 32],
  ['["|",34,48]', 50],
  ['["^",34,48]', 18],
  ['["<<",34,4]', 544],
  ['[">>",-34,4]', -3],
  ['[">>>",34,4]', 2],
])

testGroup('Sequences', [
  ['["seq","pi",["+",3,4]]', 7],
])

testGroup('Conditionals', [
  ['["if",false,3,4]', 4],
  ['["if",true,3,4]', 3],
  ['["if",["=",["+",3,4],7],1,0]', 1],
  ['["or",1,2]', 1],
  ['["and",1,2]', 2],
])

test('Bare break', async (t) => {
  const error = await t.throwsAsync(() => new ArkState().run(compile('["break"]')), {instanceOf: ArkBreakException})
  if (error !== undefined) {
    t.is(toJs(error.val), null)
  }
})

testGroup('loop and break', [
  ['["loop",["break",3]]', 3],
])

testGroup('let', [
  ['["let",["params","a"],["seq",["set","a",3],["get","a"]]]', 3],
])

testGroup('Objects', [
  ['{"a":1,"b":2,"c":3}', {a: 1, b: 2, c: 3}],
])

testGroup('Lists', [
  ['["list",1,2,3]', [1, 2, 3]],
  ['["get",["prop","length",["list",1,2,3]]]', 3],
  ['[["get",["prop","get",["list",4,5,6]]],1]', 5],
  ['[["get",["prop","set",["list",4,5,6]]],1,2]', 2],
])

testGroup('Maps', [
  ['["seq",["map",[["str","a"],1],[["str","b"],["+",2,0]],[3,4]]]', new Map<any, any>([['a', 1], ['b', 2], [3, 4]])],
])
