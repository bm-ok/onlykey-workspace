# Judgements

A judgement is a reading of code by a machine that may not change it. It
hands back a report; the last line of the report is its verdict.

## What is judged

- a **branch** — what a task delivered, read against what was asked
- a **cut** — a pull request this host sent, read at its head
- a **pull request** from outside — after a person allows it at its commit

`judgementCreate` takes the kind, the subject, the job (`judge-a-change`,
`judge-a-pull-request`, `check-a-claim`, `investigate-the-codebase`), and a
`question` — what the judge is being asked, specifically, which is put
under the brief. When the subject was cut for an issue, the whole issue
conversation is put under the brief too, fenced, so the judge reads the
change against the words of the people who asked.

## The verdict

The report ends with one line the host parses:

| line | meaning |
|---|---|
| `RECOMMENDATION: accept` / `reject` | a change this host made, going out |
| `RECOMMEND: YES` / `NO` | a pull request that arrived |
| `CLAIM: true` / `false` / `unclear` | a claim check — is this real, already fixed, or undecidable |

`judging` shows every judgement and what was decided; `judgementFindings
--ref J9 --file ...` reads a report whole; `judgementLog` is the run's
output, the only thing that says why one came back empty.

## What follows a verdict

- A judgement of a pull request or a cut becomes a **review draft**
  (APPROVE / REQUEST_CHANGES / COMMENT), waiting for a person. Claim checks
  never do.
- An **accept** on a branch with a live cut pushes the branch onto its open
  pull request.
- The supervisor is woken with the conclusion.

## Stale readings

A judgement records the tips of the branches it read. `judgementsFor
--branches a,b` says which readings still describe what is there now; a
push since makes the reading stale, and a cut, a review release or a merge
refuses on a stale one. Re-judging after a verdict is allowed — that is the
sequence the record is built for; two open judgements of one subject are
not.

## By hand

`judgementVerdict --ref J9 --verdict accepted --note ...` records what a
person decided. `judgementSay` / `reviewDraft` write the review draft on
request.
