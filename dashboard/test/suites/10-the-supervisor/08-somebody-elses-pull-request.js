'use strict'

// somebody else's pull request — the gate first, the judging after
//
// Everything else this app judges is its own. A pull request that ARRIVES is
// different in kind, and the difference is not tidiness: judging one means
// fetching a stranger's code onto a machine that is holding a Claude
// credential, a token that can push, and this app's ssh key. The machine is
// rolled back afterwards, which does nothing about anything sent out while it
// ran. And the judge is a model reading attacker-controlled TEXT — a diff can
// say "ignore your instructions" as easily as it can say anything else.
//
// So the gate is checked here as real checks, because it exists, and the
// judging that follows is drafted, because it does not.

const { it, requires, draft } = require('../../../tasks/harness')
const allowed = require('../../../repos/allowed')

requires('what this host has')

// A number nothing will collide with. The store is keyed by owner/name#number
// and never asks GitHub, so a pull request that does not exist is exactly as
// good for checking the RULE — and leaves nothing behind on anybody's tracker.
const ON = 'okc-drill/nothing-real'
const N = 987654

it('an incoming pull request is not judgeable until somebody says so', async ({ assert, log }) => {
  allowed.forget(ON, N)
  const said = allowed.check(ON, N, 'aaaa1111')
  assert.equal(said.allowed, false, 'a pull request nobody has looked at was judgeable')
  assert.equal(said.stale, false, 'nothing was allowed, so nothing can be stale')
  assert.ok(/nobody has allowed/i.test(said.why || ''), `it should say nobody has allowed it, and it said "${said.why}"`)
  log(said.why)
})

it('and an allowance names the commit, not the pull request', async ({ assert, log }) => {
  allowed.allow(ON, N, 'aaaa1111', { by: 'a drill' })
  const now = allowed.check(ON, N, 'aaaa1111')
  assert.equal(now.allowed, true, 'a pull request allowed at the commit it is on was still refused')

  // THE WHOLE REASON THE STORE EXISTS. An allowance that named only the number
  // would carry onto whatever the author pushed next, seconds later — approving
  // a number rather than the code somebody read.
  const moved = allowed.check(ON, N, 'bbbb2222')
  assert.equal(moved.allowed, false, 'an allowance carried onto a commit nobody had read')
  assert.equal(moved.stale, true, 'a pushed-since allowance reads as "never allowed" rather than as stale')
  assert.ok(/pushed since|is now at/i.test(moved.why || ''), `it should say the author pushed since, and it said "${moved.why}"`)
  log(moved.why)
})

it('and STALE is its own answer, because it is neither of the other two', async ({ assert }) => {
  const moved = allowed.check(ON, N, 'bbbb2222')
  // A person looked and formed a view, so this is not "nobody has said
  // anything" — and what they read is gone, so it is emphatically not "yes".
  // Anything that folds it into one of those two loses the fact that a person
  // has already spent attention on this pull request.
  assert.ok(moved.said, 'a stale allowance forgets that somebody had looked at all')
  assert.equal(moved.said.sha, 'aaaa1111', 'it should still say which commit was allowed')
  allowed.forget(ON, N)
  assert.equal(allowed.check(ON, N, 'aaaa1111').allowed, false, 'an allowance survived being taken back')
})

it('and a model cannot allow one', async ({ actions, assert }) => {
  // THE ONE DELEGATION THAT CANNOT BE MADE. A supervisor asking for this would
  // be a model deciding that a stranger's code is fit to be read by a model.
  await assert.refuses(
    () => actions.prAllowJudging.run({ repo: 'local-repo-c', number: 1, _overTheWire: true }),
    'in the window|a person|may not',
    'a pull request was allowed from outside the window'
  )
  await assert.refuses(
    () => actions.prForbidJudging.run({ repo: 'local-repo-c', number: 1, _overTheWire: true }),
    'in the window|like giving one',
    'an allowance was taken back from outside the window'
  )
})

