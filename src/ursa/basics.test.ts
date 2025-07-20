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
  ArkNullTraitType, ArkBooleanTraitType, ArkNumberTraitType, ArkStringTraitType,
  ArkMapTraitType, ArkListTraitType,
} from '../ark/data.js'

testGroup('Comments', [
  ['// Comment', null, ArkNullTraitType],
  ['// Comment\n3', 3, ArkNumberTraitType],
])

testGroup('Concrete values', [
  ['4', 4, ArkNumberTraitType],
  [String.raw`"hello \u00e9"`, 'hello é', ArkStringTraitType],
])

testGroup('Intrinsics', [
  ['3 + 4', 7, ArkNumberTraitType],
  ['(3 + 4) * 5', 35, ArkNumberTraitType],
  ['3 + 4 == 7', true, ArkBooleanTraitType],
  ['not true', false, ArkBooleanTraitType],
  ['~2', -3, ArkNumberTraitType],
  ['34 & 48', 32, ArkNumberTraitType],
  ['34 | 48', 50, ArkNumberTraitType],
  ['34 ^ 48', 18, ArkNumberTraitType],
  ['34 << 4', 544, ArkNumberTraitType],
  ['-34 >> 4', -3, ArkNumberTraitType],
  ['34 >>> 4', 2, ArkNumberTraitType],
])

testGroup('Globals', [
  ['pi', Math.PI, ArkNumberTraitType],
])

testGroup('Sequences', [
  ['{ pi }', Math.PI, ArkNumberTraitType],
  ['{ pi; 3+4 }', 7, ArkNumberTraitType],
  ['{ pi; 3+4; }', 7, ArkNumberTraitType],
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
  ['var a = 0; a := 3', 3, ArkNumberTraitType],
])

testGroup('Conditionals', [
  ['if true {3} else {4}', 3, ArkNumberTraitType],
  ['if false {3} else {4}', 4, ArkNumberTraitType],
  ['if 3 + 4 == 7 {1} else {0}', 1, ArkNumberTraitType],
  // FIXME: make these failing tests
  // ['1 or 2', 1],
  // ['1 and 2', 2],
  ['false or true', true, ArkBooleanTraitType],
  ['true and true', true, ArkBooleanTraitType],
  ['if 3 + 4 == 8 {1} else if 3 + 4 == 7 {2} else {3}', 2, ArkNumberTraitType],
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
  ['loop { break 3 }', 3, ArkNumberTraitType],
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
  ['fn (): Num { return 3 }()', 3, ArkNumberTraitType],
])

testGroup('let', [
  ['let a = 3; a', 3, ArkNumberTraitType],
  ['var b = 5; b := 7; b', 7, ArkNumberTraitType],
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
  ['let f = fn(x: Num): Num {x + 1}; f(1)', 2, ArkNumberTraitType],
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
  ['[1, 2, 3]', [1, 2, 3], ArkListTraitType],
  ['[1, 2, 3].len()', 3, ArkNumberTraitType],
  ['[1, 2].push(3).len()', 3, ArkNumberTraitType],
  ['[1, 2, 3].get(1)', 2, ArkNumberTraitType],
  ['let l = [1, 2, 3]; l.set(1, 4); l', [1, 4, 3], ArkListTraitType],
  ['let x = []; x == x', true, ArkBooleanTraitType],
])

testGroup('Objects', [
  // ['Object {;}', {}],
  ['let x = {;}; x == x', true, ArkBooleanTraitType],
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
  ['{}', new Map<unknown, unknown>(), ArkMapTraitType],
  ['let x = {}; x == x', true, ArkBooleanTraitType],
  ['{"a": 1, "b": 2 + 0, 3: 4}', new Map<unknown, unknown>([['a', 1], ['b', 2], [3, 4]]), ArkMapTraitType],
  ['let t = {"a": 1, "b": 2 + 0, 3: 4}; t.set("b", 1); t', new Map<unknown, unknown>([['a', 1], ['b', 1], [3, 4]]), ArkMapTraitType],
])
