// Ursa parser tests using example source files.
// © Reuben Thomas 2023
// Released under the MIT license.

import {fileTest as test} from './testutil.js'

test('Increment a variable in a loop', 'test/increment-variable-in-loop')
test('Sum ints from 1 to 10', 'test/sum-ints-from-1-to-10')
test('Call first-class function', 'test/first-class-function')
test('Factorial (recurse with function argument)', 'test/fac-function-argument')
test('Factorial (recurse with let fn)', 'test/fac-fn-let')
test('Sum list (break result)', 'test/sum-list-break')
test('Sum list (return result)', 'test/sum-list-return')
test('Double list', 'test/double-list')
test('Repeated closure', 'test/repeated-closure')
test('Two closures', 'test/two-closures')
test('Two double closures', 'test/two-double-closures')
test('Test JSON', 'test/json')
test('Test mixed lets and exps', 'test/mixed-lets-and-exps')
test('Mutual recursion', 'test/mutual-recursion')
test('Test I/O', 'test/print')
test('use jslib.fs', 'test/use-jslib-fs')
test('Find symbols in input', 'test/syms-no-shebang')
test('Test error on bad function call', 'test/bad-call')

// Rosetta code examples
test('Accumulator factory', 'rosettacode/Accumulator factory')
test('Ackermann function', 'rosettacode/Ackermann function')
test('Conditional structures', 'rosettacode/Conditional structures')
test('Hello world-Text', 'rosettacode/Hello world-Text')
test('Integer sequence', 'rosettacode/Integer sequence')

// Grammar tests
test('Function', 'test/grammar/fn')
test('List', 'test/grammar/list')
test('Map', 'test/grammar/map')
test('Object literal 1', 'test/grammar/object-test-1')
test('Object literal 2', 'test/grammar/object-test-2')
test('Object literal 3', 'test/grammar/object-test-3')
