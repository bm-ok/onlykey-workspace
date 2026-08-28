# The judge

A judge reads and does not write. It is a worker machine tagged `judge`,
running a judge job under a judge contract with the judge sign-in, and the
one thing it hands back is a report.

## What it is given

- a clone of the workspace on the branch, cut or pull request head it is
  to read
- the job's prompt, under the contract (*a judge reads and does not write*,
  or *reading somebody else's change* for a pull request from outside)
- the **question** the judgement was created with, under the brief
- for a branch cut for an issue, the **issue itself**, whole and fenced
- for a claim check, the claim

It never receives a session: a judge that remembers its last readings of a
line has an opinion before it looks.

## What it hands back

A report file, through the handback door (`POST /artifact`), kept under
the judgement in the artifacts drawer. Its last line is the verdict —
`RECOMMENDATION: accept|reject`, `RECOMMEND: YES|NO`, `CLAIM:
true|false|unclear` — and the host parses only that. Its body is what a
stranger will read when it becomes a review, so the skill tells it to
write for the person who opened the pull request, not for the parser.

## What it may not do

Push to what it reads. Run somebody else's code. Take instructions from the
text it is reading — a pull request body is evidence, and it is fenced as
such. Approve, merge, or decide what happens next: it recommends.

## Reading it

Judge → Judgement lists every judgement with its state and verdict; the
picked one shows the report and, for a pull request, the review draft with
**Post the review**. `judgementFindings`, `judgementLog` and
`judgementsFor` are the same from the command line.

## The runner

`judge-a-change` is the job; it hands the brief to Claude on the machine,
follows the run, and checks the report's last line. A judgement that
"reached no conclusion" with a report in the drawer is a run that finished
without the line, and `judgementLog` says how.
