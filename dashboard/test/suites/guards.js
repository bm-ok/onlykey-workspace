'use strict'

// The guards, brought back from tasks/planned.js.
//
// They were deleted on 14 August with the rest of that file, and the reasons
// were good: ten drills sat in one list beside jobs somebody had written, all
// approved and one click from running against whatever workspace was open — and
// two of them create tasks, give them to machines and wait ten minutes. A drill
// that is never run is not a safety net, it is a loaded thing in a drawer.
//
// WHAT WAS THROWN OUT WITH THEM WAS THE GOOD PART. These nine are the refusals,
// and they are the half of this project that a machine should be checking: a
// capability that stops working is noticed within the hour, and a guard that
// stops guarding is noticed when it costs something. Twice in this project a
// guard was written, reviewed, and open — the snapshot refusal whose flag was
// never set, and the same refusal still wide open along its second path. Both
// read correctly. Both were only true once something had been refused by them.
//
// The two ROUND TRIPS are deliberately not here. They create a task, give it to
// a machine and wait ten minutes for a worker, which is the part that made the
// old file dangerous to have one click away. They stay as prose in TEST-PLAN.md,
// where a person decides to run them.
//
// The comments are the originals wherever the reasoning still holds. That was
// the thing worth keeping: an assertion says what runs, and cannot say why it is
// worth running.

const { describe, it } = require('../../tasks/harness')

// A name nothing else will be using. Not random — these have to be findable and
// removable afterwards by somebody reading the repository, and a uuid in a branch
// list tells them nothing about where it came from.
const scratch = what => `drill/${what}-${new Date().toISOString().replace(/[^0-9]/g, '').slice(8, 14)}`

describe('guards — a task cannot be written wrong', () => {
  it('a task with nowhere to deliver is refused', async ({ okc, assert }) => {
    await assert.refuses(
      () => okc('taskCreate', { task: { title: 'no branch', brief: 'anything' } }),
      'branch',
      'A task with no branch has no artifact and could never be judged')
  })

  it('a contract that is not there is refused', async ({ okc, assert }) => {
    await assert.refuses(
      () => okc('taskCreate', { task: { title: 'bad contract', brief: 'anything', branch: scratch('contract'), contract: 'C:/nothing/here.md' } }),
      'no contract at',
      'A contract that silently fails to load leaves a worker with no rules while everything reports success')
  })
})

describe('guards — a verdict is about something', () => {
  it('a verdict on a branch with nothing on it is refused', async ({ okc, assert }) => {
    // The one drill here that writes anything, and it removes it again in a
    // `finally`. It has to: the refusal under test is about a task whose branch
    // is empty, and there is no way to have one without making one.
    const branch = scratch('empty')
    const task = await okc('taskCreate', { task: { title: 'nothing delivered', brief: 'anything', branch } })
    try {
      await assert.refuses(
        () => okc('taskJudge', { id: task.id, verdict: 'accept', note: 'should not be possible' }),
        'nothing to judge',
        'A judgement of nothing is indistinguishable afterwards from a judgement of something')
    } finally {
      await okc('taskRemove', { id: task.id })
    }
  })

  it('a rejection with no reason is refused', async ({ okc, assert }) => {
    // Checked on a delivered task if there is one, because the empty-branch
    // refusal above would otherwise be the thing that fires and this would pass
    // for the wrong reason.
    const { tasks } = await okc('tasks')
    const delivered = tasks.find(t => t.delivered)
    assert.needs(delivered, 'no task has anything on its branch — run the round trip first')
    await assert.refuses(
      () => okc('taskJudge', { id: delivered.id, verdict: 'reject', note: '' }),
      'why',
      'A rejection with no reason is sent to a worker that cannot ask what was wrong')
  })
})

describe('guards — a machine is not asked to lose work', () => {
  it('a machine holding a credential cannot be snapshotted', async ({ okc, assert }) => {
    const { vms } = await okc('vmList')
    const holding = vms.find(v => v.holdsCredential)
    assert.needs(holding, 'no machine is holding a credential — the queue takes them back when work ends')
    await assert.refuses(
      () => okc('vmBaseSnapshot', { name: holding.name, title: 'drill-should-refuse' }),
      'holding a worker credential',
      'A snapshot keeps a copy of the token for as long as the snapshot exists')
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
      await assert.refuses(
        () => okc('vmDispatch', { name: target.name, task: 'anything at all' }),
        'signed out',
        'Otherwise it fails as an api error minutes later, after a workspace has been laid out')
    } finally {
      if (held) await okc('vmCredentialsPut', { name: target.name })
    }
  })
})

describe('guards — one machine per branch, and it stays there', () => {
  it('a machine is not moved off the branch it is on', async ({ okc, assert }) => {
    const { vms } = await okc('vmList')
    const on = vms.find(v => v.connected && v.branch)
    assert.needs(on, 'no connected machine is on a branch — one is only on a branch while it is working')
    await assert.refuses(
      () => okc('vmWorkspace', { name: on.name, branch: scratch('elsewhere') }),
      'stays there until it is clean',
      'Switching is how half-finished work stops being anywhere')
  })

  it('a branch already claimed is not handed to a second machine', async ({ okc, assert }) => {
    const { vms } = await okc('vmList')
    const claimed = vms.find(v => v.branch)

    // The second machine must be on NO branch of its own, and that is the whole
    // subtlety here rather than a detail.
    //
    // Two rules can refuse this, and only one of them is the rule under test. A
    // machine that is already on a branch is refused for being on it — "stays
    // there until it is clean" — and that refusal fires first, before the claim
    // is ever consulted. The drill passed on a bare "did it throw", and what it
    // proved was a different rule than the one it names.
    //
    // Not arranged, unlike the credential drill. Releasing a claim means rolling
    // a machine back to a snapshot from before the branch, which DISCARDS
    // whatever is on it — a drill may not decide that somebody's work is worth
    // less than a green tick.
    const free = vms.find(v => v.connected && !v.branch && v.name !== (claimed || {}).name)
    assert.needs(claimed, 'no machine claims a branch — a machine is rolled back when its work ends')
    assert.needs(free, 'no second machine is connected and free of a branch. This will not make one: the only way off a branch is a rollback, and that discards whatever is on it')

    await assert.refuses(
      () => okc('vmWorkspace', { name: free.name, branch: claimed.branch }),
      'already being worked on',
      'Two machines on one branch race for the same ref and the loser\'s commits strand')
  })
})
