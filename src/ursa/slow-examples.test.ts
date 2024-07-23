// Slow Ursa tests using example source files.
// © Reuben Thomas 2024
// Released under the GPL version 3, or (at your option) any later version.

import {ursaTest} from '../testutil.js'

[
  ['Hailstone sequence', 'rosettacode/Hailstone sequence'],
].map(([title, file]) => ursaTest(title, file))
