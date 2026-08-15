'use strict'

// guards — a verdict is about something
//
// A test is a series: the checks below run in the order they are written, and
// what one arranges the next one uses. See test/suites/index.js for what the
// folder, the file and the checks each mean.

const { it, cleanup } = require('../../../tasks/harness')
const { scratch, aLine } = require('../../helpers')

it('an empty cut, and a task delivering on it', async ({ okc, assert, state }) => {
  // The one test here that writes anything, and it undoes it in cleanup. It has
  // to: the refusal under test is about a task whose branch is empty, and there
  // is no way to have one without making one.
  //
  // The cut is made first because that is the order now — a task cannot name a
  // branch nobody has cut, and this drill used to rely on being able to.
  const line = await aLine(okc, assert)
  state.branch = scratch('empty')
  await okc('branchCreate', { branch: state.branch, reason: 'a drill needing a branch with nothing on it', group: line })
  state.task = await okc('taskCreate', { task: { title: 'nothing delivered', brief: 'anything', branch: state.branch } })
})

it('a verdict on a branch with nothing on it is refused', async ({ okc, assert, state }) => {
  await assert.refuses(
    () => okc('taskJudge', { id: state.task.id, verdict: 'accept', note: 'should not be possible' }),
    'nothing to judge',
    'A judgement of nothing is indistinguishable afterwards from a judgement of something')
})

it('a rejection with no reason is refused', async ({ okc, assert }) => {
  // Asked of a DELIVERED task rather than the one above, because the
  // empty-branch refusal would otherwise be the thing that fires and this would
  // pass for the wrong reason. Two rules can refuse the same call and only one
  // of them is being tested.
  const { tasks } = await okc('tasks')
  const delivered = tasks.find(t => t.delivered)
  assert.needs(delivered, 'no task has anything on its branch — run the round trip first')
  await assert.refuses(
    () => okc('taskJudge', { id: delivered.id, verdict: 'reject', note: '' }),
    'why',
    'A rejection with no reason is sent to a worker that cannot ask what was wrong')
})

cleanup(async ({ okc, state }) => {
  if (state.task) await okc('taskRemove', { id: state.task.id }).catch(() => {})
  if (state.branch) await okc('branchDelete', { branch: state.branch, force: true }).catch(() => {})
})
