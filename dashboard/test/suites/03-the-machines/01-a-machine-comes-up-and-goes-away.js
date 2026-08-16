'use strict'

// the machines — a machine comes up, works, and goes away again
//
// The expensive one, and the only one that can prove any of this: a machine is
// not up when VirtualBox says it is running, it is up when it has DIALLED IN,
// and nothing about that can be established without waiting for a real machine
// to boot.
//
// BORROWED RATHER THAN STARTED. Borrowing claims it first and then brings it up,
// so the queue — which ticks every fifteen seconds and is entitled to anything
// that looks idle — cannot take it out from under this while it is booting. It
// is also what a person does, which is the point: a drill that starts a machine
// by a path no button offers is proving something about code nobody uses.
//
// AND IT IS PUT BACK. `cleanup` gives it back whatever happened, because a
// machine left borrowed is out of the pool with nobody using it — the exact
// state this app was built to prevent, arriving through the thing that tests it.
//
// THE REFUSALS THAT LIVE HERE were written in 01-the-guards and could never be
// tried: "a machine is not moved off the branch it is on" needs a machine that
// is on a branch, and at rest there is none. This is the series that has one.

const { it, cleanup } = require('../../../tasks/harness')
const { scratch, aLine } = require('../../helpers')

it('two branches to work on, and a machine to work on one', async ({ okc, assert, state }) => {
  const line = await aLine(okc, assert)
  state.branch = scratch('machine')
  await okc('branchCreate', { branch: state.branch, reason: 'a drill proving a machine comes up and is set up on a branch', group: line })

  // THE SECOND BRANCH IS REAL, and it has to be. This drill first tried to move
  // the machine onto a name nobody had cut — and it WAS refused, by the rule
  // that says a branch must exist. The rule under test never ran, and the check
  // would have gone on passing after "a machine stays on its branch" had stopped
  // being true.
  //
  // Two rules can refuse the same call, and only one of them is the point. The
  // only reason this was caught is that `refuses` matches the message.
  state.other = scratch('elsewhere')
  await okc('branchCreate', { branch: state.other, reason: 'a drill needing a second real branch to try to be moved onto', group: line })

  // WHAT IS FREE IS THE APP'S QUESTION, NOT THIS DRILL'S. This filter used to
  // also pick the SECOND machine for the check further down, by taking the rest
  // of its own list — and its list disagreed with the queue's, which knows about
  // machines kept back. So the "second machine" it chose was the machine that
  // had just been borrowed, and the refusal it got was about the branch it was
  // already on. Every later choice here asks vmList again, at the time.
  const { vms } = await okc('vmList')
  assert.needs(vms.some(v => v.stage === 'ready' && v.state !== 'running' && !v.branch && !v.borrowed),
    'no machine is ready, off and free — this needs one it can borrow')
})

it('it is borrowed, and it dials in', async ({ okc, assert, state }) => {
  // Minutes, not seconds: a base snapshot is restored, the machine boots, the
  // agent starts and connects back here. Two is usual and five is not alarming.
  const got = await okc('vmBorrow', { why: 'a drill proving a machine comes up and goes away' })
  state.machine = got.name

  await okc('vmAwait', { name: state.machine, for: 'connected', seconds: 300 })
  const { agents } = await okc('vmAgents')
  assert.ok(agents.some(a => a.vm === state.machine), `"${state.machine}" was brought up and is not dialled in`)
}, { minutes: 12 })

it('and it answers', async ({ okc, assert, state }) => {
  // The channel, end to end: this host asks, the guest runs it, the answer comes
  // back. Everything else this app does to a machine goes through here.
  const said = await okc('vmRun', { name: state.machine, command: 'echo okc-drill-reply', what: 'a drill asking for a reply' })
  const text = JSON.stringify(said)
  assert.ok(text.includes('okc-drill-reply'), `The machine did not say what it was asked to say: ${text.slice(0, 300)}`)
}, { minutes: 3 })

