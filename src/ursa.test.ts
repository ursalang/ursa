import test from 'ava'

import {cliTest} from './testutil.js'

test('Increment a variable in a loop', async (t) => {
  t.is(await cliTest(['test/increment-variable-in-loop.ursa']), '3')
})

test('Sum ints from 1 to 10', async (t) => {
  t.is(await cliTest(['test/sum-ints-from-1-to-10.ursa']), '55')
})

test('Call first-class function', async (t) => {
  t.is(await cliTest(['test/first-class-function.ursa']), '2')
})

test('Factorial (recurse with symbol reference)', async (t) => {
  t.is(await cliTest(['test/fac-symbol-recursion.ursa']), '720')
})

test('Factorial (recurse with function argument)', async (t) => {
  t.is(await cliTest(['test/fac-function-argument.ursa']), '720')
})

test('Factorial (recurse with fn sugar)', async (t) => {
  t.is(await cliTest(['test/fac-fn-sugar.ursa']), '720')
})

test('Sum list (break result)', async (t) => {
  t.is(await cliTest(['test/sum-list-break.ursa']), '100')
})

test('Sum list (return result)', async (t) => {
  t.is(await cliTest(['test/sum-list-return.ursa']), '100')
})

test('Double list', async (t) => {
  t.is(await cliTest(['test/double-list.ursa']), '[ 2, 4, 6 ]')
})

test('Repeated closure', async (t) => {
  t.is(await cliTest(['test/repeated-closure.ursa']), '[ 1, 2 ]')
})

test('Two closures', async (t) => {
  t.is(await cliTest(['test/two-closures.ursa']), '[ 1, 2, 1 ]')
})
