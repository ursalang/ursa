/* eslint-disable no-useless-concat */
// Ursa REPL tests.
// © Reuben Thomas 2023
// Released under the MIT license.

import version from '../version.js'

import {ursaTest} from '../testutil.js'

ursaTest('Evaluate a number', 'test/repl-number', [], `\
Welcome to Ursa ${version}.
> 4
> `, undefined, true)

ursaTest('Test let followed by reference', 'test/repl-let-val', [], `\
Welcome to Ursa ${version}.
> 1
> 3
> `, undefined, true)

ursaTest(
  'Test syntax error',
  'test/repl-syntax-error',
  [],
  `\
Welcome to Ursa ${version}.
> > `,
  `Line 1, col 4:
> 1 | 4 +
         ^
Expected "(", "{", "[", "_", a letter, a digit, ".", "r####\\"", "r###\\"", "r##\\"", "r#\\"", "r\\"", "\\"", "true", "false", "null", "fn", "-", "+", "~", or "not"`,
  true,
)
