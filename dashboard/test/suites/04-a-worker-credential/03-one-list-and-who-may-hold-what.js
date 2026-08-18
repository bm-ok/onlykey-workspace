'use strict'

// one list, and who may hold what — the shape the credentials are kept in
//
// TWO DRAFTS THAT ARE NOW BUILT, written as checks rather than left as wishes.
//
//   "the Keys tab lists every Claude credential, by machine" — it does. There was
//   one file at credentials/claude.json and a tab built to describe one thing;
//   there is a list of named identities now, each with a fingerprint and a
//   holder, and credentialsHeld answers about all of them.
//
//   "a supervisor is signed in as a supervisor, not as a worker" — it is. The
//   rule turned out to be about the PAIR rather than about the sign-in: a
//   supervisor identity belongs on a supervisor machine and nowhere else, and a
//   worker's belongs on a runner.
//
// NEVER A VALUE, WHICH IS THE RULE THE WHOLE SURFACE IS BUILT TO: a model may
// know something was done in the Keys tab without knowing what was done. So every
// check here reads names, roles, dates, holders and fingerprints, and the last
// one goes looking for a token in the answers rather than trusting that none is
// there.
//
// NO MACHINE NEEDED. All of it is this host's own record and two refusals.

const { it, requires } = require('../../../tasks/harness')

requires('the machines are built')

it('every credential this host holds is in one list, with a holder', async ({ okc, assert, state, log }) => {
  const held = await okc('credentialsHeld')
  assert.ok(Array.isArray(held.guests), `credentialsHeld does not answer with a list: ${JSON.stringify(held).slice(0, 200)}`)
  assert.needs(held.guests.length, 'this host holds no Claude sign-in at all, so there is nothing to list')
  state.held = held.guests

  for (const g of held.guests) {
    assert.ok(g.name, 'a credential in the list has no name, and a name is how anything asks for it')
    assert.ok(/^[0-9a-f]{16}$/.test(String(g.fingerprint || '')) || !g.has,
      `"${g.name}" has a token file and no fingerprint, so nothing can tell whether it changed while it was out`)
    // A HOLDER OR NOTHING, and both are answers. The column that did not exist
    // when there was one credential is "which machine has it now", and it is the
    // question asked when something stops working.
    assert.ok(Object.prototype.hasOwnProperty.call(g, 'holder'),
      `"${g.name}" does not say whether a machine is holding it`)
  }

  // AND THE CLOCK PER CREDENTIAL, not for the host. Two sign-ins expire on their
  // own schedules, and one answer for all of them was the shape that made "valid
  // until September" true while a worker was being refused.
  const withLife = held.guests.filter(g => g.life)
  assert.ok(withLife.length === held.guests.filter(g => g.has).length,
    'some credentials come back with no life at all, so how long each has left is unanswerable')

  // AND THE WHOLE LIST, WHICH IS A DIFFERENT QUESTION. `credentialsHeld` answers
  // "is there anything to hand a machine", so it leaves out the supervisor
  // sign-ins — those are never handed to a runner. `guests` is every identity
  // this host holds, of either kind, and it is what the two checks below need.
  //
  // Worth stating rather than treating as a bug: the drill asked the first for a
  // supervisor sign-in, found none, and reported "this host holds no supervisor
  // sign-in" about a host that has one.
  const all = (await okc('guests')).guests || []
  state.all = all
  assert.ok(all.length >= held.guests.length,
    'the full list holds fewer identities than the handed-out list, which cannot be true of a subset')

  log(all.map(g => `${g.name} [${g.role}] ${g.fingerprint || 'no file'}${g.holder ? ` on ${g.holder}` : ''}`).join('; '))
}, { gate: true })

it('and nothing in the answer is a token', async ({ okc, assert, log }) => {
  // ASKED OF THE WHOLE ANSWER rather than field by field, so a field added one
  // day arrives here loudly. The names are what is IN a credential file, and this
  // file is itself read by test/claims.js — hence the shapes rather than a
  // specimen.
  const said = JSON.stringify([await okc('credentialsHeld'), await okc('guests')])
  for (const tell of ['access_token', 'refreshToken', 'refresh_token', 'sk-ant', 'oauth_token']) {
    assert.ok(!said.includes(tell),
      `an answer about credentials contains "${tell}", so a value came back with it. A window that can show a secret is a window that ends up in a screenshot`)
  }
  log('names, roles, dates, holders, fingerprints and clocks — and no values')
})

it('and a supervisor sign-in belongs on a supervisor machine', async ({ okc, assert, state, log }) => {
  // THE PAIR IS THE RULE. The first version of this refused a supervisor sign-in
  // wherever it was going, which was right about workers and wrong about the one
  // machine that needs one — a supervisor cannot decide anything signed out.
  const machines = (await okc('vmList')).vms || []
  const boss = machines.find(m => m.supervisor)
  const runner = machines.find(m => !m.supervisor)
  assert.needs(boss && runner, 'this needs both a supervisor machine and a runner to tell apart')

  const sup = (state.all || []).find(g => g.role === 'supervisor')
  assert.needs(sup, 'this host holds no supervisor sign-in, so there is nothing to place')

  await assert.refuses(
    () => okc('guestLend', { name: sup.name, machine: runner.name }),
    'supervisor sign-in and',
    `"${sup.name}" is the identity that decides what work there is and it was lent to a runner, where a worker would spend it`)
  log(`"${sup.name}" cannot go to ${runner.name}`)
})

it('and a worker sign-in never goes to the supervisor', async ({ okc, assert, state, log }) => {
  // THE OTHER DIRECTION, and it is not symmetry for its own sake: a supervisor
  // holding a worker's identity takes one out of the pool the runners draw from,
  // and everything it decided would be billed to a worker.
  const machines = (await okc('vmList')).vms || []
  const boss = machines.find(m => m.supervisor)
  const worker = (state.all || []).find(g => g.role !== 'supervisor')
  assert.needs(boss && worker, 'this needs a supervisor machine and a worker sign-in')

  await assert.refuses(
    () => okc('guestLend', { name: worker.name, machine: boss.name }),
    'worker sign-in and',
    `"${worker.name}" is a worker's identity and it was put on the supervisor machine`)
  log(`"${worker.name}" cannot go to ${boss.name}`)
})
