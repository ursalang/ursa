// Ark test utility routines.
// © Reuben Thomas 2023
// Released under the GPL version 3, or (at your option) any later version.

import fs from 'fs'
import test from 'ava'
import {ArkState, debug} from './interpreter.js'
import {compile} from './parser.js'
import {toJs} from './ffi.js'
import {valToJs} from './serialize.js'

function doCompile(source: string) {
  const compiled = compile(source)
  if (process.env.DEBUG) {
    debug(compiled, null)
  }
  return compiled
}

export async function testGroup(
  title: string,
  tests: [string, any][],
) {
  test(title, async (t) => {
    for (const [source, expected] of tests) {
      const compiled = doCompile(source)
      // eslint-disable-next-line no-await-in-loop
      t.deepEqual(toJs(await new ArkState().run(compiled)), expected)
    }
  })
}

export async function cliTest(title: string, file: string) {
  test(title, async (t) => {
    const source = fs.readFileSync(`${file}.json`, {encoding: 'utf-8'})
    const expected = fs.readFileSync(`${file}.result.json`, {encoding: 'utf-8'})
    const compiled = doCompile(source)
    t.deepEqual(valToJs(compiled.value), JSON.parse(source))
    t.deepEqual(valToJs(await new ArkState().run(compiled)), JSON.parse(expected))
  })
}
