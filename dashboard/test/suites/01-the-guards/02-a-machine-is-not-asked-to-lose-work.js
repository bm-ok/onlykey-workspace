'use strict'

// guards — a machine is not asked to lose work
//
// A test is a series: the checks below run in the order they are written.
// See test/suites/index.js for what the folder, the file and the checks each
// mean, and tasks/harness.js for state, cleanup and what a failed check does
// to the ones after it.

const { it } = require('../../../tasks/harness')

// WHAT IT SAW LAST TIME is recorded at the bottom of this file.

it('a machine holding a credential cannot be snapshotted', async ({ okc, assert, log }) => {
  const { vms } = await okc('vmList')
  const holding = vms.find(v => v.holdsCredential)
  assert.needs(holding, 'no machine is holding a credential — the queue takes them back when work ends')
  const refusal = await assert.refuses(
    () => okc('vmBaseSnapshot', { name: holding.name, title: 'drill-should-refuse' }),
    'holding a worker credential',
    'A snapshot keeps a copy of the token for as long as the snapshot exists')
  log(`asked of ${holding.name}, which is holding one — refused, and this is what it said:\n${refusal.message}`)
})

it('a signed-out machine is not given work', async ({ okc, assert, log }) => {
  const { vms } = await okc('vmList')

  // ARRANGED RATHER THAN WAITED FOR.
  //
  // The first version required a connected machine that happened to be signed
  // out, and on a working host there is never one — so the drill reported
  // "there was nothing to try it on", which is not evidence and sat in the
  // results looking like a fault. A drill that only runs when the world
  // happens to suit it is a drill that never runs.
  //
  // Safe to arrange: the credential is kept on this host, sealed, so taking it
  // off a machine loses nothing and putting it back is one call. The finally
  // is not optional — leaving a machine signed out would break the next thing
  // to use it, and blame something else.
  //
  // NEVER a machine the queue is driving. The only time there is a connected
  // machine to try this on is while one is WORKING, so the obvious choice is
  // the worst one: pulling a credential out from under a live worker to prove
  // a point about refusals is a drill sabotaging the thing it exists to
  // protect, and the failure would surface minutes later as the worker's
  // rather than as this one's.
  const { inFlight = [] } = await okc('queueState')
  const busy = new Set(inFlight.map(f => f.machine))
  const idle = vms.filter(v => v.connected && !busy.has(v.name))
  const target = idle.find(v => v.holdsCredential) || idle[0]
  assert.needs(target, busy.size
    ? 'every connected machine is busy with queued work, and this must not take a credential from one that is working'
    : 'no machine is dialled in — a runner rests off')

  const held = !!(target.holdsCredential)
  if (held) {
    log(`taking ${target.name}'s credential for the duration, and putting it back afterwards`)
    await okc('vmCredentialsForget', { name: target.name })
  }
  try {
    const refusal = await assert.refuses(
      () => okc('vmDispatch', { name: target.name, task: 'anything at all' }),
      'signed out',
      'Otherwise it fails as an api error minutes later, after a workspace has been laid out')
    log(`refused, and this is what it said:\n${refusal.message}`)
  } finally {
    if (held) await okc('vmCredentialsPut', { name: target.name })
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
