'use strict'

// the order — a branch cut comes before the work
//
// A test is a series: the checks below run in the order they are written, and
// what one arranges the next one uses. See test/suites/index.js for what the
// folder, the file and the checks each mean.

const { it, cleanup } = require('../../../tasks/harness')
const { scratch, aLine } = require('../../helpers')

it('a task cannot be written on a branch that does not exist yet', async ({ okc, assert, state }) => {
  // The first rule in the outline, and the one that makes the order real: the
  // cut exists first, made on the Branches tab where naming what it is for and
  // what it starts from is the whole act.
  //
  // TRIED BEFORE ANYTHING IS ARRANGED, on purpose. A refusal proved after the
  // branch exists is not the refusal being claimed.
  //
  // AND IT CLEANS UP AFTER ITSELF, which a refusal drill looks like it should
  // never need to. It needs it precisely when it FAILS: the whole point is to
  // attempt the wrong thing, so a refusal that has stopped refusing leaves the
  // wrong thing behind — and the run where that happens is the run somebody is
  // already reading a red line in. This one found that out about itself.
  await assert.refuses(
    () => okc('taskCreate', { task: { title: 'drill: too early', brief: 'x', branch: scratch('never-cut') } })
      .then(t => { state.strayTask = t; return t }),
    'no branch|does not exist|Make it first',
    'A task was written against a branch nobody had cut')
})

it('a cut is made, on a line', async ({ okc, assert, state }) => {
  // Which line is READ rather than named: which lines exist is a fact about the
  // workspace, not something a drill decides.
  const line = await aLine(okc, assert)
  state.branch = scratch('spine')
  await okc('branchCreate', { branch: state.branch, reason: 'a drill proving the order of the work', group: line })

  const made = (await okc('gitBranches')).branches.find(b => b.name === state.branch)
  assert.ok(made, 'The cut was accepted and then was not there')
})

it('and now the task can be written on it', async ({ okc, assert, state }) => {
  // THE SAME CALL THAT WAS REFUSED IN THE FIRST STEP, changed in one respect:
  // the branch now exists. That pair is the whole statement — a rule the app
  // enforces rather than a habit the UI encourages — and it can only be made by
  // a series, because the two halves have to be the same call in one order.
  state.task = await okc('taskCreate', { task: { title: 'drill: on a cut', brief: 'x', branch: state.branch } })
  assert.equal(state.task.state, 'draft', 'A newly written task is a draft')
  assert.equal(state.task.branch, state.branch, 'It delivers on the cut it was given')
})

cleanup(async ({ okc, state }) => {
  if (state.strayTask) await okc('taskRemove', { id: state.strayTask.id }).catch(() => {})
  if (state.task) await okc('taskRemove', { id: state.task.id }).catch(() => {})
  if (state.branch) await okc('branchDelete', { branch: state.branch, force: true }).catch(() => {})
})
