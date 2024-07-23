// Ursa REPL tests.
// © Reuben Thomas 2023-2024
// Released under the GPL version 3, or (at your option) any later version.

import {ursaTest} from '../testutil.js'

ursaTest('Evaluate a number', 'test/repl-number', [], true)
ursaTest('Test let followed by reference', 'test/repl-let-val', [], true)
ursaTest('Test syntax error', 'test/repl-syntax-error', [], true, true)
