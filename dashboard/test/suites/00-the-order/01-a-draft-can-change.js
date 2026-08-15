'use strict'

// the order — a draft can change, and what is out cannot
//
// A test is a series: the checks below run in the order they are written, and
// what one arranges the next one uses. See test/suites/index.js for what the
// folder, the file and the checks each mean.

const { it, cleanup } = require('../../../tasks/harness')
const { scratch, aLine } = require('../../helpers')

it('a cut to work on, and a contract to be held to', async ({ okc, assert, state }) => {
  // ARRANGING IS A STEP, and is written as one rather than hidden at the top of
  // the next check. When this is what could not be done — no line whole, no
  // contract approved — the pane says so against this step, and the steps that
  // needed it are plainly the ones below.
  const { contracts } = await okc('contracts')
  state.contract = (contracts || []).find(c => c.approved)
  assert.needs(state.contract, 'no contract is approved, so there is nothing for a task to carry')

  const line = await aLine(okc, assert)
  state.branch = scratch('edit')
  await okc('branchCreate', { branch: state.branch, reason: 'a drill proving a draft is editable', group: line })
})

it('a task written on it is a draft, and a draft can be rewritten', async ({ okc, assert, state }) => {
  state.task = await okc('taskCreate', { task: { title: 'drill: editable', brief: 'first', branch: state.branch, contractId: state.contract.id } })
  assert.equal(state.task.state, 'draft', 'A newly written task is a draft')

  const after = await okc('taskUpdate', { id: state.task.id, task: { brief: 'second' } })
  assert.equal(after.brief, 'second', 'A draft is what a task is while it can still be changed')
})

it('and it carries a COPY of the rules, not a pointer to them', async ({ assert, state }) => {
  // The spine's rule, and the reason every arrow in it is a copy: read six
  // weeks later, a reference proves nothing about what a worker was held to.
  assert.ok(state.task.rules, 'The task carries no rules at all')
  assert.equal(state.task.rules, state.contract.text, 'The task carries something other than the words it was given')
  assert.equal(state.task.contractName, state.contract.name, 'The name travels too, for after the library entry is gone')
})

cleanup(async ({ okc, state }) => {
  if (state.task) await okc('taskRemove', { id: state.task.id }).catch(() => {})
  if (state.branch) await okc('branchDelete', { branch: state.branch, force: true }).catch(() => {})
})
