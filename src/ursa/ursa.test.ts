import test from 'ava'

import {toVal} from './parser.js'
import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
  BreakException, valueOf, evalArk,
} from '../ark/interp.js'

import {testUrsaGroup as testGroup} from '../testutil.js'

Error.stackTraceLimit = Infinity

testGroup('Comment', [
  ['// Comment', null],
  ['// Comment\n3', 3],
])

testGroup('Concrete values', [
  ['4', 4],
  [String.raw`"hello \u00e9"`, 'hello é'],
])

testGroup('Intrinsics', [
  ['3 + 4', 7],
  ['(3 + 4) * 5', 35],
  ['pi', Math.PI],
  ['3 + 4 == 7', true],
  ['not 2', false],
])

testGroup('Sequences', [
  ['{ pi }', Math.PI],
  ['{ pi; 3+4 }', 7],
  ['{ pi; 3+4; }', 7],
])

testGroup('Conditionals', [
  ['if true {3} else {4}', 3],
  ['if false {3} else {4}', 4],
  ['if 3 + 4 == 7 {1} else {0}', 1],
  ['1 or 2', 1],
  ['1 and 2', 2],
])

test('loop and break', (t) => {
  const error = t.throws(() => evalArk(toVal('break')), {instanceOf: BreakException})
  if (error !== undefined) {
    t.is(valueOf(error.value()), null)
  }
  t.is(valueOf(evalArk(toVal('loop { break 3 }'))), 3)
})

testGroup('let', [
  ['let a = 3; a', 3],
  ['let b = 5; b = 7; b', 7],
])

testGroup('fn', [
  ['let f = fn(x) {x + 1}; f(1)', 2],
])

testGroup('Lists', [
  ['[1, 2, 3]', [1, 2, 3]],
  ['[1, 2, 3].length', 3],
  ['[1, 2, 3][1]', 2],
])

testGroup('Objects', [
  ['{}', {}],
])

testGroup('Maps', [
  ['{"a": 1, "b": 2 + 0, 3: 4}', new Map<any, any>([['a', 1], ['b', 2], [3, 4]])],
  ['let t = {"a": 1, "b": 2 + 0, 3: 4}; t["b"] = 1; t', new Map<any, any>([['a', 1], ['b', 1], [3, 4]])],
])
