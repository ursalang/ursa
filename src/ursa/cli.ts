// Ursa front-end

import path from 'path'
import fs, {PathOrFileDescriptor} from 'fs'
import * as readline from 'node:readline'
import {ArgumentParser, RawDescriptionHelpFormatter} from 'argparse'
import assert from 'assert'
import programVersion from '../version.js'
import {
  debug, List, ValRef, Str, globals, ArkState, Undefined,
} from '../ark/interp.js'
import {toJs} from '../ark/ffi.js'
import {serializeCompiledArk, serializeVal} from '../ark/serialize.js'
import {Environment, compile as arkCompile} from '../ark/compiler.js'
import {compile as ursaCompile} from './compiler.js'

if (process.env.DEBUG) {
  Error.stackTraceLimit = Infinity
}

// Read and process arguments
const parser = new ArgumentParser({
  description: 'The Ursa language.',
  formatter_class: RawDescriptionHelpFormatter,
  epilog: "`-' given as a file name means standard input or output.",
})
const inputGroup = parser.add_mutually_exclusive_group()

inputGroup.add_argument('module', {metavar: 'FILE', help: 'Ursa program to run', nargs: '?'})
parser.add_argument('argument', {metavar: 'ARGUMENT', help: 'arguments to the Ursa program', nargs: '*'})
inputGroup.add_argument('--eval', '-e', {metavar: 'EXPRESSION', help: 'execute the given expression'})

parser.add_argument('--syntax', {
  default: 'ursa', choices: ['ursa', 'json'], help: 'syntax to use [default: ursa]',
})
parser.add_argument('--compile', '-c', {action: 'store_true', help: 'compile input to JSON file'})
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
  output: string | undefined
  interactive: boolean
  argument: string[]
}
const args: Args = parser.parse_args() as Args

function compile(exp: string, env: Environment = new Environment(), startRule?: string) {
  const compiler = args.syntax === 'json' ? arkCompile : ursaCompile
  const compiled = compiler(exp, env, startRule)
  if (process.env.DEBUG) {
    console.log('Compiled Ark')
    debug(compiled, null)
  }
  return compiled
}

async function repl() {
  console.log(`Welcome to Ursa ${programVersion}.`)
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> ',
  })
  rl.prompt()
  const ark = new ArkState()
  let env = new Environment()
  let val
  for await (const line of rl) {
    try {
      const compiled = compile(line, env, 'Exp')
      // Filter out already-declared bindings
      for (const id of env.stack[0]) {
        compiled[1].delete(id)
      }
      // Handle new let bindings
      if (compiled[2] !== undefined && compiled[2].length > 0) {
        env = env.push(compiled[2])
        ark.stack = ark.stack.push(Array(compiled[2].length).fill(new ValRef(Undefined)))
      }
      val = toJs(ark.run(compiled))
      console.dir(val, {depth: null})
    } catch (error) {
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
let jsonFile: PathOrFileDescriptor | undefined = args.output
if ((jsonFile === '-' || args.compile) && (args.module !== undefined || args.eval !== undefined)) {
  jsonFile = process.stdout.fd
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
    let result
    let json
    if (args.eval !== undefined) {
      prog = '(eval)'
      source = args.eval
    } else if (inputFile !== undefined) {
      source = fs.readFileSync(inputFile, {encoding: 'utf-8'})
      if (source.startsWith('#!')) {
        source = source.substring(source.indexOf('\n'))
      }
    }
    if (args.compile) {
      if (source === undefined) {
        throw new Error('--compile given, but nothing to compile!')
      }
      if (jsonFile === undefined) {
        throw new Error('--compile given with no input or output filename')
      }
      result = compile(source)
      json = serializeCompiledArk(result)
    } else {
      // Add command-line arguments.
      globals.set('argv', new ValRef(new List(
        [Str(prog ?? process.argv[0]), ...args.argument.map((s) => Str(s))],
      )))
      // Run the program
      if (source !== undefined) {
        result = new ArkState().run(compile(source))
      }
      if (source === undefined || args.interactive) {
        result = await repl()
      }
      json = serializeVal(result) ?? 'null'
    }
    if (jsonFile !== undefined) {
      assert(jsonFile)
      fs.writeFileSync(jsonFile, json)
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

main()
