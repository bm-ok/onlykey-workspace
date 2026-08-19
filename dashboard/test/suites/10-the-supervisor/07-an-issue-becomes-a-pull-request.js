'use strict'

// an issue becomes a pull request — the loop, end to end, with a person at both ends
//
// THIS RAN FOR REAL ON 17 AUGUST 2026 and is written down here so it can be run
// again. A person opened local-repo-c issue #2; the supervisor read it, had a
// judge check the claim, cut a line, wrote a task from the judgement, had the
// result judged again, and opened a pull request carrying the issue's URL. The
// person merged it and closed the issue.
//
// IT FOUND ELEVEN DEFECTS AND NONE OF THEM WERE FINDABLE BY READING CODE. That
// is the argument for these being drills rather than unit checks, and it is
// worth listing what kind they were, because a drill that does not reach them is
// not this drill:
//
//   a judging job that had never once loaded, while reporting itself runnable
//   a crashed run described in the record as "it read it and found nothing"
//   a finished judgement that woke nobody, so the answer sat unread
//   jobs that never streamed, so most work was invisible while it happened
//   an ssh key wiped by every rollback, so terminals died a run later
//   a gate demanding a judgement of a name that CANNOT be judged
//   a saved draft silently dropped, so the pull request lost its issue link
//
// Every one of them was fluent, correct-looking machinery with a wrong fact
// underneath. The loop has to be driven for them to appear.

const { it, draft, requires } = require('../../../tasks/harness')

requires('the supervisor', 'judging')

// THE TRIGGER, WHICH THIS DRAFT SAID WAS NOT BUILT. It is now, and the note is
// kept because the reasoning was right and the decision it named has been taken.
// What it asked for was `whatsNew` reporting issues and incoming pull requests,
// and something to wake the supervisor when one arrives -- observing that this
// app deliberately never asks GitHub on a timer, so it was a decision rather
// than a line of code. The decision went to a slow, opt-in poll: repos/watching.js
// looks every five minutes when `watchGitHub` is on, and the queue wakes the
// supervisor with what it found.
//
// IT RAN FOR REAL ON 19 AUGUST 2026, twice in one hour. A pull request this host
// had itself opened was noticed and the supervisor was woken with its number and
// title -- and answered, correctly, that there was nothing to do because it had
// made it. Later a merge woke it the same way.
it('a supervisor waking is told what arrived on GitHub, without asking GitHub', async ({ actions, assert, log }) => {
  const now = await actions.whatsNew.run({})

  // THE SHAPE IS THE CLAIM. A supervisor that has to know to ask is one that
  // wakes on a quiet host, sees nothing, and goes back to sleep with an open
  // issue sitting there -- which is exactly what happened before this existed.
  assert.ok(now.arrived, 'a waking says nothing about what arrived from outside')
  assert.ok(Array.isArray(now.arrived.issues), 'it does not report issues')
  assert.ok(Array.isArray(now.arrived.pulls), 'it does not report incoming pull requests')

  // AND IT IS A READING, WITH ITS AGE. This runs inside a wake, and a wake is
  // not the moment to spend a round trip per repository -- so it reports what
  // the watcher last saw and says when that was. A list with no age is one
  // somebody treats as current for ever.
  assert.ok('lookedAt' in now.arrived, 'it does not say when the list was taken, so nothing can tell a fresh answer from a stale one')
  assert.ok('watching' in now.arrived, 'it does not say whether anything is looking at all, so an empty list is unreadable')
  log(`watching: ${now.arrived.watching}, last look ${now.arrived.lookedAt || 'not yet'}, ${now.arrived.issues.length} issue(s) and ${now.arrived.pulls.length} pull request(s)`)
})

