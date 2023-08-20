import test from 'ava'

import {cliTest as realCliTest} from './testutil.js'

async function cliTest(title: string, file: string, result: string) {
  test(title, async (t) => {
    t.is(await realCliTest(['--syntax=json', `${file}.json`]), result)
  })
}

cliTest(
  'Increment a variable in a loop',
  'test/increment-variable-in-loop',
  '3',
)

cliTest(
  'Sum ints from 1 to 10',
  'test/sum-ints-from-1-to-10',
  '55',
)

cliTest(
  'Call first-class function',
  'test/first-class-function',
  '2',
)

cliTest(
  'Factorial (recurse with symbol reference)',
  'test/fac-symbol-recursion',
  '720',
)

cliTest(
  'Factorial (recurse with function argument)',
  'test/fac-function-argument',
  '720',
)

cliTest(
  'Sum list (break result)',
  'test/sum-list-break',
  '100',
)

cliTest(
  'Sum list (return result)',
  'test/sum-list-return',
  '100',
)

cliTest(
  'Double list',
  'test/double-list',
  '[ 2, 4, 6 ]',
)

cliTest(
  'Assign to table',
  'test/assign-to-table',
  'Map(3) { \'a\' => 1, \'b\' => 1, 3 => 4 }',
)

cliTest(
  'Repeated closure',
  'test/repeated-closure',
  '[ 1, 2 ]',
)
