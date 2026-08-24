'use strict'

// a dead key costs no machine — what work does when it can be given no identity
//
// RUN THIS WHILE YOU HAVE A DEAD KEY, BEFORE YOU REPLACE IT. That is the whole
// point of it and the reason it is gated rather than deleted: a paused sign-in
// is the one condition under which this path can be walked at all, and it is a
// condition that arrives by accident, is worth ten minutes while it lasts, and
// cannot be recreated afterwards without breaking a working credential on
// purpose.
//
// WHAT IT WATCHES, and it is not the failure — it is the COST of the failure:
//
//     the work stays queued          it was never started, so it is not finished
//     no machine is spent            nothing boots, rolls forward and rolls back
//     the refusal names the sign-in  so somebody knows which one to replace
//
// HOW IT WAS FOUND, which is the argument for the check existing. A task was
// queued against a host whose only worker sign-in had been paused. The queue
// took a machine, started it, waited for its kernel, laid out the workspace,
// failed at the credential handover, rolled the machine back — and then said
// "Nothing will spend a machine on these until then", having just spent one. It
// did it again fifteen seconds later. The task was marked DONE with no attempt
// against it, so the board read finished for work that never ran.
//
// IT DOES NOT PAUSE A CREDENTIAL TO SET THE SCENE, deliberately. Marking a
// sign-in dead is how this host records a real finding — a machine took it and
// the worker reported itself signed out — and a drill that wrote that record
// falsely, or restored it wrongly afterwards, would leave a genuinely dead key
// looking healthy and hand it out again. So this OBSERVES a host already in that
// state and touches nothing but the task it queues.

const { it, cleanup } = require('../../harness')

// A task that asks for nothing in particular would be sent to whichever machine
// is free, including somebody's own. The kit's machines carry this.
const POOL = 'test'

it('this host has a paused sign-in to try it with', async ({ okc, assert, state, log }) => {
  // ASKED OF THE QUEUE, NOT OF THE SIGN-INS. This used to `require` the guest
  // store and call `freeFor`/`pausedFor` on it, which a drill cannot do — it
  // runs from dist/suites with only the harness beside it — and should not want
  // to. What is under test is what the QUEUE does when it can give work no
  // identity, so the right question is the one the queue answers itself:
  // `queueState.plan.signIns` is `guests.forQueue()`, the same call the tick
  // dispatches by. A drill that read the store directly could disagree with the
  // thing it is watching, and the one that decides is not the one being read.
  const { plan } = await okc('queueState')

  assert.needs(plan && plan.signInCheck,
    'the queue could not read this host\'s sign-ins at all, so it cannot say whether one is free — which is a different fault from the one this watches for')

  const worker = (plan.signIns || {}).worker || { free: 0, paused: [] }

  // THE DOOR, and it is shut on an ordinary host on purpose. `assert.needs`
  // reports "could not be tried" and says how to try it, which is what this
  // should say when everything is working — there is nothing here to prove on a
  // host that can sign a worker in.
  assert.needs(worker.paused.length,
    'no worker sign-in on this host is paused, so there is no dead key to try this with. It runs when a machine has taken a credential and reported itself signed out — which is a thing to catch while it is happening rather than to arrange')
  assert.needs(!worker.free,
    `this host still has ${worker.free} usable worker sign-in(s), so a task would simply run. What is under test is what happens when there is NOTHING to give a machine`)

  // KEPT FOR THE CHECK THAT NEEDS THE NAMES, so both halves are talking about
  // the same reading rather than two taken minutes apart — a sign-in replaced
  // between them would otherwise look like the queue naming the wrong one.
  state.paused = worker.paused

  log(`every worker sign-in here is paused: ${worker.paused.map(n => `"${n}"`).join(', ')} — so a task queued now can be given no identity at all`)
}, { gate: true })

it('and a machine is standing free that it could have spent', async ({ okc, assert, state, log }) => {
  // WITHOUT THIS THE NEXT CHECK PROVES NOTHING. "No machine was spent" is true
  // on a host with no free machine for reasons that have nothing to do with
  // credentials, and a check that passes for the wrong reason is worse than one
  // that says it could not be tried.
  const { vms } = await okc('vmList')
  const idle = vms.filter(v => v.kind === 'worker' &&
    (v.tags || []).some(t => String(t).toLowerCase() === POOL) &&
    !v.branch && !v.borrowed && !v.holdsCredential)

  assert.needs(idle.length, `no machine tagged "${POOL}" is free, so nothing could be spent whatever the queue decided`)

  // REMEMBERED BY NAME, so the check after looks up THESE machines rather than
  // deriving a second set and comparing two lists built by two filters. Written
  // that way first and it failed on a judge machine that was already running
  // before the drill began: the "before" filter excluded it and the "after" one
  // did not, so an unrelated machine minding its own business read as a machine
  // this task had spent. A comparison is only worth as much as the two halves
  // being about the same thing.
  state.watching = idle.map(v => v.name)
  state.machinesWere = idle.map(v => `${v.name}=${v.state}`).sort().join(' ')
  log(`free and able to take this work: ${state.machinesWere}`)
})

