import test from 'ava'

import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
  BreakException, EnvironmentVal,
} from './interp.js'
import {toVal} from './parser.js'

Error.stackTraceLimit = Infinity

test('Comment', (t) => {
  t.is(toVal('; Comment\n3').eval(new EnvironmentVal([]))._value(), 3)
})

test('Concrete values', (t) => {
  t.is(toVal('4').eval(new EnvironmentVal([]))._value(), 4)
  t.is(toVal('"hello \u00e9"').eval(new EnvironmentVal([]))._value(), 'hello é')
})

test('Global values', (t) => {
  t.is(toVal('(+ 3 4)').eval(new EnvironmentVal([]))._value(), 7)
  t.is(toVal('(* (+ 3 4) 5)').eval(new EnvironmentVal([]))._value(), 35)
  t.is(toVal('pi').eval(new EnvironmentVal([]))._value(), Math.PI)
  t.is(toVal('pi (+ 3 4)').eval(new EnvironmentVal([]))._value(), 7)
  t.is(toVal('(= (+ 3 4) 7)').eval(new EnvironmentVal([]))._value(), true)
  t.is(toVal('(not 2)').eval(new EnvironmentVal([]))._value(), false)
})

test('Sequences', (t) => {
  t.is(toVal('(seq pi (+ 3 4))').eval(new EnvironmentVal([]))._value(), 7)
})

test('Conditionals', (t) => {
  t.is(toVal('(if true 3 4)').eval(new EnvironmentVal([]))._value(), 3)
  t.is(toVal('(if false 3 4)').eval(new EnvironmentVal([]))._value(), 4)
  t.is(toVal('(if (= (+ 3 4) 7) 1 0)').eval(new EnvironmentVal([]))._value(), 1)
  t.is(toVal('(or 1 2)').eval(new EnvironmentVal([]))._value(), 1)
  t.is(toVal('(and 1 2)').eval(new EnvironmentVal([]))._value(), 2)
})

test('loop and break', (t) => {
  const error = t.throws(() => toVal('(break)').eval(new EnvironmentVal([])), {instanceOf: BreakException})
  if (error !== undefined) {
    t.is(error._value()._value(), null)
  }
  t.is(toVal('(loop (break 3))').eval(new EnvironmentVal([]))._value(), 3)
})

// FIXME
// test('Global assignment', (t) => {
// t.is(toVal('(prop set (quote x) 1)').eval(new EnvironmentVal([]))._value(), 1)
// t.is(toVal('(seq (prop set (quote f) (fn [x] (+ x 1))) (f 1))').eval(new EnvironmentVal([]))._value(), 2)
// })

test('let', (t) => {
  t.is(toVal('(let [a] (seq (prop set (quote a) 3) a))').eval(new EnvironmentVal([]))._value(), 3)
})

test('Lists', (t) => {
  t.deepEqual(toVal('[1 2 3]').eval(new EnvironmentVal([]))._value(), [1, 2, 3])
  t.is(toVal('(prop length [1 2 3])').eval(new EnvironmentVal([]))._value(), 3)
  t.is(toVal('(prop get [4 5 6] 1)').eval(new EnvironmentVal([]))._value(), 5)
})

test('Maps', (t) => {
  t.deepEqual(toVal('{"a": 1 "b": (+ 2 0) 3: 4}').eval(new EnvironmentVal([]))._value(), new Map<any, any>([['a', 1], ['b', 2], [3, 4]]))
})
