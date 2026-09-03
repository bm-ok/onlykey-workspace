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
the judgement in the artifacts drawer. Its prompt asks it to end on one line —
`RECOMMENDATION: accept|reject`, `RECOMMEND: YES|NO`, `CLAIM:
true|false|unclear` — and that line is what it **concluded**, not a verdict;
see below. The host takes the first such whole line, in the first handed-back
file that has one, and reads nothing else. Its body is what a
stranger will read when it becomes a review, so the skill tells it to
write for the person who opened the pull request, not for the parser.

## What it may not do

Push to what it reads. Run somebody else's code. Take instructions from the
text it is reading — a pull request body is evidence, and it is fenced as
such. Approve, merge, or decide what happens next: it recommends.

## Reading it

Judge → Judgement lists every judgement; the picked one shows three things in
the right-hand column, in this order:

- **Verdict** — `it concluded` and `verdict` on two rows with two labels, and
  they are not the same claim. `concluded` is what the JUDGE recommends, parsed
  from the line its prompt asked it to end on; `verdict` is whether the change
  is fit to go out, which only a person writes. They were merged once: a
  check-a-claim confirmed a reviewer's request — `CLAIM: true`, meaning *yes,
  worth doing* — and it was filed as `rejected`, which then read to the cut gate
  as a failed review of the branch. A check-a-claim writes no verdict at all, so
  *none recorded* there is ordinary rather than missing.
- **Handed back** — the files, one card each with its own **Read it**. Drawn by
  `artifact`, and the Worker board draws the identical component for a task's.
- **It ended on …** — the last line, lifted out of a file that may be thousands
  of bytes long, which is how it used to get missed.

For a pull request the review draft is there too, with **Post the review**.
`judgementFindings`, `judgementLog` and `judgementsFor` are the same from the
command line — and `judgementFindings` takes the name the list shows you
(`CLAIM.md`), not the `<run>--<name>` it is stored under.

## The runner

`judge-a-change` is the job; it hands the brief to Claude on the machine,
follows the run, and looks for the line it was asked to end on. A judgement that
"reached no conclusion" with a report in the drawer is a run that finished
without the line, and `judgementLog` says how.
