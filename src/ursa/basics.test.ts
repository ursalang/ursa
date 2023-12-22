/* eslint-disable no-useless-concat */
// Ursa tests of basics using inline source snippets.
// © Reuben Thomas 2023
// Released under the GPL version 3, or (at your option) any later version.

import test from 'ava'
import assert from 'assert'

import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
  ArkState,
} from '../ark/interpreter.js'
import {toJs} from '../ark/ffi.js'

import {compile, UrsaCompilerError} from './compiler.js'

import {testUrsaGroup as testGroup} from '../testutil.js'

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

test('loop and break', async (t) => {
  const error = t.throws(() => new ArkState().run(compile('break')), {instanceOf: UrsaCompilerError})
  assert(error !== undefined)
  t.is(error.message, `\
Line 1, col 1:
> 1 | break
      ^~~~~

break used outside a loop`)
  t.is(toJs(await new ArkState().run(compile('loop { break 3 }'))), 3)
})

test('return', async (t) => {
  const error = await t.throwsAsync(async () => new ArkState().run(compile('return')), {instanceOf: UrsaCompilerError})
  assert(error !== undefined)
  t.is(error.message, `\
Line 1, col 1:
> 1 | return
      ^~~~~~

return used outside a function`)
  t.is(toJs(await new ArkState().run(compile('fn () { return 3 }()'))), 3)
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
  ['[1, 2, 3].len', 3],
  ['[1, 2, 3][1]', 2],
  ['let l = [1, 2, 3]; l[1] := 4; l', [1, 4, 3]],
])

testGroup('Objects', [
  ['{}', {}],
  ['{a = 1, b = 2, c=3}', {a: 1, b: 2, c: 3}],
  ['let o = {a = 1, b = 2}; o.b := 3; o', {a: 1, b: 3}],
  ['let o = {a = 1, b = 2}; o.b := 3; o.c := "abc"; o', {a: 1, b: 3, c: 'abc'}],
])

testGroup('Maps', [
  ['{"a": 1, "b": 2 + 0, 3: 4}', new Map<unknown, unknown>([['a', 1], ['b', 2], [3, 4]])],
  ['let t = {"a": 1, "b": 2 + 0, 3: 4}; t["b"] := 1; t', new Map<unknown, unknown>([['a', 1], ['b', 1], [3, 4]])],
])
