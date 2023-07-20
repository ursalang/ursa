import test from 'ava'

import {toVal, BreakException, debug} from './haklisp'

test('basic', (t) => {
  t.is(toVal('4').eval([]).value(), 4)
  t.is(toVal('(+ 3 4)').eval([]).value(), 7)
  t.is(toVal('(* (+ 3 4) 5)').eval([]).value(), 35)
  t.is(toVal('pi').eval([]).value(), Math.PI)
  t.is(toVal('pi (+ 3 4)').eval([]).value(), 7)
  t.is(toVal('(seq pi (+ 3 4))').eval([]).value(), 7)
  t.is(toVal('(if true 3 4)').eval([]).value(), 3)
  t.is(toVal('(if false 3 4)').eval([]).value(), 4)
  t.is(toVal('(= (+ 3 4) 7)').eval([]).value(), true)
  t.is(toVal('(if (= (+ 3 4) 7) 1 0)').eval([]).value(), 1)
  t.is(toVal('(or 1 2)').eval([]).value(), 1)
  t.is(toVal('(and 1 2)').eval([]).value(), 2)
  t.is(toVal('(not 2)').eval([]).value(), false)
  const error = t.throws(() => toVal('(break)').eval([]), {instanceOf: BreakException})
  if (error !== undefined) {
    t.is(error.value().value(), null)
  }
  t.is(toVal('(loop (break 3))').eval([]).value(), 3)
  t.is(toVal('(let {a: 3} a)').eval([]).value(), 3)
  t.is(toVal('(let {b: 5} (seq (set (quote b) 7) b))').eval([]).value(), 7)
  t.is(toVal(`
    (let {a: 0}
     (loop
      (seq
        (set (quote a) (+ a 1))
        (if (= a 3)
         (break a)))))`).eval([]).value(), 3)
  t.is(toVal(`
    (let {total: 0 i: 0}
      (loop
        (seq
          (set (quote i) (+ i 1))
          (set (quote total) (+ total i))
          (if (= i 10)
            (break total)))))`).eval([]).value(), 55)
  t.is(toVal('; Comment\n3').eval([]).value(), 3)
  t.is(toVal('"hello \u00e9"').eval([]).value(), 'hello é')
  t.is(toVal('(let {f: (fn [x] (+ x 1))} (f 1))').eval([]).value(), 2)
  t.is(toVal('(seq (set (quote f) (fn [x] (+ x 1))) (f 1))').eval([]).value(), 2)
  t.is(toVal(`
    (let {
      fac: (fn [x]
        (if (= x 0)
          1
          (* x (fac (- x 1)))))}
     (fac 6))
  `).eval([]).value(), 720)
  t.deepEqual(toVal('[1 2 3]').eval([]).value(), [1, 2, 3])
  t.is(toVal('(prop (quote length) [1 2 3])').eval([]).value(), 3)
  t.is(toVal('(prop (quote get) [4 5 6] 1)').eval([]).value(), 5)
  t.is(toVal(`
    (let {sum: (fn [l]
      (let {tot: 0 i: 0}
        (loop
          (seq
            (if (= i (prop (quote length) l))
              (break tot))
            (set (quote tot) (+ tot (prop (quote get) l i)))
            (set (quote i) (+ i 1))
        ))
      ))} (sum [10 30 50 5 5]))
  `).eval([]).value(), 100)
  t.is(toVal(`
    (let {sum: (fn [l]
      (let {tot: 0 i: 0}
        (loop
          (seq
            (if (= i (prop (quote length) l))
              (return tot))
            (set (quote tot) (+ tot (prop (quote get) l i)))
            (set (quote i) (+ i 1))
        ))
      ))} (sum [10 30 50 5 5]))
  `).eval([]).value(), 100)
  t.is(toVal('(set (quote x) 1)').eval([]).value(), 1)
  t.deepEqual(toVal(`
    (let {double: (fn [l]
      (let {i: 0}
        (loop
          (seq
            (if (= i (prop (quote length) l))
              (return l))
            (prop (quote set) l i (* (prop (quote get) l i) 2))
            (set (quote i) (+ i 1))
            ))))
    } (double [1 2 3]))
  `).eval([]).value(), [2, 4, 6])
  t.deepEqual(toVal('{"a": 1 "b": (+ 2 0) 3: 4}').eval([]).value(), new Map<any, any>([['a', 1], ['b', 2], [3, 4]]))
  t.deepEqual(toVal('(seq (set (quote t) {"a": 1 "b": (+ 2 0) 3: 4}) (prop (quote set) t "b" 1) t)').eval([]).value(), new Map<any, any>([['a', 1], ['b', 1], [3, 4]]))
})
