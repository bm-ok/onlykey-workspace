'use strict'

// a machine we lost sight of — kept, not rolled back
//
// PUTTING A MACHINE AWAY ROLLS IT BACK TO BASE, which is right after work that
// ENDED and exactly wrong after work this app stopped being able to SEE. In the
// second case that disk is the only account of what went wrong, and the rollback
// destroys it.
//
// WHY BEING OUT OF TOUCH MEANS SOMETHING BROKE, ON THIS HOST. A guest reaches
// this app over a network driven by the same machine the dashboard runs on. So
// ten minutes of a guest unable to reach an address on its own host is not
// weather: something inside it stopped — a kernel panic, memory exhausted, or
// the work itself taking the network down.
//
// AND THE HONEST LIMIT, which the operator put better than the code did: there
// is no guarantee any of this yields an answer. A guest that stopped dialling
// out may have left nothing legible anywhere. What is claimed is narrower — that
// three things can be looked at which could not be before, and that the machine
// is not thrown away before anybody has had the chance.
//
// TWO HALVES, CHECKED TWO WAYS. The BOUND is arithmetic and is asked directly.
// The CONSEQUENCE needs a real machine, and is done to one — but by calling the
// thing the queue calls, rather than by waiting ten minutes for the queue to
// call it. A drill that waits out a ten-minute bound per run is a drill nobody
// runs, which is how this property stayed unchecked in the first place.

const { it, cleanup } = require('../../harness')
const queue = require('../../../tasks/queue')
const vms = require('../../../machines/vms')
const inbox = require('../../../core/inbox')

const KIND = 'test'
const MINUTE = 60000

it('the bound is ten minutes, and it can be asked without waiting ten minutes', ({ assert, log }) => {
  // NAMED AND ASKED THROUGH A FUNCTION so it is checkable at all. `now` is a
  // parameter for exactly this reason: it lets the rule be asked about eleven
  // minutes ago without eleven minutes passing.
  assert.equal(queue.HOW_LONG_OUT_OF_TOUCH, 10 * MINUTE,
    `the bound moved to ${queue.HOW_LONG_OUT_OF_TOUCH / MINUTE} minutes. That is allowed, and this check exists so it is a decision rather than a drift`)

  const now = Date.now()
  assert.ok(!queue.outOfTouchTooLong(now - 9 * MINUTE, now), 'nine minutes of quiet is not long enough to give up on a machine')
  assert.ok(queue.outOfTouchTooLong(now - 11 * MINUTE, now), 'eleven minutes of quiet did not reach the bound, so the app would wait for ever')

  // NEVER LOST IS NOT LOST LONG AGO. `lostSince` is zero until the first failed
  // look, and zero read as a timestamp is 1970 — which would make every machine
  // instantly overdue. Worth pinning, because the bug would be silent and total.
  assert.ok(!queue.outOfTouchTooLong(0, now), 'a machine that has never gone quiet reads as overdue — zero was taken as a timestamp rather than as "not lost"')
  assert.ok(!queue.outOfTouchTooLong(null, now), 'no timestamp at all reads as overdue')

  log('nine minutes no, eleven minutes yes, never-lost no — asked in microseconds')
})

