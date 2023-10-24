import {cliTest} from './testutil.js'

[
  ['Increment a variable in a loop', 'test/increment-variable-in-loop'],
  ['Sum ints from 1 to 10', 'test/sum-ints-from-1-to-10'],
  ['Call first-class function', 'test/first-class-function'],
  ['Factorial (recurse with symbol reference)', 'test/fac-symbol-recursion'],
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
].map(([title, file]) => cliTest('ursa', title, file))

cliTest('ursa', 'Test I/O', 'test/print', 'Hello, world!')

cliTest('ursa', "'fs' module", 'test/fs', 'foo')

// FIXME: make this work again
// cliTest('ursa', 'use fs', 'test/use-fs', 'foo')

cliTest('ursa', 'Find symbols in input', 'test/syms', 'fs\nwriteSync\nfoo\nis\nstdout', ['./test/fs.ursa'])
