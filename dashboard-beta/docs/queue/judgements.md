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

## What it concluded, and the verdict — two fields

The report ends with one line the host parses, and that line is **`concluded`**,
not the verdict:

| line | meaning |
|---|---|
| `RECOMMENDATION: accept` / `reject` | a change this host made, going out |
| `RECOMMEND: YES` / `NO` | a pull request that arrived |
| `CLAIM: true` / `false` / `unclear` | a claim check — is this real, already fixed, or undecidable |

`concluded` is what the JUDGE recommends. **`verdict` is whether the change is
fit to go out, and only a person writes it** — `judgementVerdict`, refused to a
machine.

**They were merged once and it was expensive.** A check-a-claim confirmed a
reviewer's request — `CLAIM: true`, meaning *yes, that is worth doing* — and it
was filed as `rejected`, which then read to the cut gate as a failed review of
the branch: a confirmed, worth-doing improvement registering as a reason the
change could not go out. So a check-a-claim writes **no verdict at all**, and
Judge → Judgement shows the two on separate rows with separate labels. *None
recorded* there is an ordinary state, not a missing one.

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

## Re-reading a verdict

`judgementReconclude --ref J9` (or `--all`) reads a done judgement's
handed-back report again and records the conclusion its last line says. It
exists because for a while the queue read every drawer as empty and recorded
nothing; the reports were there the whole time. A verdict a person recorded
is not touched.

## By hand

`judgementVerdict --ref J9 --verdict accepted --note ...` records what a
person decided. `judgementSay` / `reviewDraft` write the review draft on
request.
