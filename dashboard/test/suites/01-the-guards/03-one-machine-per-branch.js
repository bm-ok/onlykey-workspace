'use strict'

// guards — one machine per branch, and it stays there
//
// A test is a series: the checks below run in the order they are written.
// See test/suites/index.js for what the folder, the file and the checks each
// mean, and tasks/harness.js for state, cleanup and what a failed check does
// to the ones after it.

const { it } = require('../../../tasks/harness')
const { scratch } = require('../../helpers')

// WHAT IT SAW LAST TIME is recorded at the bottom of this file. Both checks here
// need a machine that is WORKING, so the transcript is from a run made while the
// round trip was in flight — which is the only time this file can say anything.

it('a machine is not moved off the branch it is on', async ({ okc, assert, log }) => {
  const { vms } = await okc('vmList')
  const on = vms.find(v => v.connected && v.branch)
  assert.needs(on, 'no connected machine is on a branch — one is only on a branch while it is working')
  const refusal = await assert.refuses(
    () => okc('vmWorkspace', { name: on.name, branch: scratch('elsewhere') }),
    'stays there until it is clean',
    'Switching is how half-finished work stops being anywhere')
  log(`asked of ${on.name}, which is on "${on.branch}" — refused, and this is what it said:\n${refusal.message}`)
})

it('a branch already claimed is not handed to a second machine', async ({ okc, assert, log }) => {
  const { vms } = await okc('vmList')
  const claimed = vms.find(v => v.branch)

  // The second machine must be on NO branch of its own, and that is the whole
  // subtlety here rather than a detail.
  //
  // Two rules can refuse this, and only one of them is the rule under test. A
  // machine that is already on a branch is refused for being on it — "stays
  // there until it is clean" — and that refusal fires first, before the claim
  // is ever consulted. The drill passed on a bare "did it throw", and what it
  // proved was a different rule than the one it names.
  //
  // Not arranged, unlike the credential drill. Releasing a claim means rolling
  // a machine back to a snapshot from before the branch, which DISCARDS
  // whatever is on it — a drill may not decide that somebody's work is worth
  // less than a green tick.
  const free = vms.find(v => v.connected && !v.branch && v.name !== (claimed || {}).name)
  assert.needs(claimed, 'no machine claims a branch — a machine is rolled back when its work ends')
  assert.needs(free, 'no second machine is connected and free of a branch. This will not make one: the only way off a branch is a rollback, and that discards whatever is on it')

  const refusal = await assert.refuses(
    () => okc('vmWorkspace', { name: free.name, branch: claimed.branch }),
    'already being worked on',
    'Two machines on one branch race for the same ref and the loser\'s commits strand')
  log(`${claimed.name} claims "${claimed.branch}"; offering it to ${free.name} was refused, and this is what it said:\n${refusal.message}`)
})

// WHAT IT SAW — 16 August 2026, 14:16, neither could be tried
//
//   a machine is not moved off the branch it is on
//     could not be tried: no connected machine is on a branch — one is only on a
//     branch while it is working
//
//   a branch already claimed is not handed to a second machine
//     could not be tried: no machine claims a branch — a machine is rolled back
//     when its work ends
//
// EXPECTED AT REST, like 02-a-machine-is-not-asked-to-lose-work beside it, and
// for the same reason. Both refusals ARE proven — by
// 03-the-machines/01-a-machine-comes-up-and-goes-away, which borrows two
// machines, brings them both up and asks. Its transcript is where the wording of
// these two refusals is on the record.
