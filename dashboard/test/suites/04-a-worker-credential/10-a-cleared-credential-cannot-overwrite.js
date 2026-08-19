'use strict'

// a cleared credential cannot overwrite a working one
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
// There is no signed-out error before that line and nothing else after it. A
// transient failure on a guest had been made permanent on the host.
//
// THE ASSUMPTION THAT DID IT was that DIFFERENT means NEWER. It usually does —
// the CLI rotates the refresh token as a worker runs, and reading the file back
// is the only way that rotation comes home, which is why the read-before-delete
// path exists and is worth keeping. But a machine that cleared its sign-in also
// hands back something different, and telling those apart is the difference
// between keeping up with a rotation and destroying the only copy.
//
// CHECKED WITH TOKENS THIS FILE INVENTS, on a throwaway identity it adds and
// removes. No real credential is read, written or risked — the rule is about the
// SHAPE of what came back, so shapes are all it needs.

const { it, cleanup } = require('../../../tasks/harness')
const guests = require('../../../core/guests')

const WHO = 'drill-cleared-credential'

// What a real one looks like: two tokens, and the description around them.
const WORKING = JSON.stringify({
  claudeAiOauth: {
    accessToken: 'sk-ant-oat01-drill-not-a-real-token',
    refreshToken: 'sk-ant-ort01-drill-not-a-real-token',
    expiresAt: 1,
    scopes: ['user:inference'],
    subscriptionType: 'max'
  }
})

// And what came off that machine: everything except the two things that matter.
const CLEARED = JSON.stringify({
  claudeAiOauth: {
    accessToken: '',
    refreshToken: '',
    scopes: ['user:inference'],
    subscriptionType: 'max',
    rateLimitTier: 'default'
  }
})

it('the rule knows a credential from the shape of one', ({ assert, log }) => {
  // ASKED OF THE RULE DIRECTLY, in milliseconds, because it is a function of one
  // string — and because the interesting inputs are ones that are awkward to
  // arrange on a machine and trivial to write down.
  assert.ok(guests.usable(WORKING), 'a credential with both tokens reads as unusable')
  assert.ok(!guests.usable(CLEARED), 'a credential with both tokens EMPTY reads as usable, which is the bug this is about')

  // A TRUNCATED READ LOOKS EXACTLY LIKE THIS. `cat` over a channel that dropped
  // mid-file hands back half a JSON document, and "keep what we have" is the
  // right answer to that as well.
  assert.ok(!guests.usable('{"claudeAiOauth":{"acce'), 'half a credential reads as usable')
  assert.ok(!guests.usable(''), 'nothing at all reads as a credential')

  // ONE TOKEN IS ENOUGH. A refresh token with no access token is still something
  // this host can sign in with, and refusing it would throw away a recoverable
  // credential to avoid an unrecoverable one.
  assert.ok(guests.usable(JSON.stringify({ claudeAiOauth: { accessToken: '', refreshToken: 'sk-ant-ort01-x' } })),
    'a credential carrying only a refresh token was rejected — that is still a way back in')
  log('two tokens, one token, none, and half a file — only the last two are refused')
})

it('and a machine that clears its sign-in does not take the host copy with it', ({ assert, state, log }) => {
  // THE WHOLE POINT, ON A THROWAWAY. `backFrom` is what runs when a machine
  // gives a credential back, and it is the one place that decides whether what
  // came off the disk replaces what is here.
  if (guests.get(WHO)) guests.forget(WHO)
  guests.add({ name: WHO, token: WORKING, from: 'a drill', note: 'thrown away by the drill that made it' })
  state.made = WHO

  const before = guests.get(WHO).fingerprint
  assert.ok(before, 'the throwaway identity was added without a fingerprint')

  const back = guests.backFrom(WHO, { token: CLEARED })

  assert.ok(!back.rotated, 'an emptied credential was recorded as a refresh — this is the overwrite that happened')
  assert.ok(back.refused, 'nothing was said about refusing it. A credential quietly not stored is as hard to diagnose as one quietly destroyed')
  assert.equal(guests.get(WHO).fingerprint, before,
    'the stored fingerprint moved, so the empty credential was written over the working one')

  // AND WHAT IS STILL HERE IS STILL USABLE, which is the claim in the form that
  // matters. The fingerprint being unchanged says the file was not rewritten;
  // this says the file is still a credential.
  assert.ok(guests.usable(guests.token(WHO)), 'what this host holds after the read-back cannot authenticate anything')

  // AND THE REFUSAL SAYS WHICH SIGN-IN AND WHAT HAPPENED TO IT, because it is
  // the only warning that a machine just tried to destroy one.
  assert.ok(back.refused.includes(WHO), `the refusal does not name the sign-in: ${back.refused}`)
  log(back.refused)
})

it('and a real rotation still comes home', ({ assert, state, log }) => {
  // THE OTHER HALF, AND THE REASON THE READ-BACK EXISTS AT ALL. A guard that
  // refused everything would be safe and useless: the CLI rotates the refresh
  // token as a worker runs, and reading the file back is the only way this host
  // ever sees the newer one. Break that and the token here ages out while a
  // perfectly good one is thrown away with the machine every night.
  assert.needs(state.made, 'the throwaway identity was not made, so there is nothing to rotate')

  const before = guests.get(WHO).fingerprint
  const rotated = JSON.stringify({
    claudeAiOauth: {
      accessToken: 'sk-ant-oat01-drill-rotated',
      refreshToken: 'sk-ant-ort01-drill-rotated',
      expiresAt: 2,
      scopes: ['user:inference'],
      subscriptionType: 'max'
    }
  })

  const back = guests.backFrom(WHO, { token: rotated })
  assert.ok(back.rotated, 'a genuinely refreshed credential was not stored — the newest token this host will ever see was thrown away')
  assert.ok(!back.refused, `a good credential was refused: ${back.refused}`)
  assert.notEqual(guests.get(WHO).fingerprint, before, 'the fingerprint did not move for a credential that really changed')
  assert.ok(guests.get(WHO).refreshed, 'nothing recorded WHEN the token changed, which is the one date that says how old the secret is')
  log(`rotated ${before} to ${guests.get(WHO).fingerprint}, and the change is dated`)
})

cleanup(({ state }) => {
  // A THROWAWAY THROWN AWAY. It holds an invented token and nothing else, and
  // leaving it would put a sign-in in the list that no machine can ever use.
  if (state.made) {
    try { guests.forget(state.made) } catch { /* already gone */ }
    state.made = null
  }
})
