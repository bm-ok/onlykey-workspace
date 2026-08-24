'use strict'

// a machine is not asked to do the impossible
//
// A test is a series: the checks below run in the order they are written.
// See ./index.js for what the folder, the file and the checks each
// mean, and the harness for state, cleanup and what a failed check does
// to the ones after it.

const { it } = require('../../harness')

// WHAT IT SAW LAST TIME is recorded at the bottom of this file.

it('a machine that is not dialled in cannot be given a workspace', async ({ okc, assert, log }) => {
  const { vms } = await okc('vmList', {})
  const off = vms.find(v => !v.connected)
  assert.needs(off, 'every machine is dialled in, so there is nothing to refuse')
  // The branch has to be real, or the refusal above fires first and this
  // proves nothing about being dialled in.
  const { branches } = await okc('gitBranches', {})
  const real = (branches || []).find(b => (b.name || b) && !(b.missing || []).length)
  assert.needs(real, 'there is no branch that exists everywhere')
  const refusal = await assert.refuses(
    () => okc('vmWorkspace', { name: off.name, branch: real.name || real }),
    'not dialled in|start it',
    'a workspace was set up on a machine nothing can reach')
  log(`asked of ${off.name}, which is off, on the real branch "${real.name || real}" — refused, and this is what it said:\n${refusal.message}`)
})

it('a branch nobody has is not a branch to sync', async ({ okc, assert, log }) => {
  const { repos } = await okc('repositories', {})
  assert.needs(repos.length, 'there are no repositories')
  const refusal = await assert.refuses(
    () => okc('repoSyncBranch', { repo: repos[0].repo, branch: 'no/such-branch-okc-test' }),
    'has no branch',
    'a branch that is not there was fast-forwarded')
  log(`asked of ${repos[0].repo} — refused, and this is what it said:\n${refusal.message}`)
})

// WHAT IT SAW — 16 August 2026, 14:17, both passed
//
//   a machine that is not dialled in cannot be given a workspace
//     asked of runner4, which is off, on the real branch "brads/testing2" —
//     refused, and this is what it said:
//     "runner4" is not dialled in. Start it and wait for it to connect.
//
//   a branch nobody has is not a branch to sync
//     asked of local-repo-a — refused, and this is what it said:
//     "local-repo-a" has no branch called "no/such-branch-okc-test".
//
// THE BRANCH IN THE FIRST ONE IS REAL, and the transcript is what shows it: it
// says "brads/testing2", a branch somebody actually cut, not a made-up name. If
// it were made up the machine would be refused for the NAME and this check would
// pass without ever reaching the rule it is about — which is the same trap the
// comment above it describes, and the transcript is where it would be visible.
