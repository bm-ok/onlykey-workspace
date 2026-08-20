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

const { it, draft } = require('../../../tasks/harness')
const queue = require('../../../tasks/queue')

// The two kinds of work, and the two different words they use for whose it is.
// Written out rather than derived, because the point of the check is that these
// two are NOT the same shape and the rule has to hold across both anyway.
const AS_TASKS = x => x.worker
const AS_JUDGEMENTS = x => x.by

it('work that was being set up when this stopped goes back in the queue', ({ assert, log }) => {
  const board = [
    { id: 't1', number: 7, state: 'given', run: null, machine: 'kit-1', worker: 'claude' },
    { id: 't2', number: 8, state: 'queued', run: null, machine: null, worker: 'claude' },
    { id: 't3', number: 9, state: 'given', run: 'run-9', machine: 'kit-2', worker: 'claude' },
    { id: 't4', number: 10, state: 'done', run: 'run-10', machine: null, worker: 'claude' }
  ]

  const out = queue.stranded(board, AS_TASKS).map(x => x.id)
  assert.equal(out.join(', '), 't1', `only the one being set up is stranded, and this picked ${out.join(', ') || 'nothing'}`)

  // SAID THE OTHER WAY ROUND, because each of the three it left alone is left
  // alone for a different reason, and a check that only counts one would pass
  // while any of them broke.
  assert.ok(!out.includes('t2'), 'a task still queued was never given to anything — re-queueing it would be a second copy')
  assert.ok(!out.includes('t3'), 'a task WITH a run is in flight and is adopted, not re-queued — this is the one that would steal work from a machine still doing it')
  assert.ok(!out.includes('t4'), 'a finished task is finished')

  log('of given-without-run, queued, in-flight and done, only the first is stranded')
})

it('and the same rule holds for a judgement, which says it differently', ({ assert, log }) => {
  // THE ACTUAL SHAPE OF J41: given, no run, a machine that was about to be told
  // what to do. A judgement says `by` where a task says `worker`, and that one
  // word is the whole of why adoption did not cover this for as long as it did.
  const board = [
    { id: 'j41', number: 41, ref: 'J41', state: 'given', run: null, machine: 'kit-1', by: 'claude' },
    { id: 'j42', number: 42, ref: 'J42', state: 'given', run: 'run-42', machine: 'kit-2', by: 'claude' },
    { id: 'j43', number: 43, ref: 'J43', state: 'given', run: null, machine: null, by: 'person' }
  ]

  const out = queue.stranded(board, AS_JUDGEMENTS).map(x => x.ref)
  assert.equal(out.join(', '), 'J41', `J41 is the stranded one, and this picked ${out.join(', ') || 'nothing'}`)

  // AND THE CROSS-CHECK, WHICH IS THE ONE WORTH HAVING.
  //
  // Ask the same board with the TASK's word for whose work it is. Every row
  // answers undefined, because a judgement has no `worker` — so nothing looks
  // like a person's, and J43 is swept up alongside J41. That is not a
  // hypothetical: it is what a rule reading one field does the day a second
  // kind of work arrives, and it fails silently, because sweeping up more than
  // you meant to looks exactly like working.
  const wrongWord = queue.stranded(board, AS_TASKS).map(x => x.ref)
  assert.equal(wrongWord.join(', '), 'J41, J43', `asked with a task's word, the rule should sweep up the person's judgement too — that is the failure being demonstrated — and it picked ${wrongWord.join(', ') || 'nothing'}`)

  log(`by \`by\`: ${out.join(', ')}. by \`worker\`, which is the fault: ${wrongWord.join(', ')} — J43 is a person's`)
})

it('and a person\'s work is left where it is, whichever kind it is', ({ assert, log }) => {
  // THE EXPENSIVE ONE. Both boards, both words, both left alone — a person's
  // work sits in `given` with no run for as long as they are working in it,
  // which is exactly the shape of the thing being swept up above.
  const tasks = [
    { id: 'p1', number: 11, state: 'given', run: null, machine: null, worker: 'person' },
    { id: 'c1', number: 12, state: 'given', run: null, machine: 'kit-1', worker: 'claude' }
  ]
  const judgements = [
    { id: 'pj', number: 43, ref: 'J43', state: 'given', run: null, machine: null, by: 'person' },
    { id: 'cj', number: 44, ref: 'J44', state: 'given', run: null, machine: 'kit-1', by: 'claude' }
  ]

  const t = queue.stranded(tasks, AS_TASKS).map(x => x.id)
  assert.equal(t.join(', '), 'c1', `a person's task must be left alone; this would have re-queued ${t.join(', ')}`)

  const j = queue.stranded(judgements, AS_JUDGEMENTS).map(x => x.ref)
  assert.equal(j.join(', '), 'J44', `a person's judgement must be left alone; this would have re-queued ${j.join(', ')}`)

  log('a person\'s task and a person\'s judgement both stay put; the machine\'s of each go back in the queue')
})

it('and an empty board is not something to recover', ({ assert, log }) => {
  // NOT PEDANTRY. `adopt` returns early when no workspace is open, because
  // asking would read an empty board and "recover" it — adoption doing the one
  // thing it exists to prevent. This says the rule underneath it is safe on
  // nothing at all, so that early return is a second door rather than the only
  // one.
  assert.equal(queue.stranded([], AS_TASKS).length, 0, 'an empty board strands nothing')
  assert.equal(queue.stranded(null, AS_TASKS).length, 0, 'no board at all strands nothing')
  assert.equal(queue.stranded([null, undefined], AS_TASKS).length, 0, 'a board with holes in it strands nothing')
  log('empty, absent and holed boards all strand nothing')
})

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
