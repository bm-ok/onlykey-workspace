'use strict'

// a session is not tied to a key — the conversation outlives the credential
//
// THE CLAIM THIS SUITE NOW MAKES, and it is the one the rest of the app was
// quietly contradicting: a Claude SESSION and a Claude CREDENTIAL are two
// different things with two different lifetimes.
//
//   a credential   replaceable in a minute by somebody at a login page
//   a session      what a worker worked out about a branch line, which is not
//                  replaceable at all
//
// So a key can be swapped underneath a conversation and the conversation
// survives. A session is filed under WHAT IT IS ABOUT — the branch line — and
// WHICH LANE it is in: worked on, or read. Never under who paid for it.
//
// HOW THIS WAS FOUND, because it is the argument for the check existing. Moving
// one sign-in from worker to judge — a relabelling that does not touch the token
// — carried twenty-three WORKER sessions onto the judge pane with it, every one
// of them badged `worker`. The window was filtering the session list by which
// credential signed each run, so the sessions appeared to swap roles along with
// the key. Nothing threw and nothing was lost; the app simply said the opposite
// of what it claims.
//
// WHAT IS CHECKED HERE IS THE RULE, not the pane. `keyFor` and `aboutWork` are
// functions of a piece of work, and the whole question can be asked of them in
// milliseconds — where proving it through the window means real runs on real
// machines with two real credentials. What needs a machine is the drill next
// door; this is the arithmetic underneath it.

// ---- what this asks, and what it stopped asking --------------------------
//
// THE ARITHMETIC IS NOT ASKED HERE ANY MORE. `keyFor`, `aboutWork` and
// `REMEMBERS` are functions of a piece of work, and this file reached for them
// with `require` — which a drill cannot do, since it runs from `dist/suites`
// with only the harness beside it. That is why this suite read `will not load`.
//
// They are asked in `test/worker/sessions-keying.test.js`, which puts the same
// questions to the same functions and adds the ones this did not: that a worker
// keeps its conversation and a judge does not, by default, and that a piece of
// work may ask to remember over that default. Nothing about them needs a host.
//
// WHAT IS LEFT IS THE ONE THING THAT DOES: that RELABELLING A SIGN-IN ON THIS
// HOST does not touch the token, and does not move what any worker remembers.
//
// THAT IS THE INCIDENT ABOVE, from the credential's end. It is not arithmetic —
// it is the real store, the real seal, and the real session records, and the way
// it went wrong was that nothing threw and nothing was lost while the app said
// the opposite of what it claims.
//
// ON AN IDENTITY THIS FILE ADDS AND REMOVES. The version before this borrowed a
// real sign-in that happened to be free and relabelled that — which works, and
// leaves a real credential wearing the wrong role for as long as anything goes
// wrong in between. The queue honours a role quietly, by taking that sign-in out
// of the pool it belongs to.

const { it, cleanup, requires } = require('../../harness')
const crypto = require('node:crypto')

requires('what this host has')

const NAME = 'drill-relabelled'

// INVENTED, and never read back — this asks what a relabel does to a token, not
// what the token is.
const MADE_UP = JSON.stringify({
  claudeAiOauth: {
    accessToken: 'okc-drill-relabel-not-a-real-token-51ba9c',
    refreshToken: 'okc-drill-relabel-nor-this-one-77de20',
    expiresAt: 4102444800000,
    scopes: ['user:inference']
  }
})

const printOf = (text) => crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 16)

cleanup(async ({ okc }) => {
  try { await okc('guestForget', { name: NAME }) } catch (e) { /* it was never added */ }
})

it('a credential can be relabelled without touching the token', async ({ okc, assert, state, log }) => {
  // A SIGN-IN CHANGING ROLE IS A RELABELLING. The fingerprint afterwards is the
  // same one, which is how somebody can tell nothing was re-sealed or re-read.
  // If it were a replacement, swapping roles would cost a sign-in, and the
  // separation between reading and writing would be expensive enough that nobody
  // would keep it — which is the separation the whole arrangement rests on.
  try { await okc('guestForget', { name: NAME }) } catch (e) { /* left from an interrupted run */ }
  const made = await okc('guestAdd', {
    name: NAME, token: MADE_UP, role: 'worker', note: 'made by a drill; thrown away at the end of it'
  })

  assert.equal(made.fingerprint, printOf(MADE_UP), 'this host sealed something other than what it was handed')
  state.print = made.fingerprint

  const to = await okc('guestRole', { name: NAME, role: 'judge' })
  assert.equal(to.role, 'judge', `"${NAME}" was asked to become a judge and reports ${to.role}`)
  assert.equal(to.fingerprint, state.print,
    `"${NAME}" changed role and its fingerprint moved, ${state.print} to ${to.fingerprint} — the token was touched, so this is a replacement rather than a label`)

  // AND BACK, because a role that can only be given is one that traps a sign-in.
  const back = await okc('guestRole', { name: NAME, role: 'worker' })
  assert.equal(back.role, 'worker')
  assert.equal(back.fingerprint, state.print, 'it came back as a worker with a different token behind it')

  // THE LIST AGREES, asked separately: the answer above is what the door said,
  // and this is what the host holds.
  const listed = ((await okc('guests')).guests || []).filter((g) => g.name === NAME)[0]
  assert.ok(listed, `"${NAME}" is not in the list after being relabelled twice`)
  assert.equal(listed.fingerprint, state.print, 'the list holds a different token from the one the door reported')

  log(`"${NAME}" went worker to judge and back, fingerprint ${state.print} throughout`)
})

it('and relabelling it moves nothing a worker remembers', async ({ okc, assert, state, log }) => {
  // THE INCIDENT ITSELF. Moving one sign-in from worker to judge carried
  // twenty-three worker sessions onto the judge pane with it, every one badged
  // `worker` — because the list was filtered by which credential signed each
  // run. Nothing threw. The app simply said the opposite of what it claims.
  //
  // A SESSION IS FILED UNDER WHAT IT IS ABOUT and which lane it is in, never
  // under who paid for it, so a relabel must move none of them. Asked of the
  // whole list rather than of a count: a swap that moved two out and two in
  // keeps the number and is the same fault.
  const before = ((await okc('sessions')).sessions || []).map((s) => `${s.key || s.id || s.about}=${s.lane || s.kind || ''}`).sort()

  assert.needs(before.length,
    'nothing on this host remembers anything yet, so a relabel cannot be seen to move it. It fills in once a worker has run — a session is handed back when a job finishes')

  await okc('guestRole', { name: NAME, role: 'judge' })
  const after = ((await okc('sessions')).sessions || []).map((s) => `${s.key || s.id || s.about}=${s.lane || s.kind || ''}`).sort()
  await okc('guestRole', { name: NAME, role: 'worker' })

  assert.deepEqual(after, before,
    'relabelling a sign-in changed what this host says workers remember — sessions are filed under the branch line and the lane, and something is keying them on the credential')

  log(`${before.length} session(s), and the same ${before.length} after a sign-in changed role`)
})
