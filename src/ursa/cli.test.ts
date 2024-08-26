// Ursa REPL tests.
// © Reuben Thomas 2023-2024
// Released under the GPL version 3, or (at your option) any later version.

import {ursaTest} from '../testutil.js'

ursaTest('REPL: Evaluate a number', undefined, [], 'test/repl-number')
ursaTest('REPL: Test let followed by reference', undefined, [], 'test/repl-let-val')
ursaTest('REPL: Test syntax error', undefined, [], 'test/repl-syntax-error', true)
ursaTest('REPL: Run a loop', undefined, [], 'test/repl-loop')
ursaTest('REPL: Compile a generator', undefined, [], 'test/repl-generator')
ursaTest('REPL: Test values compiled in a script', 'test/yield', [], 'test/script-then-interact')
