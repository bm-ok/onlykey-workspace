'use strict'

// a machine is not asked to do the impossible
//
// A test is a series: the checks below run in the order they are written.
// See test/suites/index.js for what the folder, the file and the checks each
// mean, and tasks/harness.js for state, cleanup and what a failed check does
// to the ones after it.

const { it } = require('../../../tasks/harness')

it('a machine that is not dialled in cannot be given a workspace', async ({ actions, assert }) => {
  const { vms } = await actions.vmList.run({})
  const off = vms.find(v => !v.connected)
  assert.needs(off, 'every machine is dialled in, so there is nothing to refuse')
  // The branch has to be real, or the refusal above fires first and this
  // proves nothing about being dialled in.
  const { branches } = await actions.gitBranches.run({})
  const real = (branches || []).find(b => (b.name || b) && !(b.missing || []).length)
  assert.needs(real, 'there is no branch that exists everywhere')
  await assert.refuses(
    () => actions.vmWorkspace.run({ name: off.name, branch: real.name || real }),
    'not dialled in|start it',
    'a workspace was set up on a machine nothing can reach')
})

it('a branch nobody has is not a branch to sync', async ({ actions, assert }) => {
  const { repos } = await actions.repositories.run({})
  assert.needs(repos.length, 'there are no repositories')
  await assert.refuses(
    () => actions.repoSyncBranch.run({ repo: repos[0].repo, branch: 'no/such-branch-okc-test' }),
    'has no branch',
    'a branch that is not there was fast-forwarded')
})