it('and it is not on the supervisor\'s list at all', async ({ assert, log }) => {
  const sup = require('../../../core/supervisor')
  const names = Object.keys(sup.MAY || {})
  for (const what of ['prAllowJudging', 'prForbidJudging', 'prJudging']) {
    assert.ok(!names.includes(what), `${what} is on the supervisor's list, and the whole point is that it is not`)
  }
  log(`${names.length} actions on the list, and none of them is this one`)
})

// ---- what the judging itself has to do, once it exists ----------------------

draft('a judge investigates an arrived pull request',
  'NOT BUILT: a judgement\'s subject is a branch in this workspace or a cut this host made, and a stranger\'s pull request is neither — `judgementCreate` refuses it outright. So there is nothing to allow yet, which is why the gate above landed first. ' +
  'WHAT HAS TO EXIST: a subject of kind "pull" — repository, number and head sha — refused unless `allowed.check` says yes at THAT sha, so an allowance and a judgement cannot drift apart. ' +
  'WHAT THE OPERATOR ASKED IT TO DO, in their words: why, what and where the changes were made; whether other repositories need changes that are not there (a pull request that is half a change is the case this app exists to catch — one repository cannot half-land); whether the code is proper to check at all; then a rundown of how the project says it should work, and a re-check of exactly what the change touched. ' +
  'GREEN MEANS THREE THINGS AT ONCE: it is safe, it does what it intends, and it is exactly what the pull request says it is. Any one of those failing is not green. ' +
  'TO SETTLE: whether "check it" ever means RUNNING the contributor\'s code. Reading a diff is much cheaper to make safe; running its tests is what makes "it does what it says" a verdict rather than an opinion — and it is arbitrary execution by a stranger on a machine holding a credential. The proposal on the table is to split them: the read is a Claude judge under a contract that forbids running the change, and the test is a credential-free shell job whose output the judge then reads.')

draft('and what it found is reported back on the pull request',
  'NOT BUILT: nothing in this app can write to a pull request or an issue. `prCutUpdate` changes a title, a description or a state, and there is no comment anywhere. ' +
  'So a judge can read somebody\'s change and reach a verdict that only this host can see, which is half a review. ' +
  'WHAT HAS TO EXIST: an action that posts a comment to a pull request in THIS workspace — taking a repository this host holds rather than an owner/name, or the restriction the operator set ("these three forks and no others") leaks straight through the new door. ' +
  'THE CHECK: after a judgement of an arrived pull request, the pull request carries a comment naming this app, the verdict, and what was checked. And a comment cannot be posted to a repository the workspace does not hold. ' +
  'TO SETTLE: whether a rejection comments at all. A green light is useful to a contributor; a red one written by a model on somebody\'s work is a different act, and it may want a person to press it.')

draft('and a merge somewhere else does not leave what is out unmergeable',
  'NOT BUILT, and it is the first thing here that is maintenance rather than work somebody asked for. ' +
  'When anything lands, every open PR cut is measured against a base that has moved — so a change that was mergeable an hour ago now conflicts, and nobody finds out until somebody presses Merge. ' +
  'WHAT THE OPERATOR ASKED FOR: on a merge, the supervisor checks its open cuts for conflicts and fixes them properly, so what is out stays mergeable. ' +
  'WHAT HAS TO EXIST: something that notices a merge (the same trigger gap as everywhere else here), a way to ask "would this still merge" per cut, and a task shape for "bring this line up to the base it is landing into". ' +
  'THE CHECK: land something into a line that two open cuts are based on, and both cuts are reported as needing attention; after the supervisor has dealt with them, both merge cleanly. ' +
  'TO SETTLE, AND IT IS THE INTERESTING PART: a rebase or a merge changes what a judge already accepted. If J32 accepted a line and the line then moves to a new base, the verdict is stale by the same rule everything else here uses — so "keep it mergeable" implies "and judge it again", and the cost of keeping ten cuts current is ten more judgements. Whether that is worth it, or whether cuts should simply be told they are stale and left, is a decision nobody has made.')
