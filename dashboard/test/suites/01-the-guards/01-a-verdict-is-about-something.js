'use strict'

// guards — a verdict is about something
//
// A test is a series: the checks below run in the order they are written.
// See test/suites/index.js for what the folder, the file and the checks each
// mean, and tasks/harness.js for state, cleanup and what a failed check does
// to the ones after it.

const { it } = require('../../../tasks/harness')
const { scratch } = require('../../helpers')

it('a verdict on a branch with nothing on it is refused', async ({ okc, assert }) => {
  // The one drill here that writes anything, and it removes it again in a
  // `finally`. It has to: the refusal under test is about a task whose branch
  // is empty, and there is no way to have one without making one.
  const branch = scratch('empty')
  const task = await okc('taskCreate', { task: { title: 'nothing delivered', brief: 'anything', branch } })
  try {
    await assert.refuses(
      () => okc('taskJudge', { id: task.id, verdict: 'accept', note: 'should not be possible' }),
      'nothing to judge',
      'A judgement of nothing is indistinguishable afterwards from a judgement of something')
  } finally {
    await okc('taskRemove', { id: task.id })
  }
})

it('a rejection with no reason is refused', async ({ okc, assert }) => {
  // Checked on a delivered task if there is one, because the empty-branch
  // refusal above would otherwise be the thing that fires and this would pass
  // for the wrong reason.
  const { tasks } = await okc('tasks')
  const delivered = tasks.find(t => t.delivered)
  assert.needs(delivered, 'no task has anything on its branch — run the round trip first')
  await assert.refuses(
    () => okc('taskJudge', { id: delivered.id, verdict: 'reject', note: '' }),
    'why',
    'A rejection with no reason is sent to a worker that cannot ask what was wrong')
})
