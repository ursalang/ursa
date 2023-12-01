/* eslint-disable no-useless-concat */
// Ursa tests using example source files.
// © Reuben Thomas 2023
// Released under the MIT license.

import {cliTest} from '../testutil.js'

const test = cliTest.bind(null, 'ursa');

[
  ['Increment a variable in a loop', 'test/increment-variable-in-loop'],
  ['Sum ints from 1 to 10', 'test/sum-ints-from-1-to-10'],
  ['Call first-class function', 'test/first-class-function'],
  ['Factorial (recurse with function argument)', 'test/fac-function-argument'],
  ['Factorial (recurse with let fn)', 'test/fac-fn-let'],
  ['Sum list (break result)', 'test/sum-list-break'],
  ['Sum list (return result)', 'test/sum-list-return'],
  ['Sum list (with iterator)', 'test/sum-list-iterator'],
  ['Sum list (with for)', 'test/sum-list-for'],
  ['Sum map (with iterator)', 'test/sum-map-iterator'],
  ['Sum map (with for)', 'test/sum-map-for'],
  ['Sum map (with values iterator)', 'test/sum-map-values'],
  ['Get map keys as list', 'test/map-keys-to-list'],
  ['Double list', 'test/double-list'],
  ['Repeated closure', 'test/repeated-closure'],
  ['Two closures', 'test/two-closures'],
  ['Two double closures', 'test/two-double-closures'],
  ['Test JSON', 'test/json'],
  ['Test mixed lets and exps', 'test/mixed-lets-and-exps'],
  ['Mutual recursion', 'test/mutual-recursion'],
  ['String with line continuation', 'test/string-line-continuation'],
  ['Literal string', 'test/literal-string'],
].map(([title, file]) => cliTest('ursa', title, file))

test('Test I/O', 'test/print', [], 'Hello, world!')

test("'fs' module", 'test/fs', [], 'foo')

test('use fs', 'test/use-fs', [], 'foo')

test('Find symbols in input', 'test/syms', ['./test/fs.ursa'], 'fs\nwriteSync\nfoo\nis\nstdout')

test('Test error on bad function call', 'test/bad-call', [], undefined, `\
Error: Line 2, col 14:
  1 | let h = 3
> 2 | let g = fn() { h() }
                   ^~~~~~~
  3 | let f = fn() { g() }

Invalid call

Traceback (most recent call last)
  line 3
    let f = fn() { g() }, in f
  line 4
    f(), at top level`)

test('Test error on bad property access', 'test/sum-map-iterator-wrong', [], `\
a
b
c
d
e`, `\
Error: Line 6, col 13:
  5 |     let l = it()
> 6 |     let k = l[0] and let v = l[1]
                  ^
  7 |     if l == null { return tot }

Attempt to read property of non-object

Traceback (most recent call last)
  line 12
    sum({"a": 10, "b": 30, "c": 50, "d": 5, "e": 5}), at top level`)

test('Test error on re-assignment with wrong type', 'test/bad-reassignment', [], undefined, `\
Error: Line 3, col 1:
  2 | a := 2
> 3 | a := "hello"
      ^~~~~~~~~~~~
  4 | ` + `

Assignment to different type

Traceback (most recent call last)
`)

// Rosetta code examples
test('Accumulator factory', 'rosettacode/Accumulator factory', [], '8.3')
test('Ackermann function', 'rosettacode/Ackermann function', [], '1\n125\n13')
// Not run, as the program has an unbound variable
// test('Conditional structures', 'rosettacode/Conditional structures')
test('Hello world-Text', 'rosettacode/Hello world-Text', [], 'hello woods!')
// Not run, as this program does not terminate
// test('Integer sequence', 'rosettacode/Integer sequence')
