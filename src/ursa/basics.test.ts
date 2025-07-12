// Ursa tests of basics using inline source snippets.
// © Reuben Thomas 2023-2025
// Released under the GPL version 3, or (at your option) any later version.

import test from 'ava'

import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
} from '../ark/util.js'
import {ArkCompilerError} from '../ark/error.js'
import {ArkState} from '../ark/interpreter.js'
import {compile, runWithTraceback} from './compiler.js'

import {testUrsaGroup as testGroup} from '../testutil.js'
import {expToInst} from '../ark/flatten.js'
import {
  ArkNullVal, ArkBooleanVal, ArkNumberVal, ArkStringVal,
  ArkMap, ArkList,
} from '../ark/data.js'

testGroup('Comments', [
  ['// Comment', null, ArkNullVal],
  ['// Comment\n3', 3, ArkNumberVal],
])

testGroup('Concrete values', [
  ['4', 4, ArkNumberVal],
  [String.raw`"hello \u00e9"`, 'hello é', ArkStringVal],
])

testGroup('Intrinsics', [
  ['3 + 4', 7, ArkNumberVal],
  ['(3 + 4) * 5', 35, ArkNumberVal],
  ['3 + 4 == 7', true, ArkBooleanVal],
  ['not true', false, ArkBooleanVal],
  ['~2', -3, ArkNumberVal],
  ['34 & 48', 32, ArkNumberVal],
  ['34 | 48', 50, ArkNumberVal],
  ['34 ^ 48', 18, ArkNumberVal],
  ['34 << 4', 544, ArkNumberVal],
  ['-34 >> 4', -3, ArkNumberVal],
  ['34 >>> 4', 2, ArkNumberVal],
])

testGroup('Globals', [
  ['pi', Math.PI, ArkNumberVal],
])

testGroup('Sequences', [
  ['{ pi }', Math.PI, ArkNumberVal],
  ['{ pi; 3+4 }', 7, ArkNumberVal],
  ['{ pi; 3+4; }', 7, ArkNumberVal],
])

test('Assignment errors', (t) => {
  const error1 = t.throws(() => compile('4 := 5'), {instanceOf: ArkCompilerError})
  t.not(error1, undefined)
  t.is(error1.message, `\
Line 1, col 1:
> 1 | 4 := 5
      ^

Bad lvalue`)
  const error2 = t.throws(() => compile('range(1) := 5'), {instanceOf: ArkCompilerError})
  t.not(error2, undefined)
  t.is(error2.message, `\
Line 1, col 1:
> 1 | range(1) := 5
      ^~~~~~~~

Bad lvalue`)
})

testGroup('Assignment', [
  ['var a = 0; a := 3', 3, ArkNumberVal],
])

testGroup('Conditionals', [
  ['if true {3} else {4}', 3, ArkNumberVal],
  ['if false {3} else {4}', 4, ArkNumberVal],
  ['if 3 + 4 == 7 {1} else {0}', 1, ArkNumberVal],
  // FIXME: make these failing tests
  // ['1 or 2', 1],
  // ['1 and 2', 2],
  ['false or true', true, ArkBooleanVal],
  ['true and true', true, ArkBooleanVal],
  ['if 3 + 4 == 8 {1} else if 3 + 4 == 7 {2} else {3}', 2, ArkNumberVal],
])

test('Loop errors', (t) => {
  const error1 = t.throws(() => compile('break'), {instanceOf: ArkCompilerError})
  t.not(error1, undefined)
  t.is(error1.message, `\
Line 1, col 1:
> 1 | break
      ^~~~~

break used outside a loop`)
  const error2 = t.throws(() => compile('continue'), {instanceOf: ArkCompilerError})
  t.not(error2, undefined)
  t.is(error2.message, `\
Line 1, col 1:
> 1 | continue
      ^~~~~~~~

continue used outside a loop`)
})

testGroup('loop', [
  ['loop { break 3 }', 3, ArkNumberVal],
])

test('return outside function', (t) => {
  const error = t.throws(() => compile('return'), {instanceOf: ArkCompilerError})
  t.not(error, undefined)
  t.is(error.message, `\
Line 1, col 1:
> 1 | return
      ^~~~~~

return used outside a function`)
})

testGroup('return', [
  ['fn (): Num { return 3 }()', 3, ArkNumberVal],
])

testGroup('let', [
  ['let a = 3; a', 3, ArkNumberVal],
  ['var b = 5; b := 7; b', 7, ArkNumberVal],
])

test("Assignment to non-'var'", (t) => {
  const error = t.throws(() => compile('let a = 5; a := 7'), {instanceOf: ArkCompilerError})
  t.not(error, undefined)
  t.is(error.message, `\
Line 1, col 12:
> 1 | let a = 5; a := 7
                 ^

Cannot assign to non-'var'`)
})

testGroup('fn', [
  ['let f = fn(x: Num): Num {x + 1}; f(1)', 2, ArkNumberVal],
])

test('Duplicate parameters', (t) => {
  const error = t.throws(() => compile('fn(a: Any,a: Any): U {}'), {instanceOf: ArkCompilerError})
  t.not(error, undefined)
  t.is(error.message, `\
Line 1, col 4:
> 1 | fn(a: Any,a: Any): U {}
         ^~~~~~~~~~~~~

Duplicate parameters in list`)
})

testGroup('Lists', [
  ['[1, 2, 3]', [1, 2, 3], ArkList],
  ['[1, 2, 3].len()', 3, ArkNumberVal],
  ['[1, 2].push(3).len()', 3, ArkNumberVal],
  ['[1, 2, 3].get(1)', 2, ArkNumberVal],
  ['let l = [1, 2, 3]; l.set(1, 4); l', [1, 4, 3], ArkList],
  ['let x = []; x == x', true, ArkBooleanVal],
])

testGroup('Objects', [
  // ['Object {;}', {}],
  ['let x = {;}; x == x', true, ArkBooleanVal],
  // ['Object {a = 1; b = 2; c=3}', {a: 1, b: 2, c: 3}],
  // FIXME: use this test again once we have classes
  // ['let o = Object {a = 1; b = 2}; o.b := 3; o', {a: 1, b: 3}],
])

test('Object assign invalid property', async (t) => {
  const error = await t.throwsAsync(async () => runWithTraceback(
    new ArkState(expToInst(compile('let o = Object {a = 1; b = 2}; o.c := "abc"'))),
  ), {instanceOf: ArkCompilerError})
  t.not(error, undefined)
  t.is(error.message, `\
Line 1, col 32:
> 1 | let o = Object {a = 1; b = 2}; o.c := "abc"
                                     ^~~

Invalid property \`c'`)
})

testGroup('Maps', [
  ['{}', new Map<unknown, unknown>(), ArkMap],
  ['let x = {}; x == x', true, ArkBooleanVal],
  ['{"a": 1, "b": 2 + 0, 3: 4}', new Map<unknown, unknown>([['a', 1], ['b', 2], [3, 4]]), ArkMap],
  ['let t = {"a": 1, "b": 2 + 0, 3: 4}; t.set("b", 1); t', new Map<unknown, unknown>([['a', 1], ['b', 1], [3, 4]]), ArkMap],
])
