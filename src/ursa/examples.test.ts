// Ursa tests using example source files.
// © Reuben Thomas 2023-2025
// Released under the GPL version 3, or (at your option) any later version.

import assert from 'assert'
import test from 'ava'
import {execa} from 'execa'
import fs from 'fs'
import kill from 'tree-kill'
import tmp from 'tmp'

import {
  ursaTest, ursaDirTest, ursaCommand, run,
} from '../testutil.js'

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
  ['Mutated capture', 'test/mutated-capture'],
  ['Test JSON', 'test/json'],
  ['Test mixed lets and exps', 'test/mixed-lets-and-exps'],
  ['Mutual recursion', 'test/mutual-recursion'],
  ['String with line continuation', 'test/string-line-continuation'],
  ['Literal string', 'test/literal-string'],
  ['Test I/O', 'test/print'],
  ['use jslib.fs', 'test/use-jslib-fs'],
  ['Two sequential loops', 'test/two-sequential-loops'],
  ['else-if', 'test/else-if'],
  ['yield', 'test/yield'],
  ['generator', 'test/generator'],
  ['launch', 'test/launch'],

  // Compiler error tests
  ['Test error on bad function call', 'test/bad-call'],
  ['Test error on invalid method invocation', 'test/sum-map-iterator-invalid-method'],
  ['Test error on invalid property access', 'test/sum-map-iterator-invalid-property'],
  ['Test error on assignment to non-lvalue', 'test/bad-assignment'],
  ['Test error on re-assignment with wrong type', 'test/bad-reassignment'],
  ["Test error on duplicate identifiers in 'let'", 'test/duplicate-let'],
  ["Test error on 'yield' outside generator", 'test/bad-yield'],
  ['Test errors on bad argument types', 'test/bad-argument-types'],

  // Rosetta code examples
  ['Accumulator factory', 'rosettacode/Accumulator factory'],
  ['Ackermann function', 'rosettacode/Ackermann function'],
  ['Averages/Arithmetic mean', 'rosettacode/Averages-Arithmetic mean'],
  ['Averages/Mode', 'rosettacode/Averages-Mode'],
  ['Averages/Root mean square', 'rosettacode/Averages-Root mean square'],
  // This program has an unbound variable
  // ['Conditional structures', 'rosettacode/Conditional structures'],
  ['FizzBuzz', 'rosettacode/FizzBuzz'],
  ['Generator/Exponential', 'rosettacode/Generator-Exponential'],
  ['Hello world/Text', 'rosettacode/Hello world-Text'],
  // This program does not terminate
  // ['Integer sequence', 'rosettacode/Integer sequence'],
  // This program produces non-deterministic output
  // ['Loops/Break', 'rosettacode/Loops-Break'],
  ['Loops/Continue', 'rosettacode/Loops-Continue'],
  ['Loops/For', 'rosettacode/Loops-For'],
  ['Loops/While', 'rosettacode/Loops-While'],
  ['Man or boy test', 'rosettacode/Man or boy test'],
].map(([title, file]) => ursaTest(title, file))

// Tests with extra arguments
ursaTest('Advent of Code 2023 day 25', 'test/advent-of-code-2023-day-25', ['./test/advent-of-code-2023-day-25-input.txt'])
ursaTest('Find symbols in input', 'test/syms', ['./test/use-jslib-fs.ursa'])
ursaDirTest('fs', 'test/fs', 'test/fs.result')

// Rosetta code examples with command-line arguments
ursaTest('Anagrams', 'rosettacode/Anagrams', ['rosettacode/unixdict.txt'])

// Test executable script generation
test('Executable scripts', async (t) => {
  for (const target of ['ark', 'js']) {
    const tempExecFile = tmp.fileSync({discardDescriptor: true})
    t.teardown(() => tempExecFile.removeCallback())
    await execa(ursaCommand, [
      `--target=${target}`,
      'compile', '--executable', 'test/advent-of-code-2023-day-25.ursa',
      `--output=${tempExecFile.name}`,
    ])
    const {stdout} = await execa(tempExecFile.name, ['test/advent-of-code-2023-day-25-input.txt'])
    t.deepEqual(stdout, fs.readFileSync('test/advent-of-code-2023-day-25.stdout', {encoding: 'utf-8'}))
  }
})

// Complex tests
test('Web server', async (t) => {
  const proc = run(['./test/web-server.ursa'], {
    buffer: false, stdout: 'pipe', detached: true, reject: false,
  })
  const response = await new Promise((resolve, _reject) => {
    proc.stdout!.on('data', (data: Buffer) => {
      const matches = data.toString().match(/http:\/\/localhost: ([0-9]+)/)
      assert(matches)
      const port = Number(matches[1])
      void fetch(`http://localhost:${port}`).then(async (response) => resolve(await response.text()))
    })
  })
  t.is(response, 'My first server!')
  // Kill process group
  kill(proc.pid!)
})
