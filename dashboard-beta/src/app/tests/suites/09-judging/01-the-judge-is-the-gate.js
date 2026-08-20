'use strict'

// the judge is the gate — nothing is worked on because somebody had an idea
//
// THE RULE THIS PROVES. A supervisor cannot see the codebase. It decides what to
// do next from what a judge hands back, and nothing else — so a task written
// over the wire without naming the judgement that established the work is real
// is work commissioned from a rumour, and it is refused.
//
// AND NOT AT THE WINDOW. A person writing a task has read the code, or has
// decided they do not need to, and either is their business. This is the same
// boundary as approving a job: refused down the pipe, ordinary at the window.
// Both halves are checked, because a gate that is also shut at the window is a
// gate somebody works around rather than through.
//
// THE OTHER END OF THE SAME RULE is `prCutMake`: work does not go out for
// landing without a current judgement that is not a rejection. "Current" is
// measured against the tips the judgement recorded — a judgement made before
// another push is a judgement of something else.

const { it, cleanup, requires } = require('../../harness')
const { scratch, aLine } = require('../../helpers')

requires('the order')

const mine = []

cleanup(async ({ okc, state }) => {
  for (const id of mine.splice(0)) {
    try { await okc('judgementRemove', { id }) } catch { /* already gone */ }
  }
  if (state.task) { try { await okc('taskRemove', { id: state.task.id }) } catch { /* never written */ } }
  if (state.branch) { try { await okc('branchDelete', { branch: state.branch, force: true }) } catch { /* never cut */ } }
})

it('a task written over the wire without a judgement is refused', async ({ okc, actions, assert, state }) => {
  const line = await aLine(okc, assert)
  state.branch = scratch('gated')
  await okc('branchCreate', { branch: state.branch, reason: 'a drill proving the judge is the gate', group: line })

  const { jobs } = await okc('jobs', { kind: 'task' })
  const job = (jobs || []).find(j => j.runnable)
  assert.needs(job, 'no runnable working job to write a task under')
  state.job = job.id

  // `_overTheWire` is what `call()` sets for anything that is not the window.
  // The drills go through the same door a supervisor does, which is the only
  // way this check means anything: asked as the window, it is allowed.
  await assert.refuses(
    () => actions.taskCreate.run({
      task: { title: 'drill: a task with nothing behind it', brief: 'Written by a drill. It should not be written at all.', branch: state.branch, job: job.id },
      _overTheWire: true
    }),
    'judgement|becauseOf|rumour',
    'a task was written over the wire with no judgement behind it'
  )
}, { gate: true })

it('and naming a judgement that has not finished is not enough', async ({ okc, actions, assert, state }) => {
  assert.needs(state.branch, 'the first check did not cut a branch')

  const { jobs } = await okc('jobs', { kind: 'judge' })
  const judge = (jobs || []).find(j => j.runnable)
  assert.needs(judge, 'no judge is runnable here')

  const asked = await okc('judgementCreate', {
    kind: 'branch',
    branch: state.branch,
    job: judge.id,
    question: 'Written by a drill. Nothing runs it — being unfinished is the point.'
  })
  mine.push(asked.id)
  state.ref = asked.ref

  // A JUDGEMENT THAT HAS NOT READ ANYTHING HAS ESTABLISHED NOTHING. Without
  // this the gate would be satisfied by asking for a judgement and immediately
  // writing the task — which is the rumour again, with a reference number.
  await assert.refuses(
    () => actions.taskCreate.run({
      task: { title: 'drill: a task behind an unfinished judgement', brief: 'Written by a drill.', branch: state.branch, job: state.job },
      becauseOf: asked.ref,
      _overTheWire: true
    }),
    'has not finished|not finished reading|established nothing',
    `a task was written behind ${asked.ref}, which has not read anything yet`
  )
})

it('and a judgement that does not exist is not a way round it', async ({ okc, actions, assert, state }) => {
  assert.needs(state.branch, 'the first check did not cut a branch')

  await assert.refuses(
    () => actions.taskCreate.run({
      task: { title: 'drill: a task behind a judgement that is not there', brief: 'Written by a drill.', branch: state.branch, job: state.job },
      becauseOf: 'J99999',
      _overTheWire: true
    }),
    'no judgement|there is no',
    'a task was written behind a judgement that does not exist'
  )
})

it('and the same task, written at the window, is allowed', async ({ okc, actions, assert, state, log }) => {
  assert.needs(state.branch, 'the first check did not cut a branch')

  // THE HALF THAT IS EASY TO FORGET. If the gate were shut at the window too,
  // a person could not write a task about code they have just read — and the
  // first thing anybody would do is find the way round, which is how a rule
  // stops describing what happens.
  state.task = await actions.taskCreate.run({
    task: {
      title: 'drill: a task written at the window',
      brief: 'Written by a drill, as the window rather than over the wire. Nothing runs it.',
      branch: state.branch,
      job: state.job
    }
  })
  assert.ok(state.task.number > 0, 'a task written at the window was not given a number')
  assert.ok(!state.task.becauseOf, 'a task written at the window recorded a judgement it was not given')
  log(`#${state.task.number} was written at the window with no judgement behind it, which is allowed`)
})
