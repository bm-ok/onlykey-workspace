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
// So the gate is checked here as real checks, and the judging that follows is
// drafted — no longer because the machinery is missing, which is what this said
// when it was written. A subject of kind "pull" exists and is gated at the sha
// the allowance names. What has never happened is a judge being pointed at
// somebody else's pull request and asked, which is a run rather than a build.

const { it, requires, draft } = require('../../harness')
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

it('and a model cannot allow one', async ({ okc, assert }) => {
  // THE ONE DELEGATION THAT CANNOT BE MADE. A supervisor asking for this would
  // be a model deciding that a stranger's code is fit to be read by a model.
  await assert.refuses(
    () => okc('prAllowJudging', { repo: 'local-repo-c', number: 1, _overTheWire: true }),
    'in the window|a person|may not',
    'a pull request was allowed from outside the window'
  )
  await assert.refuses(
    () => okc('prForbidJudging', { repo: 'local-repo-c', number: 1, _overTheWire: true }),
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
  'THE MACHINERY IS BUILT, EXACTLY AS THIS ASKED FOR IT, AND NOBODY HAS WALKED IT. This said a stranger\'s pull request could not be a subject at all and that judgementCreate refused it outright. There is a subject of kind "pull" now — repository, number and head sha — and this host has judgements filed under it. ' +
  'IT IS GATED THE WAY THIS SPECIFIED, which is worth saying because the specification was the useful part: the allowance is checked at THAT sha, and a stale one is refused with the difference spelled out ("was allowed at abc1234 and is now at def5678 — the author has pushed since, so what was approved is not what a judge would read"). An allowance and a judgement cannot drift apart. ' +
  'WHAT IS LEFT IS THE RUN. Everything below this line is still a description of something no judge has been asked to do, and the questions at the end are still open. ' +
  'WHAT THE OPERATOR ASKED IT TO DO, in their words: why, what and where the changes were made; whether other repositories need changes that are not there (a pull request that is half a change is the case this app exists to catch — one repository cannot half-land); whether the code is proper to check at all; then a rundown of how the project says it should work, and a re-check of exactly what the change touched. ' +
  'GREEN MEANS THREE THINGS AT ONCE: it is safe, it does what it intends, and it is exactly what the pull request says it is. Any one of those failing is not green. ' +
  'TO SETTLE: whether "check it" ever means RUNNING the contributor\'s code. Reading a diff is much cheaper to make safe; running its tests is what makes "it does what it says" a verdict rather than an opinion — and it is arbitrary execution by a stranger on a machine holding a credential. The proposal on the table is to split them: the read is a Claude judge under a contract that forbids running the change, and the test is a credential-free shell job whose output the judge then reads.')

draft('and what it found is reported back on the pull request',
  'BUILT SINCE THIS WAS WRITTEN, AND THE NOTE IS KEPT BECAUSE IT ASKED FOR THE RIGHT DOOR. It said nothing here could write to a pull request, so a judge could reach a verdict only this host could see — half a review. ' +
  'There are two actions now: `prComment` says something on a pull request in this workspace, ending in whether it is recommended for pulling, and `judgementSay` puts a judgement of an ARRIVED pull request on GitHub as a comment, with a preview step. Both take a repository this host holds rather than an owner and name, which is what this note asked for — otherwise the operator\'s "these three forks and no others" leaks straight through the new door. ' +
  'IT HAS RUN, on this host\'s own cuts rather than on a stranger\'s: the supervisor posted "recommend pulling: YES" on two pull requests on 19 August 2026. ' +
  'WHAT IS STILL A DRAFT is the case this file is about — a pull request that ARRIVED. THE CHECK: after a judgement of an arrived pull request, it carries a comment naming this app, the verdict, and what was checked; and a comment cannot be posted to a repository the workspace does not hold. The second half needs no machine and could be written now. ' +
  'STILL TO SETTLE, and building it did not settle it: whether a REJECTION comments at all. A green light is useful to a contributor; a red one written by a model on somebody else\'s work is a different act, and it may want a person to press it.')

draft('and a merge somewhere else does not leave what is out unmergeable',
  'NOT BUILT, and it is the first thing here that is maintenance rather than work somebody asked for. ' +
  'When anything lands, every open PR cut is measured against a base that has moved — so a change that was mergeable an hour ago now conflicts, and nobody finds out until somebody presses Merge. ' +
  'WHAT THE OPERATOR ASKED FOR: on a merge, the supervisor checks its open cuts for conflicts and fixes them properly, so what is out stays mergeable. ' +
  'ONE OF ITS THREE PIECES EXISTS NOW. It named three: something that notices a merge, a way to ask "would this still merge" per cut, and a task shape for "bring this line up to the base it is landing into". The first is built — a look reports a cut of this host\'s own that is no longer open, asks GitHub which end it reached, and wakes the supervisor with "merged" or "closed without being merged". The trigger gap this called "the same as everywhere else here" is closed. ' +
  'THE OTHER TWO ARE UNTOUCHED, and the second is the one with a decision in it: "would this still merge" can be asked of GitHub, which knows, or worked out here from the tips, which does not need the network and can be wrong. ' +
  'THE CHECK: land something into a line that two open cuts are based on, and both cuts are reported as needing attention; after the supervisor has dealt with them, both merge cleanly. ' +
  'TO SETTLE, AND IT IS THE INTERESTING PART: a rebase or a merge changes what a judge already accepted. If J32 accepted a line and the line then moves to a new base, the verdict is stale by the same rule everything else here uses — so "keep it mergeable" implies "and judge it again", and the cost of keeping ten cuts current is ten more judgements. Whether that is worth it, or whether cuts should simply be told they are stale and left, is a decision nobody has made.')
