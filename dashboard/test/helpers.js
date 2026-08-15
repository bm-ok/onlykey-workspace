'use strict'

// The two things more than one test needs, and neither of them is an assertion.
//
// OUTSIDE `suites/` ON PURPOSE. Everything in that tree is loaded as a test —
// a folder is a suite, a file in it is a test — so a file of helpers living
// there would be registered as a test of its own and reported as a suite with
// nothing in it. One directory up, nothing walks it, and the tests require it
// by name.

// A name nothing else will be using. Not random — these have to be findable and
// removable afterwards by somebody reading the repository, and a uuid in a branch
// list tells them nothing about where it came from.
//
// `drillSweep` in actions/tests.js is what removes them when a run was killed
// before its cleanup, and it looks for exactly this prefix.
const scratch = what => `drill/${what}-${new Date().toISOString().replace(/[^0-9]/g, '').slice(8, 14)}`

// The line everything is cut from. Read rather than named, because which lines
// exist is a fact about the workspace and not something a drill decides.
async function aLine (okc, assert) {
  const { groups } = await okc('lines')
  const line = (groups || []).find(g => !g.broken.length)
  assert.needs(line, 'no line is whole here — a cut has to start from one')
  return line.name
}

module.exports = { scratch, aLine }
