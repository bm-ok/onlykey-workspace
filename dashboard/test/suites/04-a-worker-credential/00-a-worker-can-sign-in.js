'use strict'

// a worker credential — held here, and a machine can really use it
//
// See the README beside this file for why this is here rather than beside the
// GitHub token, and why it never reads a value.

const { it, draft, requires } = require('../../../tasks/harness')
const { aMachine, roleFor } = require('../../helpers')
const guests = require('../../../core/guests')

// It hands the credential to a machine to find out whether it works, so it
// stands on machines existing and coming up. That is the whole reason it sits
// after them rather than with the other keys.
requires('the machines are built')

it('this host holds a worker credential', async ({ okc, assert, state, log }) => {
  const held = await okc('credentialsHeld')
  assert.asksYou(held && held.held,
    'this host holds no worker credential, so no task can be given to a machine. Sign a worker in — the Keys tab starts it on a clean machine and keeps the credential here — and run this again.')
  state.held = held

  // WHAT IT SAYS ABOUT IT, AND WHAT IT DOES NOT. A plan, a scope count, where it
  // came from and when. Never the credential: the rule for this app is that a
  // model may know something was done in the Keys tab without knowing what, and
  // a check that printed a value would put it in the log, the result and the
  // transcript at once.
  const life = held.life || {}
  log(`a worker credential is held, taken from ${held.from || 'somewhere'} on ${String(held.taken || '').slice(0, 10)}`)
  if (life.plan) log(`plan "${life.plan}", ${life.scopes} scope(s)`)
}, { gate: true })

it('and it has not expired past refreshing', async ({ assert, state, log }) => {
  // TWO CLOCKS, AND ONLY ONE OF THEM MATTERS HERE. The access half expires in
  // hours and is refreshed when it is used — an expired one is the ordinary
  // resting state and says nothing is wrong. The refresh half is the one that
  // ends the credential: past that, no amount of running will fix it and
  // somebody has to sign a worker in again.
  const life = state.held.life || {}
  if (!life.readable) {
    log('the credential is sealed and its life cannot be read from here — whether it works is the next check')
    return
  }
  assert.asksYou(!(life.refresh && life.refresh.expired),
    'the worker credential here has expired past refreshing, so no machine can authenticate with it. Sign a worker in again on the Keys tab, and run this again.')

  const left = life.refresh && life.refresh.at ? String(life.refresh.at).slice(0, 10) : 'unknown'
  log(`its access half ${life.access && life.access.expired ? 'has expired, which is ordinary — it is refreshed when it is used' : 'is current'}`)
  log(`its refresh half runs to ${left}, which is the date that ends it`)
})

it('and a machine can really sign in with it', async ({ okc, assert, state, log }) => {
  // THE ONLY CHECK THAT SETTLES IT. Everything above is this host reading its
  // own files: a credential that is present, unexpired and no longer accepted
  // looks identical from here, and fails at the far end of the flow — after a
  // branch is cut, a machine is up and a job has started.
  //
  // `credentialsTest` borrows a machine, hands it the credential, asks, takes it
  // back and puts the machine away. It is the machine half of this app doing
  // exactly what it does for a real task, which is why this suite waited for
  // machines to exist.
  const free = await aMachine(okc, assert, 'no machine is free to try it on — this hands the credential to a real machine, because holding a file proves nothing about whether a worker is accepted')

  // WHICH SIGN-IN, because a machine may be both a worker and a judge and the
  // role comes from the WORK. This suite is about a worker's credential, so it
  // asks for the worker's — and on a machine that is only one thing, that is
  // what it gets anyway.
  const tried = await okc('credentialsTest', { name: free.name, role: roleFor(free, 'worker') })
  assert.ok(tried.ready === true,
    `${tried.on || free.name} was handed the stored credential and the worker did not authenticate: ${tried.note || 'no reason given'}. It is present and no longer accepted, which is the case that fails at the far end of a real job.`)
  log(`${tried.on} was handed the credential and the worker authenticated`)
  log('and it was taken back — a machine is never left holding one')
}, { minutes: 12 })

