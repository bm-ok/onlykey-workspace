'use strict'

// a branch cannot be named into existence by accident
//
// A test is a series: the checks below run in the order they are written.
// See test/suites/index.js for what the folder, the file and the checks each
// mean, and tasks/harness.js for state, cleanup and what a failed check does
// to the ones after it.

const { it } = require('../../../tasks/harness')

// WHAT IT SAW LAST TIME is recorded at the bottom of this file.

it('setting a machine up on a branch that does not exist is refused', async ({ actions, assert, log }) => {
  const { vms } = await actions.vmList.run({})
  assert.needs(vms.length, 'there are no machines')
  // Refused on the NAME, before anything is started — which is the point of
  // the test. This used to be discovered after booting a machine and waiting
  // for it to dial in, so the answer to a typo was five minutes away.
  const refusal = await assert.refuses(
    () => actions.vmWorkspace.run({ name: vms[0].name, branch: 'no/such-branch-okc-test' }),
    'there is no branch',
    'a machine was set up on a branch nobody made')
  log(`asked of ${vms[0].name} — refused, and this is what it said:\n${refusal.message}`)
})

it('a cut must start from a line or a cut, and not both', async ({ actions, assert, log }) => {
  const refusal = await assert.refuses(
    () => actions.branchCreate.run({ branch: 'okc-test/never-made', reason: 'a test', group: 'default', from: 'inspection/check1' }),
    'both|one of',
    'a branch was cut from two starting points at once')
  log(`refused, and this is what it said:\n${refusal.message}`)
})

it('a cut must say what it is for', async ({ actions, assert, log }) => {
  const refusal = await assert.refuses(
    () => actions.branchCreate.run({ branch: 'okc-test/never-made', group: 'default' }),
    'reason',
    'a branch was cut with no reason recorded')
  log(`refused, and this is what it said:\n${refusal.message}`)
})

// WHAT IT SAW — 16 August 2026, 14:17, three passed
//
//   setting a machine up on a branch that does not exist is refused
//     asked of runner4 — refused, and this is what it said:
//     There is no branch called "no/such-branch-okc-test". Make it first, with a
//     reason — branchCreate --branch no/such-branch-okc-test --reason "..."
//     --group "..." — so what it is for and what it starts from are both
//     recorded before anything is built on it. If that name is a typo, this is
//     the refusal that catches it.
//
//   a cut must start from a line or a cut, and not both
//     refused, and this is what it said:
//     Say either which line "okc-test/never-made" is cut from or which branch,
//     not both — they are two different starting points and only one of them can
//     be true.
//
//   a cut must say what it is for
//     refused, and this is what it said:
//     Say what "okc-test/never-made" is for. A branch with no reason is one
//     nobody can account for later — which is how a workspace ends up with names
//     that cannot be told apart from mistakes.
//
// EACH ONE HANDS BACK THE NAME IT WAS GIVEN, which is the property that makes a
// typo cheap: the answer to "no/such-branch-okc-test" quotes the string, so a
// name that looks right in a script and wrong on screen is visible in the
// refusal itself rather than five minutes later on a machine.
