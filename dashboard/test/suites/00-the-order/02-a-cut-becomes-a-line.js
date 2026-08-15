'use strict'

// the order — a cut becomes a line before anything leaves
//
// A test is a series: the checks below run in the order they are written, and
// what one arranges the next one uses. See test/suites/index.js for what the
// folder, the file and the checks each mean.

const { it, cleanup } = require('../../../tasks/harness')
const { scratch, aLine } = require('../../helpers')

it('a cut is made', async ({ okc, assert, state }) => {
  const line = await aLine(okc, assert)
  state.branch = scratch('promote')
  await okc('branchCreate', { branch: state.branch, reason: 'a drill proving promotion protects', group: line })
})

it('while it is a cut, it is not protected', async ({ okc, assert, state }) => {
  const before = (await okc('gitBranches')).branches.find(b => b.name === state.branch)
  assert.ok(before, 'The cut made in the step above is not there')
  assert.equal(!!before.protected, false, 'A fresh cut is not protected — work is done on it')
})

it('promoting it to a line protects it', async ({ okc, assert, state }) => {
  await okc('branchAsLine', { branch: state.branch })
  state.promoted = true
  const after = (await okc('gitBranches')).branches.find(b => b.name === state.branch)
  assert.ok(after.protected, 'Promoting a cut did not protect it, and a line is the same thing protected')
})

it('and a line is not deleted like an ordinary branch', async ({ okc, assert, state }) => {
  // THE REFUSAL THAT MAKES THE STEP ABOVE MEAN SOMETHING. "Protected" is a flag
  // until something is refused by it, and this project has twice had a guard
  // that read correctly and was open.
  //
  // The words the app actually uses. Matched rather than merely catching a
  // throw, because a refusal for the wrong reason is not a pass — and this very
  // assertion caught the author asserting the wrong reason: it expected
  // "protected" and the refusal says "is a link in", which is the more precise
  // statement of why.
  await assert.refuses(
    () => okc('branchDelete', { branch: state.branch }),
    'is a link in|nothing is built directly',
    'A line was deleted as though it were an ordinary branch')
})

cleanup(async ({ okc, state }) => {
  if (state.promoted) await okc('lineForget', { name: state.branch }).catch(() => {})
  if (state.branch) await okc('branchDelete', { branch: state.branch, force: true }).catch(() => {})
})
