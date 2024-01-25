// Ursa test utilities.
// © Reuben Thomas 2023
// Released under the GPL version 3, or (at your option) any later version.

import util from 'util'
import fs from 'fs'
import path from 'path'
import tmp from 'tmp'
import test, {ExecutionContext, Macro} from 'ava'
import {ExecaReturnValue, execa} from 'execa'
import {compareSync, Difference} from 'dir-compare'

import {ArkExp, ArkState, debug} from './ark/interpreter.js'
import {compile as doArkCompile} from './ark/compiler.js'
import {toJs} from './ark/ffi.js'
import {valToJs} from './ark/serialize.js'
import {compile as ursaCompile} from './ursa/compiler.js'
import {format} from './ursa/fmt.js'

const command = process.env.NODE_ENV === 'coverage' ? './bin/test-run.sh' : './bin/run.js'

async function run(args: string[], inputFile?: string) {
  if (process.env.DEBUG) {
    console.log(`run ${command} ${args} ${inputFile}`)
  }
  return execa(command, args, {inputFile})
}

function arkCompile(source: string) {
  return doArkCompile(JSON.parse(source))
}

function doTestGroup(
  title: string,
  compile: (expr: string) => ArkExp,
  tests: [string, unknown][],
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

export function testArkGroup(title: string, tests: [string, unknown][]) {
  return doTestGroup(title, arkCompile, tests)
}

export function testUrsaGroup(title: string, tests: [string, unknown][]) {
  return doTestGroup(title, ursaCompile, tests)
}

async function doCliTest(
  t: ExecutionContext,
  syntax: string,
  inputBasename: string,
  resultJsonFilename: string,
  extraArgs?: string[],
  expectedStdout?: string,
  expectedStderr?: string,
  useRepl?: boolean,
) {
  const inputFile = `${inputBasename}.${syntax}`
  const args = [`--syntax=${syntax}`]
  let tempFile: tmp.FileResult
  if (!useRepl) {
    tempFile = tmp.fileSync()
    t.teardown(() => tempFile.removeCallback())
    args.push('run', `--output=${tempFile.name}`, inputFile)
  }
  try {
    const {stdout, stderr} = await run(
      [...args, ...extraArgs ?? []],
      useRepl ? inputFile : undefined,
    )
    if (!useRepl) {
      const result: unknown = JSON.parse(fs.readFileSync(tempFile!.name, {encoding: 'utf-8'}))
      const expected: unknown = JSON.parse(fs.readFileSync(resultJsonFilename, {encoding: 'utf-8'}))
      t.deepEqual(result, expected)
    }
    if (syntax === 'json') {
      const source = fs.readFileSync(inputFile, {encoding: 'utf-8'})
      const compiled = arkCompile(source)
      t.deepEqual(valToJs(compiled), JSON.parse(source))
    }
    if (expectedStdout !== undefined) {
      t.is(stdout, expectedStdout)
    }
    if (expectedStderr !== undefined) {
      t.is(stderr, expectedStderr)
    }
  } catch (error) {
    if (expectedStderr !== undefined) {
      t.is((error as ExecaReturnValue).stderr.slice('run.js: '.length), expectedStderr)
      if (expectedStdout !== undefined) {
        t.is((error as ExecaReturnValue).stdout, expectedStdout)
      }
    } else {
      throw error
    }
  }
}

const arkCliTest = test.macro(async (
  t: ExecutionContext,
  file: string,
  args?: string[],
  expectedStdout?: string,
  expectedStderr?: string,
  useRepl?: boolean,
) => {
  await doCliTest(
    t,
    'json',
    file,
    `${file}.result.json`,
    args,
    expectedStdout,
    expectedStderr,
    useRepl,
  )
})

function diffsetDiffsOnly(diffSet: Difference[]): Difference[] {
  return diffSet.filter((diff) => diff.state !== 'equal')
}

async function doDirTest(
  t: ExecutionContext,
  dir: string,
  callback: (t: ExecutionContext, tmpDirPath: string) => void | Promise<void>,
) {
  const tmpDir = tmp.dirSync({unsafeCleanup: true})
  t.teardown(() => tmpDir.removeCallback())
  await callback(t, tmpDir.name)
  const compareResult = compareSync(tmpDir.name, dir, {
    compareContent: true,
    excludeFilter: '.gitkeep',
  })
  t.assert(
    compareResult.same,
    util.inspect(diffsetDiffsOnly(compareResult.diffSet as Difference[])),
  )
}

export const dirTest = test.macro(async (
  t: ExecutionContext,
  dir: string,
  callback: (t: ExecutionContext, tmpDirPath: string) => void | Promise<void>,
) => {
  await doDirTest(t, dir, callback)
})

function makeReformattedSource(t: ExecutionContext, sourceFile: string) {
  let source = fs.readFileSync(sourceFile, {encoding: 'utf-8'})
  if (source.startsWith('#!')) {
    source = source.substring(source.indexOf('\n'))
  }
  const reformattedSource = format(source)
  const tempSourceFile = tmp.fileSync({postfix: '.ursa'})
  t.teardown(() => tempSourceFile.removeCallback())
  fs.writeFileSync(tempSourceFile.name, reformattedSource)
  const tempSourcePath = path.parse(tempSourceFile.name)
  const tempSourceName = path.join(tempSourcePath.dir, tempSourcePath.name)
  return tempSourceName
}

const reformattingCliTest = test.macro(async (
  t: ExecutionContext,
  inputBasename: string,
  extraArgs?: string[],
  expectedStdout?: string,
  expectedStderr?: string,
  useRepl?: boolean,
  expectedReformattedStderr?: string,
  syntaxErrorExpected?: boolean,
) => {
  const resultFile = `${inputBasename}.result.json`
  await doCliTest(
    t,
    'ursa',
    inputBasename,
    resultFile,
    extraArgs,
    expectedStdout,
    expectedStderr,
    useRepl,
  )
  if (!syntaxErrorExpected && !useRepl) {
    await doCliTest(
      t,
      'ursa',
      makeReformattedSource(t, `${inputBasename}.ursa`),
      resultFile,
      extraArgs,
      expectedStdout,
      expectedReformattedStderr ?? expectedStderr,
      useRepl,
    )
  }
})

const reformattingCliDirTest = test.macro(async (
  t: ExecutionContext,
  inputBasename: string,
  expectedDirPath: string,
  extraArgs?: string[],
  expectedStdout?: string,
  expectedStderr?: string,
  useRepl?: boolean,
  expectedReformattedStderr?: string,
  syntaxErrorExpected?: boolean,
) => {
  const resultFile = `${inputBasename}.result.json`
  await doDirTest(
    t,
    expectedDirPath,
    async (t, tmpDirPath) => (
      doCliTest(
        t,
        'ursa',
        inputBasename,
        resultFile,
        [tmpDirPath, ...extraArgs ?? []],
        expectedStdout,
        expectedStderr,
        useRepl,
      )
    ),
  )
  if (!syntaxErrorExpected && !useRepl) {
    await doDirTest(
      t,
      expectedDirPath,
      async (t, tmpDirPath) => (
        doCliTest(
          t,
          'ursa',
          makeReformattedSource(t, `${inputBasename}.ursa`),
          resultFile,
          [tmpDirPath, ...extraArgs ?? []],
          expectedStdout,
          expectedReformattedStderr ?? expectedStderr,
          useRepl,
        )
      ),
    )
  }
})

function mkTester<Args extends unknown[]>(macro: Macro<Args, unknown>) {
  return (title: string, ...args: Args) => {
    test(title, macro, ...args)
  }
}

export const arkTest = mkTester(arkCliTest)
export const ursaTest = mkTester(reformattingCliTest)
export const ursaDirTest = mkTester(reformattingCliDirTest)
