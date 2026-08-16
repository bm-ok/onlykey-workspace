'use strict'

// guards — a machine is not asked to lose work
//
// A test is a series: the checks below run in the order they are written.
// See test/suites/index.js for what the folder, the file and the checks each
// mean, and tasks/harness.js for state, cleanup and what a failed check does
// to the ones after it.

const { it, cleanup, requires } = require('../../../tasks/harness')
const { aMachine } = require('../../helpers')

// It borrows a machine and hands it a credential to ask its questions, so it
// stands on machines existing and on a credential being here.
requires('the machines are built', 'a worker credential')

// WHAT IT SAW LAST TIME is recorded at the bottom of this file.

it('a machine of our own, up and holding a credential', async ({ okc, assert, state, log }) => {
  // ARRANGED, NOT WAITED FOR — which is the change that made this file mean
  // anything.
  //
  // Both checks below need a machine holding a worker credential, and this app
  // is built to make that state RARE: the queue hands one out for the length of
  // a job and takes it straight back. So for the whole life of this file the
  // answer was "no machine is holding a credential", it reported "could not be
  // tried" every time, and the two rules under it had never once been asked.
  //
  // Safe to arrange, and only because of what this app already refuses. The
  // credential is kept sealed on this host, so lending it to a machine loses
  // nothing and taking it back is one call — and the cleanup below does exactly
  // that whatever happens here.
  const free = await aMachine(okc, assert, 'no machine is free to borrow — this needs one of the kit\'s, or any idle machine, to lend a credential to')

  const got = await okc('vmBorrow', { name: free.name, why: 'a drill asking what a machine holding a credential refuses' })
  state.machine = got.name
  await okc('vmAwait', { name: state.machine, for: 'connected', seconds: 600 })

  const put = await okc('vmCredentialsPut', { name: state.machine })
  state.lent = true
  assert.ok(put, `${state.machine} was not given the credential, so the checks below have nothing to ask about`)
  log(`borrowed ${state.machine}, brought it up and lent it the worker credential — it goes back in the cleanup`)
}, { minutes: 12, gate: true })

it('a machine holding a credential cannot be snapshotted', async ({ okc, assert, state, log }) => {
  const { vms } = await okc('vmList')
  const holding = vms.find(v => v.name === state.machine)
  assert.ok(holding && holding.holdsCredential, `${state.machine} was lent the credential and does not report holding one`)
  const refusal = await assert.refuses(
    () => okc('vmBaseSnapshot', { name: holding.name, title: 'drill-should-refuse' }),
    'holding a worker credential',
    'A snapshot keeps a copy of the token for as long as the snapshot exists')
  log(`asked of ${holding.name}, which is holding one — refused, and this is what it said:\n${refusal.message}`)
})

it('and once it is signed out, it is not given work', async ({ okc, assert, state, log }) => {
  // THE SAME MACHINE, SIGNED OUT, which is the other half of the pair and the
  // reason the arranging above is worth doing once rather than twice.
  //
  // NEVER a machine the queue is driving. The only OTHER time there is a
  // connected machine to try this on is while one is working, so the obvious
  // choice would be the worst one: pulling a credential out from under a live
  // worker to prove a point about refusals is a drill sabotaging the thing it
  // exists to protect, and the failure would surface minutes later as the
  // worker's rather than as this one's. This machine is borrowed, so the queue
  // will not touch it.
  await okc('vmCredentialsForget', { name: state.machine })
  state.lent = false
  log(`took ${state.machine}'s credential back — it is signed out now`)

  const refusal = await assert.refuses(
    () => okc('vmDispatch', { name: state.machine, task: 'anything at all' }),
    'signed out',
    'Otherwise it fails as an api error minutes later, after a workspace has been laid out')
  log(`refused, and this is what it said:\n${refusal.message}`)
})

cleanup(async ({ okc, state }) => {
  // THE CREDENTIAL GOES BACK BEFORE THE MACHINE DOES, and neither is optional.
  // A machine left signed out breaks the next thing to use it and blames
  // something else; a machine left borrowed is out of the pool with nobody using
  // it, which is the exact state this app exists to prevent.
  if (state.machine) {
    if (state.lent) await okc('vmCredentialsForget', { name: state.machine }).catch(() => {})
    await okc('vmReturn', { name: state.machine }).catch(() => {})
  }
})

// WHAT IT SAW — 16 August 2026, 14:45, both passed, in flight
//
//   a machine holding a credential cannot be snapshotted
//     asked of runner4, which is holding one — refused, and this is what it said:
//     "runner4" is holding a worker credential, and a snapshot would keep a copy
//     of it for as long as the snapshot exists. Take it back first:
//     vmCredentialsForget --name runner4
//
//   a signed-out machine is not given work
//     refused, and this is what it said:
//     "runner3"'s worker is signed out, so the work would fail the moment it
//     started. Hand it the credential first: vmCredentialsPut --name runner3
//
// AT REST THIS FILE ANSWERS NOTHING, and that is the ordinary result rather than
// a bad run: both checks need a machine that is UP, and the resting state of
// this host — which 03-the-machines/00-a-machine-at-rest exists to assert — is
// that none is. On a host where these ran every time, something would be wrong
// with the host.
//
// So the transcript above is from a run made DELIBERATELY IN FLIGHT: a task was
// queued so the queue would take runner4 and put it to work, a second machine
// was borrowed so there was an idle one to sign out, and the suite was run in
// the twenty-five seconds while runner4 held its credential. Before that these
// two had never once been tried.
//
// BOTH REFUSALS END WITH THE COMMAND THAT UNDOES THEM, which is the thing worth
// having on the record here. Neither is a wall: one says take the credential
// back and then snapshot, the other says hand this machine a credential and then
// dispatch. That is what separates a guard from an obstacle, and no assertion
// above says it.
