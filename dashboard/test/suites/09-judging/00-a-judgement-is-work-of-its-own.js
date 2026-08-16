'use strict'

// judging — reading what came back, as work rather than as a field
//
// Every check here is a DRAFT. Nothing in this file runs, and that is the honest
// state of judging: the last step of this tool, and the only one that has never
// happened end to end. See the README beside this file for the shape it is meant
// to take and why `taskJudge` is a placeholder.

const { draft, requires } = require('../../../tasks/harness')

// It reads what a task delivered, so it stands on work getting out and coming
// back at all. And on the order, because a verdict lands on a PR cut.
requires('a task on a machine', 'the order')

draft('a judgement is a task whose subject is a PR cut',
  'THE SHAPE, and none of it exists. Today taskJudge writes a verdict onto the task that produced the work — a field, set by a person at a command line. ' +
  'What is wanted is the same chain with one end changed: ' +
  'branch <- task <- job <- prompt <- contract is the work; PR CUT <- task <- job <- prompt <- contract is judging it. ' +
  'Work delivers onto a branch; a judgement delivers onto the cut — one pull request per repository that carries something, taken as one act — because that is what is actually being judged: the change as it is proposed for landing, not a commit and not a branch. ' +
  'IT TAKES NO BRANCH OF ITS OWN, which follows from that: it reads rather than writes, and a task claiming a branch it never pushes to would hold a machine on that branch for no reason. ' +
  'WHY IT MATTERS BEYOND TIDINESS: a task gets a machine, a run, a log and a record of what it saw. A field gets none of those, so "why was this accepted" is answerable only by asking whoever typed it. ' +
  'AND job <- prompt <- contract IS ALREADY BUILT, with a tab of its own and an approval per substance — so a judging job is a job, its prompt is a prompt, its contract is a contract, and nothing new appears in the library. The only new thing is the left-hand end. ' +
  'THE CHECK: judge an open cut, and a task exists whose subject is that cut, with its own job and its own run, holding no branch.')

draft('and an open cut is what asks for one',
  'THE TRIGGER, and it is not somebody deciding to judge a task. A cut is opened when work is proposed for landing — that is the moment the change stops being one machine\'s business and becomes something to be read — so an open cut is a thing WAITING to be judged, and the app should say so without being asked. ' +
  'WHICH IS WHY IT IS THE CUT AND NOT THE TASK: a cut may carry work from more than one task, and a task may deliver nothing worth landing. Judging follows the change, not the occasion that produced it. ' +
  'THE CHECK: open a cut, and it appears as awaiting a judgement — before anybody has typed anything. Land or close it, and it stops asking. ' +
  'NOT AUTOMATIC, AND THAT IS DECIDED. An open cut ASKS; it does not start anything. The judgement is begun by a button on the cut\'s own card, so the cut reads as unjudged until a person presses it. ' +
  'Automatic would make a queue of judgements running unattended against somebody\'s repository, reporting to GitHub, with nobody having chosen this cut or this chain — which is the same thing this app already refuses about approving a job down a pipe. Asking is free; acting is a decision. ' +
  'THE OTHER HALF OF THE CHECK: an open cut with nobody pressing anything stays unjudged for ever, and nothing runs.')

draft('and the judge tab shows what is waiting, what is being judged, and what was decided',
  'THE HOME IT NEEDS. "Judge it" used to be a button on the task\'s own card — the screen that asked for a decision showed the QUESTION and not the answer — and it was removed rather than moved, so there is nowhere to do this today. ' +
  'WHAT THE SCREEN IS BUILT AROUND: the delivery. The cut\'s commits, the diff, the files handed back, the run\'s log, and the two buttons under all of it. ' +
  'THE LIST is the part this draft adds: every open cut, which are waiting, which have a judgement in flight, and which were decided — with the verdict and what it was judged on. That is the same shape as the task board, one level up, and it is what makes judging something you can be BEHIND on rather than something you remember to do. ' +
  'THE CHECK: with one cut open and one judged, the tab lists both under the right heading, and the judged one names its verdict and the run behind it. ' +
  'TO SETTLE: whether this is a tab of its own or the bottom of the board\'s third column once something has arrived. A tab is findable; the column is where somebody already is.')

