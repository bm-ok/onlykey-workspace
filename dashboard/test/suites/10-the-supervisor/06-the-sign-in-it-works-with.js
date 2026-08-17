'use strict'

// the sign-in it works with — signed out is a rest for a runner and a fault here
//
// A runner is handed a credential per task and has it taken back afterwards, so
// an idle runner is signed out BY DESIGN. A supervisor is the opposite on both
// counts: it is meant to be up, it holds one identity for as long as it is, and
// it can do nothing at all without one.
//
// THAT DISTINCTION WAS MISSING EVERYWHERE, and the cost was a supervisor sitting
// up and unable to think while the window printed the runner's sentence over it
// and called the fault normal. So it is checked in three places here: the state
// it reports, the sign-in it chooses, and what it says when it cannot.
//
// AND IT SIGNS ITSELF IN. Every route that brings a supervisor up was written
// for another reason — a host restart, vmStart, somebody at the window — and
// only `supervisorUp` also handed it an identity. `supervisorSignIn` is called
// when a machine dials in and again before every wake, and it is idempotent,
// quiet, never starts a machine and never takes a sign-in off anything.

const { it, requires } = require('../../../tasks/harness')

requires('a worker credential')

it('which sign-in it uses is one answer, asked in one place', async ({ okc, assert, log }) => {
  // ONE FUNCTION ANSWERS THIS, and that is the check. It was answered twice —
  // once by `guests` filtered to supervisors, once by whatever was reading — and
  // the two disagreed: the window told this host it had no supervisor sign-in
  // while one sat on the Runners tab with a "here" badge on it. `credentialsHeld`
  // omits supervisors from its guest list ON PURPOSE, because that list answers
  // "is there anything to hand a runner".
  const held = await okc('credentialsHeld')
  const key = await okc('supervisorKey')

  assert.ok(held.supervisor, 'credentialsHeld says nothing about supervisor sign-ins, so anything reading it will conclude there are none')
  assert.equal(
    (held.guests || []).filter(g => g.role === 'supervisor').length, 0,
    'a supervisor sign-in appeared in the guest list, which is the list of what can be handed to a RUNNER'
  )
  assert.equal(held.supervisor.kept, (key.keys || []).length,
    'the two surfaces disagree about how many supervisor sign-ins this host keeps')
  assert.equal(held.supervisor.using, key.using,
    'the banner and the pane disagree about which sign-in is in use, which is exactly the fault this was written for')
  log(`${held.supervisor.kept} kept, using ${held.supervisor.using || 'none'}${held.supervisor.chosen ? ' (chosen)' : ''}`)
})

it('and "in use" is not the same question as "free to hand over"', async ({ okc, assert }) => {
  const key = await okc('supervisorKey')
  assert.needs((key.keys || []).length, 'this host keeps no supervisor sign-in, so there is nothing to be in use')

  const out = (key.keys || []).find(k => k.holder)
  assert.needs(out, 'no supervisor sign-in is out on a machine — start the supervisor and run this again')

  // READ OFF THE WRONG FIELD THIS SAID "none" AT THE EXACT MOMENT A SUPERVISOR
  // WAS SIGNED IN AND WORKING. `key` means "what could be given to a supervisor
  // coming up", and a sign-in already on a machine is not that. `using` is what
  // a supervisor is signed in AS. Two fields, because two questions.
  assert.equal(key.using, out.name,
    `"${out.name}" is out on ${out.holder} and the pane does not report it as the one in use`)

  const held = await okc('credentialsHeld')
  assert.equal(held.supervisor.free, false,
    'a sign-in that is out on a machine is reported as free to hand to another one')
  assert.equal(held.supervisor.out, out.holder,
    'nothing says which machine has it, which is the difference between "go and sign one in" and "take it back from there"')
})

it('and signing one in is idempotent, quiet, and never starts anything', async ({ okc, assert, log }) => {
  const { vms } = await okc('vmList')
  const sup = (vms || []).find(v => (v.tags || []).some(t => String(t).toLowerCase() === 'supervisor'))
  assert.needs(sup, 'there is no supervisor machine on this host')

  // CALLED ON EVERY DIAL-IN AND BEFORE EVERY WAKE, so "it already has one" has
  // to be the ordinary, silent answer rather than an error. Asked twice here,
  // because the second call is the one that would go wrong.
  const first = await okc('supervisorSignIn')
  const again = await okc('supervisorSignIn')

  if (sup.running) {
    assert.ok(sup.holdsCredential || first.did || again.did,
      `${sup.name} is up and is holding no sign-in, and asking for one did nothing: ${first.why || again.why}`)
    assert.ok(!again.did, `asking a second time did something ("${again.did}") — it is meant to be idempotent`)
    assert.ok(/already signed in/i.test(again.why || ''), `a supervisor that is signed in should say so plainly, and it said "${again.why}"`)
  } else {
    // IT NEVER STARTS A MACHINE. Starting one is a decision with a cost, and
    // supervisorUp is where somebody makes it — a thing called on every dial-in
    // must not be able to boot anything.
    assert.equal(again.did, null, 'a supervisor that is switched off was signed in anyway, which means something started it')
    assert.ok(/not up/i.test(again.why || ''), `it should say the machine is not up, and it said "${again.why}"`)
  }
  log(again.did || again.why)
})

it('and what it is signed in as is on its own state', async ({ okc, assert, log }) => {
  const state = await okc('supervisorState')
  assert.needs(state.there, 'there is no supervisor machine on this host')
  const one = (state.supervisors || [])[0] || {}

  // THE FACT THAT WAS INVISIBLE EVERYWHERE AND COST AN AFTERNOON. A supervisor
  // that cannot authenticate looks exactly like one that is working: the machine
  // is up, the panel is green, and every wake ends in three seconds having asked
  // for nothing.
  assert.ok('signedInAs' in one, 'the supervisor does not report what it is signed in as')
  assert.equal(one.ready, !!one.signedInAs && one.state === 'running',
    'a supervisor is "ready" without holding a sign-in, or is holding one and is not ready')
  if (!one.ready) assert.ok(one.why, 'it says it cannot run and does not say why')
  log(`${one.name}: ${one.ready ? `ready as "${one.signedInAs}"` : one.why}`)
})
