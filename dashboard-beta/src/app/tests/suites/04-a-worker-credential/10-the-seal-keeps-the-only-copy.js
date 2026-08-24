'use strict'

// the seal keeps the only copy — exactly, and to itself
//
// WHAT HAPPENED, AND IT COST A SIGN-IN THAT IS NOT RECOVERABLE. A judgement ran
// on kit-2 as "runner2", failed to authenticate, and the CLI on that machine
// appears to have CLEARED its own credential file — leaving the shape intact,
// both tokens empty, 280 bytes where there had been 508. The read-back saw a
// fingerprint it had not seen before, concluded the machine had refreshed the
// token, and wrote the empty one over the working one:
//
//     03:30:35  the Claude guest "runner2" came back refreshed — 8593fb80…
//     03:32:19  kit-2 took the credential and the worker reports itself signed out
//     03:44:41  … and every attempt after that
//
// THE ASSUMPTION THAT DID IT was that DIFFERENT means NEWER. It usually does —
// the CLI rotates the refresh token as a worker runs, and reading the file back
// is the only way that rotation comes home. But a machine that cleared its
// sign-in also hands back something different, and telling those apart is the
// difference between keeping up with a rotation and destroying the only copy.
//
// ---- what this asks, and what it stopped asking --------------------------
//
// THE REFUSAL ITSELF IS NO LONGER ASKED HERE. Two reasons, and the second is the
// one that matters.
//
// It cannot be: the refusal lives in the read-back, which is reached through
// `guestBack` — and that is a conversation with a machine that is dialled in. A
// drill that needs a running machine to ask a question about a list is spending
// a machine to test arithmetic.
//
// And it need not be: `test/runners/guests-store.test.js` asks the real
// `backFrom` directly — that an empty credential handed back does NOT overwrite
// a working one, that the machine is left holding it, and the escape hatch,
// that when what is held is ALREADY unusable there is nothing to protect and the
// new one is taken. That is the whole rule, against the real function.
//
// WHAT COULD NOT MOVE THERE IS THE SEAL. That test hands the store a STUB in
// place of `core/secret` — as it must, since a unit test cannot depend on this
// Windows account existing. So the layer that actually holds the credential is
// the one thing no test touches, and it is the layer the incident destroyed. If
// the seal does not keep exactly what it was given, every refusal above it is
// guarding something that was already gone.
//
// That is a claim about THIS HOST, and this is where it belongs.
//
// ---- what it costs, and what it risks ------------------------------------
//
// TOKENS THIS FILE INVENTS, on throwaway identities it adds and removes. No real
// credential is read, written, lent or risked, no machine is touched, and
// nothing here needs a sign-in to exist. The rule is about what the seal does
// with bytes, so bytes it made up are all it needs.
//
// AND NOTHING HERE PRINTS ONE — which is not a promise, it is one of the checks:
// the last of these reads every door it can reach and fails if the credential it
// just handed in comes back out of any of them.

const { it, cleanup, requires } = require('../../harness')
const crypto = require('node:crypto')

requires('what this host has')

// THE SAME SUM THE APP TAKES, written out rather than imported. A drill runs from
// `dist/suites` with only the harness beside it and cannot reach the app's
// insides — see ../02-the-refusals/05 — and here that restriction is a gift: if
// this file computed the fingerprint by calling the code that computes the
// fingerprint, it would agree with itself no matter what was sealed.
const printOf = (text) => crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 16)

// NAMES NOBODY WOULD PICK, so a leftover from a failed run is recognisable as
// this file's rather than somebody's worker.
const TEXT = 'drill-seal-as-text'
const OBJECT = 'drill-seal-as-object'

// WHAT A REAL ONE LOOKS LIKE, and nothing more: two tokens and the description
// around them. The strings say what they are, so a person who finds one of these
// in a log knows immediately that it is not a credential.
const invented = (mark) => ({
  claudeAiOauth: {
    accessToken: 'sk-ant-oat01-drill-invented-not-a-real-token-' + mark,
    refreshToken: 'sk-ant-ort01-drill-invented-not-a-real-token-' + mark,
    expiresAt: 1,
    scopes: ['user:inference'],
    subscriptionType: 'max'
  }
})

