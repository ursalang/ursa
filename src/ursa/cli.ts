// Ursa command-line front-end and REPL.
// © Reuben Thomas 2023-2024
// Released under the GPL version 3, or (at your option) any later version.

import path from 'path'
import os from 'os'
import fs, {PathOrFileDescriptor} from 'fs'
import * as readline from 'node:readline'

import {ArgumentParser, RawDescriptionHelpFormatter} from 'argparse'

import programVersion from '../version.js'
import {
  debug, ArkState, ArkExp, ArkNull, ArkList,
  ArkLet, ArkVal, ArkString, globals, pushLets,
} from '../ark/interpreter.js'
import {Environment, compile as arkCompile} from '../ark/compiler.js'
import {fromJs, toJs} from '../ark/ffi.js'
import {serializeVal} from '../ark/serialize.js'
import {runWithTraceback, compile as ursaCompile} from './compiler.js'
import {compile as jsCompile} from './js-compiler.js'
import {format} from './fmt.js'

if (process.env.DEBUG) {
  Error.stackTraceLimit = Infinity
}

// Read and process arguments
const parser = new ArgumentParser({
  description: 'The Ursa language.',
  formatter_class: RawDescriptionHelpFormatter,
  epilog: `\`-' given as a file name means standard input or output.

If just one non-option argument is given, Ursa treats it as
a FILE to be \`run'.

Command line history is read from and saved to ~/.ursarc`,
})
parser.add_argument('--version', {
  action: 'version',
  version: `%(prog)s ${programVersion}
© 2023-2024 Reuben Thomas <rrt@sc3d.org>
https://github.com/ursalang/ursa
Distributed under the GNU General Public License version 3, or (at
your option) any later version. There is no warranty.`,
})
parser.add_argument('--syntax', {
  default: 'ursa', choices: ['ursa', 'json'], help: 'syntax to use [default: ursa]',
})
parser.add_argument('--target', {
  default: 'ark', choices: ['ark', 'js'], help: 'compile target to use [default: ark]',
})

const subparsers = parser.add_subparsers({description: 'action to take'})

function addExecArgs(parser: ArgumentParser) {
  parser.add_argument('argument', {metavar: 'ARGUMENT', help: 'arguments to the Ursa program', nargs: '*'})
  parser.add_argument('--output', '-o', {metavar: 'FILE', help: 'JSON output file [default: standard output]'})
  parser.add_argument('--interactive', '-i', {action: 'store_true', help: 'enter interactive mode after running given code'})
}

const runParser = subparsers.add_parser('run', {aliases: ['r'], description: 'Run Ursa program'})
runParser.set_defaults({func: runCommand})
runParser.add_argument('source', {metavar: 'FILE', help: 'Ursa program to run'})
addExecArgs(runParser)

const evalParser = subparsers.add_parser('eval', {aliases: ['e'], description: 'Evaluate Ursa expression'})
evalParser.set_defaults({func: evalCommand})
evalParser.add_argument('source', {metavar: 'CODE', help: 'Ursa code to evaluate'})
addExecArgs(evalParser)

const interactParser = subparsers.add_parser('interact', {aliases: ['i', 'repl', 'interactive'], description: 'Run in interactive mode'})
interactParser.set_defaults({func: interactCommand})

const compileParser = subparsers.add_parser('compile', {aliases: ['c'], description: 'Compile source code to JSON'})
compileParser.set_defaults({func: compileCommand})
compileParser.add_argument('source', {metavar: 'FILE', help: 'Ursa program to compile'})
compileParser.add_argument('--output', '-o', {metavar: 'FILE', help: 'JSON output file [default: standard output]'})

const fmtParser = subparsers.add_parser('fmt', {aliases: ['f', 'format'], description: 'Format source code'})
fmtParser.set_defaults({func: fmtCommand})
fmtParser.add_argument('source', {metavar: 'FILE', help: 'source code to format'})
fmtParser.add_argument('--output', '-o', {metavar: 'FILE', help: 'output file [default: standard output]'})
fmtParser.add_argument('--width', {metavar: 'COLUMNS', help: 'maximum desired width of formatted code'})
fmtParser.add_argument('--indent', {metavar: 'STRING', help: 'indent string'})
fmtParser.add_argument('--onelineFactor', {metavar: 'NUMBER', help: 'factor governing when expressions are wrapped (bigger means try to fit more complex expressions on one line)'})

interface Args {
  // Global arguments
  syntax: string
  func: (args: Args) => Promise<void>

  // Run/compile/eval arguments
  source: string
  argument: string[]
  output: string | undefined
  interactive: boolean
  target: string

  // Format arguments
  width: number
  indent: string
  onelineFactor: number
}

// Utility routines.

// Get output filename, if any
type OutputFileResult<T extends boolean> =
  T extends true ? PathOrFileDescriptor : (PathOrFileDescriptor | undefined)
function getOutputFile<T extends boolean>(args: Args, useStdoutIfUndefined: T): OutputFileResult<T>
function getOutputFile(
  args: Args,
  useStdoutIfUndefined: boolean,
): OutputFileResult<typeof useStdoutIfUndefined> {
  let outputFile: PathOrFileDescriptor | undefined = args.output
  if (outputFile === '-' || (useStdoutIfUndefined && outputFile === undefined)) {
    outputFile = process.stdout.fd
  }
  return outputFile
}

