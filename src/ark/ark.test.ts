import test from 'ava'

import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
  BreakException, EnvironmentVal, valToJson,
} from './interp.js'
import {toVal} from './parser.js'
import {jsonToVal} from './parser-json.js'

Error.stackTraceLimit = Infinity

function testGroup(title: string, tests: [string, any][]) {
  test(title, (t) => {
    for (const [source, expected] of tests) {
      const val = toVal(source)
      t.deepEqual(val.eval(new EnvironmentVal([]))._value(), expected)
      const json = valToJson(val)
      const jsonVal = jsonToVal(json)
      t.deepEqual(jsonVal.eval(new EnvironmentVal([]))._value(), expected)
    }
  })
}

testGroup('Comment', [
  ['; Comment\n3', 3],
])

testGroup('Concrete values', [
  ['4', 4],
  ['"hello \u00e9"', 'hello é'],
])

testGroup('Intrinsics', [
  ['(+ 3 4)', 7],
  ['(* (+ 3 4) 5)', 35],
  ['pi', Math.PI],
  ['pi (+ 3 5)', 8],
  ['(= (+ 3 4) 7)', true],
  ['(not 2)', false],
])

testGroup('Sequences', [
  ['(seq pi (+ 3 4))', 7],
])

testGroup('Conditionals', [
  ['(if true 3 4)', 3],
  ['(if false 3 4)', 4],
  ['(if (= (+ 3 4) 7) 1 0)', 1],
  ['(or 1 2)', 1],
  ['(and 1 2)', 2],
])

test('Bare break', (t) => {
  const error = t.throws(() => toVal('(break)').eval(new EnvironmentVal([])), {instanceOf: BreakException})
  if (error !== undefined) {
    t.is(error._value()._value(), null)
  }
})

testGroup('loop and break', [
  ['(loop (break 3))', 3],
])

// FIXME
// arkTests('Global assignment', [
// ['(prop set (ref x) 1)', 1],
// ['(seq (prop set (ref f) (fn [x] (+ x 1))) (f 1))', 2],
// ])

testGroup('let', [
  ['(let [a] (seq (prop set (ref a) 3) a))', 3],
])

testGroup('Lists', [
  ['[1 2 3]', [1, 2, 3]],
  ['(prop length [1 2 3])', 3],
  ['(prop get [4 5 6] 1)', 5],
])

testGroup('Maps', [
  ['{"a": 1 "b": (+ 2 0) 3: 4}', new Map<any, any>([['a', 1], ['b', 2], [3, 4]])],
])
