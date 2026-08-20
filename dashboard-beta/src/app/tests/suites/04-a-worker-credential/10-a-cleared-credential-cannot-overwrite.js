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

const { it, cleanup } = require('../../harness')
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

it('and a rotation is dated, while an unchanged token is not', ({ assert, state, log }) => {
  // ---- DETECTING THAT A KEY MOVED, WHICH IS NOT THE SAME AS STORING IT -----
  //
  // The check above proves a real rotation is KEPT. This one proves this host
  // can tell that it happened -- because the two questions have different
  // answers and only one of them is on the card.
  //
  // `added` says how old the RECORD is. `refreshed` says how old the SECRET is,
  // and after a rotation those are months apart. It was being written and then
  // dropped by the projection that lists sign-ins, so every card showed a token
  // rotated an hour ago as untouched since the day it arrived.
  //
  // THE PROPERTY THAT MAKES IT WORTH ANYTHING: it moves when the credential is a
  // DIFFERENT credential and at no other time. Being lent, checked, relabelled,
  // or handed out and taken back unchanged must not touch it -- otherwise it is
  // a "last seen" date wearing the name of something more useful.
  assert.needs(state.made, 'the throwaway identity was not made, so there is nothing to rotate')

  const dated = () => guests.get(WHO).refreshed || null
  const first = dated()
  assert.ok(first, 'the rotation in the check above recorded no date, so nothing can say how old this secret is')

  // THE SAME TOKEN BACK. This is what every ordinary run does -- a worker that
  // did not need to refresh hands back exactly what it was given -- and it must
  // read as "nothing happened", not as a rotation with the same fingerprint.
  const same = guests.token(WHO)
  const back = guests.backFrom(WHO, { token: same })
  assert.ok(!back.rotated, 'handing back the identical token was recorded as a rotation')
  assert.equal(dated(), first, 'the date moved for a token that did not change, which makes it a "last seen" stamp rather than a rotation')

  // AND A CLEARED ONE MUST NOT DATE IT EITHER. The guard already refuses to
  // store it; this says the refusal is complete rather than half-done — a
  // refused write that still stamped the date would leave the card claiming the
  // secret is newer than it is.
  const refused = guests.backFrom(WHO, { token: CLEARED })
  assert.ok(refused.refused, 'the cleared credential was not refused, so this check is testing the wrong thing')
  assert.equal(dated(), first, 'a credential that was REFUSED still moved the date, so the card would say the secret is newer than it is')

  log(`dated once at ${String(first).slice(11, 19)}, and unmoved by an identical token and by a refused one`)
})

it('and what this host holds is consistent with what it recorded', ({ assert, log }) => {
  // AGAINST THE REAL RECORD, because the checks above are about invented tokens
  // and this is the one that would notice detection quietly not working. It
  // reads shapes and dates, never values.
  //
  // WHAT IT WOULD CATCH: a sign-in whose stored fingerprint no longer matches
  // its stored token means something wrote one without the other -- which is the
  // shape of the bug that destroyed a credential here, seen from the other side.
  const all = guests.all()
  assert.ok(all.length, 'this host holds no sign-ins, so there is nothing to check')

  let everRotated = 0
  const broken = []
  for (const g of all) {
    if (!g.has) continue

    // THE FINGERPRINT IS OF THE TOKEN THAT IS THERE. Cheap, and it is the one
    // relationship every path through this file can break.
    const text = guests.token(g.name)
    assert.equal(guests.fingerprint(text), g.fingerprint,
      `"${g.name}" is recorded with fingerprint ${g.fingerprint} and its sealed token hashes to something else — the record and the secret were written apart`)

    // ---- AN UNUSABLE TOKEN MUST BE MARKED AS ONE ------------------------
    //
    // NOT "every token is usable", which is the check this started as and which
    // failed on the sign-in the bug already destroyed. `runner2` holds 280 bytes
    // of empty with a rotation date on it, from the morning before the guard
    // existed, and it is KEPT on purpose as a fixture. A check that fails for
    // ever on a known casualty is one somebody learns to ignore.
    //
    // The invariant worth having is not that nothing is broken -- something is,
    // and deliberately -- it is that nothing broken is still on offer. A sign-in
    // this host cannot authenticate with must be paused, because paused is what
    // keeps the queue from spending a machine on it.
    if (!guests.usable(text)) {
      assert.ok(guests.paused(g),
        `"${g.name}" holds a credential with no tokens in it and is NOT paused, so the queue would hand it to a machine. Either something wrote an unusable token where the guard should have refused it, or a failure was never recorded`)
      broken.push(g.name)
    }

    if (g.refreshed) {
      everRotated++
      assert.ok(String(g.refreshed) >= String(g.added),
        `"${g.name}" was refreshed (${g.refreshed}) before it was added (${g.added})`)
    }
  }

  log(`${all.length} sign-in(s), ${everRotated} with a rotation recorded, every fingerprint matching the token it names${
    broken.length ? `; ${broken.join(', ')} cannot authenticate and ${broken.length === 1 ? 'is' : 'are'} paused, so nothing will be spent on ${broken.length === 1 ? 'it' : 'them'}` : ''}`)
})

