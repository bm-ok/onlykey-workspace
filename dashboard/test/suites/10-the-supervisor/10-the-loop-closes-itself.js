'use strict'

// the loop closes itself — a cut of this host's own, reaching its end, is news
//
// THIS IS THE TAIL OF THE DRILL BESIDE IT. "an issue becomes a pull request"
// walks the loop out to a pull request and stops there, because that is where a
// person takes over. What happens AFTER the person presses had nobody watching
// it at all.
//
// THE FAULT, ON THE LOOP WALKED ON 19 AUGUST 2026. The supervisor wrote the
// draft, woke when the pull request arrived, checked the head commit was the one
// its own judge had read, recommended the merge, and closed its own item about
// waiting for the press. Then a person merged it and NOTHING TOLD THE
// SUPERVISOR. Three minutes later it was still sitting with the item about the
// actual work marked as being done. The last step of the loop was the one step
// nothing drove.
//
// The cause was a rule that is right in general: a look reports what is new and
// what has moved, and says nothing about what has gone, because "a closed issue
// is not news to act on". True for an issue somebody else closed. False for a
// pull request this host cut, which is the far end of something that started
// here.
//
// WHY THIS IS ARITHMETIC AND NOT A REAL MERGE. Deciding which watched things
// have ended is a comparison of two records; finding out what became of one is a
// trip to GitHub. `endedAmong` is the first half on its own, so the rule can be
// checked without a network and — the part that matters — WITHOUT MERGING
// ANYTHING. A drill may not press that button. See the last check in this file:
// merging is a person's, and this kit does not get to be the exception.
//
// The numbers below are on a repository that does not exist. The rule never asks
// GitHub, so a pull request nobody can reach checks it exactly as well and
// leaves nothing behind on anybody's tracker.

const { it, requires } = require('../../../tasks/harness')
const watching = require('../../../repos/watching')
const supervisor = require('../../../core/supervisor')

requires('what this host has')

const ON = 'okc-drill/nothing-real'
const pull = n => `${ON} pull#${n}`
const issue = n => `${ON} issue#${n}`

// One cut of this host's own, carrying one pull request. `into` is the field the
// landings record actually stores — `on` is the name the same value carries in
// the live projection, and reading for the wrong one matched nothing at all,
// silently, which is how the first version of this shipped doing nothing.
const CUTS = {
  'a line -> default': {
    source: 'a line',
    target: 'default',
    pulls: [{ repo: 'nothing-real', number: 41, into: ON, state: 'open' }]
  }
}

const watched = (id, kind, number) => ({ id, kind, on: ON, repo: 'nothing-real', number, title: 'a thing' })

it('a cut of this host that is no longer open is news', async ({ assert, log }) => {
  const seen = { [pull(41)]: watched(pull(41), 'pull', 41) }
  const said = watching.endedAmong(seen, {}, CUTS)

  assert.equal(said.length, 1, 'a pull request this host cut fell out of the open list and nothing said so')
  assert.equal(said[0].number, 41, 'it named the wrong pull request')
  log(`${said[0].on}#${said[0].number} has ended, and the supervisor is told`)
})

it('and a closed issue is still not', async ({ assert }) => {
  // THE HALF OF THE RULE THAT WAS ALWAYS RIGHT, and the reason this is a
  // narrowing rather than a reversal. Somebody else opened it and somebody else
  // closed it; it was never this host's loop to close, and waking a model to
  // tell it so costs a turn of somebody's money for nothing.
  const seen = { [issue(41)]: watched(issue(41), 'issue', 41) }
  assert.equal(watching.endedAmong(seen, {}, CUTS).length, 0, 'a closed issue woke the supervisor')
})

it('and a pull request nobody here cut is not', async ({ assert }) => {
  // A stranger's pull request closing on a repository this workspace watches is
  // somebody else's business. Only a cut in the landings record is a loop that
  // started here.
  const seen = { [pull(99)]: watched(pull(99), 'pull', 99) }
  assert.equal(watching.endedAmong(seen, {}, CUTS).length, 0, "somebody else's pull request was reported as this host's")
})

it('and a repository that could not be read has said nothing', async ({ assert }) => {
  // THE MISTAKE THIS FILE HAS ALREADY PAID FOR ONCE. GitHub was unreachable for
  // ten minutes overnight and every issue and pull request dropped out of the
  // record, so the next successful look read all of them as new. The fix carries
  // an unreadable repository's entries forward untouched — they stay in `now` —
  // and this is the same guard from the other side: still in `now` means it has
  // not gone, whether that is because it is still open or because nobody could
  // ask. "I did not hear" is not "it ended".
  const one = watched(pull(41), 'pull', 41)
  const seen = { [pull(41)]: one }
  assert.equal(watching.endedAmong(seen, { [pull(41)]: one }, CUTS).length, 0,
    'a repository that could not be read was treated as one whose work had gone')
})

it('and merging is a person, which is why this drill merges nothing', async ({ assert, log }) => {
  // THE BOUNDARY THE WHOLE LOOP RESTS ON. Everything before a merge is
  // recoverable from GitHub and a merge is not: it is the one act this app takes
  // that lands in somebody's repository for good.
  //
  // A SUPERVISOR IS REFUSED IT OUTRIGHT — not by a setting, not by a mode, but
  // by not being on its list at all, which is the only kind of refusal that
  // cannot be switched off by accident.
  assert.equal(supervisor.may('prCutLand'), false, 'a supervisor could merge a cut into somebody\'s repository')
  assert.ok(!Object.keys(supervisor.MAY).includes('prCutLand'), 'prCutLand appeared on the supervisor\'s list')

  // AND THE KIT IS NOT AN EXCEPTION. `prCutLand` refuses from outside the window
  // UNLESS testing mode is on — and testing mode is exactly the state the drills
  // run in, so during a run this refusal is not what stands between this file and
  // somebody's main branch. Nothing does, except that no drill calls it. That is
  // worth saying out loud rather than leaving as an unwritten habit: a kit that
  // may merge is a kit that merges the first time somebody writes the wrong line.
  log('prCutLand is not on the supervisor\'s list, and no drill in this kit calls it')
})

// WHAT IT SAW, on 19 August 2026, in fifty-one milliseconds:
//
//   a cut of this host that is no longer open is news
//     okc-drill/nothing-real#41 has ended, and the supervisor is told
//
//   and merging is a person, which is why this drill merges nothing
//     prCutLand is not on the supervisor's list, and no drill in this kit calls it
//
// THE OTHER THREE CHECKS SAY NOTHING, and that is what they are for. A closed
// issue, a stranger's pull request and a repository that could not be read all
// have to produce SILENCE, and silence is not something a log line can show —
// only a count of nought can. They are the three ways this could have become a
// wake that costs money and tells the supervisor nothing.
//
// AND THE REAL ONE, WHICH THIS CANNOT REACH. The rule was proven against the
// genuine merged pull request the day it was written, by seeding the watch
// record with it as though it were still open and running a live look: it came
// back merged, with a closed issue beside it that was correctly ignored. That
// run is also what found the fault — the set was being built from `p.on` where
// the record stores `p.into`, so it matched nothing, silently, and reported
// nothing for the right-looking reason. Reading the code did not find it and
// would not have.
