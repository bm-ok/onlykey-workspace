'use strict'

// more than one sign-in — a list rather than a file, and who may spend which
//
// The check beside this one asks whether A credential works. This one asks about
// the SHAPE the credentials are kept in, which is what changed: there was one
// file at credentials/claude.json, lent to whoever was working, and there is a
// list of named identities now — see core/guests.js.
//
// WHY THAT IS A CHECK AND NOT A TIDY-UP. The Claude CLI refreshes the token as a
// worker runs, so two machines holding one sign-in are two workers rotating the
// same credential underneath each other. One per machine is the only shape where
// what comes back off a machine can be kept, and keeping it is what was broken:
// the run ended with `rm -f` and this host went on handing out a token a refresh
// behind. That is the failure on record — a refresh half reported good until
// September while the worker answered "OAuth session expired".
//
// NEEDS NO MACHINE. Every check here is about this host's own list, so it costs
// seconds and can be run while machines are busy. The half that needs a real
// worker is a draft at the bottom, because it needs a run to prove.

const { it, draft, cleanup, requires } = require('../../../tasks/harness')

// The list is this host's own, but the suite it belongs to hands credentials to
// machines, so it inherits that standing rather than claiming a lighter one.
requires('the machines are built')

// Somewhere to put a supervisor that only exists for the length of a check. The
// token is nonsense on purpose: nothing here signs in with it, and a check that
// needed a real one could not run on a host that has none.
const A_SUPERVISOR = 'okc-test-supervisor'

it('the sign-ins are a list, and every one of them has a name', async ({ okc, assert, log }) => {
  const held = await okc('guests')
  const all = held.guests || []
  assert.ok(Array.isArray(all), 'the list of Claude identities is not a list')
  assert.asksYou(all.length > 0,
    'this host holds no Claude identity at all. Add one on Virtual machines -> Claude guest — a name and the token it signs in with — and run this again.')

  for (const g of all) {
    assert.ok(g.name, 'an identity in the list has no name, which is also its filename')
    // THREE NOW, NOT TWO, AND ONE OF THEM WAS RENAMED. A judge was added because
    // "who said this is good" and "who wrote it" must not be the same account —
    // that is the one distinction a judge exists to provide. And `guest` was the
    // old name for a worker: it is still what old records say, is read as
    // `worker`, and was retired because the machine half of this app already
    // uses "guest" for the virtual machine itself.
    //
    // The old name is accepted here for the same reason the code accepts it: a
    // record written before the rename is not a record that has gone wrong.
    assert.ok(['worker', 'judge', 'supervisor', 'guest'].includes(g.role),
      `"${g.name}" has a role of "${g.role}", and they are worker, judge and supervisor — or "guest", which is what a worker was called before the rename`)
  }
  log(`${all.length} identity(ies): ${all.map(g => `${g.name} (${g.role})`).join(', ')}`)
})

it('and nothing that reports one hands back its token', async ({ okc, assert, log }) => {
  // THE RULE THIS WHOLE SURFACE IS BUILT TO: a model may know something was done
  // in the Keys tab without knowing what. So this reads the answers the way
  // anything else would — as JSON — and looks for the shape of a credential in
  // them rather than trusting that no field is named like one.
  //
  // Asked of BOTH answers, because two things report on credentials and only one
  // of them was written with this rule in mind at the time.
  const said = JSON.stringify([await okc('guests'), await okc('credentialsHeld')])

  // What is actually in a Claude credential file. Names, not values: matching
  // these means a value came through, and this test file is itself read by
  // test/claims.js, so the patterns stay short of quoting a real token.
  for (const tell of ['access_token', 'refreshToken', 'refresh_token', 'sk-ant', 'oauth_token']) {
    assert.ok(!said.includes(tell),
      `an answer about credentials contains "${tell}", which means a token came back with it. Nothing that reports on a credential may return its value — a window that can show one is a window that ends up in a screenshot.`)
  }

  // And the thing it hands back INSTEAD, which is what makes the rule liveable:
  // sixteen hex characters of sha256 say "the same one as before" and nothing
  // else, which is the comparison a round trip needs.
  const all = (await okc('guests')).guests || []
  for (const g of all.filter(x => x.has)) {
    assert.ok(/^[0-9a-f]{16}$/.test(String(g.fingerprint || '')),
      `"${g.name}" has a token file but no fingerprint, so nothing can tell whether it changed while it was out`)
  }
  log('the answers carry names, dates, holders and fingerprints, and no values')
})

