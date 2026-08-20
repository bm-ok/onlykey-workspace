'use strict'

// a task carries what it was given, and cannot be rewritten
//
// A test is a series: the checks below run in the order they are written.
// See ./index.js for what the folder, the file and the checks each
// mean, and the harness for state, cleanup and what a failed check does
// to the ones after it.

const { it } = require('../../harness')

// WHAT IT SAW LAST TIME is recorded at the bottom of this file.

it('a task under a contract that is not approved is refused', async ({ actions, assert, log }) => {
  const { contracts } = await actions.contracts.run({})
  const unapproved = contracts.find(c => !c.approved)
  assert.needs(unapproved, 'every contract here is approved, so there is nothing to refuse')
  const refusal = await assert.refuses(
    () => actions.taskCreate.run({ task: { title: 'okc-test', brief: 'x', branch: 'inspection/check1', contractId: unapproved.id } }),
    'not approved|not ready|approve',
    'a task was written under rules nobody had approved')
  log(`tried under "${unapproved.name}", which nobody has approved — refused, and this is what it said:\n${refusal.message}`)
})

it('a task cannot name a job that does not exist', async ({ actions, assert, log }) => {
  const refusal = await assert.refuses(
    () => actions.taskCreate.run({ task: { title: 'okc-test', brief: 'x', branch: 'inspection/check1', job: 'no-such-job-okc-test' } }),
    'no job called',
    'a task was written naming a job that is not there')
  log(`refused, and this is what it said:\n${refusal.message}`)
})

it('what a task was asked cannot change once it is out', async ({ actions, assert, log }) => {
  const { tasks } = await actions.tasks.run({})
  const out = tasks.find(t => t.machine)
  assert.needs(out, 'no task has been given to a machine, so there is nothing to protect')
  const refusal = await assert.refuses(
    () => actions.taskUpdate.run({ id: out.id, task: { brief: 'something else entirely' } }),
    'already been given|cannot change',
    'the question a piece of work answers was rewritten after the fact')
  log(`tried on #${out.number}, which went to ${out.machine} — refused, and this is what it said:\n${refusal.message}`)
})

// WHAT IT SAW — 16 August 2026, 14:17, two passed and one could not be tried
//
//   a task under a contract that is not approved is refused
//     could not be tried: every contract here is approved, so there is nothing
//     to refuse
//
//   a task cannot name a job that does not exist
//     refused, and this is what it said:
//     There is no job called "no-such-job-okc-test". Ask for "jobs" to see what
//     there is.
//
//   what a task was asked cannot change once it is out
//     tried on #35, which went to runner2 — refused, and this is what it said:
//     "code-checking-time2" has already been given to runner2. What it was asked
//     and where it delivers cannot change now — that would rewrite the question
//     its work answers. Write a new task, or take the verdict on this one first.
//
// THE FIRST ONE IS RECORDED AS UNRUNNABLE ON PURPOSE. It needs a contract nobody
// has approved, and a tidy workspace has none — so it says what it needed rather
// than being quietly rewritten into something it can always do. A drill that
// always runs is not automatically a better drill.
//
// The last one names #35, which is a real task from months of other work and not
// something this drill made. It reaches for whatever has already been given out,
// because arranging one would mean sending real work to a real machine to prove
// a rule about text.
