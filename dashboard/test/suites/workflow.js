'use strict'

// THE ORDER THE WORK GOES, as something that can be run.
//
// `UI_OUTLINE.md` is the same thing in prose, and prose is where this drifts:
// that file was written by reading the markup and the action table, so it says
// what the app DOES rather than what it was meant to do — and the two are only
// the same on the day it was written.
//
// THE ORDER IS DEFINED AS MUCH BY WHAT IS REFUSED OUT OF ORDER as by what works
// in it. "Cut a branch, then write a task" is only a rule if writing the task
// first is refused; otherwise it is a habit, and a habit is what a UI enforces
// and an API does not. Every stage below therefore does the step, and then tries
// the step before it out of order.
//
// EVERY WRITE IS NAMED `drill/` OR `drill:` and removed in a `finally`. A
// `finally` does not run when a process is killed, so `drillSweep` is the
// backstop — see actions/tests.js.
//
// These need no machine. The stages that do — installing a runner, giving a task
// out, a worker delivering — stay as prose in TEST-PLAN.md, because they cost
// minutes and because a suite that mostly reports "no machine was on" teaches
// somebody to stop reading it.

const { describe, it } = require('../../tasks/harness')

// One name per run, findable and removable by somebody reading the repository.
const scratch = what => `drill/${what}-${new Date().toISOString().replace(/[^0-9]/g, '').slice(8, 14)}`

// The line everything here is cut from. Read rather than named, because which
// lines exist is a fact about the workspace and not something a drill decides.
async function aLine (okc, assert) {
  const { groups } = await okc('lines')
  const line = (groups || []).find(g => !g.broken.length)
  assert.needs(line, 'no line is whole here — a cut has to start from one')
  return line.name
}

describe('the order — a branch cut comes before the work', () => {
  it('a task cannot be written on a branch that does not exist yet', async ({ okc, assert }) => {
    // The first rule in the outline, and the one that makes the order real:
    // the cut exists first, made on the Branches tab where naming what it is
    // for and what it starts from is the whole act.
    //
    // AND IT CLEANS UP AFTER ITSELF, which a refusal drill looks like it should
    // never need to. It needs it precisely when it FAILS: the whole point is to
    // attempt the wrong thing, so a refusal that has stopped refusing leaves the
    // wrong thing behind — and the run where that happens is the run somebody is
    // already reading a red line in. This one found that out about itself.
    let made = null
    try {
      await assert.refuses(
        () => okc('taskCreate', { task: { title: 'drill: too early', brief: 'x', branch: scratch('never-cut') } })
          .then(t => { made = t; return t }),
        'no branch|does not exist|Make it first',
        'A task was written against a branch nobody had cut')
    } finally {
      if (made) await okc('taskRemove', { id: made.id }).catch(() => {})
    }
  })

  it('a cut is made, and a task can then be written on it', async ({ okc, assert }) => {
    const line = await aLine(okc, assert)
    const branch = scratch('spine')
    let task = null
    try {
      await okc('branchCreate', { branch, reason: 'a drill proving the order of the work', group: line })
      task = await okc('taskCreate', { task: { title: 'drill: on a cut', brief: 'x', branch } })
      assert.equal(task.state, 'draft', 'A newly written task is a draft')
      assert.equal(task.branch, branch, 'It delivers on the cut it was given')
    } finally {
      if (task) await okc('taskRemove', { id: task.id })
      await okc('branchDelete', { branch, force: true }).catch(() => {})
    }
  })
})

describe('the order — a draft can change, and what is out cannot', () => {
  it('a draft can be rewritten', async ({ okc, assert }) => {
    const line = await aLine(okc, assert)
    const branch = scratch('edit')
    let task = null
    try {
      await okc('branchCreate', { branch, reason: 'a drill proving a draft is editable', group: line })
      task = await okc('taskCreate', { task: { title: 'drill: editable', brief: 'first', branch } })
      const after = await okc('taskUpdate', { id: task.id, task: { brief: 'second' } })
      assert.equal(after.brief, 'second', 'A draft is what a task is while it can still be changed')
    } finally {
      if (task) await okc('taskRemove', { id: task.id })
      await okc('branchDelete', { branch, force: true }).catch(() => {})
    }
  })

  it('a task carries a COPY of the rules, not a pointer to them', async ({ okc, assert }) => {
    // The spine's rule, and the reason every arrow in it is a copy: read six
    // weeks later, a reference proves nothing about what a worker was held to.
    const { contracts } = await okc('contracts')
    const usable = (contracts || []).find(c => c.approved)
    assert.needs(usable, 'no contract is approved, so there is nothing to carry')

    const line = await aLine(okc, assert)
    const branch = scratch('carries')
    let task = null
    try {
      await okc('branchCreate', { branch, reason: 'a drill proving a task carries its rules', group: line })
      task = await okc('taskCreate', { task: { title: 'drill: carries', brief: 'x', branch, contractId: usable.id } })
      assert.ok(task.rules, 'The task carries no rules at all')
      assert.equal(task.rules, usable.text, 'The task carries something other than the words it was given')
      assert.equal(task.contractName, usable.name, 'The name travels too, for after the library entry is gone')
    } finally {
      if (task) await okc('taskRemove', { id: task.id })
      await okc('branchDelete', { branch, force: true }).catch(() => {})
    }
  })
})

describe('the order — a cut becomes a line before anything leaves', () => {
  it('a cut is promoted, and is protected afterwards', async ({ okc, assert }) => {
    const line = await aLine(okc, assert)
    const branch = scratch('promote')
    let made = false
    try {
      await okc('branchCreate', { branch, reason: 'a drill proving promotion protects', group: line })
      const before = (await okc('gitBranches')).branches.find(b => b.name === branch)
      assert.equal(!!before.protected, false, 'A fresh cut is not protected — work is done on it')

      await okc('branchAsLine', { branch })
      made = true
      const after = (await okc('gitBranches')).branches.find(b => b.name === branch)
      assert.ok(after.protected, 'Promoting a cut did not protect it, and a line is the same thing protected')

      // AND THE REFUSAL THAT MAKES IT MEAN SOMETHING. A line is merged into and
      // never worked on, so a machine may not be set up on it for work.
      // The words the app actually uses. Matched rather than merely catching a
      // throw, because a refusal for the wrong reason is not a pass — and this
      // very assertion caught the author asserting the wrong reason: it expected
      // "protected" and the refusal says "is a link in", which is the more
      // precise statement of why.
      await assert.refuses(
        () => okc('branchDelete', { branch }),
        'is a link in|nothing is built directly',
        'A line was deleted as though it were an ordinary branch')
    } finally {
      if (made) await okc('lineForget', { name: branch }).catch(() => {})
      await okc('branchDelete', { branch, force: true }).catch(() => {})
    }
  })
})
