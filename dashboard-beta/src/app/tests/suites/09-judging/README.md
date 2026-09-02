# Judging

Reading what came back and saying yes or no — and it is **work**, not a field.

This suite was nine drafts describing a design. The design was built, and it was
built *differently* from the drafts in three ways that matter, so what follows is
the shape as it exists rather than the shape as it was imagined. Anything still
described here as unbuilt is a draft below, and there is only one of those left.

## The three ways it came out differently

**A judgement is not a task.** The drafts said "a task cloned from the work,
pointed at what it delivered", and reused the task store. It has its own —
`tasks/judging.js`, its own file, its own numbering, its own refs: `J1`, `J2`,
beside the tasks' `#131`. The reason is what the drafts wanted and could not have
had: a judgement has no branch, no delivery, and no verdict *of its own work*,
and every one of those is a field a task has and a rule a task is held to.
Sharing the store meant a judgement pretending to be a task with three quarters
of it left null, and the board asking "did it deliver" about a thing that reads.

**It judges a branch cut as well as a PR cut.** The drafts were firm that the
subject is the pull request — "not a commit, not a branch, but the change as it
is being proposed for landing". That is right about the *outward* half and wrong
as the only case: the whole point of judging before a task is written is that
nothing has been proposed yet. So `subject` is `{ kind: 'branch' | 'cut' }`, and
the branch case is the one that runs first and most.

**And the judge sends its own verdict.** The drafts left this to be settled —
"whether a person's judgement is a run at all". What was built: the one that READ
the change is the one that concludes, and it says so through the job API at the
end of its session. A person judging records their own, on the Judge tab. Nobody
transcribes anybody else's, because a verdict transcribed is a second opinion
wearing the first one's clothes.

## What that makes the lane

    branch cut  <- judgement <- job <- prompt <- contract    reading what is there
    PR cut      <- judgement <- job <- prompt <- contract    reading what is proposed

    branch      <- task      <- job <- prompt <- contract    changing it

**Two libraries, one shape.** `job <- prompt <- contract` is reused exactly as
the drafts hoped, with one field added: `kind`, which is `task` or `judge`. They
are refused in both directions — a working job cannot be run as a judge, and a
judge cannot be given to a task — because a judging job run under a task's rules
would read a change under rules written for changing it.

**One queue, judgements first.** Both kinds wait in one line. `order()` in
`tasks/queue.js` puts judgements ahead of tasks, and that is the only priority
rule there is: a judgement reads work that is already waiting on it, so anything
behind it in the queue is waiting twice.

**The judge is the gate.** `taskCreate` refuses without `becauseOf` — the ref of
a *finished* judgement — when **a machine** is the one writing it. A supervisor
cannot see the codebase, so a task written without one is work commissioned from
a rumour. It is measured by `_fromMachine`, which the supervisor's own door sets
and the local pipe never does: the window and the command line are both the
person building this app, and that person can read what the judgement would have
reported on.
`prCutMake` refuses without a current judgement that is not a rejection, and
"current" is measured against the tips the judgement recorded: a judgement made
before another push is a judgement of something else.

**And a judgement cannot push.** The git route refuses a push from a machine
running one. A judge hands artifacts back — that is `okc-artifact`, the same door
a task uses — and what it hands back is read on the Judge tab under *Handed
back*.

## What is still not built

**GitHub is not told.** A verdict does not appear beside the pull request, so
anybody looking at the change where a reviewer looks has no way to know this app
read it. That is the one draft left below, and it is still a draft for the reason
it always was: nobody has decided whether it is a commit status, a check run or a
comment — and whether a rejection should block somebody else's merge button.

## `taskJudge`

Still there, and now genuinely vestigial: `judgementVerdict` is where a verdict
is recorded. It is proven in `08` and in the guards, so it is doing real work
today, and the check below says what has actually replaced it rather than
assuming the old thing is gone.
