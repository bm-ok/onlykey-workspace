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
