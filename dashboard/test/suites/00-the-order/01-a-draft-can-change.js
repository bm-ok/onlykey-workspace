'use strict'

// the order — a draft can change, and what is out cannot
//
// A test is a series: the checks below run in the order they are written.
// See test/suites/index.js for what the folder, the file and the checks each
// mean, and tasks/harness.js for state, cleanup and what a failed check does
// to the ones after it.

const { it } = require('../../../tasks/harness')
const { scratch, aLine } = require('../../helpers')

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
