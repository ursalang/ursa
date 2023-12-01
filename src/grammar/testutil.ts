// Ursa grammar and parser test utilities.
// © Reuben Thomas 2023
// Released under the MIT license.

import fs from 'fs'
import test from 'ava'
import {toAST} from 'ohm-js/extras'

// eslint-disable-next-line import/extensions
import grammar from './ursa.ohm-bundle.js'

function stringifyAST(ast: any) {
  return JSON.stringify(ast, null, 2)
}

export function parse(
  expr: string,
  startRule?: string,
): {} {
  const matchResult = grammar.match(expr, startRule)
  if (matchResult.failed()) {
    throw new Error(matchResult.message)
  }
  // Lightweight mapping to eliminate elements for optional separators and
  // some redundant keywords.
  const ast = toAST(matchResult, {
    Sequence: 0,
    List: {1: 1},
    Object: {1: 1},
    Map: {1: 1},
    Arguments: {1: 1},
    If: {1: 1, 2: 2},
    Fn: {2: 2, 5: 5},
    Loop: {1: 1},
    Exp_break: {1: 1},
    Exp_return: {1: 1},
    // The following are to work around https://github.com/ohmjs/ohm/issues/463
    UnaryExp_not: {1: 1},
    UnaryExp_bitwise_not: {1: 1},
    UnaryExp_pos: {1: 1},
    UnaryExp_neg: {1: 1},
    Let: {1: 1, 3: 3},
    Use: {1: 1},
  })
  if (process.env.DEBUG) {
    console.log(stringifyAST(ast))
  }
  // FIXME: const freeVars = ast.freeVars(env)
  // FIXME: also check boundVars
  return ast
}

export function testGroup(
  title: string,
  tests: [string, any][],
) {
  test(title, (t) => {
    for (const [source, expected] of tests) {
      const parsed = parse(source)
      t.deepEqual(parsed, expected)
    }
  })
}

export async function fileTest(
  title: string,
  file: string,
  expected_stderr?: string,
) {
  test(title, async (t) => {
    try {
      const result = parse(fs.readFileSync(`${file}.ursa`, {encoding: 'utf-8'}))
      if (process.env.TEST_REGENERATE_EXPECTED) {
        fs.writeFileSync(`${file}.grammar-result.json`, JSON.stringify(result, null, 2))
        t.pass()
      } else {
        const expected = JSON.parse(fs.readFileSync(`${file}.grammar-result.json`, {encoding: 'utf-8'}))
        t.deepEqual(result, expected)
      }
    } catch (error) {
      if (expected_stderr !== undefined) {
        t.is((error as any).stderr.slice('run.js: '.length), expected_stderr)
      } else {
        throw error
      }
    }
  })
}
