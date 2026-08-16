'use strict'

// guards — a verdict is about something
//
// A test is a series: the checks below run in the order they are written, and
// what one arranges the next one uses. See test/suites/index.js for what the
// folder, the file and the checks each mean.

const { it, cleanup } = require('../../../tasks/harness')
const { scratch, aLine } = require('../../helpers')

// WHAT IT SAW LAST TIME is recorded at the bottom of this file.

it('an empty cut, and a task delivering on it', async ({ okc, assert, state, log }) => {
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
  log(`cut "${state.branch}" with nothing on it, and wrote #${state.task.number} to deliver there`)
})

it('a verdict on a branch with nothing on it is refused', async ({ okc, assert, state, log }) => {
  const refusal = await assert.refuses(
    () => okc('taskJudge', { id: state.task.id, verdict: 'accept', note: 'should not be possible' }),
    'nothing to judge',
    'A judgement of nothing is indistinguishable afterwards from a judgement of something')
  log(`refused, and this is what it said:\n${refusal.message}`)
})

it('a rejection with no reason is refused', async ({ okc, assert, state, log }) => {
  // Asked of a DELIVERED task rather than the empty one above, because the
  // empty-branch refusal would otherwise be the thing that fires and this would
  // pass for the wrong reason. Two rules can refuse the same call and only one
  // of them is being tested.
  //
  // IT MAKES ITS OWN DELIVERY NOW. It used to go looking for a task that had
  // already delivered something — `assert.needs(delivered, 'run the round trip
  // first')` — and on a tidy host there is never one, so this check had never
  // run in its life. A drill that only works when the world happens to suit it
  // is a drill that never works.
  //
  // A commit put straight on the branch is enough, and is honest about what it
  // is: the rule under test is about the VERDICT, not about who did the work, so
  // sending a machine off for ten minutes to produce a commit would be paying
  // for realism the check cannot use. `drillCommit` refuses to write anywhere
  // but a drill branch, which is what makes doing it safe.
  await okc('drillCommit', {
    branch: state.branch,
    repo: (await okc('repositories')).repos[0].repo,
    file: 'drill-delivered.md',
    text: 'Put here by a drill, so a task has something on its branch to be judged.\n',
    message: 'drill: something to judge'
  })

  const { tasks } = await okc('tasks')
  const mine = tasks.find(t => t.id === state.task.id)
  assert.ok(mine, 'the task written above is gone')

  const refusal = await assert.refuses(
    () => okc('taskJudge', { id: state.task.id, verdict: 'reject', note: '' }),
    'why',
    'A rejection with no reason is sent to a worker that cannot ask what was wrong')
  log(`#${mine.number} now has a commit on "${state.branch}", so the empty-branch rule is out of the way`)
  log(`refused, and this is what it said:\n${refusal.message}`)
})

cleanup(async ({ okc, state }) => {
  if (state.task) await okc('taskRemove', { id: state.task.id }).catch(() => {})
  if (state.branch) await okc('branchDelete', { branch: state.branch, force: true }).catch(() => {})
})

// WHAT IT SAW — 16 August 2026, 14:16, two passed and one could not be tried
//
//   an empty cut, and a task delivering on it
//     cut "drill/empty-141618" with nothing on it, and wrote #99 to deliver there
//
//   a verdict on a branch with nothing on it is refused
//     refused, and this is what it said:
//     Nothing has arrived on "drill/empty-141618", so there is nothing to judge.
//     A worker that finished without pushing has delivered nothing.
//
//   a rejection with no reason is refused
//     could not be tried: no task has anything on its branch — run the round
//     trip first
//
// THE SAME SENTENCE THE ROUND TRIP MEETS. 06-a-task-on-a-machine ends on this
// exact refusal, after a real machine has done real work and handed back a file
// — and the wording is identical, because to this app the two situations are the
// same situation: nothing on the branch. That is the rule being consistent
// rather than two rules that happen to agree, and reading the two transcripts
// together is the only place it shows.
//
// The third check needs a task that DID deliver, which a tidy host does not
// keep, so it says so rather than making one.