it('and a supervisor is refused when a machine asks for it', async ({ okc, assert, log }) => {
  // THE ONE SEPARATION THAT MATTERS IN THE LIST. A guest is lent to a machine; a
  // supervisor is the sign-in this host decides work with. Lending a supervisor
  // would put the identity that supervises workers inside a worker — which is
  // not a tidiness question, and is refused in core/guests.js at the single point
  // that records a machine holding something.
  //
  // Made here rather than assumed, so this check does not need the host to
  // already have a supervisor and does not care which one it is.
  // try/catch and not `.catch()`: an action whose run() is synchronous throws
  // before there is a promise to attach a handler to, so the tidy-up would take
  // the run down with it on a host where there is nothing to tidy.
  try { await okc('guestForget', { name: A_SUPERVISOR }) } catch { /* left over from a run that was stopped */ }
  await okc('guestAdd', { name: A_SUPERVISOR, token: 'not-a-real-token-for-a-check', role: 'supervisor', note: 'made by a drill; thrown away at the end of it' })

  const mine = ((await okc('guests', { role: 'supervisor' })).guests || []).find(g => g.name === A_SUPERVISOR)
  assert.ok(mine, 'a supervisor was added and the list does not have it')
  assert.ok(mine.role === 'supervisor', 'it was added as a supervisor and came back as something else')

  // ASKED ON THE MACHINE PATH, not on the core function. This is the refusal a
  // person or the queue would run into, and a check that called the module
  // directly would pass while the action around it did something else.
  //
  // AND ASKED WITH A MACHINE THAT DOES NOT EXIST, deliberately. It has to be
  // refused for being a supervisor rather than for anything about the machine —
  // which is what this found the first time it ran: the role was checked in
  // core/guests.js at the point that RECORDS the lending, which happens after the
  // credential has already been written onto the machine. Refused, and handed
  // over anyway. The action refuses first now, and this is the check that says so.
  //
  // MATCHED ON THE ROLE HALF OF THE SENTENCE rather than on the whole of it: the
  // words are "is a supervisor sign-in and <machine> is a runner", and what this
  // check is about is which of the two reasons it was refused FOR.
  await assert.refuses(
    () => okc('guestLend', { name: A_SUPERVISOR, machine: 'okc-no-such-machine' }),
    'is a supervisor sign-in',
    'a supervisor was lent to a machine, which puts the sign-in that decides what workers do inside a worker')

  log('a supervisor cannot be lent to a machine, and the refusal says why')
})

it('and one that is out on a machine cannot be thrown away', async ({ okc, assert, log }) => {
  // THE OTHER HALF OF THE SAME RECORD. "Which sign-in is on that machine" has to
  // be answerable while the machine is switched off, because a machine that is
  // off still has a credential on its disk. So the holder is written down here
  // rather than worked out from the machines — and removing a held identity
  // would leave a credential on a machine with nothing on this host knowing it
  // is there.
  const all = (await okc('guests')).guests || []
  const out = all.find(g => g.holder)
  if (!out) {
    log('nothing is lent out at the moment, so there is no held identity to try to remove')
    return
  }
  await assert.refuses(
    () => okc('guestForget', { name: out.name }),
    'Take it back first',
    `"${out.name}" is on ${out.holder} and was thrown away anyway, which leaves a credential on a machine that nothing here knows about`)
  log(`"${out.name}" is on ${out.holder}, and removing it is refused until it is taken back`)
})

cleanup(async ({ okc }) => {
  // WHAT THE CLEANUP LEAVES IS WHAT THE NEXT RUN FINDS. A supervisor made by a
  // drill must not survive it: the next run would refuse to add it, and a person
  // reading the pane would find an identity nobody put there.
  try { await okc('guestForget', { name: A_SUPERVISOR }) } catch { /* the check may not have got that far */ }
})

// ---- what still needs a real worker to prove -------------------------------

draft('and what comes back off a machine is what the worker refreshed',
  'THE QUESTION THIS EXISTED TO SETTLE IS ANSWERED, and the answer is on the record rather than in this note. Rotation is REAL: "supervisor1" was taken off a machine on 19 August and came back with a different fingerprint, which is a worker refreshing a token mid-run and the host catching it. ' +
  'AND SHARING IS SURVIVABLE, which this note guessed the other way. Two sign-ins of ONE Claude account ran at the same time on two machines that afternoon and both were still good afterwards, so one-per-machine is about throughput and tidiness rather than about credentials rotating each other away. ' +
  'WHAT IS BUILT SINCE: `refreshed` is recorded when and only when the fingerprint differs, it is on the card beside `added` so the age of the SECRET is readable next to the age of the RECORD, and a credential that comes back with no tokens in it cannot overwrite a working one — that path destroyed a sign-in here before it was guarded. See "a cleared credential cannot overwrite a working one" in this suite, which checks all of that in milliseconds, plus this host\'s own records for consistency. ' +
  'WHAT IS STILL A DRAFT is only the end-to-end half: lend a guest, give the machine real work that uses Claude, take the guest back, and assert the fingerprint this host holds is the one the machine finished with — compared by fingerprint and never by value. It costs a worker run, which is why it is here rather than beside the arithmetic.')

// WRITTEN NOW, next door: see 06-two-tasks-at-once-each-as-itself.js. Two tasks
// are queued and nothing touches them again; the queue picks the machines, lends
// each one an identity, runs both at once, and gives both back. The draft was
// right about the hard part -- dispatch is not serialised but BOOTING is, one
// kernel at a time, so the job has to be slow enough that the two runs overlap
// in the middle.

draft('and a machine that can be given no identity waits rather than borrowing one',
  'HALF OF THIS IS DONE, AND THE HALF THAT IS LEFT IS THE ONE ABOUT SHARING. The queue asks whether there is a sign-in to give BEFORE it claims a machine now, so work that can be given no identity waits instead of booting one to find out — checked by "a dead key costs no machine" in this suite, which walks it against a genuinely paused credential. ' +
  'WHAT IS STILL A DRAFT is the case this was first written for: not a sign-in that is DEAD, but every sign-in already OUT on other machines. Both end in a wait; only one of them gets better on its own, and nothing has yet watched a task pick itself up when a guest comes back. ' +
  'THE CHECK: with one guest and two machines, dispatch two tasks — the second waits, and RUNS when the first gives its guest back, rather than failing or waiting for ever. The second half is the claim: a wait that never ends is a failure that has not said so. ' +
  'TO SETTLE FIRST: whether a guest is PINNED to a machine or drawn from a pool per job. Pinned wastes one per idle machine; pooled is the shape the machines themselves already have.')
