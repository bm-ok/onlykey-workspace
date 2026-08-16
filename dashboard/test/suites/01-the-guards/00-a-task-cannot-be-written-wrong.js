'use strict'

// guards — a task cannot be written wrong
//
// A test is a series: the checks below run in the order they are written, and
// what one arranges the next one uses. See test/suites/index.js for what the
// folder, the file and the checks each mean.

const { it, cleanup } = require('../../../tasks/harness')
const { scratch, aLine } = require('../../helpers')

// WHAT IT SAW LAST TIME is recorded at the bottom of this file. See
// 00-the-order/00-a-cut-comes-first.js for why the transcript is kept at all —
// and it matters most in a file like this one, where the product IS the sentence
// somebody gets back.

it('a task with nowhere to deliver is refused', async ({ okc, assert, log }) => {
  const refusal = await assert.refuses(
    () => okc('taskCreate', { task: { title: 'no branch', brief: 'anything' } }),
    'branch',
    'A task with no branch has no artifact and could never be judged')
  log(`refused, and this is what it said:\n${refusal.message}`)
})

it('a cut to write the rest of these against', async ({ okc, assert, state, log }) => {
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
  log(`cut "${state.branch}" from line "${line}" — so the check below meets the contract rule and not the branch rule`)
})

it('a contract that is not there is refused', async ({ okc, assert, state, log }) => {
  const refusal = await assert.refuses(
    () => okc('taskCreate', { task: { title: 'bad contract', brief: 'anything', branch: state.branch, contract: 'C:/nothing/here.md' } })
      .then(t => { state.stray = t; return t }),
    'no contract at',
    'A contract that silently fails to load leaves a worker with no rules while everything reports success')
  log(`refused, and this is what it said:\n${refusal.message}`)
})

cleanup(async ({ okc, state }) => {
  if (state.stray) await okc('taskRemove', { id: state.stray.id }).catch(() => {})
  if (state.branch) await okc('branchDelete', { branch: state.branch, force: true }).catch(() => {})
})

// WHAT IT SAW — 16 August 2026, 14:16, three passed
//
//   a task with nowhere to deliver is refused
//     refused, and this is what it said:
//     A branch needs a name.
//
//   a cut to write the rest of these against
//     cut "drill/written-wrong-141615" from line "default" — so the check below
//     meets the contract rule and not the branch rule
//
//   a contract that is not there is refused
//     refused, and this is what it said:
//     There is no contract at C:\nothing\here.md. It is read from this host when
//     the task is given out.
//
// "A BRANCH NEEDS A NAME." is four words where everything else here is three
// lines, and that is worth seeing rather than assuming. It is right — there is
// nothing more to say about an empty field, and a paragraph would be padding —
// but it is the one refusal in this project that tells you nothing about what to
// do next, which is a deliberate difference and not an oversight.
//
// The second one says where it looked and when it would have read it, which is
// the useful half: a contract path that is wrong on this host fails when the
// task is GIVEN OUT, not when it is written, and that sentence is what stops
// somebody hunting for the mistake at the wrong end.