// TWO DRAFTS, NOT ONE, and the difference is worth the second title.
//
// The first was written as "no two machines hold one at the same time", which
// reads as a decision to LOCK IT DOWN — one credential, guarded — and says
// nothing about the thing actually wanted. Locking it down is a fine place to
// start and is a real check; it is not the feature, and a to-do list where the
// constraint has a line and the capability does not is a list that quietly
// argues for never building it.
// BOTH WRITTEN NOW — see "two machines two identities" beside this file.
//
// The lock and the feature were two drafts and are one check: two identities
// out on two machines at the same moment, each holding its own, and every way
// of getting one onto both refused.
//
// WHAT THE DRAFT ASKED FOR IS NOT WHAT WAS WRITTEN, deliberately. It said
// dispatch two tasks at once and compare what the machines report — which
// would cost two worker runs and turn on whether the queue happened to overlap
// them. Machines start one at a time here, so a short job can finish before the
// second has booted, and that drill would pass while proving nothing. Asked at
// the credential level it is deterministic.
// ---- what the roadmap wants from this suite -------------------------------
//
// Two of the roadmap's items are claims about what this app does with a
// credential, which makes them checks rather than plans. They are written here
// as drafts so they sit beside the claim they would replace — "a machine can
// really sign in with it" — rather than in a document that describes an order to
// build in.

// WRITTEN NOW — see "nothing travels as cleartext" beside this file. The key
// exchange it asked for is core/handover.js: the machine makes a pair and
// publishes the public half, this host seals to it, and what crosses is
// ciphertext. What made the second half checkable without a person at a login
// page was measuring on the MACHINE — the bytes that landed on its disk, hashed
// there — rather than asking whether a made-up token authenticates.
//
// STILL OPEN, AND HONESTLY THE SMALLER HALF: the credential coming BACK.
// vmCredentialsGrab and guestBack read it with `cat`, so it arrives in a
// command's OUTPUT rather than in its arguments — not in `ps` and not in a
// history, but not sealed either. The same two files do the mirror of this when
// it is done.

draft('and signing a worker in is a job, not a sequence written into this app',
  'credentialsBegin and credentialsFinish are guest commands hard-coded in actions/credentials.js and machines/auth.js — written before there was any other way to run a sequence of commands on a machine. There is one now: a job is a script that runs ON a machine, read and approved before it does. ' +
  'WHAT IT WOULD BUY: the flow becomes editable without a release, and the sign-in URL stays on the machine rather than being logged here. ' +
  'THE STICKING POINT, which is why this is a draft and not a task: a credential is NOT an artifact and must not be handed back like one. A job hands files back; this one would have to hand back something the host stores sealed and never shows, which is a hole in the job API rather than a thing to write around. ' +
  'THE CHECK: the sign-in runs as an approved job, the credential arrives sealed on this host, and no URL or token appears in the log.')

// ---- the credential a worker hands back ------------------------------------
//
// THE TOKEN THIS HOST HOLDS IS PROBABLY ALREADY INVALID, and the reason is in
// the code rather than in the account: the Claude CLI refreshes the credential
// on the machine as it works, and `vmCredentialsForget` ends a run with
//
//     rm -f "$HOME/.claude/.credentials.json"
//
// so the refreshed one is deleted and this host goes on handing out the original.
// That is exactly the shape of the failure already on record — credentialsHeld
// reporting the refresh token good until September while the worker answered
// "OAuth session expired and could not be refreshed".
//
// Which is why a credential that rotates has to be taken back rather than thrown
// away, and has to survive the rollback that wipes the disk between tasks.
//
// AND NOT WHY IT HAS TO BE PER MACHINE, which is what this used to say. That
// part was argued from a belief since disproved: that two sign-ins sharing an
// account would rotate each other away. Two of ONE account ran on two machines
// the same afternoon and both were still good afterwards. Lending is pooled --
// `choosable` filters on role, token, not paused and not held elsewhere, and
// never prefers the machine that had it last. `lastGivenTo` is written and never
// consulted; it says where a sign-in went, not where it goes next. Pinning would
// only waste one per idle machine.

