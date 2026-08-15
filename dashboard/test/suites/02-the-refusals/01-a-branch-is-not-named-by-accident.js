'use strict'

// a branch cannot be named into existence by accident
//
// A test is a series: the checks below run in the order they are written.
// See test/suites/index.js for what the folder, the file and the checks each
// mean, and tasks/harness.js for state, cleanup and what a failed check does
// to the ones after it.

const { it } = require('../../../tasks/harness')

it('setting a machine up on a branch that does not exist is refused', async ({ actions, assert }) => {
  const { vms } = await actions.vmList.run({})
  assert.needs(vms.length, 'there are no machines')
  // Refused on the NAME, before anything is started — which is the point of
  // the test. This used to be discovered after booting a machine and waiting
  // for it to dial in, so the answer to a typo was five minutes away.
  await assert.refuses(
    () => actions.vmWorkspace.run({ name: vms[0].name, branch: 'no/such-branch-okc-test' }),
    'there is no branch',
    'a machine was set up on a branch nobody made')
})

it('a cut must start from a line or a cut, and not both', async ({ actions, assert }) => {
  await assert.refuses(
    () => actions.branchCreate.run({ branch: 'okc-test/never-made', reason: 'a test', group: 'default', from: 'inspection/check1' }),
    'both|one of',
    'a branch was cut from two starting points at once')
})

it('a cut must say what it is for', async ({ actions, assert }) => {
  await assert.refuses(
    () => actions.branchCreate.run({ branch: 'okc-test/never-made', group: 'default' }),
    'reason',
    'a branch was cut with no reason recorded')
})
