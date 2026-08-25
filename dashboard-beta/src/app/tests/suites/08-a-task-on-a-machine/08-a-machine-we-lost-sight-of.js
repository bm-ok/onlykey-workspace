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
// ---- what this asks, and what it stopped asking --------------------------
//
// IT USED TO REACH IN FOR ALL OF IT: `tasks/queue` for the bound and for
// `keepForLooking`, `machines/vms`, `core/inbox`, and `core/log` to hand the
// keeping something to log to. A drill runs from `dist/suites` with only the
// harness beside it and can reach none of them, which is why this file read
// `will not load`.
//
// THE BOUND IS ARITHMETIC. Ten minutes, and that nine is not enough and eleven
// is, and that a machine which has never gone quiet does not read as overdue —
// `test/queue/queue-running.test.js` asks all of it against the same function,
// including the one that matters most: zero and null are "not lost" rather than
// timestamps from 1970.
//
// AND THE KEEPING ITSELF IS ASKED IN `test/queue/queue-putting.test.js`: not
// stopped, not rolled back, not asked for its credential, and marked as held with
// the reason and who held it.
//
// THE PART THAT CANNOT BE DONE HERE AT ALL is arranging for a machine to be kept.
// There is no action for "give up on a run" — correctly, because nothing should
// be able to ASK for that — and the drill before this one got round it by calling
// the queue's own function with a log it had reached in for. From `dist/suites`
// that is not available, and building an action so a drill can reach it would be
// adding a door to the app for the test's benefit.
//
// ---- so this runs when it is true, which is when it matters --------------
//
// A MACHINE BEING HELD IS NOT A STATE SOMEBODY ARRANGES. It happens when a run
// went quiet, and on a host where that has happened these are exactly the
// questions worth asking — asked of the real machine, the real inbox and the
// real way out, rather than of a situation a drill staged for itself.
//
// AND THE FAILURE IT GUARDS IS THE ONE KEEPING A MACHINE CREATES. A held machine
// is correctly never picked up, which is indistinguishable from a queue that has
// gone quiet — this app says so about itself elsewhere. So the thing that holds a
// machine back has to be the thing that says so, and the way out has to work, or
// keeping it at all is a one-way door and the objection to the whole idea is
// correct.

const { it, cleanup, requires } = require('../../harness')

requires('the machines are built')

it('this host is holding a machine it lost sight of', async ({ okc, assert, state, log }) => {
  // NOT ARRANGED, FOUND. See the header: there is no way to ask this app to give
  // up on a run, and there should not be.
  const { vms } = await okc('vmList')
  const kept = (vms || []).filter((v) => v.borrowed && v.borrowed.keptBy === 'the queue')

  assert.needs(kept.length,
    'no machine here is being held by the queue, so there is nothing to ask these questions about. It happens when a run goes quiet for ten minutes — the machine is kept exactly as it is rather than rolled back, and this runs on the host where that has happened')

  state.machine = kept[0].name
  state.why = (kept[0].borrowed || {}).why || ''

  // IT IS STILL THERE, WHICH IS THE WHOLE POINT. Keeping a machine means keeping
  // it: one somebody may want to open a console on is one that has to still be
  // on, because memory holds what the disk does not.
  assert.ok(kept[0].running || kept[0].state === 'running',
    `${state.machine} is held but not running (${kept[0].state}) — it was kept so somebody could look at it, and what was on its screen is gone`)

  log(`${state.machine} is held: ${state.why}`)
}, { gate: true })

it('and the person is told, rather than the pool quietly draining', async ({ okc, assert, state, log }) => {
  const items = ((await okc('inbox')).items || []).filter((i) => /kept for you/.test(i.kind))
  const mine = items.filter((i) => i.what === state.machine)[0]

  assert.ok(mine,
    `nothing in the inbox says ${state.machine} is being held. It is out of the pool and nothing anywhere explains why, which is the failure this whole arrangement would otherwise have traded for the one it fixes`)

  // WHERE TO GO, because a row that names a problem and not a place is one
  // somebody has to go and find.
  assert.equal(mine.where && mine.where.view, 'Runners', `it does not say where to go: ${JSON.stringify(mine.where)}`)
  assert.equal(mine.where && mine.where.pick, state.machine, 'it points at the tab but not at the machine it is about')

  // AND HOW TO END IT. Nothing in this app will ever clear this row by itself,
  // so the row has to carry the one thing the reader needs next.
  assert.ok(/give it back|given back/.test(mine.why || ''),
    `it does not say how to release the machine, which is the one thing the reader needs next: ${mine.why}`)

  log(`inbox: "${mine.kind}" — ${mine.what}, pointing at ${mine.where.view}/${mine.where.pane || '(the tab)'}`)
})

it('and giving it back puts it in the pool again', async ({ okc, assert, state, log }) => {
  // THE WAY OUT HAS TO WORK, or keeping a machine is a one-way door and the
  // objection to keeping it at all is correct.
  //
  // THIS IS THE ONE STEP THAT CHANGES SOMETHING, and it is the step a person
  // would take anyway once they had looked. It is not undone afterwards: the
  // machine belongs in the pool, and putting it back is the answer rather than a
  // side effect to clean up.
  await okc('vmReturn', { name: state.machine })

  let back = null
  for (let i = 0; i < 24; i++) {
    const v = ((await okc('vmList')).vms || []).filter((x) => x.name === state.machine)[0]
    if (v && !v.borrowed && !v.branch && v.state !== 'running') { back = v; break }
    await new Promise((r) => setTimeout(r, 5000))
  }

  assert.ok(back, `${state.machine} did not come back after vmReturn`)

  const left = ((await okc('inbox')).items || [])
    .filter((i) => /kept for you/.test(i.kind) && i.what === state.machine)
  assert.equal(left.length, 0, 'the machine is back in the pool and the inbox still says it is being held')

  state.machine = null
  log(`${back.name}: ${back.state}, in the pool, and the inbox no longer mentions it`)
}, { minutes: 6 })

cleanup(async ({ okc, state }) => {
  // ONLY IF A CHECK FAILED BEFORE GIVING IT BACK. This machine was deliberately
  // left running and held by something that went wrong, so a drill that stopped
  // halfway must not leave it that way — but it also must not put back a machine
  // it never took.
  if (state.machine) {
    try { await okc('vmReturn', { name: state.machine }) } catch (e) { /* already back, or gone */ }
    state.machine = null
  }
})
