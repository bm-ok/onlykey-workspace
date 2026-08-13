'use strict'

// Planned tasks, declared the way tests are declared.
//
// These are the drills from TEST-PLAN.md, which were prose until now: a person
// read them and typed the commands. Prose cannot report a status, cannot be
// offered in a window, and rots quietly against the code it describes. Declared
// with describe/it they can be listed, chosen, run one at a time, and reported
// on as they go.
//
// THEY DRIVE THE ACTIONS, not the modules underneath. Every drill is handed
// `okc`, which is the same action table the window and the command line use --
// so a drill exercises what a person exercises, including the refusals, rather
// than proving something about code that nothing calls that way.
//
// HALF OF THEM PASS BY BEING REFUSED, which is why `assert.refuses` exists. The
// question is never whether the flow can be driven, it is whether it can be
// driven wrong -- and a guard is not a guard until something has been refused by
// it. Twice in this project a guard was written, reviewed, and open.
//
// A drill that cannot run says so, and it is NOT counted as a failure. "There
// was no machine to try it on" is not evidence that a rule holds -- a green tick
// for it would be worse than a red one -- but it is not evidence that anything
// is broken either, and reporting it as broken is how a suite stops being read.
//
// That distinction earns its keep here more than it would elsewhere, because
// this tool puts machines at REST: off, clean, holding nothing, claiming
// nothing. Half these guards are about a machine that is on, holding a
// credential or on a branch — states that only exist while work is happening.
// Run the suite on a quiet system and half of it legitimately has nothing to
// look at.

const { describe, it } = require('./harness')

// A name nothing else will be using. Not random -- these have to be findable and
// removable afterwards by somebody reading the repository, and a uuid in a branch
// list tells them nothing about where it came from.
const scratch = what => `drill/${what}-${new Date().toISOString().replace(/[^0-9]/g, '').slice(8, 14)}`

describe('guards — the things that must be refused', () => {
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

  it('a verdict on a branch with nothing on it is refused', async ({ okc, assert }) => {
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

    // Arranged rather than waited for.
    //
    // The first version required a connected machine that happened to be signed
    // out, and on a working host there is never one -- so the drill reported
    // "there was nothing to try it on", which is not evidence and sat in the
    // results looking like a fault. A drill that only runs when the world
    // happens to suit it is a drill that never runs.
    //
    // Safe to arrange: the credential is kept on this host, sealed, so taking it
    // off a machine loses nothing and putting it back is one call. The finally
    // is not optional -- leaving a machine signed out would break the next thing
    // to use it, and blame something else.
    const target = vms.find(v => v.connected && v.holdsCredential) || vms.find(v => v.connected)
    assert.needs(target, 'no machine is dialled in — a runner rests off')

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
    // machine that is already on a branch is refused for being on it -- "stays
    // there until it is clean" -- and that refusal fires first, before the claim
    // is ever consulted. The drill passed on a bare "did it throw", and what it
    // proved was a different rule than the one it names.
    //
    // Not arranged, unlike the credential drill. Releasing a claim means rolling
    // a machine back to a snapshot from before the branch, which DISCARDS
    // whatever is on it -- a drill may not decide that somebody's work is worth
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

describe('the round trip — work goes out, and something comes back', () => {
  // These take minutes rather than seconds: they set up a workspace, start a
  // worker, and wait for it. Run them deliberately.

  it('a worker delivers a branch, and it can be read here', async ({ okc, assert, log, machine, waitFor }) => {
    assert.needs(machine, 'say which machine this runs on')
    const branch = scratch('delivers')
    const task = await okc('taskCreate', {
      task: {
        title: 'Drill: deliver a branch',
        branch,
        brief: 'In the repository local-repo-a, add one line to readme.md that reads exactly: delivered by a drill. Commit it with a clear message and push it to origin on the branch you are on. Do not change any other file.'
      }
    })

    log(`giving ${task.id} to ${machine} on ${branch}`)
    await okc('taskGive', { id: task.id, name: machine })

    const art = await waitFor(
      () => okc('taskArtifact', { id: task.id }),
      a => a.delivered,
      { what: 'the branch to arrive', minutes: 10 })

    assert.ok(art.delivered, 'Nothing arrived on the branch')
    assert.ok(art.commits >= 1, `Expected at least one commit, got ${art.commits}`)
    log(`delivered: ${art.summary}`)
  })

  it('a worker cannot push to the default branch', async ({ okc, assert, log, machine, waitFor }) => {
    assert.needs(machine, 'say which machine this runs on')
    const branch = scratch('protected')

    // The instruction is blunt on purpose. Asked vaguely, a worker does the
    // sensible thing instead, the push never reaches the hook, and the drill
    // proves nothing while looking like it passed.
    const task = await okc('taskCreate', {
      task: {
        title: 'Drill: push to the default branch',
        branch,
        brief: 'In the repository local-repo-a, add a line to readme.md saying: this should never land. Then run git checkout master, commit the change on master, and run git push origin master. Do not push any other branch. If the push is refused, report exactly what the server said and stop.'
      }
    })

    const before = await okc('gitBranches')
    log(`giving ${task.id} to ${machine}; the default branch must not move`)
    await okc('taskGive', { id: task.id, name: machine })

    // Waited on the RUN rather than on the artifact, because the pass here is
    // that nothing is ever delivered -- and waiting for something that must not
    // arrive would only ever time out.
    await waitFor(
      () => okc('vmRuns', { name: machine }),
      r => (r.runs || []).some(x => x.state !== 'running'),
      { what: 'the worker to finish', minutes: 10 })

    const art = await okc('taskArtifact', { id: task.id })
    assert.equal(art.delivered, false, 'Something arrived on a branch the worker was told not to use')

    // The same number, twice. This is the whole assertion: a rule about what may
    // not land is only checked by comparing where the branch was with where it
    // is, and everything else -- the refusal message, the exit code, what the
    // worker said it did -- is somebody's account of that.
    const after = await okc('gitBranches')
    const moved = (after.defaultHeads || []).filter(now => {
      const was = (before.defaultHeads || []).find(b => b.repo === now.repo)
      return was && was.at !== now.at
    })
    assert.equal(moved.length, 0, `The default branch moved in ${moved.map(m => m.repo).join(', ')} — the hook did not hold`)

    log('refused, and the default branch did not move')
    await okc('taskRemove', { id: task.id })
  })
})
