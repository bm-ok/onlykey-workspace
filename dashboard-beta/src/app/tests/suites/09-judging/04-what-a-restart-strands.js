'use strict'

// what a restart strands — and what it must not touch on the way past
//
// FOUND BY DOING IT, ON 18 AUGUST. The dashboard was restarted in the twenty
// seconds between a machine being set up for J41 and its run starting. The
// judgement sat in `given` with no run: invisible to the queue, which only looks
// at `queued`, and invisible to the recovery loop, which only looks for a run to
// wait on. Its machine was rolled back underneath it and nothing said so.
//
// THE RULE THAT WAS MISSING was not missing for tasks. Adoption had had it for
// years — work in `given` with no run was being SET UP when this stopped and
// never started, so nothing was dispatched, nothing happened, and putting it
// back in the queue loses nothing. Judging arrived later, shares this queue, is
// dispatched by the same tick, and adoption was never told about it.
//
// THAT IS THE FAULT WORTH CHECKING FOR, and it is not really about judging: it
// is a rule written when tasks were the only kind of work there was, and a
// second kind added underneath it. Six of those have now been found. So the
// check below asks the rule about BOTH kinds, and about the field each of them
// uses to say whose work it is — a rule that reads `worker` and nothing else
// stops applying to judging without anything appearing to break.
//
// AND THE EXCEPTION MATTERS MORE THAN THE RULE. A person's work has no run for
// as long as they are in it — there is no run because there is no worker
// process; the exit code is a human saying "finished". Re-queueing one hands
// somebody's branch to a machine while they have an editor open on it. That is
// the most expensive thing in this file and the cheapest to get wrong.
//
// NO MACHINE, NO RESTART. `adopt` runs once at startup against the real board,
// so asking it anything used to mean restarting the app and arranging for the
// restart to land inside a twenty-second window — which is how this was found,
// by accident, rather than by anybody checking. The deciding is now separable
// from the doing (`stranded` in tasks/queue.js) and this hands it boards it
// makes up. What is still a draft is the other half: that a real run survives a
// real restart, which needs the app stopped and started and so belongs to a
// person.

// ---- where the arithmetic went, and why it is better off there ----------
//
// THIS FILE COULD NOT LOAD. It required `tasks/queue` to call `stranded`
// directly, handing it boards it made up — a drill runs from `dist/suites` with
// only the harness beside it and cannot reach the app's insides.
//
// AND MADE-UP BOARDS ARE NOT A DRILL'S WORK. There is no host in the question,
// no machine and no restart: it is a function of a list, and asking it here meant
// it was only ever asked when somebody exercised the kit.
//
// `test/queue/queue-plan.test.js` asks it — a task that was being set up is
// stranded, a judgement that was is too, and a person's work never is, whichever
// kind it is — and `test/queue/queue-adopting.test.js` asks what is DONE about
// them: re-queued, left alone, and nothing recovered in a workspace nobody is
// serving.
//
// MOVING THE LAST OF IT FOUND A GAP. Nothing over there had ever handed
// `stranded` an empty board, a missing one, or one with holes in it — the
// defensive case that makes `adopt`'s early return a second door rather than the
// only one. It is asked there now.
//
// WHAT IS LEFT IS THE PART THAT NEEDS A RESTART, and it is below, still a draft
// for the reason it always was: this harness runs INSIDE the app, so a check
// here cannot restart the app without killing itself.

const { draft } = require('../../harness')

draft('and a real run survives a real restart', [
  'WALKED ON 20 AUGUST 2026, AND IT FOUND ONE. A run is detached on purpose —',
  'nohup, its own session — so this app is not the work, and restarting it must',
  'interrupt only the WATCHING. What adoption owes is to wait on a run that is',
  'still alive, keep its log, put the machine away, and re-queue anything that',
  'had not dispatched.',
  '',
  'HOW IT WAS DONE: J74 was queued against an already-merged branch, so the',
  'reading itself did not matter; the dashboard was killed once the run existed',
  'and started again. Adoption said "J74 was being read when this restarted;',
  'picking it back up", waited two minutes, took the recommendation off the',
  'machine, took the credential back — refreshed — and rolled kit-1 to base.',
  'Four of the five things owed, done.',
  '',
  'THE FIFTH WAS NOT: the log. The ordinary path keeps it "so it survives the',
  'machine"; adoption called waitForRun, threw the outcome away, and kept',
  'nothing — so the attempt carried no exit code and no outcome, and',
  'judgementLog explained the absence as "judgements read before this app',
  'started keeping their logs have none", about one made four minutes earlier.',
  'That undid a fix the record already carries: without the exit code, a',
  'judgement that CRASHED and one that read the change and found nothing are',
  'the same row, and the machine is rolled back moments later taking the answer',
  'with it. Every run a restart happened to interrupt lost that distinction.',
  '',
  'FIXED AND PROVEN THE SAME WAY: J75, same branch, same kill mid-run — log',
  'kept at 213,754 bytes, attempt marked exit 0, outcome finished, adopted true.',
  'J74 beside it still has an empty attempt and no log, which is the before.',
  '',
  'WHY IT IS STILL A DRAFT: the harness runs INSIDE the app, so a check here',
  'cannot restart the app without killing itself. It is a person-driven drill —',
  'queue a judgement, wait for state "given" with a run, kill the dashboard,',
  'start it, and read judgementLog afterwards. Roughly a dollar and six minutes.',
  '',
  'WHAT IS ALREADY COVERED WITHOUT IT: the rule that decides what is stranded,',
  'above, which is the half that was wrong the first time.'
].join(' '))
