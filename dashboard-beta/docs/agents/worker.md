# The worker

A worker takes a task on a branch, does the work, commits and pushes to
this host. It is a machine tagged `worker`, running a task job under a
task contract with a worker sign-in.

## What it is given

- a clone of every repository in the workspace, on the task's branch,
  pointed back at this host's git server (`vmWorkspace`)
- the brief, the job's prompt, and the contract's rules
- the judge's report, when the task was raised `becauseOf` a judgement —
  left on the machine where the job will find it
- its **session**: what it remembered from the last run on this branch
  cut, restored before and taken back after
- a worker credential, lent for the run and taken back after

## What it hands back

Commits, pushed to this host (`git-receive-pack finished` in the events).
Files a branch cannot hold — a built binary, an archive — through the
handback door, listed by `taskFiles`. Its output, kept on this host as the
task log.

## What it is held to

The contract. `delivery-rules`: commit everything, push to the branch you
were set up on, touch nothing you were not asked about. A task copies the
rules it was held to at write time, so editing a contract later never
changes what already went out.

## Where it runs

`do-the-work` is the ordinary job. `api-tour` and `ask-a-worker` are the
proving ones: take stock of the machine, write down what is on it. All of
them are scripts in the library a person approved.

## The Worker tab

Worker → Jobs / Prompts / Contracts is the library filtered to task kind;
**Claude Worker** under Keys is the worker sign-in.

**Worker → Claude Sessions** is what it remembers — `sessions` and
`sessionForget` from the command line. It is on this tab because a session is
the WORKER's, not the machine's: the machine is rolled back when the work ends
and the memory outlives it, filed under the branch cut so a second task on one
branch is the same conversation rather than a stranger. Only a worker keeps one;
a judge that remembered the last four readings of a line would have an opinion
before it looked.

**Worker → Board** shows what a task delivered, in two cards that answer
different questions. *What arrived* is the branch — press **Read it** for the
repository, the commit count and the subject of the commit on top. *Handed back*
is the files, which a run gives over by calling `okc-artifact <file>`: a built
binary, a screenshot, the thing that explains the diff. Either can be empty
while the other is not.

## Skill

`worker-skill.md` — read with `skills --which worker`. It says what the
machine is, where the work is, how to hand things back, and that the
person's rules come first.
