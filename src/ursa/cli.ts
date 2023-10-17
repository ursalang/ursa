// Ursa front-end

import path from 'path'
import fs, {PathOrFileDescriptor} from 'fs'
import * as readline from 'node:readline'
import {ArgumentParser, RawDescriptionHelpFormatter} from 'argparse'
import assert from 'assert'
import programVersion from '../version.js'
import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
  List, ValRef, Str, globals, ArkState, serialize, toJs,
} from '../ark/interp.js'
import {compile as arkCompile} from '../ark/compiler.js'
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

function compile(exp: string) {
  switch (args.syntax) {
    case 'json':
      return arkCompile(exp)
    default:
      return ursaCompile(exp)
  }
}

function evaluate(exp: string) {
  // Add command-line arguments.
  globals.set('argv', new ValRef(new List(
    args.argument.map((s) => Str(s)),
  )))
  const compiled = compile(exp)
  return new ArkState().run(compiled)
}

async function repl() {
  console.log(`Welcome to Ursa ${programVersion}.`)
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> ',
  })
  rl.prompt()
  let val
  for await (const line of rl) {
    try {
      val = toJs(evaluate(line))
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

// Use standard input if requested
let inputFile: PathOrFileDescriptor = args.module
if (args.module === '-') {
  inputFile = process.stdin.fd
}

async function main() {
  // Any otherwise uncaught exception is reported as an error.
  try {
    // Read input
    let source: string | undefined
    let result
    if (args.eval !== undefined) {
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
      // FIXME: Handle freevars in compiled output
      result = compile(source)[0]
    } else {
      // Run the program
      if (source !== undefined) {
        result = evaluate(source)
      }
      if (source === undefined || args.interactive) {
        result = await repl()
      }
    }
    if (jsonFile !== undefined) {
      const json = serialize(result) ?? 'null'
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
