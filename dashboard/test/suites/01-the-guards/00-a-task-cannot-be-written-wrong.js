'use strict'

// guards — a task cannot be written wrong
//
// A test is a series: the checks below run in the order they are written, and
// what one arranges the next one uses. See test/suites/index.js for what the
// folder, the file and the checks each mean.

const { it, cleanup } = require('../../../tasks/harness')
const { scratch, aLine } = require('../../helpers')

it('a task with nowhere to deliver is refused', async ({ okc, assert }) => {
  await assert.refuses(
    () => okc('taskCreate', { task: { title: 'no branch', brief: 'anything' } }),
    'branch',
    'A task with no branch has no artifact and could never be judged')
})

it('a cut to write the rest of these against', async ({ okc, assert, state }) => {
  // TWO RULES CAN REFUSE THE SAME CALL, and only one of them is being tested.
  //
  // The check below asks for a task with a contract that is not on disk, and
  // used to name a branch nobody had cut — so once "the cut comes first" became
  // a rule, the refusal it got was the branch one, and the contract rule was no
  // longer being exercised at all. It reported a pass for a while and would have
  // gone on reporting one.
  //
  // What caught it is that `refuses` matches the MESSAGE. A drill that merely
  // catches a throw cannot tell which rule answered, and the wrong one answering
  // is indistinguishable from the right one.
  const line = await aLine(okc, assert)
  state.branch = scratch('written-wrong')
  await okc('branchCreate', { branch: state.branch, reason: 'a drill needing a real cut to write bad tasks against', group: line })
})

it('a contract that is not there is refused', async ({ okc, assert, state }) => {
  await assert.refuses(
    () => okc('taskCreate', { task: { title: 'bad contract', brief: 'anything', branch: state.branch, contract: 'C:/nothing/here.md' } })
      .then(t => { state.stray = t; return t }),
    'no contract at',
    'A contract that silently fails to load leaves a worker with no rules while everything reports success')
})

cleanup(async ({ okc, state }) => {
  if (state.stray) await okc('taskRemove', { id: state.stray.id }).catch(() => {})
  if (state.branch) await okc('branchDelete', { branch: state.branch, force: true }).catch(() => {})
})
