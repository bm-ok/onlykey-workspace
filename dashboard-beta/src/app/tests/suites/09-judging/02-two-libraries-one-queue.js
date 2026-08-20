'use strict'

// two libraries, one queue — kept apart where it matters, together where it does
//
// A judging job and a working job are the same kind of thing and must not be the
// same job. `kind` is `task` or `judge`, and the refusal runs in BOTH directions:
//
//   a working job run as a judge   reads a change under rules written for
//                                  changing it — rules that permit exactly what
//                                  a judge is there to notice
//   a judge given to a task        sends a machine to READ, on a branch it was
//                                  told to deliver on
//
// The first direction is checked in 00, where a judgement is made. This is the
// second, and the queue they share.
//
// ONE QUEUE, AND ONE PRIORITY RULE. Both kinds wait in one line and judgements
// go first, because a judgement reads work that is already waiting on it —
// anything behind it is waiting twice. That rule lives in `order()` in
// tasks/queue.js and nowhere else, which is what lets the Queue tab, the
// reporters and the tick agree about what is next.

const { it, cleanup, requires } = require('../../harness')
const { scratch, aLine } = require('../../helpers')

// A TAG NO MACHINE CARRIES, and it is not a detail — it is the difference
// between proving the queue's ORDER and ambushing a machine with a drill's work.
//
// This was written with the test pool's tag, and the queue did exactly what it
// is built to do: it ticked, took the task, brought a machine up and dispatched
// it. The drill then failed trying to take it back out — "#147 is given, not
// queued" — which is the queue reporting that it had won a race the drill should
// never have entered.
//
// A tag nothing carries makes the queue WAIT, visibly and by design, so both
// things are genuinely queued and neither is dispatched. Proving "it can queue"
// does not require proving "a machine can be ambushed". The same trick is used
// by the supervisor drill for the same reason.
const NO_MACHINE = 'okc-no-machine-carries-this'

requires('the order')

const mine = []

cleanup(async ({ okc, state }) => {
  for (const id of mine.splice(0)) {
    try { await okc('judgementUnqueue', { id }) } catch { /* not queued */ }
    try { await okc('judgementRemove', { id }) } catch { /* already gone */ }
  }
  if (state.task) {
    try { await okc('taskUnqueue', { id: state.task.id }) } catch { /* not queued */ }
    try { await okc('taskRemove', { id: state.task.id }) } catch { /* never written */ }
  }
  if (state.branch) { try { await okc('branchDelete', { branch: state.branch, force: true }) } catch { /* never cut */ } }
})

it('a judge cannot be given to a task', async ({ okc, assert, state }) => {
  const { jobs } = await okc('jobs', { kind: 'judge' })
  const judge = (jobs || []).find(j => j.runnable)
  assert.needs(judge, 'no judge is runnable here')

  const line = await aLine(okc, assert)
  state.branch = scratch('libraries')
  await okc('branchCreate', { branch: state.branch, reason: 'a drill proving the two libraries are kept apart', group: line })

  await assert.refuses(
    () => okc('taskCreate', {
      task: { title: 'drill: a task given a judge', brief: 'Written by a drill. It should not be written.', branch: state.branch, job: judge.id }
    }),
    'is a judge|reads a change|work library',
    'a judging job was accepted as the job of a task'
  )
}, { gate: true })

it('and both kinds wait in one line, with judgements in front', async ({ okc, assert, state, log }) => {
  assert.needs(state.branch, 'the first check did not cut a branch')

  const { jobs } = await okc('jobs', { kind: 'task' })
  const working = (jobs || []).find(j => j.runnable)
  assert.needs(working, 'no runnable working job to queue')

  // A task first, so the judgement is the LATER of the two. Without that this
  // would pass on a queue that simply keeps its order — which is the reading
  // that has to be ruled out for the check to mean anything.
  state.task = await okc('taskCreate', {
    task: {
      title: 'drill: something waiting behind a judgement',
      brief: 'Written by a drill, tagged for a machine that does not exist so nothing picks it up.',
      branch: state.branch,
      job: working.id,
      tag: NO_MACHINE
    }
  })
  await okc('taskQueue', { id: state.task.id })

  const { jobs: judges } = await okc('jobs', { kind: 'judge' })
  const judge = (judges || []).find(j => j.runnable)
  assert.needs(judge, 'no judge is runnable here')

  const asked = await okc('judgementCreate', {
    kind: 'branch',
    branch: state.branch,
    job: judge.id,
    tag: NO_MACHINE,
    question: 'Written by a drill, and queued after a task to prove which goes first.'
  })
  mine.push(asked.id)
  await okc('judgementQueue', { id: asked.id })

  // READ, AND THEN TAKEN STRAIGHT BACK OUT. The queue ticks every fifteen
  // seconds and does not know this is a drill: left in the line, these would
  // boot a machine, take a credential and run a worker over a branch that
  // exists to be deleted. The cleanup below removes them too, but cleanup runs
  // at the END of the file — which is minutes away if the checks after this one
  // are slow, and "minutes" is several ticks.
  const q = await okc('queueState')
  const waiting = q.waiting || []
  await okc('judgementUnqueue', { id: asked.id }).catch(() => {})
  await okc('taskUnqueue', { id: state.task.id }).catch(() => {})
  const at = {
    judgement: waiting.findIndex(w => w.ref === asked.ref),
    task: waiting.findIndex(w => w.ref === `#${state.task.number}`)
  }
  assert.ok(at.judgement >= 0, `${asked.ref} was queued and is not in the line`)
  assert.ok(at.task >= 0, `#${state.task.number} was queued and is not in the line`)

  // THE WHOLE RULE, in one comparison: the judgement was asked for SECOND and
  // is ahead.
  assert.ok(at.judgement < at.task,
    `${asked.ref} was queued after #${state.task.number} and is behind it — judgements go first`)
  log(`${waiting.length} waiting; ${asked.ref} at ${at.judgement}, #${state.task.number} at ${at.task}`)

  // AND THE LINE SAYS WHICH KIND EACH IS, because a queue of mixed work that
  // does not say what anything is cannot be read by anybody deciding whether to
  // wait for it.
  assert.equal(waiting[at.judgement].kind, 'judgement', 'the queue does not say that a judgement is one')
  assert.equal(waiting[at.task].kind, 'task', 'the queue does not say that a task is one')
})

it('and the order is written down once, where the queue reads it', async ({ okc, assert, log }) => {
  const q = await okc('queueState')

  // A RULE THE BOARD DESCRIBES IN ITS OWN WORDS IS A RULE THAT DRIFTS. The
  // sentence and the sort live beside each other in tasks/queue.js, and this
  // asks the app for the sentence rather than repeating it here — so a change to
  // the ordering that forgets the words is caught by the words being wrong.
  assert.ok(/judgement/i.test(q.order || ''), 'the queue does not say what its order is')
  log(q.order)
})