draft('and it finds an issue it was never told about',
  'WHAT IS LEFT OF THE TRIGGER DRAFT, and it is a much smaller thing than it was. The reporting is built and checked above; the waking is built and has run for real twice. ' +
  'What has never been watched is the case the original note cared about most: an issue that arrived while nothing was waking, so the wake REASON does not name it and the only way to find it is to read `arrived` in whatsNew. ' +
  'THE CHECK: with an issue open on a watched repository and no wake pending for it, wake the supervisor for an unrelated reason and it still finds the issue. ' +
  'WHY IT IS A DRILL AND NOT A CHECK: it costs a supervisor turn of somebody\'s money and needs a real issue on a real repository, so it belongs with the runs that spend rather than with the arithmetic.')

draft('and a judge decides whether the claim is real before any work is written',
  'THIS HALF IS BUILT AND WAS PROVEN. `taskCreate` over the wire refuses without `becauseOf` naming a FINISHED judgement, and in the real run the supervisor tried twice to get round it — once passing a prose sentence as the ref, once leaving it off — before reasoning its way to "the issue\'s claim has to be checked first". ' +
  'The refusal text is what taught it the path, which is the argument for refusals that say what to do next. ' +
  'THE CHECK, as a drill rather than the unit version in `judging`: from an issue, the supervisor produces a judgement of the claim BEFORE any task exists, and the task that follows names that judgement. The unit refusals are already checked — see "the judge is the gate" — so what this adds is that a supervisor actually walks it.')

draft('and the work is judged again before it goes out',
  'BUILT, AND THE SECOND JUDGEMENT IS THE ONE THAT MATTERS. J31 established the claim was real; J32 read what the task delivered. `prCutMake` refuses over the wire unless a judgement of that line has finished, is not stale against the tips it was made on, and did not reject. ' +
  'A judgement made before the last push does not count — which is exactly the case here, because J31 was made before the fix was pushed. ' +
  'THE CHECK: after the task delivers, sending the change out is refused until a judgement made AFTER that push has accepted it. Then it goes.')

draft('and the pull request carries the issue it came from',
  'THE ONE THAT BROKE, AND IT BROKE SILENTLY. The supervisor wrote "Closes #2 — <url>" into the draft with `prDraftSave`, then called `prCutMake`, which read only its `body` argument and ignored the draft entirely. The pull request went out as template blocks, titled after the LINE, with no closing keyword anywhere in it — so the issue stayed open through the merge and had to be closed by hand. ' +
  'Nothing failed, nothing warned, and the only way to find it was to ask GitHub what the body actually said. ' +
  'FIXED — the body and the title fall back to the saved draft — so this is now a check that can be written rather than a draft. It is here rather than done because it needs a real cut against GitHub, which is a drill with somebody\'s repository at the end of it. ' +
  'HALF OF IT HAS SINCE HAPPENED, in earnest rather than as a drill. On 19 August the supervisor called prDraftSave and then prCutMake with no body argument, and the host recorded "the pull request text came from the draft kept for fix/escape-note-id-in-data-id into default". The silent drop is gone and a real cut proved it. ' +
  'THE OTHER HALF IS UNTESTED, and it is the half this note is named for: there was no ISSUE in that run, so nothing has yet confirmed that a closing keyword written into a draft survives into the pull request and closes the issue on merge. That is the thing that stayed open through a merge and had to be closed by hand. ' +
  'THE CHECK: save a draft naming an issue URL, cut without passing a body, and the pull request on GitHub carries the draft\'s title and its issue link. And the merge closes the issue, which is the whole point of the keyword and is the thing that was actually wanted.')

draft('and one cut, never one repository',
  'BUILT AND ENFORCED BY THE ARGUMENT TYPE. `prCutMake` takes two LINE names and `twoLines` refuses anything that is not a line, so a raw branch cannot be sent out — it has to be made a line first, and the line is what goes out as one act with one pull request per repository that carries something. ' +
  'There is no per-repository PR action anywhere, and none on the supervisor\'s list. ' +
  'THE CHECK: with a line carrying commits in one repository of three, one pull request is opened and the cut records it as one landing; and `prCutMake` given a branch name rather than a line name is refused.')
