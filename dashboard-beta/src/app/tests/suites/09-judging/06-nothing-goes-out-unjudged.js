'use strict'

// nothing goes out unjudged — the gate on the one act with consequences
//
// SENDING A CHANGE OUT IS THE ONE STEP THAT LEAVES THIS HOST. Everything else
// happens on machines that get rolled back; a pull request lands in somebody
// else's repository and cannot be unsent. Over the pipe there is no person
// looking at it, so the reading has to exist and has to be worth something.
//
// THREE PARTS, AND ALL THREE HAVE TO HOLD:
//
//   has read it      a judgement, done, of this line or any branch it is made of
//   still true       not stale against the tips it was made on
//   did not reject   the last current one is not "rejected"
//
// EVERY CHECK IN THIS FILE ENDS IN A REFUSAL, deliberately. Nothing here pushes
// and nothing opens a pull request: the gate is the subject, and a drill that
// proved it by sending something out would be proving it by doing the thing it
// exists to prevent.
//
// AND `_overTheWire: true` IS SAID OUT LOUD ON EVERY ONE OF THEM, because a
// drill is marked `_fromTest` and NOT `_overTheWire` — so without it the gate
// does not apply and `prCutMake` does exactly what it says on the tin.
//
// THE FIRST VERSION OF THIS FILE LEFT IT OFF. It opened a real pull request on
// bm-sandbox-c/local-repo-a, #15, and then its own cleanup deleted the branch
// underneath it. The check "reported" that the gate had failed, when the gate
// had simply never been asked. A drill that means to test a rule about the wire
// has to arrive over the wire.
//
// WHY IT COULD NOT BE BUILT BEFORE. Staleness is measured with `tips` that live
// on the judgement, and until `judgementVerdict` existed nothing could record a
// verdict at all — so the gate was refused outright over the pipe rather than
// ported at two thirds. A gate that only asks whether a judgement EXISTS would
// pass a judgement of an earlier state, which is exactly as useful as none.

const { it, cleanup, requires } = require('../../harness')
const { scratch, aLine } = require('../../helpers')

requires('the order')

const mine = []

cleanup(async ({ okc, state }) => {
  for (const id of mine.splice(0)) {
    try { await okc('judgementRemove', { id }) } catch { /* already gone */ }
  }
  if (state.line) { try { await okc('lineForget', { name: state.line }) } catch { /* never named */ } }
  if (state.branch) {
    try { await okc('branchDelete', { branch: state.branch, force: true }) } catch { /* never cut */ }
  }
})

it('a change with something on it, and a line to send it as', async ({ okc, assert, state, log }) => {
  const from = await aLine(okc, assert)
  state.branch = scratch('unjudged')
  await okc('branchCreate', { branch: state.branch, reason: 'a drill proving nothing goes out unjudged', group: from })

  // SOMETHING TO SEND. A cut that carries nothing is refused long before the
  // gate, so without this the drill would pass on the wrong sentence.
  const put = await okc('drillCommit', {
    branch: state.branch,
    message: 'a drill commit, so this cut carries something'
  })
  assert.ok(put, 'nothing was committed, so this cut carries nothing and the gate is never reached')

  state.line = scratch('unjudged-line')
  await okc('branchAsLine', { branch: state.branch, name: state.line, why: 'a drill sending a change out' })
  log(`${state.line} carries a commit on ${state.branch}`)
}, { gate: true })

it('and nothing has read it, so it does not go out', async ({ okc, assert, state, log }) => {
  assert.needs(state.line, 'the first check did not make a line')

  // THE NAMES A JUDGE COULD ACTUALLY HAVE READ. A judgement is made against the
  // BRANCH; `branchAsLine` then gives it a line name. Searching only for the
  // line name means the flow the supervisor is told to follow — judge it, make
  // it a line, cut it — cannot pass its own gate, because the name searched for
  // is one nothing has ever judged, by construction. Over there that refused
  // with "Nothing has judged it" about a change that had just been accepted.
  await assert.refuses(
    () => okc('prCutMake', { source: state.line, target: 'default', title: 'a drill, which should not go out', _overTheWire: true }),
    'Nothing has judged',
    'a change nothing has read was sent out over the pipe')
  log('unjudged, and refused')
})

it('and a rejection stops it', async ({ okc, assert, state, log }) => {
  assert.needs(state.line, 'the first check did not make a line')

  const made = await okc('judgementCreate', { kind: 'branch', branch: state.branch, by: 'person' })
  mine.push(made.id)
  await okc('judgementVerdict', {
    ref: made.ref,
    verdict: 'rejected',
    note: 'A drill rejected this so the gate has something to refuse on.'
  })

  await assert.refuses(
    () => okc('prCutMake', { source: state.line, target: 'default', title: 'a drill, which should not go out', _overTheWire: true }),
    'came back "rejected"',
    'a change a judge rejected was sent out anyway')
  log(`${made.ref} rejected it, and the cut is refused`)
})

it('and a judgement made before the last push does not count', async ({ okc, assert, state, log }) => {
  assert.needs(state.line, 'the first check did not make a line')

  // ACCEPTED, SO THE ONLY THING LEFT TO REFUSE ON IS STALENESS. If this passed
  // the gate the next step would push — so the branch is moved first, which is
  // exactly what makes the reading stop describing it.
  const made = await okc('judgementCreate', { kind: 'branch', branch: state.branch, by: 'person' })
  mine.push(made.id)
  await okc('judgementVerdict', { ref: made.ref, verdict: 'accepted', note: 'A drill accepted this.' })

  // THE PUSH THAT MAKES IT STALE. A judgement made before this is a judgement of
  // something else — that is the whole of what staleness means here.
  await okc('drillCommit', {
    branch: state.branch,
    message: 'a second drill commit, made after the judgement read it'
  })

  await assert.refuses(
    () => okc('prCutMake', { source: state.line, target: 'default', title: 'a drill, which should not go out', _overTheWire: true }),
    'before the last push',
    'a judgement of an earlier state let the change out — which is exactly as useful as none')
  log(`${made.ref} accepted it, the branch moved, and the cut is refused again`)
})
