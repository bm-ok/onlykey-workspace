'use strict'

// a machine kept back is left alone — by the queue, and in what anything is told
//
// "Keep it back from tasks" is the one lever a person has for "this machine is
// mine, do not touch it". Everything else here is about what the app may do; this
// is about what it may not, on a machine somebody has claimed.
//
// IT HAS TO HOLD AGAINST EVERY ASKER, which is why it is worth a drill of its
// own. The queue takes whatever is free; a drill borrows what is idle; a
// supervisor writes untagged work and the queue places it. Three different things
// reaching for a machine, one rule that has to stop all of them — and it has been
// tested by exactly none of them, because the failures it prevents look like
// nothing happening.
//
// AND IT IS NOT ONLY ABOUT THE QUEUE. A machine kept back is out of the pools
// entirely — see actions/machines.js. What a supervisor is told is "where can
// work go", and a machine somebody has held back is not an answer to that: naming
// it hands the reader a name and a state it cannot act on.
//
// NOTHING HERE COSTS A MACHINE COMING UP. It holds a machine back, asks four
// things, and puts it back exactly as it found it — including if it fails
// halfway, which is what the cleanup is for.

const { it, cleanup, requires } = require('../../../tasks/harness')

requires('the machines are built')

it('a machine can be kept back from the queue', async ({ okc, assert, state, log }) => {
  // THE KIT'S OWN, and only ever the kit's own. A drill that held somebody's
  // working runner back and then failed would have stopped their queue with no
  // explanation — which is precisely the fault this lever exists to prevent,
  // arriving from the thing that checks it.
  const machines = (await okc('vmList')).vms || []
  const mine = machines.find(m => !m.supervisor && (m.tags || []).includes('test') && m.forTasks !== false)
  assert.needs(mine, 'no machine from the test pool is available to hold back, and this must not touch anybody else\'s')
  state.machine = mine.name

  const said = await okc('vmForTasks', { name: mine.name, enabled: false })
  state.held = true
  assert.equal(said.forTasks, false, `${mine.name} was kept back and the record says ${said.forTasks}`)

  // ASKED OF THE QUEUE, WHICH IS WHAT DECIDES. The record saying so is this app
  // agreeing with itself; the queue's own availability is the thing every caller
  // reads.
  const queue = await okc('queueState')
  const how = (queue.machines || []).find(m => m.name === mine.name)
  assert.ok(how, `the queue says nothing at all about ${mine.name}`)
  assert.equal(how.free, false, `${mine.name} is kept back and the queue still counts it as free to be given work`)
  assert.ok(/kept back/i.test(String(how.why || '')), `the queue holds it back for the wrong reason: "${how.why}"`)
  log(`${mine.name}: ${how.why}`)
})

it('and a borrow will not take it either', async ({ okc, assert, state, log }) => {
  // THE OTHER WAY A MACHINE GETS TAKEN. The queue is not the only thing that
  // reaches for one — vmBorrow is what a person, a drill and credentialsTest all
  // use, and a rule the queue honours and borrowing ignores is half a rule.
  //
  // Asked by NAME, which is the strongest form: "give me that one specifically"
  // must be refused as firmly as "give me anything".
  const refusal = await assert.refuses(
    () => okc('vmBorrow', { name: state.machine, why: 'a drill checking that keeping a machine back is honoured' }),
    'kept back',
    `${state.machine} is kept back from tasks and was handed over to a borrower anyway`)
  log(`borrowing it by name is refused: ${refusal.message.slice(0, 120)}`)
})

it('and it is not offered as a pool a supervisor could use', async ({ okc, assert, state, log }) => {
  // WHAT A SUPERVISOR IS TOLD is "where can work go". A machine held back is not
  // an answer to that question, so it is absent rather than annotated: a name and
  // a reason it cannot act on is information for its own sake.
  const pools = await okc('pools')
  const seen = (pools.pools || []).flatMap(p => p.machines).find(m => m.name === state.machine)
  assert.ok(!seen, `${state.machine} is kept back and still appears in the pools, as "${seen && seen.why}"`)
  assert.ok(Number(pools.keptBack) >= 1,
    'nothing is reported as kept back at all, so a reader counting machines against pools finds a gap with no explanation')
  log(`it is out of the pools; ${pools.keptBack} machine(s) reported as kept back, none by name`)
})

it('and giving it back puts it where it was', async ({ okc, assert, state, log }) => {
  // THE OTHER HALF OF THE LEVER. A switch that cannot be switched back is a fault
  // rather than a guard, and "it is free again" has to be true of the QUEUE
  // rather than only of the record.
  const said = await okc('vmForTasks', { name: state.machine, enabled: true })
  state.held = false
  assert.ok(said.forTasks !== false, `${state.machine} was given back and the record still says it is held`)

  const queue = await okc('queueState')
  const how = (queue.machines || []).find(m => m.name === state.machine)
  assert.equal(how.free, true, `${state.machine} was given back and the queue still will not use it: ${how.why}`)

  const pools = await okc('pools')
  const seen = (pools.pools || []).flatMap(p => p.machines).find(m => m.name === state.machine)
  assert.ok(seen && seen.free, `${state.machine} was given back and the pools still do not offer it`)
  log(`${state.machine} is free to the queue and back in its pool`)
})

cleanup(async ({ okc, state }) => {
  // A MACHINE LEFT KEPT BACK IS A QUEUE THAT QUIETLY STOPPED, and the check that
  // gives it back is the one most likely not to run — it is last. So this does it
  // again, from state, however the run ended.
  if (state.machine && state.held) {
    try { await okc('vmForTasks', { name: state.machine, enabled: true }) } catch { /* it may never have been held */ }
  }
})
