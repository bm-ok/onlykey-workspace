'use strict'

// The two things more than one test needs, and neither of them is an assertion.
//
// OUTSIDE `suites/` ON PURPOSE. Everything in that tree is loaded as a test —
// a folder is a suite, a file in it is a test — so a file of helpers living
// there would be registered as a test of its own and reported as a suite with
// nothing in it. One directory up, nothing walks it, and the tests require it
// by name.

// A name nothing else will be using. Not random — these have to be findable and
// removable afterwards by somebody reading the repository, and a uuid in a branch
// list tells them nothing about where it came from.
//
// `drillSweep` in actions/tests.js is what removes them when a run was killed
// before its cleanup, and it looks for exactly this prefix.
const scratch = what => `drill/${what}-${new Date().toISOString().replace(/[^0-9]/g, '').slice(8, 14)}`

// The line everything is cut from. Read rather than named, because which lines
// exist is a fact about the workspace and not something a drill decides.
async function aLine (okc, assert) {
  const { groups } = await okc('lines')
  const line = (groups || []).find(g => !g.broken.length)
  assert.needs(line, 'no line is whole here — a cut has to start from one')
  return line.name
}

// A MACHINE TO WORK ON, AND IT COMES FROM THE TEST POOL.
//
// The kit builds `kit-1` and `kit-2` and tags them `test`: they are made from
// nothing, used by everything downstream, and removed when the host is cooled
// down. A drill that reaches past them for somebody's own runner is borrowing a
// machine that is not the kit's to borrow — it will be given back, but it was
// never the intention, and on a host where a runner is mid-something of its own
// it is worse than impolite.
//
// BY THE TAG, NOT BY THE NAME. This matched `/^kit-/`, which is the same idea
// written the fragile way: a machine renamed, or a second test machine called
// anything else, silently stops being the kit's — and the drill quietly borrows
// a runner instead. Tags are how this app already says what KIND a machine is,
// the queue matches on them, and a task can ask for one. This asks the same way.
//
// It falls back to any free machine rather than refusing, because these drills
// have to keep working on a host where the kit has never been run — which is
// every host until the warming stage has finished once. The fallback is said out
// loud where a drill takes one, rather than left to be noticed afterwards.
//
// `free` is what the QUEUE would consider free, not merely what exists: ready,
// off or idle, claiming nothing, holding nothing, and not kept back from tasks.
// A supervisor is never free — it is out of the pool for good — so it cannot be
// picked here either.
const TEST_POOL = 'test'
const tagged = (v, tag) => (v.tags || []).some(t => String(t).toLowerCase() === tag)

async function aMachine (okc, assert, why) {
  const { vms } = await okc('vmList')
  const free = vms.filter(v => v.baseSnapshot && !v.branch && !v.borrowed && v.forTasks !== false && !v.supervisor)
  const ours = free.filter(v => tagged(v, TEST_POOL))
  const pick = ours[0] || free[0]
  assert.needs(pick, why || `no machine is free, ready and holding nothing — run "the machines are built" first, which makes the two this kit uses and tags them "${TEST_POOL}"`)
  return { ...pick, fromThePool: ours.length > 0 }
}

// AND THE SAME QUESTION FOR A MACHINE THAT IS ALREADY UP. Some drills need one
// dialled in rather than one they may borrow — asking the two APIs from both
// sides, for instance — and "the first connected machine" reaches a runner just
// as readily as the pool.
async function aConnectedMachine (okc, assert, why) {
  const { vms } = await okc('vmList')
  const up = vms.filter(v => v.connected && !v.supervisor)
  const ours = up.filter(v => tagged(v, TEST_POOL))
  const pick = ours[0] || up[0]
  assert.needs(pick, why || `no ordinary machine is dialled in. Start one from the test pool — the kit tags its own "${TEST_POOL}" — and run this again`)
  return { ...pick, fromThePool: ours.length > 0 }
}

// What a drill puts on a task so the queue can only give it to the kit. A task
// with no tag takes any free machine, which is every machine somebody owns.
const POOL_TAG = TEST_POOL

module.exports = { scratch, aLine, aMachine, aConnectedMachine, POOL_TAG }
