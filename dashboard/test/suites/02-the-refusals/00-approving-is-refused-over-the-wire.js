'use strict'

// approving is refused over the wire
//
// A test is a series: the checks below run in the order they are written.
// See test/suites/index.js for what the folder, the file and the checks each
// mean, and tasks/harness.js for state, cleanup and what a failed check does
// to the ones after it.

const { it } = require('../../../tasks/harness')

// The rule: a model may WRITE a job, a prompt or a contract, and may not
// ratify its own. It is the one place in this app where who is asking decides
// the answer, so it is the one most worth a test.
it('a job cannot be approved down the pipe', async ({ actions, assert, log }) => {
  const { jobs } = await actions.jobs.run({})
  assert.needs(jobs.length, 'there are no jobs to try approving')
  const refusal = await assert.refuses(
    () => actions.jobApprove.run({ id: jobs[0].id, _overTheWire: true }),
    'window|person|may not approve',
    'a job was approved from the command line')
  log(`tried on "${jobs[0].id}" — refused, and this is what it said:\n${refusal.message}`)
})

it('a prompt cannot be approved down the pipe', async ({ actions, assert, log }) => {
  const { prompts } = await actions.prompts.run({})
  assert.needs(prompts.length, 'there are no prompts to try approving')
  const refusal = await assert.refuses(
    () => actions.promptApprove.run({ id: prompts[0].id, _overTheWire: true }),
    'window|person|may not approve',
    'a prompt was approved from the command line')
  log(`tried on "${prompts[0].id}" — refused, and this is what it said:\n${refusal.message}`)
})

it('a contract cannot be approved down the pipe', async ({ actions, assert, log }) => {
  const { contracts } = await actions.contracts.run({})
  assert.needs(contracts.length, 'there are no contracts to try approving')
  const refusal = await assert.refuses(
    () => actions.contractApprove.run({ id: contracts[0].id, _overTheWire: true }),
    'window|person|may not approve',
    'a contract was approved from the command line')
  log(`tried on "${contracts[0].id}" — refused, and this is what it said:\n${refusal.message}`)
})

// WHAT IT SAW — 16 August 2026, 14:17, three passed
//
//   a job cannot be approved down the pipe
//     tried on "api-tour" — refused, and this is what it said:
//     Approving is done in the window, by a person who has read the script. A
//     model may write one and may not approve its own.
//
//   a prompt cannot be approved down the pipe
//     tried on "take-stock" — refused, and this is what it said:
//     Approving is done in the window, by a person who has read it. A model may
//     write a prompt and may not approve its own.
//
//   a contract cannot be approved down the pipe
//     tried on "delivery-rules" — refused, and this is what it said:
//     Approving is done in the window, by a person who has read it. A model may
//     write a contract and may not approve its own.
//
// THREE SENTENCES THAT ARE ALMOST THE SAME, and the difference is the whole
// reason to read them side by side: the job one says "who has read the SCRIPT",
// because a job is code that will run on a machine, and the other two say "who
// has read it". If those three ever collapse into one shared string, this
// transcript is where somebody will notice what was lost.
