# The library: jobs, prompts, contracts

Nothing unapproved runs — and that means the script *and* the prompt it
is given *and* the contract it runs under. The library is those three,
written once, kept, versioned, and approved by a person.

## The chain

    job  <-  prompt  <-  contract

- A **contract** is what a worker may not do while doing what it was told
  (`delivery-rules`: commit everything, push to the branch you were set up
  on, touch nothing you were not asked about; `a-judge-reads-and-does-not-
  write`). Kind: task or judge.
- A **prompt** is what a worker is told, under a contract.
- A **job** is a script that takes a prompt and does something with it on
  the machine: `do-the-work`, `judge-a-change`, `check-a-claim`,
  `judge-a-pull-request`, `investigate-the-codebase`.

A job is **runnable** when it, its prompt and its prompt's contract are all
approved and none is set aside. The listing says so per row, and a refusal
names which link is the fault.

## Approval

`jobApprove`, `promptApprove`, `contractApprove` — a person, having read
it. `approved --kind job --id X` lists every version a person approved;
`approvedVersion` reads one in full with what changed to reach it.
`jobWithdraw` takes an approval back; the job stays and nothing may use it.
`jobUse --on false` sets one aside without deleting it; `jobForget` deletes
one that was never used.

The supervisor may **propose** — `jobSave`, `promptSave`, `contractSave` —
and what it writes is unapproved until a person reads it. That is how it
can improve its own tools without ever running something nobody looked at.

## Where they live

**In the workspace, in its `.okc` folder**, as readable files: `jobs/`,
`prompts/`, `contracts/`, `provision/`, and a `library.json` naming them.
Not in the app's data folder — copy the workspace and the library comes
with it.

A drawer laid out that way **is** a bundle, which is why there is no
translation step: exporting one is tarring the folder, and importing one is
writing the files. The repository holds a seed, `okc-bootstrap.tar`, and a
folder with no `.okc` is set up from it — everything arriving unapproved,
because a bundle carries no approvals. See
[Refresh the bootstrap tar](../howto/refresh-the-bootstrap-tar.md).

## Panes

Worker → Jobs / Prompts / Contracts and Judge → Jobs / Prompts / Contracts
are the same library filtered by kind, with a finder above each list.
