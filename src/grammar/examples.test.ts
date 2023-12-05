// Ursa parser tests using example source files.
// © Reuben Thomas 2023
// Released under the MIT license.

import {fileTest as test} from './testutil.js'

void test('Increment a variable in a loop', 'test/increment-variable-in-loop')
void test('Sum ints from 1 to 10', 'test/sum-ints-from-1-to-10')
void test('Call first-class function', 'test/first-class-function')
void test('Factorial (recurse with function argument)', 'test/fac-function-argument')
void test('Factorial (recurse with let fn)', 'test/fac-fn-let')
void test('Sum list (break result)', 'test/sum-list-break')
void test('Sum list (return result)', 'test/sum-list-return')
void test('Double list', 'test/double-list')
void test('Repeated closure', 'test/repeated-closure')
void test('Two closures', 'test/two-closures')
void test('Two double closures', 'test/two-double-closures')
void test('Test JSON', 'test/json')
void test('Test mixed lets and exps', 'test/mixed-lets-and-exps')
void test('Mutual recursion', 'test/mutual-recursion')
void test('Test I/O', 'test/print')
void test('use fs', 'test/use-fs')
void test('Find symbols in input', 'test/syms-no-shebang')
void test('Test error on bad function call', 'test/bad-call')

// Rosetta code examples
void test('Accumulator factory', 'rosettacode/Accumulator factory')
void test('Ackermann function', 'rosettacode/Ackermann function')
void test('Conditional structures', 'rosettacode/Conditional structures')
void test('Hello world-Text', 'rosettacode/Hello world-Text')
void test('Integer sequence', 'rosettacode/Integer sequence')
