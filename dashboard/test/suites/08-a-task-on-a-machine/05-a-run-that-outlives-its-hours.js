'use strict'

// a run that outlives its hours — abandoned, and said out loud
//
// A TASK IS AS LONG AS THE WORK IS. Five minutes and two hours are both
// ordinary, so nothing in this app decides a run has stalled by how long it has
// taken. What it can say is how long it HAS been, which is what somebody
// deciding whether to go and look actually needs.
//
// THE ONE BOUND THAT DOES EXIST is the hours a task declares, six by default.
// It exists so a machine is not held for ever by a run that will never end, and
// it is the reason a soak left overnight has to SAY it is long: at hour six it
// would otherwise be abandoned while running perfectly, and its machine rolled
// back underneath it.
//
// HOW THIS IS TESTED IN SECONDS RATHER THAN HOURS. The task declares a number
// of hours so small that the deadline has already passed by the time the queue
// starts waiting on the run. That is not a trick to dodge the wait -- it is the
// same decision the six-hour case makes, reached by the same line of code, at a
// moment this drill can be present for. Waiting for the real thing would mean a
// drill that takes six hours and is therefore never run, which is how this
// stayed a draft.
//
// AND DONE DOES NOT MEAN IT WORKED. The task is marked done whatever the
// outcome, deliberately -- done is about the run having ENDED. Whether anything
// arrived is a separate question, read from the branch, and this checks both
// halves precisely because they are so easy to read as one.

const { it, cleanup } = require('../../../tasks/harness')
const { scratch, aLine } = require('../../helpers')

// The same job the suite beside this one uses: it hands a file back and never
// commits, which is all this needs -- what is being watched is the clock, not
// the work.
const JOB = 'api-tour'
const KIND = 'test'

// Small enough that the deadline is behind us before the first look, so the
// answer does not depend on how long the job happens to take. 0.00001 hours is
// thirty-six milliseconds.
const NO_TIME_AT_ALL = 0.00001

it('a machine, a job, and a task that says it has no time', async ({ okc, assert, slow, state, log }) => {
  assert.needs(slow, 'this puts a real task on a real machine and waits for the queue — minutes. Ask for it with: suiteRun --suite "a task on a machine" --slow true')

  const job = ((await okc('jobs')).jobs || []).find(j => j.id === JOB && j.approved)
  assert.needs(job, `"${JOB}" is not an approved job here, and an unapproved job is refused on purpose`)

  const { vms } = await okc('vmList')
  const free = vms.filter(v => v.stage === 'ready' && !v.branch && !v.borrowed && v.forTasks !== false && v.baseSnapshot)
  const tagged = free.filter(v => (v.tags || []).includes(KIND))
  assert.needs(free.length, 'no machine is free, ready and holding nothing — the queue would have nothing to give this to')
  state.tag = tagged.length ? KIND : null

  state.line = await aLine(okc, assert)
  state.branch = scratch('out-of-time')
  await okc('branchCreate', { branch: state.branch, reason: 'a drill proving a run that outlives its hours is abandoned', group: state.line })

  const { contracts } = await okc('contracts')
  const contract = (contracts || []).find(c => c.approved)
  assert.needs(contract, 'no contract is approved, and a task carries the rules a worker is held to')

  state.task = await okc('taskCreate', {
    task: {
      title: 'drill: a run with no time to run in',
      brief: 'It declares almost no hours on purpose. The queue should give up on it and say so.',
      branch: state.branch,
      job: JOB,
      contractId: contract.id,
      hours: NO_TIME_AT_ALL,
      tag: state.tag
    }
  })

  // THE DECLARATION IS THE POINT, so it is read back rather than assumed. A
  // store that quietly rounded this to null would leave the task on the six
  // hour default and this drill would wait six hours to fail.
  const mine = ((await okc('tasks')).tasks || []).find(t => t.id === state.task.id)
  assert.equal(Number(mine.hours), NO_TIME_AT_ALL, `the task was written with hours=${NO_TIME_AT_ALL} and reads ${JSON.stringify(mine.hours)} — if that is null it is on the six hour default and this drill proves nothing`)

  log(`#${mine.number} on "${state.branch}", job "${JOB}", declaring ${NO_TIME_AT_ALL} hours`)
}, { gate: true, minutes: 6 })