it('it is set up on the branch, and claims it', async ({ okc, assert, state }) => {
  await okc('vmWorkspace', { name: state.machine, branch: state.branch })
  const { vms } = await okc('vmList')
  const mine = vms.find(v => v.name === state.machine)
  assert.equal(mine.branch, state.branch, `"${state.machine}" was set up on ${state.branch} and claims ${mine.branch || 'nothing'}`)
}, { minutes: 8 })

it('and it is not moved off the branch it is on', async ({ okc, assert, state }) => {
  // FROM 01-the-guards, where it could only ever report "no connected machine is
  // on a branch". Moving a working machine to another branch strands whatever it
  // has not pushed, and the machine is the only place that work exists.
  // The words the app actually uses — "is set up on X and stays there until it
  // is clean" — matched rather than merely catching a throw. Written from memory
  // the first time as "is on", which matched nothing: a refusal drill that does
  // not match is a drill that cannot tell the right rule from the wrong one, and
  // that is the whole reason this matches at all.
  await assert.refuses(
    () => okc('vmWorkspace', { name: state.machine, branch: state.other }),
    'stays there until it is clean|is set up on',
    'A machine was moved off the branch it was working on, which strands anything it had not pushed')
}, { minutes: 3 })

it('and a second machine, dialled in, is not handed the same branch', async ({ okc, assert, state }) => {
  // The other half of the same rule, and the one that needs TWO machines up.
  //
  // Both halves of that are load-bearing. `vmWorkspace` refuses "not dialled in"
  // BEFORE it refuses "already being worked on", so offering the branch to a
  // machine that is switched off proves nothing about claims — it proves the
  // machine is off, which nobody doubted. Two rules can refuse the same call.
  //
  // So the second machine is borrowed and brought up like the first, and if
  // there is not one to borrow this says so rather than making do.
  const { vms } = await okc('vmList')
  const other = vms.find(v => v.name !== state.machine && v.stage === 'ready' && !v.borrowed && !v.branch && v.forTasks !== false)
  assert.needs(other, 'there is no second machine free here — one branch, one machine cannot be shown with one machine')

  await okc('vmBorrow', { name: other.name, why: 'a drill proving one branch is only ever handed to one machine' })
  state.second = other.name
  await okc('vmAwait', { name: state.second, for: 'connected', seconds: 300 })

  await assert.refuses(
    () => okc('vmWorkspace', { name: state.second, branch: state.branch }),
    'already being worked on|race for the same ref',
    `${state.second} was set up on a branch ${state.machine} is already working on — two machines on one branch race, and the loser's commits strand`)
}, { minutes: 12 })

it('and it goes away clean', async ({ okc, assert, state }) => {
  // Put away, which is a rollback to the base snapshot and a power off — so the
  // claim goes, the credential goes, and the next task starts from the same
  // place every other task starts from.
  await okc('vmReturn', { name: state.machine })
  state.returned = true

  await okc('vmAwait', { name: state.machine, for: 'off', seconds: 300 })
  const { vms } = await okc('vmList')
  const mine = vms.find(v => v.name === state.machine)
  assert.ok(!mine.borrowed, `"${state.machine}" was given back and is still borrowed`)
  assert.ok(!mine.branch, `"${state.machine}" was put away and still claims ${mine.branch}`)
  assert.notEqual(mine.state, 'running', `"${state.machine}" was put away and is still running`)
}, { minutes: 10 })

cleanup(async ({ okc, state }) => {
  // The machine first: a branch that cannot be deleted because a machine claims
  // it is a worse mess than a branch left behind.
  //
  // The second machine is only ever borrowed to be refused, so it is holding
  // nothing and goes back the ordinary way.
  if (state.second) await okc('vmReturn', { name: state.second }).catch(() => {})
  if (state.machine && !state.returned) {
    await okc('vmReturn', { name: state.machine }).catch(async () => {
      // It could not be put away clean — usually because it is holding something
      // unpushed, which is exactly when discarding it would be wrong. Released
      // instead, and said out loud: the machine stays as it is, out of the pool.
      await okc('vmReturn', { name: state.machine, keep: true }).catch(() => {})
    })
  }
  for (const b of [state.branch, state.other]) {
    if (b) await okc('branchDelete', { branch: b, force: true }).catch(() => {})
  }
})
