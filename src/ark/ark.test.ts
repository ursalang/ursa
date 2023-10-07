import test from 'ava'

import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
  BreakException, runArk, toJs,
} from './interp.js'
import {compile} from './compiler.js'

import {testArkGroup as testGroup} from '../testutil.js'

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

test('Bare break', (t) => {
  const error = t.throws(() => runArk(compile('["break"]')), {instanceOf: BreakException})
  if (error !== undefined) {
    t.is(toJs(error.value()), null)
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
  ['["prop","length",["list",1,2,3]]', 3],
  ['[["prop","get",["list",4,5,6]],1]', 5],
  ['[["prop","set",["list",4,5,6]],1,2]', 2],
])

testGroup('Maps', [
  ['["seq",["map",[["str","a"],1],[["str","b"],["+",2,0]],[3,4]]]', new Map<any, any>([['a', 1], ['b', 2], [3, 4]])],
])
