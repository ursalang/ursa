import fs from 'fs'
import test from 'ava'
import tmp from 'tmp'
import execa from 'execa'
import {EnvironmentVal, evalArk, valueOf} from './ark/interp'
import {toVal as arkToVal} from './ark/parser'
import {toVal as ursaToVal} from './ursa/parser'

const command = process.env.NODE_ENV === 'coverage' ? './bin/test-run.sh' : './bin/run.js'

async function run(args: string[]) {
  return execa(command, args)
}

function doTestGroup(title: string, toVal: Function, tests: [string, any][]) {
  test(title, (t) => {
    for (const [source, expected] of tests) {
      t.deepEqual(valueOf(evalArk(toVal(source), new EnvironmentVal([]))), expected)
    }
  })
}

export function testArkGroup(title: string, tests: [string, any][]) {
  return doTestGroup(title, arkToVal, tests)
}

export function testUrsaGroup(title: string, tests: [string, any][]) {
  return doTestGroup(title, ursaToVal, tests)
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
