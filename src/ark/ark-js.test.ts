import test from 'ava'

import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug, EnvironmentVal,
  toJson,
} from './interp.js'

import {toVal} from './parser.js'

function jsonTests(title: string, tests: [string, ...any][]) {
  test(title, (t) => {
    for (const [source, ...results] of tests) {
      t.is(toJson(toVal(source)), JSON.stringify(['seq', ...results]))
    }
  })
}

Error.stackTraceLimit = Infinity

jsonTests('Comment', [
  ['; Comment\n3', 3],
])

jsonTests('Concrete values', [
  ['4', 4],
  ['"hello \u00e9"', 'hello é'],
])

jsonTests('Intrinsics', [
  ['(+ 3 4)', ['+', 3, 4]],
  ['(* (+ 3 4) 5)', ['*', ['+', 3, 4], 5]],
  ['pi', 'pi'],
  ['pi (+ 3 4)', 'pi', ['+', 3, 4]],
  ['(= (+ 3 4) 7)', ['=', ['+', 3, 4], 7]],
  ['(not 2)', ['not', 2]],
])

jsonTests('Sequences', [
  ['(seq pi (+ 3 4))', ['seq', 'pi', ['+', 3, 4]]],
])

jsonTests('Conditionals', [
  ['(if true 3 4)', ['if', true, 3, 4]],
  ['(if false 3 4)', ['if', false, 3, 4]],
  ['(if (= (+ 3 4) 7) 1 0)', ['if', ['=', ['+', 3, 4], 7], 1, 0]],
  ['(or 1 2)', ['or', 1, 2]],
  ['(and 1 2)', ['and', 1, 2]],
])

jsonTests('loop and break', [
  ['(loop (break 3))', ['loop', ['break', 3]]],
])

// FIXME
// jsonTests('Global assignment', [
// t.is(compile('(prop set (ref x) 1)'), 1)
// t.is(compile('(seq (prop set (ref f) (fn [x] (+ x 1))) (f 1))'), 2)
// })

jsonTests('let', [
  ['(let [a] (seq (prop set (ref a) 3) a))', ['let', ['a'], ['seq', ['prop', 'set', ['ref', 'a'], 3], 'a']]],
])

jsonTests('Lists', [
  ['[1 2 3]', [1, 2, 3]],
  ['(prop length [1 2 3])', ['prop', 'length', [1, 2, 3]]],
  ['(prop get [4 5 6] 1)', ['prop', 'get', [4, 5, 6], 1]],
])

jsonTests('Objects', [
  ['{a: 1 b: (+ 2 0) c: 4}', {a: 1, b: ['+', 2, 0], c: 4}],
])

jsonTests('Maps', [
  ['{"a": 1 "b": (+ 2 0) 3: 4}', ['map', ['a', 1], ['b', ['+', 2, 0]], [3, 4]]],
])
