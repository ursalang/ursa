import {cliTest} from './testutil.js'

const test = cliTest.bind(null, 'ursa');

[
  ['Increment a variable in a loop', 'test/increment-variable-in-loop'],
  ['Sum ints from 1 to 10', 'test/sum-ints-from-1-to-10'],
  ['Call first-class function', 'test/first-class-function'],
  ['Factorial (recurse with function argument)', 'test/fac-function-argument'],
  ['Factorial (recurse with let fn)', 'test/fac-fn-let'],
  ['Sum list (break result)', 'test/sum-list-break'],
  ['Sum list (return result)', 'test/sum-list-return'],
  ['Double list', 'test/double-list'],
  ['Repeated closure', 'test/repeated-closure'],
  ['Two closures', 'test/two-closures'],
  ['Two double closures', 'test/two-double-closures'],
  ['Test JSON', 'test/json'],
  ['Test mixed lets and exps', 'test/mixed-lets-and-exps'],
  ['Mutual recursion', 'test/mutual-recursion'],
].map(([title, file]) => cliTest('ursa', title, file))

test('Test I/O', 'test/print', [], 'Hello, world!')

test("'fs' module", 'test/fs', [], 'foo')

// FIXME: make this work again
// test('use fs', 'test/use-fs', 'foo')

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
    let f = fn() { g() }, at top level
  line 4
    f(), in g`)

// Rosetta code examples
test('Accumulator factory', 'rosettacode/Accumulator factory', [], '8.3')
test('Ackermann function', 'rosettacode/Ackermann function', [], '1\n125\n13')
// Not run, as the program has an unbound variable
// test('Conditional structures', 'rosettacode/Conditional structures.ursa')
test('Hello world-Text', 'rosettacode/Hello world-Text', [], 'hello woods!')
// Not run, as this program does not terminate
// test('Integer sequence', 'Integer sequence.ursa')