it('a machine kept for looking at is not rolled back, and says so', async ({ okc, assert, slow, state, log }) => {
  assert.needs(slow, 'this borrows a real machine and leaves it running — minutes. Ask for it with: suiteRun --suite "a task on a machine" --slow true')

  const { vms: all } = await okc('vmList')
  const free = all.filter(v => v.stage === 'ready' && !v.branch && !v.borrowed && v.forTasks !== false && v.baseSnapshot)
  const tagged = free.filter(v => (v.tags || []).includes(KIND))
  const pick = tagged[0] || free[0]
  assert.needs(pick, 'no machine is free to keep')

  await okc('vmBorrow', { name: pick.name, why: 'a drill proving a machine we lost sight of is kept as it is' })
  state.machine = pick.name

  const before = ((await okc('vmList')).vms || []).find(v => v.name === state.machine)
  assert.ok(before.running, `${state.machine} was borrowed and is not running, so there is nothing to keep`)
  state.wasOn = before.baseSnapshot

  // THE THING THE QUEUE CALLS, called directly.
  //
  // Reaching past the actions is deliberate and is the only way in: this runs
  // inside a `finally` after a ten-minute wait, and there is no action for "give
  // up on a run" — correctly, because nothing should be able to ASK for that.
  // The kit already does this where a rule cannot be reached through an action;
  // see the supervisor suite reading MAY directly.
  const kept = await queue.keepForLooking(
    { vmList: { run: () => okc('vmList') }, vmScreenshot: { run: a => okc('vmScreenshot', a) } },
    require('../../../core/log'),
    state.machine,
    'a drill pretending this host lost sight of it'
  )
  assert.ok(kept.kept, 'keepForLooking did not report keeping it')

  // ---- IT IS STILL THERE, WHICH IS THE WHOLE POINT --------------------------
  const after = ((await okc('vmList')).vms || []).find(v => v.name === state.machine)
  assert.ok(after.running, `${state.machine} was stopped. Keeping it means keeping it: a machine somebody may want to open a console on is one that has to still be on`)
  assert.equal(after.baseSnapshot, state.wasOn, 'its snapshot moved, which means something rolled it back — the one thing this must not do')
  assert.ok(!after.branch || after.branch === before.branch, 'its claim changed underneath it')

  // ---- AND IT SAYS WHOSE IT IS AND WHY -------------------------------------
  assert.ok(after.borrowed, `${state.machine} is not marked as held, so the queue would hand it to the next task and roll it back after that`)
  assert.equal(after.borrowed.keptBy, 'the queue', 'it is held, but not in a way anything can tell apart from somebody borrowing it by hand')
  assert.ok(/lost sight/.test(after.borrowed.why || ''), `what it says about why is not the reason: "${after.borrowed.why}"`)

  log(`${state.machine}: still ${after.state}, still on "${after.baseSnapshot}", held — ${after.borrowed.why}`)
}, { gate: true, minutes: 12 })

it('and the person is told, rather than the pool quietly draining', async ({ assert, state, log }) => {
  // THE FAILURE THIS GUARDS IS THE ONE KEEPING A MACHINE CREATES. A held machine
  // is correctly never picked up, which is indistinguishable from a queue that
  // has gone quiet — this app says so about itself elsewhere. So the thing that
  // holds a machine back has to be the thing that says so.
  const items = inbox.all().filter(i => /kept for you/.test(i.kind))
  const mine = items.find(i => i.what === state.machine)
  assert.ok(mine, `nothing in the inbox says ${state.machine} is being held. It is out of the pool and nothing anywhere explains why, which is the failure this whole change would otherwise have traded for the one it fixed`)

  assert.ok(mine.mine, 'it is listed as something other than a person\'s errand, but nothing in this app will ever clear it by itself')
  assert.equal(mine.where.view, 'runners', `it does not say where to go: ${JSON.stringify(mine.where)}`)
  assert.ok(/vmReturn/.test(mine.why), 'it does not say how to give the machine back, which is the one thing the reader needs next')

  log(`inbox: "${mine.kind}" — ${mine.what}, pointing at ${mine.where.view}/${mine.where.pane}`)
})

it('and giving it back puts it in the pool again', async ({ okc, assert, state, log }) => {
  // THE WAY OUT HAS TO WORK, or keeping a machine is a one-way door and the
  // objection to keeping it at all is correct.
  await okc('vmReturn', { name: state.machine })

  for (let i = 0; i < 24; i++) {
    const v = ((await okc('vmList')).vms || []).find(x => x.name === state.machine)
    if (v && !v.borrowed && !v.branch && v.state !== 'running') { state.back = v; break }
    await new Promise(r => setTimeout(r, 5000))
  }
  assert.ok(state.back, `${state.machine} did not come back after vmReturn`)
  state.machine = null

  const left = inbox.all().filter(i => /kept for you/.test(i.kind) && i.what === (state.back || {}).name)
  assert.equal(left.length, 0, 'the machine is back in the pool and the inbox still says it is being held')
  log(`${state.back.name}: ${state.back.state}, in the pool, and the inbox no longer mentions it`)
}, { minutes: 6 })

cleanup(async ({ okc, state }) => {
  // Only if a check failed before giving it back: this machine is deliberately
  // left running and held, so a drill that stops halfway would leave it that way
  // for ever.
  if (state.machine) await okc('vmReturn', { name: state.machine }).catch(() => { /* already back */ })
  state.machine = null
})
