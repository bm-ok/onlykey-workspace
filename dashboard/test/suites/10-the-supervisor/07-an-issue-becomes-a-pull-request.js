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

const { draft, requires } = require('../../../tasks/harness')

requires('the supervisor', 'judging')

draft('a person opens an issue and the supervisor reads it',
  'THE TRIGGER, AND IT IS THE PART THAT IS NOT BUILT. `whatsNew` carries what was said, tasks, machines, cuts and what happened — and NOT issues or pull requests. ' +
  'So a supervisor waking on a quiet host is never told that an issue arrived; it can ASK (`issues` is on its list, and it did) but only because the wake reason named it. Without that it would wake, see nothing new, and go back to sleep with an open issue sitting there. ' +
  'WHAT HAS TO EXIST FIRST: `whatsNew` reporting open issues and incoming pull requests, and something that wakes the supervisor when one arrives. This app deliberately never asks GitHub on a timer, so that is a decision rather than a line of code — poll on a slow cadence, or check on every wake and rely on other things waking it. ' +
  'THE CHECK: with an issue open that the supervisor has not been told about, wake it for an unrelated reason, and it still finds the issue. Today it does not, and the run above only worked because the wake reason said "a new issue arrived on local-repo-c: #2".')

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
  'THE CHECK: save a draft naming an issue URL, cut without passing a body, and the pull request on GitHub carries the draft\'s title and its issue link. And the merge closes the issue, which is the whole point of the keyword and is the thing that was actually wanted.')

draft('and one cut, never one repository',
  'BUILT AND ENFORCED BY THE ARGUMENT TYPE. `prCutMake` takes two LINE names and `twoLines` refuses anything that is not a line, so a raw branch cannot be sent out — it has to be made a line first, and the line is what goes out as one act with one pull request per repository that carries something. ' +
  'There is no per-repository PR action anywhere, and none on the supervisor\'s list. ' +
  'THE CHECK: with a line carrying commits in one repository of three, one pull request is opened and the cut records it as one landing; and `prCutMake` given a branch name rather than a line name is refused.')
