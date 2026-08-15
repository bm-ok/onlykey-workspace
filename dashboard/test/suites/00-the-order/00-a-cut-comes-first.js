'use strict'

// the order — a branch cut comes before the work
//
// A test is a series: the checks below run in the order they are written.
// See test/suites/index.js for what the folder, the file and the checks each
// mean, and tasks/harness.js for state, cleanup and what a failed check does
// to the ones after it.

const { it } = require('../../../tasks/harness')
const { scratch, aLine } = require('../../helpers')

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
