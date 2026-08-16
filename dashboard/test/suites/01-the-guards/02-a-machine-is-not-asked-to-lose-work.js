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

// WHAT IT SAW — 16 August 2026, 14:16, neither could be tried
//
//   a machine holding a credential cannot be snapshotted
//     could not be tried: no machine is holding a credential — the queue takes
//     them back when work ends
//
//   a signed-out machine is not given work
//     could not be tried: no machine is dialled in — a runner rests off
//
// AND THAT IS THE ORDINARY RESULT FOR THIS FILE, not a bad run. Both checks need
// a machine that is UP, and the resting state of this host — which
// 03-the-machines/00-a-machine-at-rest exists to assert — is that none is. On a
// host where these two ran every time, something would be wrong with the host.
//
// They are here rather than deleted because the moment they can run is the
// moment they matter: run the suite while the queue has work in flight and both
// have a machine to ask. The same is true of 03-one-machine-per-branch, and the
// refusals in this folder that could NEVER be tried were moved into
// 03-the-machines/01-a-machine-comes-up-and-goes-away, which brings up a machine
// of its own so it can ask.
