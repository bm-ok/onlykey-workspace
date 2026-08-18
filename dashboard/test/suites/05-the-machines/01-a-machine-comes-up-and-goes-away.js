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
const { scratch, aLine, POOL_TAG } = require('../../helpers')

// WHAT IT SAW LAST TIME is recorded at the bottom of this file, and this is the
// file where the numbers are worth having: how long a machine takes to dial in
// is the figure everything else here is budgeted against.

it('two branches to work on, and a machine to work on one', async ({ okc, assert, state, log }) => {
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
  log(`cut "${state.branch}" and "${state.other}" from line "${line}"`)
  log(`free to borrow: ${vms.filter(v => v.stage === 'ready' && v.state !== 'running' && !v.branch && !v.borrowed).map(v => v.name).join(', ')}`)
}, { gate: true })

it('it is borrowed, and it dials in', async ({ okc, assert, state, log }) => {
  // Minutes, not seconds: a base snapshot is restored, the machine boots, the
  // agent starts and connects back here. Two is usual and five is not alarming.
  const began = Date.now()
  // FROM THE TEST POOL. Unnamed and untagged, this took whichever machine was
  // free — which on this host means one of the operator's runners as readily as
  // one of the kit's, and a drill that borrows a working machine gives it back
  // rolled to its base snapshot. The tag is how work asks for a KIND of machine,
  // and a drill is a kind of work.
  const got = await okc('vmBorrow', { tag: POOL_TAG, why: 'a drill proving a machine comes up and goes away' })
  state.machine = got.name

  await okc('vmAwait', { name: state.machine, for: 'connected', seconds: 300 })
  const { agents } = await okc('vmAgents')
  assert.ok(agents.some(a => a.vm === state.machine), `"${state.machine}" was brought up and is not dialled in`)

  // AND IT IS STILL BORROWED, WHICH IS NOT AS OBVIOUS AS IT LOOKS.
  //
  // Bringing a machine up makes it clean, and making a running machine clean
  // means rolling it back -- which used to drop the borrow taken moments
  // earlier. The machine then reads as free while a drill is working in it,
  // and the queue may hand it a task.
  //
  // Asked here rather than left to "it goes away clean" five steps below,
  // where it surfaced as `not borrowed, so there is nothing to give back` --
  // a sentence about giving back, three minutes after the fault, pointing at
  // the wrong end of it.
  const held = (await okc('vmList')).vms.find(v => v.name === state.machine)
  assert.ok(held && held.borrowed, `"${state.machine}" was borrowed and does not read as borrowed once it is up — the queue would treat a machine in use as free`)

  log(`borrowed ${state.machine}; it dialled in ${Math.round((Date.now() - began) / 1000)}s after being asked for, and still reads as borrowed`)
}, { minutes: 12 })

it('and it answers', async ({ okc, assert, state, log }) => {
  // The channel, end to end: this host asks, the guest runs it, the answer comes
  // back. Everything else this app does to a machine goes through here.
  const said = await okc('vmRun', { name: state.machine, command: 'echo okc-drill-reply', what: 'a drill asking for a reply' })
  const text = JSON.stringify(said)
  assert.ok(text.includes('okc-drill-reply'), `The machine did not say what it was asked to say: ${text.slice(0, 300)}`)
  log(`asked ${state.machine} to say "okc-drill-reply", and it did`)
}, { minutes: 3 })

it('it is set up on the branch, and claims it', async ({ okc, assert, state, log }) => {
  const began = Date.now()
  await okc('vmWorkspace', { name: state.machine, branch: state.branch })
  const { vms } = await okc('vmList')
  const mine = vms.find(v => v.name === state.machine)
  assert.equal(mine.branch, state.branch, `"${state.machine}" was set up on ${state.branch} and claims ${mine.branch || 'nothing'}`)
  log(`${state.machine} was set up on "${state.branch}" in ${Math.round((Date.now() - began) / 1000)}s, and claims it`)
}, { minutes: 8 })

it('and it is not moved off the branch it is on', async ({ okc, assert, state, log }) => {
  // FROM 01-the-guards, where it could only ever report "no connected machine is
  // on a branch". Moving a working machine to another branch strands whatever it
  // has not pushed, and the machine is the only place that work exists.
  // The words the app actually uses — "is set up on X and stays there until it
  // is clean" — matched rather than merely catching a throw. Written from memory
  // the first time as "is on", which matched nothing: a refusal drill that does
  // not match is a drill that cannot tell the right rule from the wrong one, and
  // that is the whole reason this matches at all.
  const refusal = await assert.refuses(
    () => okc('vmWorkspace', { name: state.machine, branch: state.other }),
    'stays there until it is clean|is set up on',
    'A machine was moved off the branch it was working on, which strands anything it had not pushed')
  log(`offering ${state.machine} the real branch "${state.other}" was refused, and this is what it said:\n${refusal.message}`)
}, { minutes: 3 })

