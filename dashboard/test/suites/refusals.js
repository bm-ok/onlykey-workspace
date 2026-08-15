'use strict'

// What this app will not do, proved by asking it to.
//
// HALF OF TEST-PLAN.md PASSES BY BEING REFUSED, and that half is the part worth
// having a machine check: a capability that stops working is noticed within the
// hour, and a refusal that stops refusing is noticed when it costs something.
//
// Every test here goes through the ACTIONS TABLE, the same surface a person and
// the command line use, so what is proved is what anybody actually meets. A test
// reaching past it into the modules underneath would prove something about code
// nobody calls.
//
// NOTHING HERE CHANGES ANYTHING. A refusal that works leaves no trace by
// definition, and one that has stopped working is a failing test rather than a
// mess to clean up — which is what makes this suite safe to run on a whim, on a
// live workspace, while somebody is working.

const { describe, it } = require('../../tasks/harness')

describe('approving is refused over the wire', () => {
  // The rule: a model may WRITE a job, a prompt or a contract, and may not
  // ratify its own. It is the one place in this app where who is asking decides
  // the answer, so it is the one most worth a test.
  it('a job cannot be approved down the pipe', async ({ actions, assert }) => {
    const { jobs } = await actions.jobs.run({})
    assert.needs(jobs.length, 'there are no jobs to try approving')
    await assert.refuses(
      () => actions.jobApprove.run({ id: jobs[0].id, _overTheWire: true }),
      'window|person|may not approve',
      'a job was approved from the command line')
  })

  it('a prompt cannot be approved down the pipe', async ({ actions, assert }) => {
    const { prompts } = await actions.prompts.run({})
    assert.needs(prompts.length, 'there are no prompts to try approving')
    await assert.refuses(
      () => actions.promptApprove.run({ id: prompts[0].id, _overTheWire: true }),
      'window|person|may not approve',
      'a prompt was approved from the command line')
  })

  it('a contract cannot be approved down the pipe', async ({ actions, assert }) => {
    const { contracts } = await actions.contracts.run({})
    assert.needs(contracts.length, 'there are no contracts to try approving')
    await assert.refuses(
      () => actions.contractApprove.run({ id: contracts[0].id, _overTheWire: true }),
      'window|person|may not approve',
      'a contract was approved from the command line')
  })
})

describe('a branch cannot be named into existence by accident', () => {
  it('setting a machine up on a branch that does not exist is refused', async ({ actions, assert }) => {
    const { vms } = await actions.vmList.run({})
    assert.needs(vms.length, 'there are no machines')
    // Refused on the NAME, before anything is started — which is the point of
    // the test. This used to be discovered after booting a machine and waiting
    // for it to dial in, so the answer to a typo was five minutes away.
    await assert.refuses(
      () => actions.vmWorkspace.run({ name: vms[0].name, branch: 'no/such-branch-okc-test' }),
      'there is no branch',
      'a machine was set up on a branch nobody made')
  })

  it('a cut must start from a line or a cut, and not both', async ({ actions, assert }) => {
    await assert.refuses(
      () => actions.branchCreate.run({ branch: 'okc-test/never-made', reason: 'a test', group: 'default', from: 'inspection/check1' }),
      'both|one of',
      'a branch was cut from two starting points at once')
  })

  it('a cut must say what it is for', async ({ actions, assert }) => {
    await assert.refuses(
      () => actions.branchCreate.run({ branch: 'okc-test/never-made', group: 'default' }),
      'reason',
      'a branch was cut with no reason recorded')
  })
})

describe('a task carries what it was given, and cannot be rewritten', () => {
  it('a task under a contract that is not approved is refused', async ({ actions, assert }) => {
    const { contracts } = await actions.contracts.run({})
    const unapproved = contracts.find(c => !c.approved)
    assert.needs(unapproved, 'every contract here is approved, so there is nothing to refuse')
    await assert.refuses(
      () => actions.taskCreate.run({ task: { title: 'okc-test', brief: 'x', branch: 'inspection/check1', contractId: unapproved.id } }),
      'not approved|not ready|approve',
      'a task was written under rules nobody had approved')
  })

  it('a task cannot name a job that does not exist', async ({ actions, assert }) => {
    await assert.refuses(
      () => actions.taskCreate.run({ task: { title: 'okc-test', brief: 'x', branch: 'inspection/check1', job: 'no-such-job-okc-test' } }),
      'no job called',
      'a task was written naming a job that is not there')
  })

  it('what a task was asked cannot change once it is out', async ({ actions, assert }) => {
    const { tasks } = await actions.tasks.run({})
    const out = tasks.find(t => t.machine)
    assert.needs(out, 'no task has been given to a machine, so there is nothing to protect')
    await assert.refuses(
      () => actions.taskUpdate.run({ id: out.id, task: { brief: 'something else entirely' } }),
      'already been given|cannot change',
      'the question a piece of work answers was rewritten after the fact')
  })
})

describe('a machine is not asked to do the impossible', () => {
  it('a machine that is not dialled in cannot be given a workspace', async ({ actions, assert }) => {
    const { vms } = await actions.vmList.run({})
    const off = vms.find(v => !v.connected)
    assert.needs(off, 'every machine is dialled in, so there is nothing to refuse')
    // The branch has to be real, or the refusal above fires first and this
    // proves nothing about being dialled in.
    const { branches } = await actions.gitBranches.run({})
    const real = (branches || []).find(b => (b.name || b) && !(b.missing || []).length)
    assert.needs(real, 'there is no branch that exists everywhere')
    await assert.refuses(
      () => actions.vmWorkspace.run({ name: off.name, branch: real.name || real }),
      'not dialled in|start it',
      'a workspace was set up on a machine nothing can reach')
  })

  it('a branch nobody has is not a branch to sync', async ({ actions, assert }) => {
    const { repos } = await actions.repositories.run({})
    assert.needs(repos.length, 'there are no repositories')
    await assert.refuses(
      () => actions.repoSyncBranch.run({ repo: repos[0].repo, branch: 'no/such-branch-okc-test' }),
      'has no branch',
      'a branch that is not there was fast-forwarded')
  })
})
