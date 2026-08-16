# Judging

Reading what came back and saying yes or no — and it is **work**, not a field.

That is the whole of what this suite is waiting for, and none of it is built. It
is written down here, as drafts, because judging is the last step of the tool and
the only one that has never happened end to end: the round trip in `08` finishes
on a refusal, correctly, because nothing was pushed.

## The shape it is meant to take

**A judgement is a task of its own.** Not a verdict typed onto the task that
produced the work — a task cloned from it, pointed at what it delivered. Which
means it gets everything a task already has: a job that says how the judging is
done, a prompt that says what to look for, a contract that says what the judge
may not do, and a run on a machine with a record of what it saw.

    branch  <- task <- job <- prompt <- contract   the work
    PR cut  <- task <- job <- prompt <- contract   judging the work

**The same chain, and only the left-hand end differs.** Work delivers onto a
BRANCH; judging delivers onto a **PR cut** — the one pull request per repository
that carries something, taken as one act. That is what a judgement is about: not
a commit, not a branch, but the change as it is being proposed for landing.

It also answers a question that otherwise has to be invented. A judging task
does not need a branch of its own and must not take one: it reads rather than
writes, and a task claiming a branch it never pushes to would hold a machine on
a branch for no reason. Its subject is the cut, and the cut is where its verdict
goes.

**And `job <- prompt <- contract` already exists**, with a tab of its own, an
approval per substance, and a rule that a model may write one and may not ratify
its own. Judging reuses it: a judging job is a job, its prompt is a prompt, its
contract is a contract. Nothing new is built there and no second approval path
appears — which is most of why this shape is worth having rather than a
judge-specific mechanism beside it.

So the only genuinely new thing is the left-hand end: a task whose subject is a
cut rather than a branch.

**And the judge can be either kind of supervisor.** A person reading a diff and a
worker running checks are the same act with a different body — which is exactly
what the spine already says about who supervises, and the reason judging should
not be a special case bolted to the side of a task.

**An open cut is what asks for a judgement.** Not somebody deciding to judge a
task — a cut is opened when work is proposed for landing, which is the moment the
change stops being one machine's business and becomes something to be read. So an
open cut is a thing *waiting*, and this app should say so without being asked.

That is also why the subject is the cut and not the task: a cut may carry work
from more than one task, and a task may deliver nothing worth landing. Judging
follows the change, not the occasion that produced it.

**Which makes it a list, and lists want a tab.** Every open cut: which are
waiting, which have a judgement in flight, which were decided and what the
verdict was. The same shape as the task board, one level up — and it is what
turns judging into something you can be *behind on* rather than something you
remember to do.

**And a sub-tab for the chains that can be run.** The library lists jobs,
prompts and contracts one substance at a time, because that is how each is
written and approved. A judgement you can *run* is the whole chain — this job,
giving these words, under these rules — and picking one from three separate
lists asks somebody to recombine in their head what the app already knows.
`jobs` already reports `runnable` and `whyNot`, and `whyNot` names the one rung
that is missing; nothing shows it combined.

**And it reports outward.** A verdict is not only a note on a board: it belongs
on the PR cut the work is landing through, and on GitHub beside the pull request
— the place anybody looking at the change would expect to find out whether it was
checked. Testing, verifying, whatever the job did.

## What `taskJudge` is

**A placeholder that predates the decision.** It records a verdict and a note on
the task, refuses a verdict on a branch nothing arrived on, and refuses a
rejection with no reason — "sent back to a worker that cannot ask what was
wrong", which describes something that does not happen. It is the note this app
left itself to complain about later, and it is where the complaint is.

Nothing here says to delete it. It is the only way a verdict is recorded today,
and it will be replaced by the thing above rather than removed first.

## Why the checks are drafts

Because the behaviour is not decided, and a check would assert an answer nobody
chose. Each draft below carries what has to exist, what the check would be, and
what has to be settled first — and becomes a real check the moment the answer
is picked.
