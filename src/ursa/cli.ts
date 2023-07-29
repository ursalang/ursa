// Ursa front-end

import path from 'path'
import fs from 'fs'
import * as readline from 'node:readline'
import {ArgumentParser, RawDescriptionHelpFormatter} from 'argparse'
import programVersion from '../version.js'
// eslint-disable-next-line import/no-named-as-default
import {toVal} from './ursa.js'
import {EnvironmentVal, toVal as lispToVal} from '../hak/hak.js'

// Read and process arguments
const parser = new ArgumentParser({
  description: 'The Ursa language.',
  formatter_class: RawDescriptionHelpFormatter,
})
const inputGroup = parser.add_mutually_exclusive_group()

inputGroup.add_argument('module', {metavar: 'FILE', help: 'Ursa module to run', nargs: '?'})
parser.add_argument('argument', {metavar: 'ARGUMENT', help: 'arguments to the Ursa module', nargs: '*'})
inputGroup.add_argument('--eval', '-e', {metavar: 'EXPRESSION', help: 'execute the given expression'})

parser.add_argument('--sexp', {action: 'store_true', help: 'Use sexp syntax'})

parser.add_argument('--version', {
  action: 'version',
  version: `%(prog)s ${programVersion}
© 2023 Reuben Thomas <rrt@sc3d.org>
https://github.com/rrthomas/ursa
Distributed under the GNU General Public License version 3, or (at
your option) any later version. There is no warranty.`,
})

interface Args {
  sexp: boolean
  module: string
  eval: string
  argument: string[]
}
// FIXME: add as a Ursa global
const args: Args = parser.parse_args() as Args

function evaluate(exp: string) {
  return (args.sexp ? lispToVal : toVal)(exp).eval(new EnvironmentVal([]))
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
      const val = evaluate(line).value()
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

// Run the program
try {
  let source: string | undefined
  if (args.eval !== undefined) {
    source = args.eval
  } else if (args.module !== undefined) {
    source = fs.readFileSync(args.module, {encoding: 'utf-8'})
  }
  if (source !== undefined) {
    evaluate(source)
  } else {
    repl()
  }
} catch (error) {
  if (process.env.DEBUG) {
    console.error(error)
  } else {
    console.error(`${path.basename(process.argv[1])}: ${error}`)
  }
  process.exitCode = 1
}
