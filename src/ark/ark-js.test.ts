import test from 'ava'

import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug, EnvironmentVal,
  valToJson,
} from './interp.js'

import {toVal} from './parser.js'

function testGroup(title: string, tests: [string, ...any][]) {
  test(title, (t) => {
    for (const [source, ...results] of tests) {
      t.is(valToJson(toVal(source)), JSON.stringify(['seq', ...results]))
    }
  })
}

Error.stackTraceLimit = Infinity

testGroup('Comment', [
  ['; Comment\n3', 3],
])

testGroup('Concrete values', [
  ['4', 4],
  ['"hello \u00e9"', ['str', 'hello é']],
])

testGroup('Intrinsics', [
  ['(+ 3 4)', ['+', 3, 4]],
  ['(* (+ 3 4) 5)', ['*', ['+', 3, 4], 5]],
  ['pi', 'pi'],
  ['pi (+ 3 4)', 'pi', ['+', 3, 4]],
  ['(= (+ 3 4) 7)', ['=', ['+', 3, 4], 7]],
  ['(not 2)', ['not', 2]],
])

testGroup('Sequences', [
  ['(seq pi (+ 3 4))', ['seq', 'pi', ['+', 3, 4]]],
  // FIXME: Global access.
  // ['(seq (prop set (ref f) (fn [x] (+ x 1))) (f 1))',
  //   ['seq', ['prop', 'set', ['ref', 'f'], ['fn', ['params', 'x'], ['+', 'x', 1]]]]],
])

testGroup('Conditionals', [
  ['(if true 3 4)', ['if', true, 3, 4]],
  ['(if false 3 4)', ['if', false, 3, 4]],
  ['(if (= (+ 3 4) 7) 1 0)', ['if', ['=', ['+', 3, 4], 7], 1, 0]],
  ['(or 1 2)', ['or', 1, 2]],
  ['(and 1 2)', ['and', 1, 2]],
])

testGroup('loop and break', [
  ['(loop (break 3))', ['loop', ['break', 3]]],
])

testGroup('let', [
  ['(let [a] (seq (prop set (ref a) 3) a))', ['let', ['params', 'a'], ['seq', ['prop', 'set', ['ref', 'a'], 3], 'a']]],
])

testGroup('Lists', [
  ['[1 2 3]', ['list', 1, 2, 3]],
  ['(prop length [1 2 3])', ['prop', 'length', ['list', 1, 2, 3]]],
  ['(prop get [4 5 6] 1)', ['prop', 'get', ['list', 4, 5, 6], 1]],
])

testGroup('Objects', [
  ['{a: 1 b: (+ 2 0) c: 4}', {a: 1, b: ['+', 2, 0], c: 4}],
])

testGroup('Maps', [
  ['{"a": 1 "b": (+ 2 0) 3: 4}', ['map', [['str', 'a'], 1], [['str', 'b'], ['+', 2, 0]], [3, 4]]],
])
