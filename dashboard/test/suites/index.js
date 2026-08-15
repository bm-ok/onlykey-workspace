'use strict'

// Every suite there is, loaded once.
//
// Registration is a SIDE EFFECT OF REQUIRING a file: each suite below calls
// describe/it as it loads, and the harness keeps them. So this module exists to
// require them in a fixed order and to be required exactly once — `suites` in
// the harness is a module-level array, and loading a file twice would register
// every test in it twice.
//
// Found rather than listed. A suite added to this directory is a suite that
// runs, with nothing to remember and nothing to keep in step — which is the
// same rule the actions table follows and for the same reason.

const fs = require('node:fs')
const path = require('node:path')

let loaded = false

function load () {
  if (loaded) return
  loaded = true
  const here = __dirname
  const files = fs.readdirSync(here)
    .filter(f => f.endsWith('.js') && f !== 'index.js')
    // Alphabetical, so the order a run reports in is the same every time. The
    // harness keeps registration order, and a directory listing is not a
    // promise about anything.
    .sort()
  for (const f of files) require(path.join(here, f))
}

// REQUIRE THE HARNESS BY A RELATIVE PATH — `require('../../tasks/harness')` —
// and never by an absolute one.
//
// `suites` in the harness is a module-level array, and Node keys its module
// cache on the RESOLVED path. An absolute require that differs in any way the
// resolver does not normalise — on Windows, a drive letter in the other case is
// enough — loads a SECOND copy of the harness with its own empty array. The
// suite then registers into a registry nothing reads: no error, no warning, and
// the file simply does not appear.
//
// Found by writing a probe suite that way. It ran, it registered, and
// `suiteRun --suite probe` answered "0 passed, 0 failed" about a suite sitting
// in the directory.

module.exports = { load }