it('the queue gives it out, waits, and gives up on it', async ({ okc, assert, state, log }) => {
  await okc('taskQueue', { id: state.task.id })

  // Given to a machine first -- the deadline is only consulted once there is a
  // run to wait on, so a task that never dispatched would pass this check for
  // the wrong reason.
  for (let i = 0; i < 60; i++) {
    const { tasks } = await okc('tasks')
    const t = (tasks || []).find(x => x.id === state.task.id)
    if (t && t.machine) { state.machine = t.machine; break }
    await new Promise(r => setTimeout(r, 5000))
  }
  assert.ok(state.machine, 'no machine took this task within five minutes — the queue never picked it up, so nothing here is about the clock')

  // Then to the end, however it ends.
  for (let i = 0; i < 96; i++) {
    const { tasks } = await okc('tasks')
    const t = (tasks || []).find(x => x.id === state.task.id)
    if (t && t.state === 'done') { state.done = t; break }
    await new Promise(r => setTimeout(r, 5000))
  }
  assert.ok(state.done, 'the task never ended — which is the failure this whole check is about, arriving as a drill that hangs rather than as a run that is abandoned')

  log(`#${state.done.number} went to ${state.machine} and ended`)
}, { minutes: 12 })

it('and it says it gave up, rather than saying it finished', async ({ okc, assert, state, log }) => {
  // WHERE THE ANSWER LIVES. `abandoned` is an outcome, not a task state: the
  // task is marked done either way. So the evidence is the line the queue wrote
  // when it stopped waiting, which is also the only thing that would tell a
  // person why their machine came back early.
  const said = ((await okc('events')).events || []).map(e => String(e.text || ''))
  const gaveUp = said.filter(x => /giving up on .* after .* hours/.test(x))
  assert.ok(gaveUp.length, 'nothing in the record says the queue gave up. A run that outlived its hours has to say so, or a machine comes back with no explanation at all.')

  // AND THE OUTCOME IS NAMED IN THE ONE LINE SOMEBODY READS.
  const ended = said.find(x => x.includes(`#${state.done.number} done`))
  assert.ok(ended, `nothing said #${state.done.number} was done`)
  assert.ok(/abandoned/.test(ended), `the line a person reads says "${ended}" — a run that was given up on must not read as one that finished`)

  log(`${gaveUp[gaveUp.length - 1]}`)
  log(`${ended}`)
})

it('and the machine it was on came back clean', async ({ okc, assert, state, log }) => {
  // THE WHOLE REASON THE BOUND EXISTS. Abandoning a run is not about the task,
  // it is about not holding a machine for ever -- so a run given up on that
  // left its machine borrowed or claiming a branch would have failed at the one
  // thing it was for.
  for (let i = 0; i < 24; i++) {
    const v = ((await okc('vmList')).vms || []).find(x => x.name === state.machine)
    if (v && !v.borrowed && !v.branch) { state.back = v; break }
    await new Promise(r => setTimeout(r, 5000))
  }
  assert.ok(state.back, `${state.machine} is still borrowed or still claiming a branch two minutes after the run was abandoned — the machine is the thing this bound exists to get back`)
  assert.ok(!state.back.holdsCredential, `${state.machine} came back still holding a sign-in`)
  log(`${state.machine} is back: ${state.back.state}, claiming nothing, holding nothing`)
}, { minutes: 4 })

cleanup(async ({ okc, state }) => {
  if (state.task) await okc('taskRemove', { id: state.task.id }).catch(() => { /* it was never written */ })
  if (state.branch) await okc('branchDelete', { branch: state.branch, force: true }).catch(() => { /* nor was this */ })
  state.task = null
  state.branch = null
})
