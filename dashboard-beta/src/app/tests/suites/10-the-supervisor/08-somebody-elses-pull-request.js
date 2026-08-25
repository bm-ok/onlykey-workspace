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

// ---- where the rule itself is asked ---------------------------------------
//
// THIS FILE COULD NOT LOAD. It required `repos/allowed` and `core/supervisor`,
// and a drill runs from `dist/suites` with only the harness beside it. The first
// of those does not exist in this app at all: allowances are kept by
// ../../repositories/pr, which is where the pane that grants them lives.
//
// AND WHAT IT ASKED THAT STORE WAS ARITHMETIC. Allow at one commit, ask about
// another, get STALE; forget it, get nothing. No host in the question, no
// machine, no GitHub — and asked here it was only ever asked when somebody
// exercised the kit, which for the rule that keeps a stranger's code off this
// host is not often enough.
//
// `test/repositories/pr-allowing.test.js` asks it now, of a module extracted for
// the purpose, and asks more than this did: that a single character of difference
// is enough — comparing shortened shas is the natural way to write it and would
// accept a collision — and that not knowing where the pull request is NOW is its
// own answer rather than staleness, because what is missing is this host's
// knowledge and not the person's decision.
//
// ---- and what stays here, which is who may press it ------------------------
//
// THE GATE IS NOT THE RULE. Whether an allowance matches a commit is arithmetic;
// whether a MODEL can grant one is a fact about this running app, and it is the
// half that would be catastrophic to get wrong. A supervisor allowing a pull
// request would be a model deciding that a stranger's code is fit to be read by
// a model.

const { it, requires, draft } = require('../../harness')

requires('what this host has')

it('a model cannot allow a pull request to be judged', async ({ okc, assert, log }) => {
  // THE ONE DELEGATION THAT CANNOT BE MADE, asked of the running action table
  // rather than of the source, so it is about what this app actually refuses.
  await assert.refuses(
    () => okc('prAllowJudging', { repo: 'local-repo-c', number: 1, _overTheWire: true }),
    'in the window|a person|may not',
    'a pull request was allowed from outside the window'
  )

  // AND TAKING ONE BACK IS THE SAME PRESS. It reads like the safe direction and
  // is not: a model that can withdraw an allowance can withdraw the one a person
  // gave, and then ask for it again at a commit of its choosing.
  await assert.refuses(
    () => okc('prForbidJudging', { repo: 'local-repo-c', number: 1, _overTheWire: true }),
    'in the window|like giving one',
    'an allowance was taken back from outside the window'
  )

  log('both doors refuse the wire, so allowing one is a person at the window')
})

it('and it is not on the list of what a supervisor may call', async ({ okc, assert, log }) => {
  // TWO GATES, AND THIS IS THE OUTER ONE. The refusal above is what happens when
  // it is pressed; this is whether the supervisor is ever told the press exists.
  // A refusal is a door somebody can rattle — see `the ways round a refusal` —
  // and the list is what decides whether it is even in the corridor.
  const { may } = await okc('supervisorMay')
  const names = (may || []).map((m) => m.action)

  assert.ok(names.length, 'the supervisor may call nothing at all, so finding this one absent proves nothing')

  for (const what of ['prAllowJudging', 'prForbidJudging', 'prJudging']) {
    assert.ok(!names.includes(what),
      `${what} is on the supervisor's list, and the whole point is that it is not — the model would be deciding that a stranger's code is fit for a model to read`)
  }

  log(`${names.length} actions on the supervisor's list, and none of them is this one`)
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