it('and a second machine, dialled in, is not handed the same branch', async ({ okc, assert, state, log }) => {
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
  // FROM THE TEST POOL, LIKE THE FIRST ONE. This picked "a second machine that is
  // free" and got runner4 — one of the operator's — brought it up, and gave it
  // back rolled to its base snapshot two minutes later. Nothing was harmed and it
  // was still not this kit's to touch: the first borrow in this file was moved to
  // the pool and this one was left behind, which is exactly how a rule with two
  // call sites goes wrong.
  const free = vms.filter(v => v.name !== state.machine && v.stage === 'ready' && !v.borrowed && !v.branch && v.forTasks !== false && !v.supervisor)
  const ours = free.filter(v => (v.tags || []).some(t => String(t).toLowerCase() === POOL_TAG))
  const other = ours[0] || free[0]
  assert.needs(other, 'there is no second machine free here — one branch, one machine cannot be shown with one machine')
  if (!ours.length) log(`no second machine tagged "${POOL_TAG}" is free, so this borrowed ${other.name} instead`)

  await okc('vmBorrow', { name: other.name, why: 'a drill proving one branch is only ever handed to one machine' })
  state.second = other.name
  await okc('vmAwait', { name: state.second, for: 'connected', seconds: 300 })

  const refusal = await assert.refuses(
    () => okc('vmWorkspace', { name: state.second, branch: state.branch }),
    'already being worked on|race for the same ref',
    `${state.second} was set up on a branch ${state.machine} is already working on — two machines on one branch race, and the loser's commits strand`)
  log(`${state.second} came up too; offering it "${state.branch}" was refused, and this is what it said:\n${refusal.message}`)
}, { minutes: 12 })

it('and it goes away clean', async ({ okc, assert, state, log }) => {
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
  log(`${state.machine}: ${mine.state}, on "${mine.baseSnapshot}", claiming nothing, borrowed by nobody`)
}, { minutes: 10 })

it('and one that is already running can be borrowed without losing the borrow', async ({ okc, assert, state, log }) => {
  // THE SAME PROPERTY AS ABOVE, MADE TO HAPPEN RATHER THAN WAITED FOR.
  //
  // The check in "it is borrowed, and it dials in" only bites when the machine
  // it picked was already running, and machines are usually off -- `bringUp`
  // skips the rollback when one is clean AND off, so the borrow survives by
  // not being touched. A drill that only catches a fault when the host happens
  // to be in the right state is a drill that passes for months and then cannot
  // be trusted the one time it matters.
  //
  // So this puts the host in that state on purpose: start it, then borrow it.
  // Bringing up a RUNNING machine has to stop it and roll it back to make it
  // clean, and that rollback used to delete the borrow taken a second earlier
  // -- leaving a machine somebody is using looking free to the queue.
  //
  // IT COSTS A BOOT, which is why it is at the end. What it buys is that the
  // failing path runs every time rather than by luck.
  assert.needs(state.machine, 'there is no machine from the steps above to start')

  await okc('vmStart', { name: state.machine })
  await okc('vmAwait', { name: state.machine, for: 'console', seconds: 300 })
  const up = (await okc('vmList')).vms.find(v => v.name === state.machine)
  assert.equal(up.state, 'running', `"${state.machine}" was started and reads as ${up.state} — the case this check exists for is not set up`)
  assert.ok(!up.borrowed, 'it should be nobody\'s at this point, so that the borrow below is the only one there has been')

  await okc('vmBorrow', { name: state.machine, why: 'a drill proving a borrow survives being brought up from running' })
  state.returned = false

  const now = (await okc('vmList')).vms.find(v => v.name === state.machine)
  assert.ok(now.borrowed, `"${state.machine}" was borrowed while running and does not read as borrowed — the rollback that made it clean threw the borrow away, and the queue would hand a machine in use to a task`)
  log(`started ${state.machine}, borrowed it while running, and it is still borrowed: ${now.borrowed.why}`)
}, { minutes: 12 })

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

// WHAT IT SAW — 16 August 2026, 14:17, all seven passed
//
//   two branches to work on, and a machine to work on one
//     cut "drill/machine-141727" and "drill/elsewhere-141727" from line "default"
//     free to borrow: runner4, runner3
//
//   it is borrowed, and it dials in
//     borrowed runner4; it dialled in 33s after being asked for
//
//   and it answers
//     asked runner4 to say "okc-drill-reply", and it did
//
//   it is set up on the branch, and claims it
//     runner4 was set up on "drill/machine-141727" in 5s, and claims it
//
//   and it is not moved off the branch it is on
//     offering runner4 the real branch "drill/elsewhere-141727" was refused, and
//     this is what it said:
//     "runner4" is set up on drill/machine-141727 and stays there until it is
//     clean. To work on something else, go back to a snapshot taken before that
//     branch — "Go back to it" says what it discards — or use another machine.
//
//   and a second machine, dialled in, is not handed the same branch
//     runner3 came up too; offering it "drill/machine-141727" was refused, and
//     this is what it said:
//     "drill/machine-141727" is already being worked on by "runner4". Two
//     machines on one branch race for the same ref and the loser's commits
//     strand. Pick another branch, or roll "runner4" back to a point before it.
//
//   and it goes away clean
//     runner4: poweroff, on "base", claiming nothing, borrowed by nobody
//
// THIRTY-THREE SECONDS FROM ASKED-FOR TO DIALLED IN, and five seconds to be set
// up on a branch. Both are worth having written down: the comment above budgets
// "two minutes is usual and five is not alarming", which was true of the desktop
// image and is now pessimistic by a factor of four. A number in a transcript is
// how that gets noticed.
//
// THE TWO REFUSALS ARE THE POINT OF THE FILE. Both are the ones from
// 01-the-guards that can never run at rest, and both do more than refuse: each
// says what to do instead — go back to a snapshot, use another machine, pick
// another branch. That is the difference between a guard and an obstacle, and it
// is only visible by reading what they actually say.
