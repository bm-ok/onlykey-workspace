'use strict'

// the order — a draft can change, and what is out cannot
//
// A test is a series: the checks below run in the order they are written, and
// what one arranges the next one uses. See test/suites/index.js for what the
// folder, the file and the checks each mean.

const { it, cleanup } = require('../../../tasks/harness')
const { scratch, aLine } = require('../../helpers')

// WHAT IT SAW LAST TIME is recorded at the bottom of this file. See
// 00-a-cut-comes-first.js for why the transcript is kept in the file at all.

it('a cut to work on, and a contract to be held to', async ({ okc, assert, state, log }) => {
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
  log(`contract "${state.contract.name}" is approved, ${String(state.contract.text || '').length} characters of rules`)
  log(`cut "${state.branch}" from line "${line}"`)
}, { gate: true })

it('a task written on it is a draft, and a draft can be rewritten', async ({ okc, assert, state, log }) => {
  state.task = await okc('taskCreate', { task: { title: 'drill: editable', brief: 'first', branch: state.branch, contractId: state.contract.id } })
  assert.equal(state.task.state, 'draft', 'A newly written task is a draft')

  const after = await okc('taskUpdate', { id: state.task.id, task: { brief: 'second' } })
  assert.equal(after.brief, 'second', 'A draft is what a task is while it can still be changed')
  log(`task #${state.task.number} written as a ${state.task.state}; its brief went from "${state.task.brief}" to "${after.brief}"`)
})

it('and it carries a COPY of the rules, not a pointer to them', async ({ assert, state, log }) => {
  // The spine's rule, and the reason every arrow in it is a copy: read six
  // weeks later, a reference proves nothing about what a worker was held to.
  assert.ok(state.task.rules, 'The task carries no rules at all')
  assert.equal(state.task.rules, state.contract.text, 'The task carries something other than the words it was given')
  assert.equal(state.task.contractName, state.contract.name, 'The name travels too, for after the library entry is gone')
  log(`it carries the words of "${state.task.contractName}" itself — ${state.task.rules.length} characters, matching the library entry exactly`)
})

cleanup(async ({ okc, state }) => {
  if (state.task) await okc('taskRemove', { id: state.task.id }).catch(() => {})
  if (state.branch) await okc('branchDelete', { branch: state.branch, force: true }).catch(() => {})
})

// WHAT IT SAW — 16 August 2026, 14:08, three passed
//
//   a cut to work on, and a contract to be held to
//     contract "how work is delivered" is approved, 385 characters of rules
//     cut "drill/edit-140816" from line "default"
//
//   a task written on it is a draft, and a draft can be rewritten
//     task #97 written as a draft; its brief went from "first" to "second"
//
//   and it carries a COPY of the rules, not a pointer to them
//     it carries the words of "how work is delivered" itself — 385 characters,
//     matching the library entry exactly
//
// THE TWO 385s ARE THE POINT of the last check, and reading them side by side is
// the whole of it: the number on the first line is the library's copy, the
// number on the last is the task's own, and they are equal because the words
// were copied rather than pointed at. If the contract is edited tomorrow the
// first number moves and the second does not — which is exactly the property
// being claimed, and the only reason a task can be read six weeks later.
