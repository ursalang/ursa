/* eslint-disable no-useless-concat */
// Ursa tests using example source files.
// © Reuben Thomas 2023-2024
// Released under the GPL version 3, or (at your option) any later version.

import assert from 'assert'
import test from 'ava'
import kill from 'tree-kill'

import {ursaTest, ursaDirTest, run} from '../testutil.js'

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
  ['Closure with object', 'test/mutated-capture'],
  ['Test JSON', 'test/json'],
  ['Test mixed lets and exps', 'test/mixed-lets-and-exps'],
  ['Mutual recursion', 'test/mutual-recursion'],
  ['String with line continuation', 'test/string-line-continuation'],
  ['Literal string', 'test/literal-string'],
].map(([title, file]) => ursaTest(title, file))

ursaTest('Advent of Code 2023 day 25', 'test/advent-of-code-2023-day-25', ['./test/advent-of-code-2023-day-25-input.txt'], '547080')
ursaTest('Test I/O', 'test/print', [], 'Hello, world!')
ursaTest('use jslib.fs', 'test/use-jslib-fs', [], 'foo')
ursaTest('Find symbols in input', 'test/syms', ['./test/use-jslib-fs.ursa'], 'use\njslib\nfs\nfs\nwriteSync\nfoo\nis\nstdout')
ursaTest('Two sequential loops', 'test/two-sequential-loops', [], '1\n2\n3\na\nb\nc')
ursaTest('else-if', 'test/else-if', [], `\
nought
one
two
many
many
many
many
many
many
many`)
ursaTest('launch', 'test/launch', [], `\
10 0
5 0
10 1
5 1
10 2
5 2
10 3
5 3
10 4
5 4
10 5
10 6
10 7
10 8
10 9`)
ursaDirTest('fs', 'test/fs', 'test/fs.result')

// Compiler error tests
ursaTest('Test error on bad function call', 'test/bad-call', [], undefined, `\
Error: Line 2, col 21:
  1 | let h = 3
> 2 | let g = fn(): Int { h() }
                          ^~~
  3 | let f = fn(): Int { g() }

Invalid call

Traceback (most recent call last)
  line 3
    let f = fn(): Int { g() }, in f
  line 4
    f(), at top level`, undefined, `\
Error: Line 3, col 5:
  2 | let g = fn(): Int {
> 3 |     h()
          ^~~
  4 | }

Invalid call

Traceback (most recent call last)
  line 6
        g(), in f
  line 8
    f(), at top level`)

ursaTest('Test error on bad property access', 'test/sum-map-iterator-wrong', [], `\
a
b
c
d
e`, `\
Error: Line 6, col 13:
  5 |     let l = it()
> 6 |     let k = l.get(0) and let v = l.get(1)
                  ^~~~~
  7 |     if l == null { return tot }

Invalid property

Traceback (most recent call last)
  line 12
    sum({"a": 10, "b": 30, "c": 50, "d": 5, "e": 5}), at top level`, undefined, `\
Error: Line 6, col 17:
  5 |         let l = it()
> 6 |         let k = l.get(0) and let v = l.get(1)
                      ^~~~~
  7 |         if l == null {

Invalid property

Traceback (most recent call last)
  line 14
    sum({"a": 10, "b": 30, "c": 50, "d": 5, "e": 5}), at top level`)

ursaTest('Test error on re-assignment with wrong type', 'test/bad-reassignment', [], undefined, `\
Error: Line 3, col 1:
  2 | a := 2
> 3 | a := "hello"
      ^~~~~~~~~~~~
  4 | ` + `

Assignment to different type`)

// Rosetta code examples
ursaTest('Accumulator factory', 'rosettacode/Accumulator factory', [], '8.3')
ursaTest('Ackermann function', 'rosettacode/Ackermann function', [], '1\n125\n13')
// Not run, as the program has an unbound variable
// test('Conditional structures', 'rosettacode/Conditional structures')
ursaTest('Hello world-Text', 'rosettacode/Hello world-Text', [], 'hello woods!')
// Not run, as this program does not terminate
// test('Integer sequence', 'rosettacode/Integer sequence')

// Complex tests
test('Web server', async (t) => {
  const proc = run(['./test/web-server.ursa'], {buffer: false, stdout: 'pipe', detached: true})
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
