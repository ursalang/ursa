// Ursa command-line front-end and REPL.
// © Reuben Thomas 2023
// Released under the GPL version 3, or (at your option) any later version.

import assert from 'assert'
import path from 'path'
import os from 'os'
import fs, {PathOrFileDescriptor} from 'fs'
import * as readline from 'node:readline'

import {ArgumentParser, RawDescriptionHelpFormatter} from 'argparse'

import {
  debug, ArkState, ArkUndefined, ArkNull, ArkList,
  ArkLet, ArkVal, ArkValRef, ArkString, globals,
} from '../ark/interpreter.js'
import {
  Environment, CompiledArk, PartialCompiledArk, compile as arkCompile,
} from '../ark/compiler.js'
import {toJs} from '../ark/ffi.js'
import {serializeVal} from '../ark/serialize.js'

import programVersion from '../version.js'
import {runWithTraceback, compile as ursaCompile} from './compiler.js'
import {format} from './fmt.js'

if (process.env.DEBUG) {
  Error.stackTraceLimit = Infinity
}

// Read and process arguments
const parser = new ArgumentParser({
  description: 'The Ursa language.',
  formatter_class: RawDescriptionHelpFormatter,
  epilog: `\`-' given as a file name means standard input or output.
Command line history is read from and saved to ~/.ursarc`,
})
const inputGroup = parser.add_mutually_exclusive_group()

inputGroup.add_argument('module', {metavar: 'FILE', help: 'Ursa program to run', nargs: '?'})
parser.add_argument('argument', {metavar: 'ARGUMENT', help: 'arguments to the Ursa program', nargs: '*'})
inputGroup.add_argument('--eval', '-e', {metavar: 'EXPRESSION', help: 'execute the given expression'})

parser.add_argument('--syntax', {
  default: 'ursa', choices: ['ursa', 'json'], help: 'syntax to use [default: ursa]',
})
const actionGroup = parser.add_mutually_exclusive_group()
actionGroup.add_argument('--compile', '-c', {action: 'store_true', help: 'compile input to JSON file'})
actionGroup.add_argument('--format', {action: 'store_true', help: 'format input source'})
parser.add_argument('--output', '-o', {metavar: 'FILE', help: 'JSON output file [default: standard output]'})
parser.add_argument('--interactive', '-i', {action: 'store_true', help: 'enter interactive mode after running given code'})

parser.add_argument('--version', {
  action: 'version',
  version: `%(prog)s ${programVersion}
© 2023 Reuben Thomas <rrt@sc3d.org>
https://github.com/ursalang/ursa
Distributed under the GNU General Public License version 3, or (at
your option) any later version. There is no warranty.`,
})

interface Args {
  module: string
  eval: string
  syntax: string
  compile: boolean
  format: boolean
  output: string | undefined
  interactive: boolean
  argument: string[]
}
const args: Args = parser.parse_args() as Args

function compile(
  exp: string,
  env: Environment = new Environment(),
  startRule?: string,
): CompiledArk {
  let compiled: CompiledArk
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

async function repl(): Promise<ArkVal> {
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
      let compiled = compile(line, env)
      // Filter out already-declared bindings
      for (const id of env.stack[0][0]) {
        compiled.freeVars.delete(id!)
      }
      // Handle new let bindings
      if (compiled instanceof PartialCompiledArk && compiled.value instanceof ArkLet) {
        env = env.push(compiled.value.boundVars)
        ark.stack.push(Array<ArkValRef>(compiled.value.boundVars.length).fill(
          new ArkValRef(ArkUndefined),
        ))
        compiled = new PartialCompiledArk(
          compiled.value.body,
          compiled.freeVars,
          compiled.value.boundVars,
        )
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

// Get output filename, if any
let outputFile: PathOrFileDescriptor | undefined = args.output
if (outputFile === '-' || ((args.compile || args.format) && outputFile === undefined)) {
  outputFile = process.stdout.fd
}

// Program name for argv[0]
let prog: string

// Use standard input if requested
let inputFile: PathOrFileDescriptor = args.module
if (args.module === '-') {
  inputFile = process.stdin.fd
  prog = '(stdin)'
} else {
  prog = inputFile
}

async function main() {
  // Any otherwise uncaught exception is reported as an error.
  try {
    // Read input
    let source: string | undefined
    let output
    if (args.eval !== undefined) {
      prog = '(eval)'
      source = args.eval
    } else if (inputFile !== undefined) {
      source = fs.readFileSync(inputFile, {encoding: 'utf-8'})
      if (source.startsWith('#!')) {
        source = source.substring(source.indexOf('\n'))
      }
    }
    const ark = new ArkState()
    if (args.compile || args.format) {
      if (source === undefined) {
        throw new Error('--compile given, but nothing to compile')
      }
      if (outputFile === undefined) {
        throw new Error('--compile given with no input or output filename')
      }
    }
    if (args.compile) {
      output = serializeVal(compile(source!).value)
    } else if (args.format) {
      output = format(source!)
    } else {
      // Add command-line arguments.
      globals.set('argv', new ArkValRef(new ArkList(
        [ArkString(prog ?? process.argv[0]), ...args.argument.map((s) => ArkString(s))],
      )))
      // Run the program
      let result: ArkVal | undefined
      if (source !== undefined) {
        result = await runWithTraceback(ark, compile(source))
      }
      if (source === undefined || args.interactive) {
        result = await repl()
      }
      output = serializeVal(result ?? ArkNull()) ?? 'null'
    }
    if (outputFile !== undefined) {
      assert(outputFile)
      fs.writeFileSync(outputFile, output)
    }
  } catch (error) {
    if (process.env.DEBUG) {
      console.error(error)
    } else {
      console.error(`${path.basename(process.argv[1])}: ${error}`)
    }
    process.exitCode = 1
  }
}

await main()
