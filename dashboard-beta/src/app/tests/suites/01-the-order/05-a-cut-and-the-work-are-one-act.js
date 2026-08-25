'use strict'

// the order — a cut and the work on it are one act
//
// THE SUPERVISOR'S SEQUENCE IS THREE CALLS AND THE FIRST TWO ARE ONE DECISION.
// Its skill gives them in order: `branchCreate` to cut a branch from a line,
// `taskCreate` to write the work on it, `taskQueue` to give it out. Nobody cuts
// a branch and then wonders what to put on it — the work is why the branch
// exists.
//
// SO `taskCreate` DOES BOTH, and this is what holds it to that. Give the task
// `cutFrom` (a line) and `reason`, and the branch named in `branch` is cut from
// that line before the work is written on it.
//
// ---- why this is a drill and not a unit test -----------------------------
//
// BECAUSE IT IS ABOUT TWO PLUGINS AGREEING. The cutting is ../../repositories/
// branches' act and the writing is ../../queue's, and what is being checked is
// that one door does both without either growing an opinion about the other's
// rules. A test with a stand-in branchCreate would prove the wiring and nothing
// about the refusals, which are the whole reason the composition is safe.
//
// AND BECAUSE IT WAS CHECKED BY HAND FIRST, which is the actual reason this file
// exists. Every claim below was proven with a run of `okc.js taskCreate` typed
// out at the time and then thrown away — so the next person to touch this door
// has nothing to run, and the six commands get invented again. A drill is the
// difference between "I checked" and "it is checked".
//
// NO MACHINE AND NO NETWORK. Writing a task touches neither, and cutting a
// branch is local — so this costs a second and can be run on every change.

const { it, cleanup } = require('../../harness')
const { scratch, aLine } = require('../../helpers')

it('a task cuts the branch it delivers on, in the same act', async ({ okc, assert, state, log }) => {
  state.line = await aLine(okc, assert)
  state.branch = scratch('one-act')

  const made = await okc('taskCreate', {
    task: {
      title: 'drill: a cut and the work at once',
      brief: 'proving that one call cuts the branch and writes the work on it',
      branch: state.branch,
      cutFrom: state.line,
      reason: 'a drill proving a cut and a task are one act'
    }
  })

  state.task = made.id
  assert.equal(made.branch, state.branch, 'The task was written against a different branch than the one asked for')
  log(`wrote ${made.id} on "${state.branch}", cut from line "${state.line}", in one call`)
})

it('and the branch is really there, recorded as cut from that line', async ({ okc, assert, state, log }) => {
  // ASKED OF THE BOARD RATHER THAN OF WHAT THE CALL SAID IT DID. "It reported
  // cutting one" and "there is a branch" are different claims, and only the
  // second is what the queue will find when it comes to dispatch this.
  const row = ((await okc('branchBoard')).branches || []).find(b => b.name === state.branch)
  assert.ok(row, `"${state.branch}" is not on the board at all, so the cut did not happen`)
  assert.equal(row.cut, true, 'The branch exists but nothing recorded the act of cutting it')
  assert.equal((row.note || {}).group, state.line, `It was recorded as cut from "${(row.note || {}).group}"`)

  // AND THE TASK IS ON IT, which is the half that says the two acts joined
  // rather than merely both happening.
  assert.ok((row.tasks || []).some(t => t.id === state.task),
    'The branch was cut and the task is not on it, so the two did not join up')
  log(`"${state.branch}" is cut from "${state.line}" in ${((row.note || {}).cutIn || []).length} repositories, `
    + `carrying ${(row.tasks || []).length} task(s)`)
})

// ---- and what it refuses, which is why composing them is safe -------------
//
// EACH OF THESE IS A WAY FOR THE TWO ACTS TO DISAGREE, and the refusal is what
// keeps them one thing rather than a sequence that can half happen.

it('and it will not cut without being told what the branch is for', async ({ okc, assert, state, log }) => {
  // THE SAME THING `branchCreate` ASKS FOR, asked here because this is where the
  // branch is being made. A branch with no reason on it is one nobody can
  // account for later.
  const said = await assert.refuses(
    () => okc('taskCreate', {
      task: {
        title: 'drill: no reason', brief: 'x',
        branch: scratch('no-reason'), cutFrom: state.line
      }
    }),
    'what .* is for|reason',
    'A branch was cut with no reason recorded on it')
  log(said)
})

it('and it will not cut a branch that is already here', async ({ okc, assert, state, log }) => {
  // "CUT IT FROM default" AND "IT IS ALREADY THERE" CANNOT BOTH BE WHAT SOMEBODY
  // MEANT, and quietly taking the existing one would put the work on a branch
  // cut from somewhere else entirely — which is the one mistake the whole
  // arrangement of lines and cuts exists to prevent.
  const said = await assert.refuses(
    () => okc('taskCreate', {
      task: {
        title: 'drill: already here', brief: 'x',
        branch: state.branch, cutFrom: state.line,
        reason: 'it is already here'
      }
    }),
    'already here|cannot also be cut',
    'It wrote work onto an existing branch while claiming to cut it from a line')
  log(said)
})

it('and a line that does not exist is refused by the door that owns lines', async ({ okc, assert, state, log }) => {
  // THE REFUSAL ARRIVES UNCHANGED from ../../repositories/branches. That is the
  // point of asking it rather than reimplementing it: a second opinion about
  // what a line is would be wrong in some way nobody would find for months.
  const said = await assert.refuses(
    () => okc('taskCreate', {
      task: {
        title: 'drill: no line', brief: 'x',
        branch: scratch('no-line'), cutFrom: 'a line nobody made',
        reason: 'proving the refusal comes from the right place'
      }
    }),
    'no line called',
    'It cut a branch from a line that does not exist')
  log(said)
})

it('and nothing is left behind by any of that', async ({ okc, assert, state, log }) => {
  // THE REFUSALS MUST LEAVE NOTHING, which is the half a refusal drill is most
  // likely to get wrong: the whole point is to attempt the wrong thing, so a
  // refusal that has stopped refusing leaves the wrong thing behind — and the
  // run where that happens is the run somebody is already reading a red line in.
  const board = (await okc('branchBoard')).branches || []
  const strays = board.filter(b => /^drill\/(no-reason|no-line)/.test(b.name))
  assert.equal(strays.length, 0, `A refused cut left a branch behind: ${strays.map(b => b.name).join(', ')}`)

  await okc('taskRemove', { id: state.task })
  state.task = null
  await okc('branchDelete', { branch: state.branch, force: true })
  state.branch = null

  const left = await okc('drillSweep', {})
  assert.equal(left.total, 0, `Something was left behind: ${JSON.stringify(left.branches)}`)
  log(`the refusals left nothing, and a sweep found ${left.total} things left by drills`)
})

cleanup(async ({ okc, state }) => {
  // Only what the series did not get to.
  if (state.task) await okc('taskRemove', { id: state.task }).catch(() => {})
  if (state.branch) await okc('branchDelete', { branch: state.branch, force: true }).catch(() => {})
})
