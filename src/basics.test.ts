import test from 'ava'

import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
  ArkBreakException, ArkState, toJs,
} from '@ursalang/ark'

import {compile} from './compiler.js'

import {testUrsaGroup as testGroup} from './testutil.js'

Error.stackTraceLimit = Infinity

testGroup('Comments', [
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
  ['3 + 4 == 7', true],
  ['not 2', false],
  ['~2', -3],
  ['34 & 48', 32],
  ['34 | 48', 50],
  ['34 ^ 48', 18],
  ['34 << 4', 544],
  ['-34 >> 4', -3],
  ['34 >>> 4', 2],
])

testGroup('Globals', [
  ['pi', Math.PI],
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
  ['if 3 + 4 == 8 {1} else if 3 + 4 == 7 {2} else {3}', 2],
])

test('loop and break', (t) => {
  const error = t.throws(() => new ArkState().run(compile('break')), {instanceOf: ArkBreakException})
  if (error !== undefined) {
    t.is(toJs(error.val), null)
  }
  t.is(toJs(new ArkState().run(compile('loop { break 3 }'))), 3)
})

testGroup('let', [
  ['let a = 3; a', 3],
  ['let b = 5; b := 7; b', 7],
])

testGroup('fn', [
  ['let f = fn(x) {x + 1}; f(1)', 2],
])

testGroup('Lists', [
  ['[1, 2, 3]', [1, 2, 3]],
  ['[1, 2, 3].length', 3],
  ['[1, 2, 3][1]', 2],
  ['let l = [1, 2, 3]; l[1] := 4; l', [1, 4, 3]],
])

testGroup('Objects', [
  ['{}', {}],
  ['{a: 1, b: 2, c:3}', {a: 1, b: 2, c: 3}],
  ['let o = {a: 1, b: 2}; o.b := "abc"; o', {a: 1, b: 'abc'}],
  ['let o = {a: 1, b: 2}; o.b := "abc"; o.c := 3; o', {a: 1, b: 'abc', c: 3}],
])

testGroup('Maps', [
  ['{"a": 1, "b": 2 + 0, 3: 4}', new Map<any, any>([['a', 1], ['b', 2], [3, 4]])],
  ['let t = {"a": 1, "b": 2 + 0, 3: 4}; t["b"] := 1; t', new Map<any, any>([['a', 1], ['b', 1], [3, 4]])],
])
