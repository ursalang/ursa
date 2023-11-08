import fs from 'fs'
import test from 'ava'
import tmp from 'tmp'
import {execa} from 'execa'
import {ArkState, debug} from '@ursalang/ark'
// eslint-disable-next-line import/extensions
import {toJs} from '@ursalang/ark/lib/ffi.js'
// eslint-disable-next-line import/extensions
import {compile as arkCompile, CompiledArk} from '@ursalang/ark/lib/compiler.js'
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
  test(title, (t) => {
    for (const [source, expected] of tests) {
      const compiled = compile(source)
      if (process.env.DEBUG) {
        debug(compiled, null)
      }
      t.deepEqual(toJs(new ArkState().run(compiled)), expected)
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
  expected_stdout?: string,
  expected_stderr?: string,
) {
  const tempFile = tmp.tmpNameSync()
  test(title, async (t) => {
    try {
      const {stdout} = await run([`--syntax=${syntax}`, `--output=${tempFile}`, `${file}.${syntax}`, ...args ?? []])
      const result = JSON.parse(fs.readFileSync(tempFile, {encoding: 'utf-8'}))
      const expected = JSON.parse(fs.readFileSync(`${file}.result.json`, {encoding: 'utf-8'}))
      t.deepEqual(result, expected)
      if (expected_stdout !== undefined) {
        t.is(stdout, expected_stdout)
      }
    } catch (error) {
      if (expected_stderr !== undefined) {
        t.is((error as any).stderr.slice('run.js: '.length), expected_stderr)
      } else {
        throw error
      }
    }
  })
}
