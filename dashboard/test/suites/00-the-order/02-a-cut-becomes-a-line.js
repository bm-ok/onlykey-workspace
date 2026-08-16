'use strict'

// the order — a cut becomes a line before anything leaves
//
// A test is a series: the checks below run in the order they are written, and
// what one arranges the next one uses. See test/suites/index.js for what the
// folder, the file and the checks each mean.

const { it, cleanup } = require('../../../tasks/harness')
const { scratch, aLine } = require('../../helpers')

// WHAT IT SAW LAST TIME is recorded at the bottom of this file. See
// 00-a-cut-comes-first.js for why the transcript is kept in the file at all.

it('a cut is made', async ({ okc, assert, state, log }) => {
  const line = await aLine(okc, assert)
  state.branch = scratch('promote')
  await okc('branchCreate', { branch: state.branch, reason: 'a drill proving promotion protects', group: line })
  log(`cut "${state.branch}" from line "${line}"`)
})

it('while it is a cut, it is not protected', async ({ okc, assert, state, log }) => {
  const before = (await okc('gitBranches')).branches.find(b => b.name === state.branch)
  assert.ok(before, 'The cut made in the step above is not there')
  assert.equal(!!before.protected, false, 'A fresh cut is not protected — work is done on it')
  log(`"${state.branch}" is protected: ${!!before.protected}`)
})

it('promoting it to a line protects it', async ({ okc, assert, state, log }) => {
  await okc('branchAsLine', { branch: state.branch })
  state.promoted = true
  const after = (await okc('gitBranches')).branches.find(b => b.name === state.branch)
  assert.ok(after.protected, 'Promoting a cut did not protect it, and a line is the same thing protected')
  log(`promoted, and now protected: ${!!after.protected} — the same branch, one flag apart`)
})

it('and a line is not deleted like an ordinary branch', async ({ okc, assert, state, log }) => {
  // THE REFUSAL THAT MAKES THE STEP ABOVE MEAN SOMETHING. "Protected" is a flag
  // until something is refused by it, and this project has twice had a guard
  // that read correctly and was open.
  //
  // The words the app actually uses. Matched rather than merely catching a
  // throw, because a refusal for the wrong reason is not a pass — and this very
  // assertion caught the author asserting the wrong reason: it expected
  // "protected" and the refusal says "is a link in", which is the more precise
  // statement of why.
  const refusal = await assert.refuses(
    () => okc('branchDelete', { branch: state.branch }),
    'is a link in|nothing is built directly',
    'A line was deleted as though it were an ordinary branch')
  log(`refused, and this is what it said:\n${refusal.message}`)
})

cleanup(async ({ okc, state }) => {
  if (state.promoted) await okc('lineForget', { name: state.branch }).catch(() => {})
  if (state.branch) await okc('branchDelete', { branch: state.branch, force: true }).catch(() => {})
})

// WHAT IT SAW — 16 August 2026, 14:08, four passed
//
//   a cut is made
//     cut "drill/promote-140834" from line "default"
//
//   while it is a cut, it is not protected
//     "drill/promote-140834" is protected: false
//
//   promoting it to a line protects it
//     promoted, and now protected: true — the same branch, one flag apart
//
//   and a line is not deleted like an ordinary branch
//     refused, and this is what it said:
//     "drill/promote-140834" is a link in "drill/promote-140834". Work goes onto
//     its own branch and is merged here afterwards, so nothing is built directly
//     on it.
//
// THE REFUSAL NAMES THE BRANCH TWICE, and that is worth leaving on the record
// rather than smoothing over. It reads oddly here because the drill promoted a
// branch into a line of its own, so the branch and the line it is a link in are
// the same name — an artificial arrangement no real workspace has. Somebody
// meeting that sentence with a real line would see two different names, which is
// what it was written for.