// WRITTEN NOW — see "what comes back" beside this file. What it took to make
// it checkable was noticing that the CLI rotating is not the thing to prove:
// what has to be true is that a CHANGE on the machine arrives here, which a
// throwaway identity can demonstrate in seconds without a worker run.
// THE INVARIANT, and it needs no machine and no money: one sign-in is never out
// on two machines at once. Whether lending is pinned or pooled is a policy
// question, settled above and in favour of pooled; this is not policy. Two
// machines holding one identity means two workers authenticating as the same
// account, and the host having no idea which of them refreshed the token it gets
// back — and there is no version of that anybody wants.
//
// A draft asking for pinned credentials stood here and was scrapped rather than
// kept, because a to-do list that carries a design somebody already decided
// against is one that argues for building it every time it is read.
//
// ASKED OF `choosable` WITH ROWS HANDED IN, so the answer does not depend on
// what this host happens to be holding. The same separation the merge rule and
// the revise rule got, for the same reason: a rule only checkable against live
// state is one that gets checked once.
it('one sign-in is never out on two machines at once', async ({ assert, log }) => {
  const rows = [
    { name: 'free', role: 'worker', has: true, holder: null },
    { name: 'onA', role: 'worker', has: true, holder: 'machine-a' },
    { name: 'judgely', role: 'judge', has: true, holder: null },
    { name: 'tokenless', role: 'worker', has: false, holder: null }
  ]
  const names = (role, machine) => guests.choosable(rows, role, machine).map(g => g.name)

  // THE WHOLE POINT: a sign-in already out is not offered to anybody else.
  assert.ok(!names('worker', 'machine-b').includes('onA'),
    '"onA" is out on machine-a and was offered to machine-b as well — two workers would authenticate as one account')

  // AND IT IS STILL ITS OWN. A machine already holding one is not refused it a
  // second time: that is a machine picking up where it left off, not sharing.
  assert.ok(names('worker', 'machine-a').includes('onA'),
    'a machine was refused the sign-in it is already holding')

  // THE ORDINARY CASE, so the filter is not simply refusing everything.
  assert.ok(names('worker', 'machine-b').includes('free'), 'a free worker sign-in was not offered at all')

  // AND THE TWO THAT ARE NOT ABOUT HOLDING: the wrong role, and no token.
  assert.ok(!names('worker', 'machine-b').includes('judgely'), 'a judge sign-in was offered for a worker')
  assert.ok(!names('worker', 'machine-b').includes('tokenless'), 'a sign-in with no token behind it was offered')

  log(`offered to machine-b: ${names('worker', 'machine-b').join(', ') || 'nothing'} — "onA" is out on machine-a and stays there`)
})


draft('and the .claude folder can be thrown away without losing the token',
  'THE GAP TO BRIDGE, and half of it is already built. `machines/job-api.js` archives ~/.claude per task and excludes .credentials.json on purpose — that folder is the worker\'s MEMORY and is kept for a long time, so an unsealed token riding along would be filed for ever. ' +
  'The consequence is that memory and credential are two different things with two different lifetimes, and only one of them has somewhere to live. ' +
  'WHAT IT WOULD MEAN: the token is set up and kept through the same path the memory uses — captured when the run ends, sealed here, per machine — so ~/.claude on the guest becomes disposable. Trash it, restore the memory, hand back the token, and the machine is where it was. ' +
  'THE CHECK: delete ~/.claude on a machine entirely, start its next task, and it both remembers what it was doing and authenticates.')

// WRITTEN NOW — see "one list and who may hold what" beside this file. The tab
// itself moved rather than grew a list: sign-ins live under Virtual machines →
// Claude guest, and credentialsHeld answers about all of them with a holder, a
// fingerprint and a clock each.
