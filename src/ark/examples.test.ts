// Ark tests using example source files.
// © Reuben Thomas 2023
// Released under the GPL version 3, or (at your option) any later version.

import {cliTest} from './testutil.js'

[
  ['Increment a variable in a loop', 'test/increment-variable-in-loop'],
  ['Sum ints from 1 to 10', 'test/sum-ints-from-1-to-10'],
  ['Call first-class function', 'test/first-class-function'],
  ['Factorial (recurse with symbol reference)', 'test/fac-symbol-recursion'],
  ['Factorial (recurse with function argument)', 'test/fac-function-argument'],
  ['Sum list (break result)', 'test/sum-list-break'],
  ['Sum list (return result)', 'test/sum-list-return'],
  ['Double list', 'test/double-list'],
  ['Assign to table', 'test/assign-to-table'],
  ['Repeated closure', 'test/repeated-closure'],
  ['Two double closures', 'test/two-double-closures'],
  // eslint-disable-next-line @typescript-eslint/return-await
].map(async ([title, file]) => await cliTest(title, file))
