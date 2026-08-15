'use strict'

// a task carries what it was given, and cannot be rewritten
//
// A test is a series: the checks below run in the order they are written.
// See test/suites/index.js for what the folder, the file and the checks each
// mean, and tasks/harness.js for state, cleanup and what a failed check does
// to the ones after it.

const { it } = require('../../../tasks/harness')

it('a task under a contract that is not approved is refused', async ({ actions, assert }) => {
  const { contracts } = await actions.contracts.run({})
  const unapproved = contracts.find(c => !c.approved)
  assert.needs(unapproved, 'every contract here is approved, so there is nothing to refuse')
  await assert.refuses(
    () => actions.taskCreate.run({ task: { title: 'okc-test', brief: 'x', branch: 'inspection/check1', contractId: unapproved.id } }),
    'not approved|not ready|approve',
    'a task was written under rules nobody had approved')
})

it('a task cannot name a job that does not exist', async ({ actions, assert }) => {
  await assert.refuses(
    () => actions.taskCreate.run({ task: { title: 'okc-test', brief: 'x', branch: 'inspection/check1', job: 'no-such-job-okc-test' } }),
    'no job called',
    'a task was written naming a job that is not there')
})

it('what a task was asked cannot change once it is out', async ({ actions, assert }) => {
  const { tasks } = await actions.tasks.run({})
  const out = tasks.find(t => t.machine)
  assert.needs(out, 'no task has been given to a machine, so there is nothing to protect')
  await assert.refuses(
    () => actions.taskUpdate.run({ id: out.id, task: { brief: 'something else entirely' } }),
    'already been given|cannot change',
    'the question a piece of work answers was rewritten after the fact')
})
