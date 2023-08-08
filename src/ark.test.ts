import test from 'ava'

import {cliTest as realCliTest} from './testutil.js'

async function cliTest(args: string[]) {
  return realCliTest(['--sexp', ...args])
}

test('Increment a variable in a loop', async (t) => {
  t.is(await cliTest(['test/increment-variable-in-loop.ark']), '3')
})

test('Sum ints from 1 to 10', async (t) => {
  t.is(await cliTest(['test/sum-ints-from-1-to-10.ark']), '55')
})

test('Call first-class function', async (t) => {
  t.is(await cliTest(['test/first-class-function.ark']), '2')
})

test('Factorial (recurse with symbol reference)', async (t) => {
  t.is(await cliTest(['test/fac-symbol-recursion.ark']), '720')
})

test('Factorial (recurse with function argument)', async (t) => {
  t.is(await cliTest(['test/fac-function-argument.ark']), '720')
})

test('Sum list (break result)', async (t) => {
  t.is(await cliTest(['test/sum-list-break.ark']), '100')
})

test('Sum list (return result)', async (t) => {
  t.is(await cliTest(['test/sum-list-return.ark']), '100')
})

test('Double list', async (t) => {
  t.is(await cliTest(['test/double-list.ark']), '[ 2, 4, 6 ]')
})

test('Assign to table', async (t) => {
  t.is(await cliTest(['test/assign-to-table.ark']), 'Map(3) { \'a\' => 1, \'b\' => 1, 3 => 4 }')
})

test('Repeated closure', async (t) => {
  t.is(await cliTest(['test/repeated-closure.ark']), '[ 1, 2 ]')
})
