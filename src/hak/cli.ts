// Hak front-end

import path from 'path'
import fs from 'fs'
import {ArgumentParser, RawDescriptionHelpFormatter} from 'argparse'
import programVersion from '../version.js'
// eslint-disable-next-line import/no-named-as-default
import {toVal} from './hak.js'
import {EnvironmentVal} from '../haklisp/haklisp.js'

// Read and process arguments
const parser = new ArgumentParser({
  description: 'The Hak language.',
  formatter_class: RawDescriptionHelpFormatter,
})
const inputGroup = parser.add_mutually_exclusive_group()
inputGroup.add_argument('module', {metavar: 'FILE', help: 'Hak module to run', nargs: '?'})
parser.add_argument('argument', {metavar: 'ARGUMENT', help: 'arguments to the Hak module', nargs: '*'})
inputGroup.add_argument('--eval', '-e', {metavar: 'EXPRESSION', help: 'execute the given expression'})
parser.add_argument('--version', {
  action: 'version',
  version: `%(prog)s ${programVersion}
© 2023 Reuben Thomas <rrt@sc3d.org>
https://github.com/rrthomas/hak
Distributed under the GNU General Public License version 3, or (at
your option) any later version. There is no warranty.`,
})
interface Args {
  module: string
  eval: string
  argument: string[]
}
// FIXME: add as a Hak global
const args: Args = parser.parse_args() as Args

// Run the program
try {
  let source: string
  if (args.eval !== undefined) {
    source = args.eval
  } else {
    source = fs.readFileSync(args.module, {encoding: 'utf-8'})
  }
  toVal(source).eval(new EnvironmentVal([]))
} catch (error) {
  if (process.env.DEBUG) {
    console.error(error)
  } else {
    console.error(`${path.basename(process.argv[1])}: ${error}`)
  }
  process.exitCode = 1
}