// Program name for argv[0]
let prog: string

// Use standard input if requested
function getInputFile(args: Args) {
  let inputFile: PathOrFileDescriptor = args.source
  if (args.source !== '-') {
    prog = inputFile
  } else {
    inputFile = process.stdin.fd
    prog = '(stdin)'
  }
  return inputFile
}

function readSourceFile(inputFile: PathOrFileDescriptor) {
  const source = fs.readFileSync(inputFile, {encoding: 'utf-8'})
  if (source.startsWith('#!')) {
    return source.substring(source.indexOf('\n'))
  }
  return source
}

function compile(
  args: Args,
  exp: string,
  env: Environment = new Environment(),
  startRule?: string,
): ArkExp {
  let compiled: ArkExp
  if (args.syntax === 'json') {
    compiled = arkCompile(JSON.parse(exp), env)
  } else {
    compiled = ursaCompile(exp, env, startRule)
  }
  if (process.env.DEBUG) {
    console.log('Compiled Ark')
    debug(compiled, null)
  }
  return compiled
}

async function repl(args: Args): Promise<ArkVal> {
  console.log(`Welcome to Ursa ${programVersion}.`)
  const historyFile = path.join(os.homedir(), '.ursarc')
  let history: string[] = []
  if (fs.existsSync(historyFile)) {
    history = fs.readFileSync(historyFile, {encoding: 'utf-8'}).split('\n').reverse()
  }
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> ',
    history,
    historySize: Infinity,
    removeHistoryDuplicates: true,
  })
  rl.on('history', (history: string[]) => {
    const reversedHistory: string[] = history.toReversed()
    fs.writeFileSync(historyFile, `${reversedHistory.join('\n')}\n`)
  })
  rl.prompt()
  const ark = new ArkState()
  let env = new Environment()
  let val: ArkVal = ArkNull()
  for await (const line of rl) {
    try {
      const compiled = compile(args, line, env)
      // Handle new let bindings
      if (compiled instanceof ArkLet) {
        env = env.push(compiled.boundVars.map((bv) => bv[0]))
        await pushLets(ark, compiled.boundVars)
      }
      val = await runWithTraceback(ark, compiled)
      debug(toJs(val))
    } catch (error) {
      if (process.env.DEBUG) {
        throw error
      }
      if (error instanceof Error) {
        console.error(error.message)
      } else {
        console.error(error)
      }
    }
    rl.prompt()
  }
  return val
}

// Sub-command action routines.

async function runCode(source: string, args: Args) {
  const outputFile = getOutputFile(args, false)
  // Any otherwise uncaught exception is reported as an error.
  const ark = new ArkState()
  // Add command-line arguments.
  globals.set('argv', new ArkList(
    [ArkString(prog ?? process.argv[1]), ...args.argument.map((s) => ArkString(s))],
  ))
  // Run the program
  let result: ArkVal | undefined
  if (source !== undefined) {
    if (args.target === 'ark') {
      const exp = compile(args, source)
      if (args.syntax === 'ursa') {
        result = await runWithTraceback(ark, exp)
      } else {
        result = await ark.run(exp)
      }
    } else {
      // eslint-disable-next-line no-eval
      result = fromJs(eval(jsCompile(source)))
    }
  }
  if (source === undefined || args.interactive) {
    result = await repl(args)
  }
  const output = serializeVal(result ?? ArkNull()) ?? 'null'
  if (outputFile !== undefined) {
    fs.writeFileSync(outputFile, output)
  }
}

async function evalCommand(args: Args) {
  prog = '(eval)'
  await runCode(args.source, args)
}

async function runCommand(args: Args) {
  const inputFile = getInputFile(args)
  await runCode(readSourceFile(inputFile), args)
}

async function interactCommand(args: Args) {
  await repl(args)
}

function compileCommand(args: Args) {
  const outputFile = getOutputFile(args, true)
  // Any otherwise uncaught exception is reported as an error.
  // Read input
  const inputFile = getInputFile(args)
  const source = readSourceFile(inputFile)
  const output = args.target === 'ark' ? serializeVal(compile(args, source)) : jsCompile(source)
  fs.writeFileSync(outputFile, output)
  return Promise.resolve()
}

function fmtCommand(args: Args) {
  const outputFile = getOutputFile(args, true)
  const inputFile = getInputFile(args)
  const source = readSourceFile(inputFile)
  const output = format(source, args.width, args.indent, args.onelineFactor)
  fs.writeFileSync(outputFile, output)
  return Promise.resolve()
}

// Execute given commands and options.
if (process.argv.length === 3) {
  // If we have only one argument and it's not a command or option, assume it's a file to run.
  const filename = process.argv[2]
  // The next line accesses a private field of subparsers to get the command names.
  // eslint-disable-next-line max-len
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
  if (!filename.startsWith('-') && !new Set(Object.keys((subparsers as any).choices)).has(filename)) {
    process.argv.splice(2, 0, 'run')
  }
}

// Any otherwise uncaught exception is reported as an error.
try {
  const args = parser.parse_args() as Args
  if (args.func) {
    await args.func(args)
  } else {
    // If we have no sub-command, enter REPL.
    await repl(args)
  }
} catch (error) {
  if (process.env.DEBUG) {
    console.error(error)
  } else {
    console.error(`${path.basename(process.argv[1])}: ${error}`)
  }
  process.exitCode = 1
}
