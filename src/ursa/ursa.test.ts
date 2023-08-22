import test from 'ava'

import {toVal} from './parser.js'
import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
  BreakException, EnvironmentVal, valueOf, evalArk,
} from '../ark/interp.js'

Error.stackTraceLimit = Infinity

test('Comment', (t) => {
  t.is(valueOf(evalArk(toVal('// Comment'), new EnvironmentVal([]))), null)
  t.is(valueOf(evalArk(toVal('// Comment\n3'), new EnvironmentVal([]))), 3)
})

test('Concrete values', (t) => {
  t.is(valueOf(evalArk(toVal('4'), new EnvironmentVal([]))), 4)
  t.is(valueOf(evalArk(toVal(String.raw`"hello \u00e9"`), new EnvironmentVal([]))), 'hello é')
})

test('Intrinsics', (t) => {
  t.is(valueOf(evalArk(toVal('3 + 4'), new EnvironmentVal([]))), 7)
  t.is(valueOf(evalArk(toVal('(3 + 4) * 5'), new EnvironmentVal([]))), 35)
  t.is(valueOf(evalArk(toVal('pi'), new EnvironmentVal([]))), Math.PI)
  t.is(valueOf(evalArk(toVal('3 + 4 == 7'), new EnvironmentVal([]))), true)
  t.is(valueOf(evalArk(toVal('not 2'), new EnvironmentVal([]))), false)
})

test('Sequences', (t) => {
  t.is(valueOf(evalArk(toVal('{ pi }'), new EnvironmentVal([]))), Math.PI)
  t.is(valueOf(evalArk(toVal('{ pi; 3+4 }'), new EnvironmentVal([]))), 7)
  t.is(valueOf(evalArk(toVal('{ pi; 3+4; }'), new EnvironmentVal([]))), 7)
})

test('Conditionals', (t) => {
  t.is(valueOf(evalArk(toVal('if true {3} else {4}'), new EnvironmentVal([]))), 3)
  t.is(valueOf(evalArk(toVal('if false {3} else {4}'), new EnvironmentVal([]))), 4)
  t.is(valueOf(evalArk(toVal('if 3 + 4 == 7 {1} else {0}'), new EnvironmentVal([]))), 1)
  t.is(valueOf(evalArk(toVal('1 or 2'), new EnvironmentVal([]))), 1)
  t.is(valueOf(evalArk(toVal('1 and 2'), new EnvironmentVal([]))), 2)
})

test('loop and break', (t) => {
  const error = t.throws(() => evalArk(toVal('break'), new EnvironmentVal([])), {instanceOf: BreakException})
  if (error !== undefined) {
    t.is(valueOf(error.value()), null)
  }
  t.is(valueOf(evalArk(toVal('loop { break 3 }'), new EnvironmentVal([]))), 3)
})

test('let', (t) => {
  t.is(valueOf(evalArk(toVal('let a = 3; a'), new EnvironmentVal([]))), 3)
  t.is(valueOf(evalArk(toVal('let b = 5; b = 7; b'), new EnvironmentVal([]))), 7)
})

test('fn', (t) => {
  t.is(valueOf(evalArk(toVal('let f = fn(x) {x + 1}; f(1)'), new EnvironmentVal([]))), 2)
})

test('Lists', (t) => {
  t.deepEqual(valueOf(evalArk(toVal('[1, 2, 3]'), new EnvironmentVal([]))), [1, 2, 3])
  t.is(valueOf(evalArk(toVal('[1, 2, 3].length'), new EnvironmentVal([]))), 3)
  t.is(valueOf(evalArk(toVal('[1, 2, 3][1]'), new EnvironmentVal([]))), 2)
})

test('Objects', (t) => {
  t.deepEqual(valueOf(evalArk(toVal('{}'), new EnvironmentVal([]))), {})
})

test('Maps', (t) => {
  t.deepEqual(valueOf(evalArk(toVal('{"a": 1, "b": 2 + 0, 3: 4}'), new EnvironmentVal([]))), new Map<any, any>([['a', 1], ['b', 2], [3, 4]]))
  t.deepEqual(valueOf(evalArk(toVal('let t = {"a": 1, "b": 2 + 0, 3: 4}; t["b"] = 1; t'), new EnvironmentVal([]))), new Map<any, any>([['a', 1], ['b', 1], [3, 4]]))
})
