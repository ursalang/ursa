// Ursa test utilities.
// © Reuben Thomas 2023-2025
// Released under the GPL version 3, or (at your option) any later version.

import assert from 'assert'
import util from 'util'
import fs from 'fs'
import path from 'path'
import tmp from 'tmp'
import test, {ExecutionContext, Macro} from 'ava'
import {ExecaError, Options as ExecaOptions, execa} from 'execa'
import {compareSync, Difference} from 'dir-compare'

import {debug} from './ark/util.js'
import {flatToJs, evalArkJs} from './ark/compiler/index.js'
import {expToInsts} from './ark/flatten.js'
import {ArkObject, toJs} from './ark/data.js'
import {ArkExp} from './ark/code.js'
import {ArkState} from './ark/interpreter.js'
import {compile as doArkCompile} from './ark/reader.js'
import {valToJs} from './ark/serialize.js'
import {type ArkType} from './ark/type.js'
import {typeEquals} from './ark/type-check.js'
import {compile as ursaCompile} from './ursa/compiler.js'
import {format} from './ursa/fmt.js'
import version from './version.js'

export const ursaCommand = process.env.NODE_ENV === 'coverage' ? './bin/test-run.sh' : './bin/run.js'

const arkTargets = new Set(['ark', 'js'])

export function run(args: string[], options: ExecaOptions) {
  if (process.env.DEBUG) {
    console.log(`run ${ursaCommand} ${args} ${options.inputFile}`)
  }
  return execa(ursaCommand, args, options)
}

function arkCompile(source: string) {
  return doArkCompile(JSON.parse(source))
}

function doTestGroup(
  title: string,
  compile: (expr: string) => ArkExp,
  tests: [string, unknown, ArkType][],
) {
  test(title, async (t) => {
    for (const [source, expected, expectedType] of tests) {
      const compiled = compile(source)
      assert(typeEquals(compiled.type, expectedType, undefined))
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
        // FIXME: remove this once we have separated methods from members.
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

export function testArkGroup(title: string, tests: [string, unknown, ArkType][]) {
  return doTestGroup(title, arkCompile, tests)
}

export function testUrsaGroup(title: string, tests: [string, unknown, ArkType][]) {
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
  inputBasename?: string,
  realSourceBasename?: string,
  extraArgs?: string[],
  replInputBasename?: string,
  target: string = 'ark',
) {
  const actualSourceBasename = replInputBasename ?? realSourceBasename ?? inputBasename
  const resultJsonFilename = `${actualSourceBasename}.result.json`
  const stdoutFilename = `${actualSourceBasename}.stdout`
  let expectedStdout
  if (fs.existsSync(stdoutFilename)) {
    expectedStdout = fs.readFileSync(stdoutFilename, {encoding: 'utf-8'})
  }
  const stderrFilename = `${actualSourceBasename}.stderr`
  let expectedStderr
  if (fs.existsSync(stderrFilename)) {
    expectedStderr = fs.readFileSync(stderrFilename, {encoding: 'utf-8'})
  }
  const inputFile = `${realSourceBasename ?? inputBasename}.${syntax}`
  const args = [`--syntax=${syntax}`, `--target=${target}`]
  let tempFile: tmp.FileResult
  if (inputBasename !== undefined) {
    tempFile = tmp.fileSync()
    t.teardown(() => tempFile.removeCallback())
    args.push('run', `--output=${tempFile.name}`, inputFile)
  }
  try {
    if (inputBasename !== undefined && replInputBasename !== undefined) {
      args.push('--interactive')
    }
    const {stdout, stderr} = await run(
      [...args, ...extraArgs ?? []],
      {inputFile: replInputBasename !== undefined ? `${replInputBasename}.${syntax}` : undefined},
    )
    let processedStdout = stdout
    if (replInputBasename !== undefined) {
      processedStdout = (processedStdout as string)?.replace(`Welcome to Ursa ${version}.\n`, '')
    } else {
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
      t.is(processedStdout, expectedStdout)
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
      let processedStdout = (error as ExecaError).stdout
      if (replInputBasename !== undefined) {
        processedStdout = (processedStdout as string).replace(`Welcome to Ursa ${version}.\n`, '')
      }
      if (expectedStdout !== undefined) {
        t.is(processedStdout, expectedStdout)
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

async function makeReformattedSource(
  t: ExecutionContext,
  inputBasename: string,
  replInputBasename?: string,
) {
  const sourceFile = `${inputBasename}.ursa`
  let source = fs.readFileSync(sourceFile, {encoding: 'utf-8'})
  if (source.startsWith('#!')) {
    source = source.substring(source.indexOf('\n'))
  }
  let reformattedSource: string
  if (process.env.NODE_ENV === 'coverage') {
    const {stdout} = await run(['fmt', sourceFile], {stripFinalNewline: false})
    reformattedSource = stdout as string
  } else {
    reformattedSource = format(source)
  }
  const tempDir = tmp.dirSync({unsafeCleanup: true})
  t.teardown(tempDir.removeCallback)
  // Copy optional related files into temporary directory.
  const extraFiles = [`${inputBasename}.result.json`, `${inputBasename}.stdout`]
  if (replInputBasename !== undefined) {
    extraFiles.push(replInputBasename)
  }
  for (const extraFile of extraFiles) {
    if (fs.existsSync(extraFile)) {
      fs.copyFileSync(extraFile, path.join(tempDir.name, path.parse(extraFile).base))
    }
  }
  const stderrFile = `${inputBasename}.stderr`
  const reformattedStderrFile = `${inputBasename}.reformatted-stderr`
  if (fs.existsSync(reformattedStderrFile)) {
    fs.copyFileSync(
      reformattedStderrFile,
      path.join(tempDir.name, `${path.parse(reformattedStderrFile).name}.stderr`),
    )
  } else if (fs.existsSync(stderrFile)) {
    fs.copyFileSync(
      stderrFile,
      path.join(tempDir.name, `${path.parse(stderrFile).name}.stderr`),
    )
  }
  const tempSourceFile = path.join(tempDir.name, path.basename(sourceFile))
  fs.writeFileSync(tempSourceFile, reformattedSource)
  const tempSourcePath = path.parse(tempSourceFile)
  const tempSourceName = path.join(tempSourcePath.dir, tempSourcePath.name)
  return tempSourceName
}

const reformattingCliTest = test.macro(async (
  t: ExecutionContext,
  inputBasename?: string,
  extraArgs?: string[],
  replInputBasename?: string,
  syntaxErrorExpected?: boolean,
) => {
  for (const target of arkTargets) {
    await doCliTest(
      t,
      'ursa',
      inputBasename,
      undefined,
      extraArgs,
      replInputBasename,
      target,
    )
  }
  if (!syntaxErrorExpected && inputBasename !== undefined) {
    await doCliTest(
      t,
      'ursa',
      inputBasename,
      await makeReformattedSource(t, inputBasename),
      extraArgs,
      replInputBasename,
    )
  }
})

const reformattingCliDirTest = test.macro(async (
  t: ExecutionContext,
  inputBasename: string | undefined,
  expectedDirPath: string,
  extraArgs?: string[],
  replInputBasename?: string,
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
          replInputBasename,
          target,
        )
      ),
    )
  }
  if (!syntaxErrorExpected && inputBasename !== undefined) {
    await doDirTest(
      t,
      expectedDirPath,
      async (t, tmpDirPath) => (
        doCliTest(
          t,
          'ursa',
          inputBasename,
          await makeReformattedSource(t, inputBasename),
          [tmpDirPath, ...extraArgs ?? []],
          replInputBasename,
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