it('so a task queued against it waits, and nothing boots', async ({ okc, assert, state, log }) => {
  // A REAL TASK THROUGH THE REAL QUEUE. Every step could be driven by hand and
  // doing so would prove that dispatch refuses, which is not the claim — the
  // claim is about what the thing running unattended does with work it cannot
  // start.
  const { tasks } = await okc('tasks')
  const spare = tasks.find(t => t.state === 'draft' && !t.verdict && t.job)
  assert.needs(spare, 'no draft task is on the board to queue. This needs one that already exists — writing one over the wire is refused without a judgement, correctly')

  state.task = spare.id
  state.tagWas = spare.tag || ''
  await okc('taskUpdate', { id: spare.id, task: { tag: POOL } })
  await okc('taskQueue', { id: spare.id })

  // A BOOKMARK FIRST. The record is durable and read from a point, so this asks
  // what happened SINCE queueing rather than searching the whole history for a
  // sentence that may have been written an hour ago about something else.
  const from = (await okc('events', { limit: 1 })).bookmark

  // THE QUEUE TICKS EVERY FIFTEEN SECONDS. Two ticks is enough to have decided,
  // and long enough that a machine which was going to boot would have started —
  // `vmList` reports "running" within a few seconds of startvm.
  let said = null
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 5000))
    const { events } = await okc('events', { since: from })
    said = (events || []).find(e => /needs a worker sign-in/.test(e.text || ''))
    if (said) break
  }

  assert.ok(said, 'the queue said nothing about this task in a minute. It should say what it is waiting for rather than leaving work sitting silently')

  // ---- THE THREE THINGS THAT MATTER ------------------------------------

  // 1. NOTHING WAS SPENT. The machines are exactly as they were.
  const { vms } = await okc('vmList')
  const now = vms.filter(v => state.watching.includes(v.name))
    .map(v => `${v.name}=${v.state}`).sort().join(' ')
  assert.equal(now, state.machinesWere,
    `a machine changed state while the task could not be given an identity — was "${state.machinesWere}", now "${now}". Booting one to discover there is no credential costs a minute and a rollback, every fifteen seconds, for as long as the wait lasts`)

  // 2. THE WORK IS STILL WAITING, not finished. Marking it done would file "we
  //    learnt nothing" as an outcome, and somebody would find a task reading
  //    finished with an empty branch and no attempt against it.
  const mine = (await okc('tasks')).tasks.find(t => t.id === state.task)
  assert.equal(mine.state, 'queued',
    `#${mine.number} reads "${mine.state}" after the queue could not give it an identity. It never started, so it is waiting — and it must be there still waiting when somebody signs in again`)
  assert.ok(!mine.machine, `#${mine.number} names machine "${mine.machine}" for a run that never happened`)

  // 3. AND THE REFUSAL SAYS WHICH SIGN-IN TO REPLACE. "No credential available"
  //    is a sentence somebody has to act on and cannot: this host may hold
  //    several, and the one that is paused is the one to sign in again.
  for (const name of state.paused) {
    assert.ok(said.text.includes(name),
      `the queue said it is waiting without naming "${name}", which is the sign-in somebody has to replace: ${said.text}`)
  }
  assert.ok(/paused/i.test(said.text),
    `the queue does not say the sign-in is PAUSED, so it reads as "busy, try later" for something that will never get better on its own: ${said.text}`)

  log(said.text)
  // A MINUTE OF POLLING NEEDS MORE THAN THE MINUTE THE HARNESS ALLOWS BY
  // DEFAULT. Written without this the first time and it died at 60s -- which is
  // the mistake `minutes` exists to prevent, made in the file that adds it.
}, { minutes: 3 })

it('and it says so once, not four times a minute', async ({ okc, assert, log }) => {
  // THE OTHER HALF OF WAITING WELL, and the reason it is checked rather than
  // assumed: this loop runs on a tick, so anything it says about work that is
  // WAITING it says again every fifteen seconds. A task waiting overnight for a
  // sign-in somebody has to make writes thousands of identical lines — and the
  // record is read from a bookmark, so the cost is not disk. It is that the next
  // real event arrives buried under them.
  const from = (await okc('events', { limit: 1 })).bookmark
  await new Promise(r => setTimeout(r, 40000))

  const { events } = await okc('events', { since: from })
  const again = (events || []).filter(e => /needs a worker sign-in/.test(e.text || ''))
  assert.ok(!again.length,
    `the queue repeated what it is waiting for ${again.length} time(s) in forty seconds. It has already been said and nothing has changed — say it again when the REASON changes, not on a timer`)

  log('two ticks passed and the wait was not repeated — it is said once, and again when the reason changes')
}, { minutes: 2 })

cleanup(async ({ okc, state }) => {
  // THE TASK PUT BACK. It is left queued otherwise, and would start the moment
  // somebody signs a worker in — which is a run nobody asked for, kicked off by
  // a drill that finished an hour ago.
  if (state.task) {
    await okc('taskUnqueue', { id: state.task }).catch(() => {})
    await okc('taskUpdate', { id: state.task, task: { tag: state.tagWas || '' } }).catch(() => {})
    state.task = null
  }
})