// GONE WHETHER OR NOT ANY OF THIS PASSES. A drill that leaves an identity behind
// leaves it in the list a person reads to decide what to lend a machine.
cleanup(async ({ okc }) => {
  for (const name of [TEXT, OBJECT]) {
    try { await okc('guestForget', { name }) } catch (e) { /* it was never added */ }
  }
})

it('the seal keeps exactly the credential it was given', async ({ okc, assert, log }) => {
  const text = JSON.stringify(invented('text'))

  // ADDED AS A STRING, which is what the window sends: somebody pastes the
  // contents of .credentials.json into a box.
  const made = await okc('guestAdd', { name: TEXT, token: text, note: 'a drill; safe to remove' })

  assert.equal(made.name, TEXT)
  assert.equal(made.fingerprint, printOf(text),
    'the host sealed this credential and reported a fingerprint of something else — what came back is not '
    + 'what was handed in, and a fingerprint that does not describe what is on disk is exactly how the '
    + 'read-back was fooled into overwriting a working sign-in')

  log(`sealed and fingerprinted as ${made.fingerprint}, which is the sum of what was handed in`)
})

it('and one handed in as an object is kept as itself, not as the words "[object Object]"', async ({ okc, assert, log }) => {
  // THIS ONE HAS ALREADY HAPPENED HERE. The command line parses `--token
  // '{"claudeAiOauth":…}'` into an object, because that is what makes
  // `--vm '{…}'` work, and the door used to do String(token) — which turns an
  // object into fourteen characters, seals them, records a fingerprint of them,
  // and reports the guest as added. The credential is gone at that moment and
  // the way you find out is a machine answering "not signed in" weeks later.
  //
  // A DRILL IS THE RIGHT PLACE FOR IT because the object only arrives that way
  // when something outside the app parsed it — the CLI, or the window's own
  // form. Asked here, through the same table those use.
  const object = invented('object')

  const made = await okc('guestAdd', { name: OBJECT, token: object, note: 'a drill; safe to remove' })

  assert.notEqual(made.fingerprint, printOf('[object Object]'),
    'a credential handed in as an object was sealed as the literal words "[object Object]" — the sign-in '
    + 'is already gone and this host is reporting it as kept')

  assert.equal(made.fingerprint, printOf(JSON.stringify(object)),
    'a credential handed in as an object was not sealed as its own JSON, so what is on disk is neither the '
    + 'credential nor anything that can be recognised as wrong')

  log('an object arrived, its JSON was sealed, and the fingerprint says which')
})

it('and nothing hands the credential back out again', async ({ okc, assert, log }) => {
  // THE RULE THE PERSON WHO OWNS THIS HOST STATED: for the keys, you should know
  // that something was done in there and not what it was. `guests-boundary`
  // holds the store to that; this holds the DOORS to it, on the real host, with
  // a credential whose exact bytes this file knows and can therefore look for.
  const secret = 'sk-ant-oat01-drill-invented-not-a-real-token-text'

  // EVERY ANSWER A DRILL CAN REACH, named so a failure says which door leaked
  // rather than that a string was found somewhere.
  const doors = [
    ['guests', await okc('guests')],
    ['guestRole', await okc('guestRole', { name: TEXT, role: 'worker' })]
  ]

  for (const [door, answer] of doors) {
    assert.ok(!JSON.stringify(answer).includes(secret),
      `"${door}" handed back the credential itself — everything that reads this list can now read the token`)
  }

  // A SCAN THAT FOUND NOTHING PASSES EVERYTHING. It has to have been looking at
  // the right identity for the absence to mean anything.
  const listed = (doors[0][1].guests || []).filter((g) => g.name === TEXT)
  assert.equal(listed.length, 1,
    'the guest this drill added is not in the list it just read, so finding no token in it proves nothing')

  assert.ok(listed[0].fingerprint,
    'the list says nothing about the credential at all — a fingerprint is what makes "something changed in '
    + 'there" answerable without showing what')

  log(`${doors.length} doors read, the identity is in the list, and the token is in none of them`)
})
