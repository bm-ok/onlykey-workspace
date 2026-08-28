# Tasks

A task is work for a worker: what is wanted, the branch it delivers on, and
the job that runs it. The board (`tasks`) lists every one, newest first,
with whether its branch has anything on it yet.

## What a task carries

| field | what it is |
|---|---|
| `title`, `brief` | what a person or the supervisor wrote; the brief is what the worker reads |
| `branch` | where it delivers — cut first, or cut in the same act with `cutFrom` and `reason` |
| `job`, `promptId`, `contractId` | the chain it runs under, copied at write time so editing the library later never rewrites a task that already went out |
| `issue` | `{on, number}` when it came from a GitHub issue; the pull request says `Closes` from it |
| `becauseOf` | the judgement it was raised because of; its report is put where the worker will find it |
| `tag` | which kind of machine may take it |
| `hours` | how long a run may take before it is given up on |

## Its life

*draft* → *queued* → *given* (to a machine) → *done* or *failed* → judged.
`taskProgress` shows every attempt and what the worker is doing now;
`taskLog --id --run` the kept output afterwards; `taskArtifact` the commits
and files that arrived per repository; `taskFiles` anything handed over
that a branch cannot hold (a built binary, an archive).

A task finishing means the machine stopped, nothing more. What it delivered
is read by a judgement; `taskJudge` records a verdict by hand.

## Sessions

What a worker remembers between the machines it passes through is kept per
**branch cut**: `worker--cut--<branch>`. Restored before a run, taken back
after. A judge never remembers — a judge that remembers its last four
readings of one line has an opinion before it looks. `sessions` lists what
is held; `sessionForget` starts a task fresh.

## Taking one by hand

`vmBorrow` a machine, work on the branch yourself, then `taskFinished --id`
gives the machine back and puts the task up for a verdict.
