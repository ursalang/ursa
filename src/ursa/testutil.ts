// Ursa test utilities.
// © Reuben Thomas 2023
// Released under the MIT license.

import fs from 'fs'
import test from 'ava'
import tmp from 'tmp'
import {execa} from 'execa'

import {ArkState, debug} from '../ark/interpreter.js'
import {compile as arkCompile, CompiledArk} from '../ark/parser.js'
import {toJs} from '../ark/ffi.js'

import {compile as ursaCompile} from './compiler.js'

const command = process.env.NODE_ENV === 'coverage' ? './bin/test-run.sh' : './bin/run.js'

async function run(args: string[]) {
  return execa(command, args)
}

function doTestGroup(
  title: string,
  compile: (expr: string) => CompiledArk,
  tests: [string, any][],
) {
  test(title, async (t) => {
    for (const [source, expected] of tests) {
      const compiled = compile(source)
      if (process.env.DEBUG) {
        debug(compiled, null)
      }
      // eslint-disable-next-line no-await-in-loop
      t.deepEqual(toJs(await new ArkState().run(compiled)), expected)
    }
  })
}

export function testArkGroup(title: string, tests: [string, any][]) {
  return doTestGroup(title, arkCompile, tests)
}

export function testUrsaGroup(title: string, tests: [string, any][]) {
  return doTestGroup(title, ursaCompile, tests)
}

export async function cliTest(
  syntax: string,
  title: string,
  file: string,
  args?: string[],
  expectedStdout?: string,
  expectedStderr?: string,
) {
  const tempFile = tmp.tmpNameSync()
  test(title, async (t) => {
    try {
      const {stdout} = await run([`--syntax=${syntax}`, `--output=${tempFile}`, `${file}.${syntax}`, ...args ?? []])
      const result = JSON.parse(fs.readFileSync(tempFile, {encoding: 'utf-8'}))
      const expected = JSON.parse(fs.readFileSync(`${file}.result.json`, {encoding: 'utf-8'}))
      t.deepEqual(result, expected)
      if (expectedStdout !== undefined) {
        t.is(stdout, expectedStdout)
      }
    } catch (error) {
      if (expectedStderr !== undefined) {
        t.is((error as any).stderr.slice('run.js: '.length), expectedStderr)
        if (expectedStdout !== undefined) {
          t.is((error as any).stdout, expectedStdout)
        }
      } else {
        throw error
      }
    }
  })
}
