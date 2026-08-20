'use strict'

// the order — a branch cut comes before the work
//
// A test is a series: the checks below run in the order they are written, and
// what one arranges the next one uses. See ./index.js for what the
// folder, the file and the checks each mean.

const { it, cleanup } = require('../../harness')
const { scratch, aLine } = require('../../helpers')

// WHAT IT SAW LAST TIME is recorded at the bottom of this file, quoted rather
// than described. Each check reports what it actually met with log(), the window
// keeps those lines against the check they came from, and the block below is a
// transcript of a real run — so the file says what the app SAYS, not what
// somebody remembers it saying.
//
// It is worth the space because the refusal here is the product. A rule is only
// as good as the sentence it gives back, that sentence is a thing that gets
// edited, and a reader comparing the transcript against a fresh run can see at a
// glance whether the words have drifted.

it('a task cannot be written on a branch that does not exist yet', async ({ okc, assert, state, log }) => {
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
  const refusal = await assert.refuses(
    () => okc('taskCreate', { task: { title: 'drill: too early', brief: 'x', branch: scratch('never-cut') } })
      .then(t => { state.strayTask = t; return t }),
    'no branch|does not exist|Make it first',
    'A task was written against a branch nobody had cut')

  // THE SENTENCE, NOT THE FACT THAT THERE WAS ONE. That it threw is already in
  // the pass; what a reader wants six weeks later is the wording somebody will
  // actually meet, and that is the half that rots without anyone noticing.
  log(`refused, and this is what it said:\n${refusal.message}`)
})

it('a cut is made, on a line', async ({ okc, assert, state, log }) => {
  // Which line is READ rather than named: which lines exist is a fact about the
  // workspace, not something a drill decides.
  const line = await aLine(okc, assert)
  state.branch = scratch('spine')
  await okc('branchCreate', { branch: state.branch, reason: 'a drill proving the order of the work', group: line })

  const made = (await okc('gitBranches')).branches.find(b => b.name === state.branch)
  assert.ok(made, 'The cut was accepted and then was not there')
  log(`cut "${state.branch}" from line "${line}", protected: ${!!made.protected}`)
})

it('and now the task can be written on it', async ({ okc, assert, state, log }) => {
  // THE SAME CALL THAT WAS REFUSED IN THE FIRST STEP, changed in one respect:
  // the branch now exists. That pair is the whole statement — a rule the app
  // enforces rather than a habit the UI encourages — and it can only be made by
  // a series, because the two halves have to be the same call in one order.
  state.task = await okc('taskCreate', { task: { title: 'drill: on a cut', brief: 'x', branch: state.branch } })
  assert.equal(state.task.state, 'draft', 'A newly written task is a draft')
  assert.equal(state.task.branch, state.branch, 'It delivers on the cut it was given')
  log(`task #${state.task.number} "${state.task.title}" written as a ${state.task.state}, delivering on ${state.task.branch}`)
})

cleanup(async ({ okc, state }) => {
  if (state.strayTask) await okc('taskRemove', { id: state.strayTask.id }).catch(() => {})
  if (state.task) await okc('taskRemove', { id: state.task.id }).catch(() => {})
  if (state.branch) await okc('branchDelete', { branch: state.branch, force: true }).catch(() => {})
})

// WHAT IT SAW — 16 August 2026, 14:07, three passed
//
//   a task cannot be written on a branch that does not exist yet
//     refused, and this is what it said:
//     There is no branch called "drill/never-cut-140753" in this workspace. Cut
//     it first, on the Branches tab — a task delivers on a branch, and one
//     nobody has cut is work with nowhere to land.
//
//   a cut is made, on a line
//     cut "drill/spine-140753" from line "default", protected: false
//
//   and now the task can be written on it
//     task #96 "drill: on a cut" written as a draft, delivering on drill/spine-140753
//
// The digits are a clock and change every run; nothing else here should move.
//
// NOTE THAT THE APP HAS TWO REFUSALS FOR THIS, and they are not the same words.
// The one above is `taskCreate` and points at the Branches tab, which is right
// for somebody sitting at the window. The queue meets a second one when it sets
// a machine up on a branch that has since been deleted, and that one gives the
// command: `branchCreate --branch ... --reason "..." --group "..."`. Both are
// correct for who is reading them, and only this transcript makes it obvious
// there are two.
