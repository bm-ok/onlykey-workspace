'use strict'

// guards — one machine per branch, and it stays there
//
// A test is a series: the checks below run in the order they are written.
// See ./index.js for what the folder, the file and the checks each
// mean, and the harness for state, cleanup and what a failed check does
// to the ones after it.

const { it } = require('../../harness')

// WHAT IT SAW LAST TIME is recorded at the bottom of this file. Both checks here
// need a machine that is WORKING, so the transcript is from a run made while the
// round trip was in flight — which is the only time this file can say anything.

it('a machine is not moved off the branch it is on', async ({ okc, assert, log }) => {
  const { vms } = await okc('vmList')
  const on = vms.find(v => v.connected && v.branch)
  assert.needs(on, 'no connected machine is on a branch — one is only on a branch while it is working')

  // THE BRANCH IT IS OFFERED HAS TO BE REAL, and this check spent its whole life
  // proving the wrong thing because it was not.
  //
  // It used to offer a made-up name — `scratch('elsewhere')` — and was refused,
  // so it passed. It was refused for the NAME: there is no branch called that,
  // make it first. The rule this check is about was never consulted, and it
  // would have gone on passing after "a machine stays on its branch" stopped
  // being true.
  //
  // It only ever showed itself the first time this file ran with a machine
  // actually working, because until then the check could not be tried at all.
  // The same mistake was found and fixed in
  // 03-the-machines/01-a-machine-comes-up-and-goes-away, which cuts a second
  // real branch for exactly this; here there is no series to cut one in, so it
  // asks for a branch that already exists.
  const { branches } = await okc('gitBranches')
  const elsewhere = (branches || []).find(b => b.name !== on.branch && !(b.missing || []).length)
  assert.needs(elsewhere, 'there is no other branch that exists everywhere, so the only branch to offer would be a name — and a name is refused for being a name')

  const refusal = await assert.refuses(
    () => okc('vmWorkspace', { name: on.name, branch: elsewhere.name }),
    'stays there until it is clean',
    'Switching is how half-finished work stops being anywhere')
  log(`asked of ${on.name}, which is on "${on.branch}", offering the real branch "${elsewhere.name}" — refused, and this is what it said:\n${refusal.message}`)
})

it('a branch already claimed is not handed to a second machine', async ({ okc, assert, log }) => {
  const { vms } = await okc('vmList')
  const claimed = vms.find(v => v.branch)

  // The second machine must be on NO branch of its own, and that is the whole
  // subtlety here rather than a detail.
  //
  // Two rules can refuse this, and only one of them is the rule under test. A
  // machine that is already on a branch is refused for being on it — "stays
  // there until it is clean" — and that refusal fires first, before the claim
  // is ever consulted. The drill passed on a bare "did it throw", and what it
  // proved was a different rule than the one it names.
  //
  // Not arranged, unlike the credential drill. Releasing a claim means rolling
  // a machine back to a snapshot from before the branch, which DISCARDS
  // whatever is on it — a drill may not decide that somebody's work is worth
  // less than a green tick.
  const free = vms.find(v => v.connected && !v.branch && v.name !== (claimed || {}).name)
  assert.needs(claimed, 'no machine claims a branch — a machine is rolled back when its work ends')
  assert.needs(free, 'no second machine is connected and free of a branch. This will not make one: the only way off a branch is a rollback, and that discards whatever is on it')

  const refusal = await assert.refuses(
    () => okc('vmWorkspace', { name: free.name, branch: claimed.branch }),
    'already being worked on',
    'Two machines on one branch race for the same ref and the loser\'s commits strand')
  log(`${claimed.name} claims "${claimed.branch}"; offering it to ${free.name} was refused, and this is what it said:\n${refusal.message}`)
})

// WHAT IT SAW — 16 August 2026, 14:45, both passed, in flight
//
//   a machine is not moved off the branch it is on
//     asked of runner4, which is on "drill/guards-inflight", offering the real
//     branch "brads/testing2" — refused, and this is what it said:
//     "runner4" is set up on drill/guards-inflight and stays there until it is
//     clean. To work on something else, go back to a snapshot taken before that
//     branch — "Go back to it" says what it discards — or use another machine.
//
//   a branch already claimed is not handed to a second machine
//     runner4 claims "drill/guards-inflight"; offering it to runner3 was refused,
//     and this is what it said:
//     "drill/guards-inflight" is already being worked on by "runner4". Two
//     machines on one branch race for the same ref and the loser's commits
//     strand. Pick another branch, or roll "runner4" back to a point before it.
//
// AND THE RUN BEFORE THIS ONE IS WHY THE FIRST CHECK IS WRITTEN THE WAY IT IS.
//
// The very first time this file was tried with a real working machine — which
// took arranging, because at rest it answers nothing — it did not pass. It was
// offering a made-up branch name and being refused for the NAME:
//
//     expected something matching /stays there until it is clean/, got:
//     There is no branch called "drill/elsewhere-144315". Make it first, with a
//     reason — branchCreate --branch drill/elsewhere-144315 ...
//
// It had never proven anything about one machine per branch. It could not have,
// and nothing would have said so: at rest it reports "could not be tried", and
// the moment it could be tried it would have reported a pass for the wrong rule.
// It is fixed here by offering a branch that exists — "brads/testing2" above is
// a real one somebody cut — and the only reason any of it surfaced is that
// `refuses` matches the message rather than merely catching a throw.
