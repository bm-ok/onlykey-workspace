'use strict'

// the machines — a machine at rest is at rest
//
// The cheapest test here and the one the rest of the app leans on hardest.
// Nothing is started, nothing is written, and it takes milliseconds: it reads
// the register and says whether the resting state is what everything else
// assumes it is.
//
// OFF, ON ITS BASE SNAPSHOT, CLAIMING NOTHING, HOLDING NOTHING. The queue picks
// up a machine that is free and clean, so a machine that quietly keeps a claim
// is never picked up again — and a queue that has stopped handing work out looks
// exactly like a queue with nothing to do. That failure has happened here twice.

const { it } = require('../../../tasks/harness')

it('every machine this app made is known to it', async ({ okc, assert, state }) => {
  const { vms } = await okc('vmList')
  assert.needs(vms && vms.length, 'this host has no machines, so there is nothing to say about their resting state')
  state.vms = vms
  for (const vm of vms) {
    assert.ok(vm.name, 'A machine in the register has no name')
    assert.ok(vm.stage, `"${vm.name}" has no stage — it is neither built, nor installing, nor ready`)
  }
})

it('a machine that is not running claims no branch', async ({ assert, state }) => {
  // The one that matters. A claim is how a machine says "the work on this branch
  // is mine", and it is released when the work ends — so a claim held by a
  // machine that is switched off is a claim nobody is going to release.
  const stuck = state.vms.filter(v => v.state !== 'running' && v.branch)
  assert.equal(stuck.length, 0,
    `${stuck.map(v => `${v.name} is ${v.state} and still claims ${v.branch}`).join('; ')} — nothing will release that, and the queue will pass over it for ever`)
})

it('and holds no credential it was lent', async ({ okc, assert, state }) => {
  // Asked of the register rather than of the machine: this must be answerable
  // with every machine switched off, which is when it matters.
  const { vms } = await okc('vmList')
  const holding = vms.filter(v => v.state !== 'running' && (v.holdsCredential || v.credential))
  assert.equal(holding.length, 0,
    `${holding.map(v => v.name).join(', ')} is off and still marked as holding a credential — a snapshot of it would store the credential with it`)
  state.free = vms.filter(v => v.stage === 'ready' && v.state !== 'running' && !v.branch)
})

it('and at least one is free for the queue to use', async ({ assert, state }) => {
  // Not a rule about the app — a fact about this host, said out loud because
  // every expensive check below it is unrunnable without one, and "no machine
  // was free" is a much more useful sentence than eight checks that could not be
  // tried for reasons of their own.
  assert.ok(state.free.length, 'no machine is ready, off and free — the drills that need one cannot be tried')
})
