'use strict'

// the order — a cut becomes a line before anything leaves
//
// A test is a series: the checks below run in the order they are written.
// See test/suites/index.js for what the folder, the file and the checks each
// mean, and tasks/harness.js for state, cleanup and what a failed check does
// to the ones after it.

const { it } = require('../../../tasks/harness')
const { scratch, aLine } = require('../../helpers')

it('a cut is promoted, and is protected afterwards', async ({ okc, assert }) => {
  const line = await aLine(okc, assert)
  const branch = scratch('promote')
  let made = false
  try {
    await okc('branchCreate', { branch, reason: 'a drill proving promotion protects', group: line })
    const before = (await okc('gitBranches')).branches.find(b => b.name === branch)
    assert.equal(!!before.protected, false, 'A fresh cut is not protected — work is done on it')

    await okc('branchAsLine', { branch })
    made = true
    const after = (await okc('gitBranches')).branches.find(b => b.name === branch)
    assert.ok(after.protected, 'Promoting a cut did not protect it, and a line is the same thing protected')

    // AND THE REFUSAL THAT MAKES IT MEAN SOMETHING. A line is merged into and
    // never worked on, so a machine may not be set up on it for work.
    // The words the app actually uses. Matched rather than merely catching a
    // throw, because a refusal for the wrong reason is not a pass — and this
    // very assertion caught the author asserting the wrong reason: it expected
    // "protected" and the refusal says "is a link in", which is the more
    // precise statement of why.
    await assert.refuses(
      () => okc('branchDelete', { branch }),
      'is a link in|nothing is built directly',
      'A line was deleted as though it were an ordinary branch')
  } finally {
    if (made) await okc('lineForget', { name: branch }).catch(() => {})
    await okc('branchDelete', { branch, force: true }).catch(() => {})
  }
})
