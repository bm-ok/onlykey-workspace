'use strict'

// what a judgement decided — the step the loop had no end without
//
// A JUDGEMENT COULD BE ASKED FOR, QUEUED, RUN AND READ, AND THEN NOTHING COULD
// SAY WHAT IT DECIDED. `store.js` carried `VERDICTS` and validated one on the
// way in; `gate.js` gated a second reading on `state === 'done' && by ===
// 'person' && verdict`; `judging` counted `decided` and `gaveUp` off that field;
// and `judgementQueue` refused a person's judgement with "Record what you decide
// with judgementVerdict instead" — naming an action that did not exist.
//
// So everything was built to READ a verdict and nothing wrote one. Four
// judgements on this host sat `done` with none, which is what that looks like
// from outside: work that finished and settled nothing.
//
// NOTHING HERE NEEDS A MACHINE OR A MODEL. A person's own reading is the case
// this covers — `by: 'person'` exists precisely so somebody can read a change
// themselves — and it is the one that could never be completed at all.
//
// HALF OF IT PASSES BY BEING REFUSED, which is the half worth having: a verdict
// that is not one, a rejection with no reason, and an edit to something already
// decided. Each of those is a way of recording something that would read as a
// judgement and would not be one.

const { it, cleanup, requires } = require('../../harness')
const { scratch, aLine } = require('../../helpers')

requires('the order')

const mine = []

cleanup(async ({ okc, state }) => {
  for (const id of mine.splice(0)) {
    try { await okc('judgementRemove', { id }) } catch { /* already gone, or never made */ }
  }
  // THE JUDGEMENT FIRST, THEN THE CUT. One open against a subject is exactly
  // what stops the branch being tidied.
  if (state.branch) {
    try { await okc('branchDelete', { branch: state.branch, force: true }) } catch { /* never cut */ }
  }
})

it('a person can read a change themselves, and it starts with nothing decided', async ({ okc, assert, state, log }) => {
  const line = await aLine(okc, assert)
  state.branch = scratch('decided')
  await okc('branchCreate', { branch: state.branch, reason: 'a drill recording what a judgement decided', group: line })

  // `by: 'person'` — NO JOB, NO MACHINE, NO MODEL. This is somebody saying they
  // will read it themselves, which the queue refuses to dispatch on purpose.
  //
  // AND NO QUESTION EITHER, which this drill got wrong first time and the app
  // corrected: a question is added to what a JOB's prompt says, so asking one
  // without a job is asking nobody. A person reading it themselves has no
  // prompt to add it to.
  const made = await okc('judgementCreate', {
    kind: 'branch',
    branch: state.branch,
    by: 'person'
  })
  mine.push(made.id)
  state.judgement = made.id
  state.ref = made.ref

  assert.equal(made.by, 'person', `it was recorded as read by "${made.by}", and this is a person's own reading`)
  assert.ok(!made.verdict, `it arrived already carrying the verdict "${made.verdict}" — nothing has read anything yet`)
  log(`${made.ref} reads ${made.subject.name}, for a person, with nothing decided`)
}, { gate: true })

it('and a verdict that is not one is refused', async ({ okc, assert, state }) => {
  assert.needs(state.judgement, 'the first check did not make a judgement')

  // THE LIST IS THE VOCABULARY. A judgement that cannot say which of them it
  // reached is one that has not been made, and a free-text verdict is a field
  // nothing downstream can act on — `judging` counts `decided` off this.
  await assert.refuses(
    () => okc('judgementVerdict', { ref: state.ref, verdict: 'looks fine to me' }),
    'is neither',
    'any words at all were accepted as a verdict')
})

it('and a rejection has to say why', async ({ okc, assert, state }) => {
  assert.needs(state.judgement, 'the first check did not make a judgement')

  // NOTHING IS AUTOMATICALLY RE-RUN AND NOTHING IS SENT ANYWHERE. A rejection is
  // a RECORD, and what happens to the work is a person's decision — so this note
  // is the whole of what survives it. Without it, somebody reads "rejected" six
  // weeks later and has to guess.
  await assert.refuses(
    () => okc('judgementVerdict', { ref: state.ref, verdict: 'rejected' }),
    'why it was rejected',
    'a rejection with no reason was recorded, and there is nothing to act on')
})

it('and recording one keeps what it was read against', async ({ okc, assert, state, log }) => {
  assert.needs(state.judgement, 'the first check did not make a judgement')

  const said = await okc('judgementVerdict', {
    ref: state.ref,
    verdict: 'accepted',
    note: 'A drill recorded this. It read a branch with nothing on it.'
  })

  assert.equal(said.verdict, 'accepted', `it recorded "${said.verdict}"`)
  assert.equal(said.state, 'done', `a judgement with a verdict is done, and this one says "${said.state}"`)
  assert.ok(said.note, 'the reason was dropped')
  assert.ok(said.decided, 'nothing recorded WHEN it was decided')

  // THE TIPS ARE THE HALF THAT MAKES IT AGE. A verdict that does not record what
  // it was read against reads as current for ever — which is the shape that
  // lies, and is why an unreadable subject is refused rather than filed.
  assert.ok(said.tips && Object.keys(said.tips).length,
    'nothing recorded what it was read against, so this verdict can never go stale and will describe '
    + 'whatever is on the branch for ever')

  // AND IT REACHES THE BOARD, which is the claim rather than the field: `judging`
  // counts `decided` off this, and a verdict nothing counts is a verdict nobody
  // sees.
  const board = await okc('judging')
  const row = (board.judgements || []).find(j => j.ref === state.ref)
  assert.ok(row, `${state.ref} is not on the board at all`)
  assert.equal(row.verdict, 'accepted', `the board says "${row.verdict}" about it`)
  log(`${state.ref} accepted, against ${Object.keys(said.tips).length} repository tip(s), and on the board`)
})

it('and a decided judgement cannot be edited afterwards', async ({ okc, assert, state, log }) => {
  assert.needs(state.judgement, 'the first check did not make a judgement')

  // A JUDGEMENT IS A RECORD OF WHAT SOMEBODY THOUGHT AT A MOMENT. Edit it and it
  // stops being that — so the way to change your mind is another judgement,
  // which leaves both readings and the order they happened in.
  await assert.refuses(
    () => okc('judgementUpdate', { ref: state.ref, judgement: { question: 'actually, read something else' } }),
    'is decided',
    'a decided judgement was rewritten, and the record no longer says what was thought when')
  log('what was decided stays decided; changing your mind means another judgement')
})
