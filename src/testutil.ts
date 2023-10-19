import fs from 'fs'
import test from 'ava'
import tmp from 'tmp'
import {execa} from 'execa'
import {ArkState, toJs, debug} from './ark/interp.js'
import {compile as arkCompile, CompiledArk} from './ark/compiler.js'
import {compile as ursaCompile} from './ursa/compiler.js'

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
  output?: string,
  args?: string[],
) {
  const tempFile = tmp.tmpNameSync()
  test(title, async (t) => {
    const {stdout} = await run([`--syntax=${syntax}`, `--output=${tempFile}`, `${file}.${syntax}`, ...args ?? []])
    const result = JSON.parse(fs.readFileSync(tempFile, {encoding: 'utf-8'}))
    const expected = JSON.parse(fs.readFileSync(`${file}.result.json`, {encoding: 'utf-8'}))
    t.deepEqual(result, expected)
    if (output !== undefined) {
      t.is(stdout, output)
    }
  })
}
