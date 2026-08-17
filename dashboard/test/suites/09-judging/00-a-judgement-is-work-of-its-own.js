'use strict'

// a judgement is work of its own — its own store, its own numbering, no branch
//
// This file was nine drafts describing a design. It was built, and this is what
// it turned into — see the README beside this file for the three ways the thing
// built differs from the thing drafted, which is the part worth reading before
// changing any of it.
//
// NOTHING HERE NEEDS A MACHINE. Everything below is about what a judgement IS
// and what it refuses, which is decided on this host before anything is
// dispatched. The half that needs a machine is the verdict coming back over the
// wire, and that is 03.

const { it, cleanup, requires } = require('../../../tasks/harness')
const { scratch, aLine } = require('../../helpers')

// It reads a cut, so there has to be something cut. The order suite is what
// proves cutting works; this only borrows it.
requires('the order')

// The judgements this file made, removed at the end whatever happened. A
// judgement left behind is not harmless: one open against a subject refuses the
// next one, so a drill that abandons one blocks the next run of itself.
const mine = []
const aJudge = async okc => {
  const { jobs } = await okc('jobs', { kind: 'judge' })
  return (jobs || []).find(j => j.runnable) || null
}

cleanup(async ({ okc, state }) => {
  for (const id of mine.splice(0)) {
    try { await okc('judgementRemove', { id }) } catch { /* already gone, or never made */ }
  }
  // AND THE CUTS, in the same order everything else here removes them: the
  // judgement first, because one open against a subject is exactly what stops
  // the branch being tidied and the next run of this being made.
  for (const branch of [state.branch, state.strayBranch]) {
    if (branch) { try { await okc('branchDelete', { branch, force: true }) } catch { /* never cut */ } }
  }
})

it('a judgement is asked for against a branch cut, and gets a ref of its own', async ({ okc, assert, state, log }) => {
  const judge = await aJudge(okc)
  assert.needs(judge, 'no judge is runnable here — a judging job with an approved prompt and contract is what this reads with')

  const line = await aLine(okc, assert)
  state.branch = scratch('judged')
  await okc('branchCreate', { branch: state.branch, reason: 'a drill asking for a judgement of a branch cut', group: line })

  const made = await okc('judgementCreate', {
    kind: 'branch',
    branch: state.branch,
    job: judge.id,
    question: 'Written by a drill. Nothing runs this — it exists to prove what a judgement is.'
  })
  mine.push(made.id)
  state.judgement = made.id
  state.ref = made.ref

  // A REF, AND ITS OWN NUMBERING. Tasks are #131; judgements are J1. Two
  // sequences rather than one, because they are two kinds of thing and a shared
  // counter would make "#132" and "J132" mean different work with one number.
  assert.ok(/^J\d+$/.test(made.ref), `a judgement is referred to as J<n>, and this one says "${made.ref}"`)

  // AND NO BRANCH OF ITS OWN, which is the rule the drafts wanted and the reason
  // this is not a task: it reads rather than writes, and a thing claiming a
  // branch it never pushes to holds a machine on that branch for nothing.
  assert.ok(!made.branch, `${made.ref} has taken a branch ("${made.branch}"), and a judgement reads rather than writes`)
  assert.equal(made.state, 'draft', 'a judgement starts as a draft, like any other work nobody has queued')
  log(`${made.ref} reads ${made.subject.name}, with ${made.job}`)
})

it('and the same subject is not judged twice at once', async ({ okc, assert, state }) => {
  assert.needs(state.judgement, 'the first check did not make a judgement')
  const judge = await aJudge(okc)

  // ONE OPEN JUDGEMENT PER SUBJECT. Two at once is two machines reading one
  // change to reach two verdicts about it, and whichever finished last would
  // look like the answer.
  await assert.refuses(
    () => okc('judgementCreate', { kind: 'branch', branch: state.branch, job: judge.id, question: 'a second reading of the same thing' }),
    'already|open|being read|another',
    'a second open judgement of one subject was allowed'
  )
})

it('and a job for doing work cannot be run as a judge', async ({ okc, assert, state }) => {
  const { jobs } = await okc('jobs', { kind: 'task' })
  const working = (jobs || []).find(j => j.runnable)
  assert.needs(working, 'no runnable working job here to try this with')

  const line = await aLine(okc, assert)
  const branch = scratch('wrong-kind')
  await okc('branchCreate', { branch, reason: 'a drill proving the two libraries are kept apart', group: line })
  state.strayBranch = branch

  // THE TWO LIBRARIES ARE KEPT APART, and this is the direction that matters:
  // a working job run as a judge would read a change under rules written for
  // changing it — rules that permit exactly what a judge is there to notice.
  await assert.refuses(
    () => okc('judgementCreate', { kind: 'branch', branch, job: working.id, question: 'read this with a working job' }),
    'judging|judge|not for judging',
    'a working job was accepted as a judge'
  )
})

it('and a judgement is filed against something that exists', async ({ okc, assert }) => {
  const judge = await aJudge(okc)
  assert.needs(judge, 'no judge is runnable here')

  // A judgement filed under a name nothing matches is a verdict nobody will
  // ever find, and a machine sent to read nothing.
  await assert.refuses(
    () => okc('judgementCreate', { kind: 'branch', branch: 'drill/no-such-branch-anywhere', job: judge.id, question: 'read a branch that does not exist' }),
    'no branch cut|does not exist|nothing matches',
    'a judgement was filed against a branch that is not there'
  )
})

it('and what it is reading cannot be changed while it reads it', async ({ okc, assert, state }) => {
  assert.needs(state.judgement, 'the first check did not make a judgement')

  // A draft can still be corrected — that is what judgementUpdate is for — and
  // this proves the door is open before proving where it shuts.
  const changed = await okc('judgementUpdate', {
    id: state.judgement,
    judgement: { question: 'Written by a drill, and then rewritten by the same drill.' }
  })
  assert.ok(/rewritten/.test(changed.question || ''), 'a draft judgement would not take a new question')

  // The shut half is on a judgement that is out, which needs a machine — so it
  // is asserted where the state exists rather than faked here. See 03.
})

// ---- what is genuinely not built -------------------------------------------

const { draft } = require('../../../tasks/harness')

draft('and GitHub is told, beside the pull request',
  'THE OUTWARD HALF, and the only part of the original nine that is still true as a draft. ' +
  'Anybody looking at the change on GitHub — which is where a reviewer looks — has no way to know this app read it. A verdict belongs there: a status or a check beside the pull request, saying what was run and what it found. ' +
  'THE CHECK: after a judgement of a PR cut, the pull request on the parent carries a status naming this app and the verdict. ' +
  'TO SETTLE, AND STILL UNSETTLED: whether that is a commit status, a check run, or a comment — a comment is the easiest and the least useful, since it cannot gate a merge. And whether a rejection blocks the merge button, which is a decision about somebody else\'s repository rather than about this app. ' +
  'WHAT HAS CHANGED SINCE THIS WAS FIRST WRITTEN: everything inward. The verdict exists, it is the judge\'s own, it is current or stale against the tips it was made on, and prCutMake already refuses to send out work a judgement has rejected. So this is now the last mile rather than the whole road.')
