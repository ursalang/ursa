import test from 'ava'

import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
  BreakException, EnvironmentVal,
} from './interp.js'
import {jsonToVal} from './parser.js'

Error.stackTraceLimit = Infinity

function testGroup(title: string, tests: [string, any][]) {
  test(title, (t) => {
    for (const [source, expected] of tests) {
      const jsonVal = jsonToVal(source)
      t.deepEqual(jsonVal.eval(new EnvironmentVal([]))._value(), expected)
    }
  })
}

// FIXME
// testGroup('Comment', [
//   ['; Comment\n3', 3],
// ])

testGroup('Concrete values', [
  ['["seq",4]', 4],
  ['["seq",["str","hello é"]]', 'hello é'],
])

testGroup('Intrinsics', [
  ['["seq",["+",3,4]]', 7],
  ['["seq",["*",["+",3,4],5]]', 35],
  ['["seq","pi"]', Math.PI],
  ['["seq","pi",["+",3,5]]', 8],
  ['["seq",["=",["+",3,4],7]]', true],
  ['["seq",["not",2]]', false],
])

testGroup('Sequences', [
  ['["seq","pi",["+",3,4]]', 7],
])

testGroup('Conditionals', [
  ['["seq",["if",false,3,4]]', 4],
  ['["seq",["if",true,3,4]]', 3],
  ['["seq",["if",["=",["+",3,4],7],1,0]]', 1],
  ['["seq",["or",1,2]]', 1],
  ['["seq",["and",1,2]]', 2],
])

test('Bare break', (t) => {
  const error = t.throws(() => jsonToVal('["break"]').eval(new EnvironmentVal([])), {instanceOf: BreakException})
  if (error !== undefined) {
    t.is(error._value()._value(), null)
  }
})

testGroup('loop and break', [
  ['["seq",["loop",["break",3]]]', 3],
])

// FIXME
// arkTests('Global assignment', [
// ['["prop","set",["ref","x"],1]', 1],
// ['["seq",["prop","set",["ref","f"],["fn",["params","x"],["+","x",1]]],["f","1"]]', 2],
// ])

testGroup('let', [
  ['["seq",["let",["params","a"],["seq",["prop","set",["ref","a"],3],"a"]]]', 3],
])

testGroup('Lists', [
  ['["seq",["list",1,2,3]]', [1, 2, 3]],
  ['["seq",["prop","length",["list",1,2,3]]]', 3],
  ['["seq",["prop","get",["list",4,5,6],1]]', 5],
])

testGroup('Maps', [
  ['["seq",["map",[["str","a"],1],[["str","b"],["+",2,0]],[3,4]]]', new Map<any, any>([['a', 1], ['b', 2], [3, 4]])],
])
