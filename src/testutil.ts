import fs from 'fs'
import test from 'ava'
import tmp from 'tmp'
import execa from 'execa'
import {evalArk, toJs} from './ark/interp'
import {compile as arkCompile, CompiledArk} from './ark/parser'
import {compile as ursaCompile} from './ursa/parser'

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
      t.deepEqual(toJs(evalArk(compile(source)[0])), expected)
    }
  })
}

export function testArkGroup(title: string, tests: [string, any][]) {
  return doTestGroup(title, arkCompile, tests)
}

export function testUrsaGroup(title: string, tests: [string, any][]) {
  return doTestGroup(title, ursaCompile, tests)
}

export async function cliTest(syntax: string, title: string, file: string, output?: string) {
  const tempFile = tmp.tmpNameSync()
  test(title, async (t) => {
    const {stdout} = await run([`${file}.${syntax}`, `--syntax=${syntax}`, `--output=${tempFile}`])
    const result = fs.readFileSync(tempFile, {encoding: 'utf-8'})
    const expected = fs.readFileSync(`${file}.result.json`, {encoding: 'utf-8'})
    if (output !== undefined) {
      t.is(output, stdout)
    }
    t.is(result, expected)
  })
}
