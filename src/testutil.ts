// Ursa test utilities.
// © Reuben Thomas 2023-2024
// Released under the GPL version 3, or (at your option) any later version.

import assert from 'assert'
import util from 'util'
import fs from 'fs'
import path from 'path'
import tmp from 'tmp'
import test, {ExecutionContext, Macro} from 'ava'
import {ExecaError, Options as ExecaOptions, execa} from 'execa'
import {compareSync, Difference} from 'dir-compare'

import {
  debug, ArkState, ArkExp, ArkObject, toJs,
} from './ark/interpreter.js'
import {compile as doArkCompile} from './ark/reader.js'
import {valToJs} from './ark/serialize.js'
import {compile as ursaCompile} from './ursa/compiler.js'
import {format} from './ursa/fmt.js'
import {flatToJs, evalArkJs} from './ark/compiler/index.js'
import {expToInsts} from './ark/flatten.js'

const command = process.env.NODE_ENV === 'coverage' ? './bin/test-run.sh' : './bin/run.js'

const arkTargets = new Set(['ark', 'js'])

export function run(args: string[], options: ExecaOptions) {
  if (process.env.DEBUG) {
    console.log(`run ${command} ${args} ${options.inputFile}`)
  }
  return execa(command, args, options)
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
      const flat = expToInsts(compiled)
      const jsSource = flatToJs(flat)
      const resArk = await new ArkState(flat.insts[0]).run()
      const resJs = await evalArkJs(jsSource, title)
      if (resArk instanceof ArkObject) {
        assert(typeof expected === 'object')
        // Remove methods of ArkObject
        // FIXME: remove this once we have separated methods from properties.
        if (Object.keys(expected as object).length === 0) {
          t.deepEqual({}, expected)
        } else {
          t.like(toJs(resArk), expected as object)
          t.like(toJs(resJs), expected as object)
        }
      } else {
        t.deepEqual(toJs(resArk), expected)
        t.deepEqual(toJs(resJs), expected)
      }
    }
  })
}

export function testArkGroup(title: string, tests: [string, unknown][]) {
  return doTestGroup(title, arkCompile, tests)
}

export function testUrsaGroup(title: string, tests: [string, unknown][]) {
  return doTestGroup(title, ursaCompile, tests)
}

// The interpreter is able to underline the extent of an error location,
// whereas JavaScript source maps, used by the JavaScript compiler, lack
// extent; so, remove the underlines from expected and actual output, and
// assume that they came at the end of a line.
function deleteErrorExtent(msg: string) {
  return msg.replaceAll(/~+$/gm, '')
}

async function doCliTest(
  t: ExecutionContext,
  syntax: string,
  inputBasename: string,
  realSourceBasename?: string,
  extraArgs?: string[],
  expectedStdout?: string,
  expectedStderr?: string,
  useRepl?: boolean,
  target: string = 'ark',
) {
  const resultJsonFilename = `${inputBasename}.result.json`
  const actualSourceBasename = realSourceBasename ?? inputBasename
  const inputFile = `${actualSourceBasename}.${syntax}`
  const args = [`--syntax=${syntax}`, `--target=${target}`]
  let tempFile: tmp.FileResult
  if (!useRepl) {
    tempFile = tmp.fileSync()
    t.teardown(() => tempFile.removeCallback())
    args.push('run', `--output=${tempFile.name}`, inputFile)
  }
  try {
    const {stdout, stderr} = await run(
      [...args, ...extraArgs ?? []],
      {inputFile: useRepl ? inputFile : undefined},
    )
    if (!useRepl) {
      const result: unknown = JSON.parse(fs.readFileSync(tempFile!.name, {encoding: 'utf-8'}))
      const expected: unknown = fs.existsSync(resultJsonFilename)
        ? JSON.parse(fs.readFileSync(resultJsonFilename, {encoding: 'utf-8'}))
        : undefined
      if (expected !== undefined) {
        t.deepEqual(result, expected)
      }
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
      t.is(deleteErrorExtent(stderr!.toString()), deleteErrorExtent(expectedStderr))
    }
  } catch (error) {
    if (expectedStderr !== undefined) {
      t.is(
        deleteErrorExtent(((error as ExecaError).stderr as string).slice('run.js: '.length)),
        deleteErrorExtent(expectedStderr),
      )
      if (expectedStdout !== undefined) {
        t.is((error as ExecaError).stdout, expectedStdout)
      }
    } else {
      throw error
    }
  }
}

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
  for (const target of arkTargets) {
    await doCliTest(
      t,
      'ursa',
      inputBasename,
      undefined,
      extraArgs,
      expectedStdout,
      expectedStderr,
      useRepl,
      target,
    )
  }
  if (!syntaxErrorExpected && !useRepl) {
    await doCliTest(
      t,
      'ursa',
      inputBasename,
      makeReformattedSource(t, `${inputBasename}.ursa`),
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
  for (const target of arkTargets) {
    await doDirTest(
      t,
      expectedDirPath,
      async (t, tmpDirPath) => (
        doCliTest(
          t,
          'ursa',
          inputBasename,
          undefined,
          [tmpDirPath, ...extraArgs ?? []],
          expectedStdout,
          expectedStderr,
          useRepl,
          target,
        )
      ),
    )
  }
  if (!syntaxErrorExpected && !useRepl) {
    await doDirTest(
      t,
      expectedDirPath,
      async (t, tmpDirPath) => (
        doCliTest(
          t,
          'ursa',
          inputBasename,
          makeReformattedSource(t, `${inputBasename}.ursa`),
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

export const ursaTest = mkTester(reformattingCliTest)
export const ursaDirTest = mkTester(reformattingCliDirTest)
