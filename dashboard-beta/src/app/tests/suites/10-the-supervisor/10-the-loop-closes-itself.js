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

// ---- what this asks, and what it stopped asking --------------------------
//
// IT COULD NOT LOAD. It required `repos/watching` and `core/supervisor`, and a
// drill runs from `dist/suites` with only the harness beside it.
//
// AND THE FIRST OF THOSE IS NOT A RENAME. This app has no `endedAmong` and
// nothing that answers the question it asks: which of the pull requests this host
// cut have since been merged or closed, and are therefore news the supervisor has
// not been told. Four of this file's five checks were about that function, so
// four of them are describing something that is not here yet. They are a DRAFT
// below rather than checks that fail — a check failing says a rule broke, and
// nothing broke; this half of the loop has not been carried over.
//
// WHAT IS HERE IS THE FIFTH, and it is the one the whole loop rests on.

const { it, requires, draft } = require('../../harness')

requires('what this host has')

it('merging is a person, which is why this drill merges nothing', async ({ okc, assert, log }) => {
  // THE BOUNDARY THE WHOLE LOOP RESTS ON. Everything before a merge is
  // recoverable from GitHub and a merge is not: it is the one act this app takes
  // that lands in somebody else's repository for good.
  //
  // A SUPERVISOR IS REFUSED IT OUTRIGHT — not by a setting, not by a mode, but by
  // not being on its list at all, which is the only kind of refusal that cannot
  // be switched off by accident.
  const { may } = await okc('supervisorMay')
  const names = (may || []).map((m) => m.action)

  assert.ok(names.length, 'the supervisor may call nothing at all, so finding this one absent proves nothing')
  assert.ok(!names.includes('prCutLand'),
    'prCutLand is on the list of what a supervisor may call, so a model could merge a cut into somebody else\'s repository')

  // AND THE KIT IS NOT AN EXCEPTION, which is worth saying out loud rather than
  // leaving as an unwritten habit.
  //
  // `prCutLand` refuses from outside the window UNLESS testing mode is on — and
  // testing mode is exactly the state the drills run in. So during a run that
  // refusal is NOT what stands between this file and somebody's main branch.
  // Nothing does, except that no drill calls it. A kit that may merge is a kit
  // that merges the first time somebody writes the wrong line.
  log(`prCutLand is not among the ${names.length} actions a supervisor may call, and no drill in this kit calls it`)
})

// ---- and the half of the loop that has not been carried over ---------------

draft('a cut of this host that is no longer open is news',
  'WHAT IT WOULD DO: notice that a pull request this host CUT has been merged or closed, and tell the supervisor '
  + 'once — which is what closes the loop, because otherwise the last thing that happens to a piece of work is '
  + 'invisible to the thing that started it. '
  + 'WHERE IT STANDS: the app being ported from has `repos/watching.endedAmong(seen, extra, cuts)`; this one has '
  + 'nothing that answers the question, and nothing in supervisor/carrying or supervisor/todos looks at whether a '
  + 'cut has ended. '
  + 'THE FOUR CHECKS THIS FILE USED TO MAKE, and each is a way it can go wrong — three of them by SAYING SOMETHING '
  + 'when it should be silent, which is worse than saying nothing, because a supervisor woken for nothing learns to '
  + 'be woken for nothing: (1) a pull request of ours that has ended IS news; (2) a closed ISSUE is not, because an '
  + 'issue is not a cut; (3) a pull request nobody here cut is not, however interesting — it is not this host\'s '
  + 'work; (4) a repository that could not be READ has said nothing, and an unreadable repository must not read as '
  + '"everything in it ended". '
  + 'WHY IT IS A DRAFT AND NOT A FAILING CHECK: nothing broke. This is a feature the port has not reached, and a red '
  + 'drill would say the opposite. '
  + 'WHERE IT SHOULD BE ASKED WHEN IT EXISTS: `endedAmong` is a function of three lists with no host in it, so it '
  + 'belongs in test/, the way pr-allowing and queue-plan do. What belongs HERE is only that the supervisor is actually told, once, on a host where one of its cuts has just been merged.')
