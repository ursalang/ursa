// Ursa front-end

import path from 'path'
import fs from 'fs'
import * as readline from 'node:readline'
import {ArgumentParser, RawDescriptionHelpFormatter} from 'argparse'
import programVersion from '../version.js'
// eslint-disable-next-line import/no-named-as-default
import {toVal} from './parser.js'
import {EnvironmentVal, toJson} from '../ark/interp.js'
import {toVal as lispToVal} from '../ark/parser.js'

// Read and process arguments
const parser = new ArgumentParser({
  description: 'The Ursa language.',
  formatter_class: RawDescriptionHelpFormatter,
})
const inputGroup = parser.add_mutually_exclusive_group()

inputGroup.add_argument('module', {metavar: 'FILE', help: 'Ursa module to run', nargs: '?'})
parser.add_argument('argument', {metavar: 'ARGUMENT', help: 'arguments to the Ursa module', nargs: '*'})
inputGroup.add_argument('--eval', '-e', {metavar: 'EXPRESSION', help: 'execute the given expression'})

parser.add_argument('--sexp', {action: 'store_true', help: 'use sexp syntax'})
parser.add_argument('--compile', '-c', {action: 'store_true', help: 'compile input to JSON file'})
parser.add_argument('--output', '-o', {metavar: 'FILE', help: 'filename of compiled JSON [default: INPUT-FILE.json]'})
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
  sexp: boolean
  compile: boolean
  output: string | undefined
  interactive: boolean
  // FIXME: add as an Ursa global.
  // To do this, need a persistent Ark state.
  argument: string[]
}
const args: Args = parser.parse_args() as Args

function compile(exp: string) {
  return (args.sexp ? lispToVal : toVal)(exp)
}

function evaluate(exp: string) {
  return compile(exp).eval(new EnvironmentVal([]))
}

async function repl() {
  console.log(`Welcome to Ursa ${programVersion}.`)
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> ',
  })
  rl.prompt()
  for await (const line of rl) {
    try {
      const val = evaluate(line)._value()
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
}

// Any otherwise uncaught exception is reported as an error.
try {
  // Read input
  let source: string | undefined
  if (args.eval !== undefined) {
    source = args.eval
  } else if (args.module !== undefined) {
    source = fs.readFileSync(args.module, {encoding: 'utf-8'})
  }
  if (args.compile) {
    if (source === undefined) {
      throw new Error('--compile given, but nothing to compile!')
    }
    let jsonFile = args.output
    if (jsonFile === undefined) {
      if (args.module === undefined) {
        throw new Error('--compile given with no input or output filename')
      }
      const parsedFilename = path.parse(args.module)
      jsonFile = path.join(parsedFilename.dir, `${parsedFilename.name}.json`)
    }
    fs.writeFileSync(jsonFile, toJson(compile(source)))
  } else {
    // Run the program
    if (source !== undefined) {
      evaluate(source)
    }
    if (source === undefined || args.interactive) {
      repl()
    }
  }
} catch (error) {
  if (process.env.DEBUG) {
    console.error(error)
  } else {
    console.error(`${path.basename(process.argv[1])}: ${error}`)
  }
  process.exitCode = 1
}
