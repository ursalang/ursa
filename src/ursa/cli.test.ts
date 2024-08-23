// Ursa REPL tests.
// © Reuben Thomas 2023-2024
// Released under the GPL version 3, or (at your option) any later version.

import {ursaTest} from '../testutil.js'

ursaTest('REPL: Evaluate a number', 'test/repl-number', [], true)
ursaTest('REPL: Test let followed by reference', 'test/repl-let-val', [], true)
ursaTest('REPL: Test syntax error', 'test/repl-syntax-error', [], true, true)
ursaTest('REPL: Run a loop', 'test/repl-loop', [], true)