draft('and a sub-tab lists the judgements that can be run, as whole chains',
  'THE COMBINATIONS, which the library tab cannot show. Jobs, prompts and contracts are listed there one substance at a time, because that is how they are written and approved — but a JUDGEMENT you can run is a whole chain: this job, giving these words, under these rules. Picking one from three separate lists is asking somebody to recombine in their head what the app already knows. ' +
  'WHAT IT LISTS: every job whose prompt and contract are approved, shown as the chain it is — job <- prompt <- contract — with the ones that cannot run saying which rung is missing. ' +
  'THE DATA IS ALREADY THERE: `jobs` reports `runnable` and `whyNot`, and whyNot names the one rung rather than saying "not approved" about the thing that plainly is. Nothing shows it combined. ' +
  'THE CHECK: with one judging job approved end to end and one whose contract is not, the sub-tab lists both, the first as runnable and the second naming the contract. ' +
  'TO SETTLE: whether a judgement is chosen per cut, or a cut has a default chain it is judged by — a repository where every cut is judged the same way should not ask the same question every time.')

draft('and it is done by either kind of supervisor',
  'A person reading a diff and a worker running checks are the same act with a different body — which is what the spine already says about who supervises, and the reason judging should not be a special case bolted to a task. ' +
  'A judging job might run the tests, read the diff against the contract, or do nothing but wait for a person. ' +
  'THE CHECK: the same judgement, given to a worker and given to a person, produces the same kind of record — a verdict, a note, and what it was judged on. ' +
  'TO SETTLE: whether a person\'s judgement is a run at all, or a task that is completed without one. Every other kind of work here has a run behind it.')

draft('and the verdict reaches the PR cut it is landing through',
  'A verdict lives on a task and stops there. The work it is about is landing through a PR cut — one pull request per repository that carries something — and somebody reading that cut cannot see whether anything was judged. ' +
  'THE CHECK: judge the work on a branch that has a cut open, and the cut reports it — which repositories were judged, by what, and whether the verdict still describes what is there. ' +
  'The last part is the hard part: a judgement made before another push is a judgement of something else. `judgements` in actions/repos.js already reasons about exactly that and nothing calls it — see test/unused.md.')

draft('and GitHub is told, beside the pull request',
  'THE OUTWARD HALF. Anybody looking at the change on GitHub — which is where a reviewer looks — has no way to know this app checked it. A verdict belongs there: a status or a check beside the pull request, saying what was run and what it found. ' +
  'THE CHECK: after a judgement, the pull request on the parent carries a status naming this app and the verdict. ' +
  'TO SETTLE: whether that is a commit status, a check run, or a comment — a comment is the easiest and the least useful, since it cannot gate a merge. And whether a rejection blocks the merge button, which is a decision about somebody else\'s repository rather than about this app.')

draft('and a rejection says what happens to the work',
  'NOT A CHECK YET, BECAUSE THE BEHAVIOUR IS NOT DECIDED — and this is the sharpest example of why an undecided thing must not be written as one. ' +
  'taskJudge refuses a rejection with no reason, because "a rejection with no reason is sent back to a worker that cannot ask what was wrong". Nothing is sent anywhere. ' +
  'TO SETTLE: does a rejection re-queue the same task so a worker sees the note and tries again, write a NEW task carrying it, or is it only a record about work that is finished? ' +
  'The first keeps one identity and needs the attempts kept — they are, in `attempts`. The second makes "what happened to this piece of work" span two numbers. The third is what the code does today, and the wording says otherwise. ' +
  'One of those is true by accident. Deciding which is meant is the work, and a check written now would enshrine the accident.')

draft('and taskJudge is replaced rather than removed',
  'It is the placeholder this design grew around: a verdict recorded on a task, from before there was a shape for judging. It refuses a verdict on a branch nothing arrived on, and that refusal is proven in 08 and in the guards — so it is doing real work today. ' +
  'THE CHECK, when the rest of this suite is built: nothing calls taskJudge except the thing that replaces it, and the board shows a judgement where it used to show a field. ' +
  'Kept until then, because the alternative is a period with no way to record a verdict at all.')