it('and a sign-in that failed is never CHOSEN, however many are kept', ({ assert, log }) => {
  // THE FLAG DOING ITS JOB, ASKED PERMANENTLY. The drill next door walks this on
  // a host that has no working sign-in at all, so it goes quiet the moment one
  // is added -- and a dead key is worth KEEPING as a fixture: it is the only way
  // to exercise what happens to work that cannot be given an identity, without
  // breaking a working credential to arrange it.
  //
  // So the interesting arrangement is not "everything is paused". It is a host
  // holding a dead one and a good one at once, which is the ordinary state after
  // somebody replaces a key and keeps the old one, and where being chosen by
  // accident would actually cost a run.
  //
  // ASKED OF A LIST THIS FILE WRITES DOWN. Adding real sign-ins to find out how
  // they are treated means a throwaway with an invented token sitting in the
  // list, and the queue picks one up fifteen seconds later.
  const failed = at => ({ ready: false, on: 'a-machine', at: at || '2026-01-01T00:00:00.000Z' })
  const rows = [
    { name: 'good', role: 'worker', has: true, holder: null, lastCheck: null },
    { name: 'dead', role: 'worker', has: true, holder: null, lastCheck: failed() },
    { name: 'out', role: 'worker', has: true, holder: 'someone-else', lastCheck: null },
    { name: 'gone', role: 'worker', has: false, holder: null, lastCheck: null },
    { name: 'a-judge', role: 'judge', has: true, holder: null, lastCheck: null }
  ]

  const picked = guests.choosable(rows, 'worker').map(g => g.name)
  assert.equal(picked.join(','), 'good',
    `choosing a worker sign-in offered [${picked.join(', ')}] — it must offer the one that has not failed, is not out on another machine, and still has a token`)

  // AND THE ORDER OF THE LIST MUST NOT DECIDE IT. A dead one first was how one
  // could starve a host that had a working sign-in all along: picked because it
  // was first, failed minutes later, and picked again next time.
  const backwards = guests.choosable([...rows].reverse(), 'worker').map(g => g.name)
  assert.equal(backwards.join(','), 'good', `reversing the list changed which sign-in is chosen: [${backwards.join(', ')}]`)

  // A MACHINE IS NOT REFUSED THE ONE IT IS ALREADY HOLDING, which is what the
  // second argument is for -- otherwise handing a machine its own credential
  // again reads as "every sign-in is out".
  const its = guests.choosable(rows, 'worker', 'someone-else').map(g => g.name)
  assert.ok(its.includes('out'), `a machine was refused the sign-in it is already holding: [${its.join(', ')}]`)

  // AND NOTHING AT ALL WHEN THE ONLY ONE OF THAT ROLE HAS FAILED, which is the
  // state this host is in and the reason work waits rather than being given a
  // credential known not to work.
  const onlyDead = guests.choosable([{ name: 'dead', role: 'worker', has: true, holder: null, lastCheck: failed() }], 'worker')
  assert.ok(!onlyDead.length, 'a sign-in that has already failed was offered as the only candidate')

  log('a failed sign-in is never chosen, whatever order it is in and however many others are kept')
})

cleanup(({ state }) => {
  // A THROWAWAY THROWN AWAY. It holds an invented token and nothing else, and
  // leaving it would put a sign-in in the list that no machine can ever use.
  if (state.made) {
    try { guests.forget(state.made) } catch { /* already gone */ }
    state.made = null
  }
})
