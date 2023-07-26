import test from 'ava'

import {
  toVal, BreakException, debug, EnvironmentVal,
} from './haklisp'

Error.stackTraceLimit = Infinity

test('basic', (t) => {
  t.is(toVal('4').eval(new EnvironmentVal([])).value(), 4)
  t.is(toVal('(+ 3 4)').eval(new EnvironmentVal([])).value(), 7)
  t.is(toVal('(* (+ 3 4) 5)').eval(new EnvironmentVal([])).value(), 35)
  t.is(toVal('pi').eval(new EnvironmentVal([])).value(), Math.PI)
  t.is(toVal('pi (+ 3 4)').eval(new EnvironmentVal([])).value(), 7)
  t.is(toVal('(seq pi (+ 3 4))').eval(new EnvironmentVal([])).value(), 7)
  t.is(toVal('(if true 3 4)').eval(new EnvironmentVal([])).value(), 3)
  t.is(toVal('(if false 3 4)').eval(new EnvironmentVal([])).value(), 4)
  t.is(toVal('(= (+ 3 4) 7)').eval(new EnvironmentVal([])).value(), true)
  t.is(toVal('(if (= (+ 3 4) 7) 1 0)').eval(new EnvironmentVal([])).value(), 1)
  t.is(toVal('(or 1 2)').eval(new EnvironmentVal([])).value(), 1)
  t.is(toVal('(and 1 2)').eval(new EnvironmentVal([])).value(), 2)
  t.is(toVal('(not 2)').eval(new EnvironmentVal([])).value(), false)
  const error = t.throws(() => toVal('(break)').eval(new EnvironmentVal([])), {instanceOf: BreakException})
  if (error !== undefined) {
    t.is(error.value().value(), null)
  }
  t.is(toVal('(loop (break 3))').eval(new EnvironmentVal([])).value(), 3)
  t.is(toVal('(let {a: 3} a)').eval(new EnvironmentVal([])).value(), 3)
  t.is(toVal('(let {b: 5} (seq (prop set (quote b) 7) b))').eval(new EnvironmentVal([])).value(), 7)
  t.is(toVal(`
    (let {a: 0}
     (loop
      (seq
        (prop set (quote a) (+ a 1))
        (if (= a 3)
         (break a)))))`).eval(new EnvironmentVal([])).value(), 3)
  t.is(toVal(`
    (let {total: 0 i: 0}
      (loop
        (seq
          (prop set (quote i) (+ i 1))
          (prop set (quote total) (+ total i))
          (if (= i 10)
            (break total)))))`).eval(new EnvironmentVal([])).value(), 55)
  t.is(toVal('; Comment\n3').eval(new EnvironmentVal([])).value(), 3)
  t.is(toVal('"hello \u00e9"').eval(new EnvironmentVal([])).value(), 'hello é')
  t.is(toVal('(let {f: (fn [x] (+ x 1))} (f 1))').eval(new EnvironmentVal([])).value(), 2)
  // t.is(toVal('(seq (prop set (quote f) (fn [x] (+ x 1))) (f 1))').eval(new EnvironmentVal([])).value(), 2)
  // t.is(toVal(`
  //   (let {
  //     fac: (fn [x]
  //       (if (= x 0)
  //         1
  //         (* x (fac (- x 1)))))}
  //    (fac 6))
  // `).eval(new EnvironmentVal([])).value(), 720)
  t.is(toVal(`
    (let {
      fac: (fn [self x]
        (if (= x 0)
          1
          (* x (self self (- x 1)))))}
     (fac fac 6))
  `).eval(new EnvironmentVal([])).value(), 720)
  t.deepEqual(toVal('[1 2 3]').eval(new EnvironmentVal([])).value(), [1, 2, 3])
  t.is(toVal('(prop length [1 2 3])').eval(new EnvironmentVal([])).value(), 3)
  t.is(toVal('(prop get [4 5 6] 1)').eval(new EnvironmentVal([])).value(), 5)
  t.is(toVal(`
    (let {sum: (fn [l]
      (let {tot: 0 i: 0}
        (loop
          (seq
            (if (= i (prop length l))
              (break tot))
            (prop set (quote tot) (+ tot (prop get l i)))
            (prop set (quote i) (+ i 1))
        ))
      ))} (sum [10 30 50 5 5]))
  `).eval(new EnvironmentVal([])).value(), 100)
  t.is(toVal(`
    (let {sum: (fn [l]
      (let {tot: 0 i: 0}
        (loop
          (seq
            (if (= i (prop length l))
              (return tot))
            (prop set (quote tot) (+ tot (prop get l i)))
            (prop set (quote i) (+ i 1))
        ))
      ))} (sum [10 30 50 5 5]))
  `).eval(new EnvironmentVal([])).value(), 100)
  // t.is(toVal('(prop set (quote x) 1)').eval(new EnvironmentVal([])).value(), 1)
  t.deepEqual(toVal(`
    (let {double: (fn [l]
      (let {i: 0}
        (loop
          (seq
            (if (= i (prop length l))
              (return l))
            (prop set l i (* (prop get l i) 2))
            (prop set (quote i) (+ i 1))
            ))))
    } (double [1 2 3]))
  `).eval(new EnvironmentVal([])).value(), [2, 4, 6])
  t.deepEqual(toVal('{"a": 1 "b": (+ 2 0) 3: 4}').eval(new EnvironmentVal([])).value(), new Map<any, any>([['a', 1], ['b', 2], [3, 4]]))
  t.deepEqual(toVal('(let {t: {"a": 1 "b": (+ 2 0) 3: 4}} (seq (prop set t "b" 1) t))').eval(new EnvironmentVal([])).value(), new Map<any, any>([['a', 1], ['b', 1], [3, 4]]))
  t.deepEqual(toVal(`
    (let {tot: 0}
      (let {accum: (fn [x]
        (prop set (quote tot) (+ tot x))
      )}
        [(accum 1) (accum 1)]))
  `).eval(new EnvironmentVal([])).value(), [1, 2])
})
