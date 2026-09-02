# What this dashboard is

It runs Claude on your repositories without giving Claude your computer.

A workspace here is a folder of git repositories — one, or a dozen. The app
builds virtual machines, lends each one a sign-in for as long as a piece of
work takes, gives it a branch and a brief that a person approved, and rolls
the machine back to a clean snapshot afterwards. What comes back is a
branch pushed to this host and a report. Whether any of it reaches GitHub
is a separate press, made by a person.

**It knows nothing about your project.** The folder you open is the only
thing that says what the work is: the repositories in it, and a `.okc`
folder beside them holding what this app has learnt and been told about
them. Anything project-specific — what a machine needs installed, what a
worker is told, what counts as done — is a file in that folder rather than
a rule in here. Point it at a different folder and it is a different
workspace with different everything.

## Why it exists

**Because the useful thing and the dangerous thing are the same thing.** A
model that can read your code, run your build and push a branch is a model
that can read your credentials, run anything, and push a branch you did not
ask for. Those are not two features to be told apart — they are one
capability, and the only real question is *where it is pointed*.

So the app answers that question with a machine rather than with a
promise:

- **Work happens on a machine that is thrown away.** Every task starts from
  a base snapshot and is rolled back to it. Nothing a run does to a disk
  outlives the run, so "what did it change" has a bounded answer.
- **A sign-in is lent, not installed.** It is sealed on this host, handed
  to one machine for one run, and taken back after — and a machine holding
  one cannot be snapshotted, because a snapshot would keep a copy of it for
  as long as the snapshot exists.
- **Nothing unapproved runs.** Not the script, not the prompt it is given,
  not the contract it runs under. A person reads and approves each. The
  supervisor may *propose* new ones and may not approve its own.
- **Your working tree is never the workspace.** A machine clones from this
  host and pushes back to this host. Nothing an agent does touches the
  folder you are editing in.

## Why it matters

**The alternative is not "no agent". It is an agent with no edges.**

Running Claude Code by hand on a real project means: your keys, your
checkout, your shell, and a transcript in a terminal that scrolls away. It
works, and it works right up until the run that does something you would
not have agreed to — at which point there is no snapshot to go back to, no
record of what was approved, and no line between what the model did and
what you did.

What this app is really for is making that boundary **a thing you can
point at**:

| the question | where it is answered |
|---|---|
| what may it run? | the library — job, prompt, contract, each approved |
| whose identity is it using? | a sign-in per role, metered apart |
| what can it reach? | one machine, one branch, cloned from this host |
| what did it change? | a branch, a diff, a judgement, an artifact |
| what leaves this computer? | nothing until somebody presses it |

## Why use it rather than doing it by hand

Because by hand, each of those five answers is something you have to
remember, and the app is the thing that remembers.

- **Which machine, which branch, which key.** One press takes a free
  machine of the right kind, lays the branch across every repository, lends
  the matching sign-in, and records that it did. The same acts by hand are
  four commands and a note to yourself.
- **A set of repositories moves as one.** A **line** is one branch per
  repository under a name; a **cut** is one pull request per repository
  opened as a single act and tracked as one landing. By hand that is one of
  everything per repository, and missing one of them is the normal outcome
  — a change that half-landed, with nothing naming the other half.
- **The queue does not need you awake.** Tasks and judgements are picked up
  by machines of the right kind, rolled back between runs, and reported
  against. What it will never do is the irreversible half.
- **Everything is read, not remembered.** Whether a machine is running,
  whether a fork is behind, whether a pull request merged — asked of
  VirtualBox, of git and of GitHub at the moment somebody looks, because a
  dashboard confidently showing a stale answer is worse than one showing
  none.

## Where a person stands

The rule the whole app is arranged around: **a person makes every press
that cannot be taken back.** Opening pull requests, merging them, sending a
reply to somebody's issue, destroying a machine, moving what a machine
rolls back to. A supervisor may prepare any of those and say it is ready;
the press is still yours.

Some of those presses are refused to the command line entirely, and marked
in purple in the window: purple means *this is the person's, and a model
may not reach it*. It is only honest because it is spent on nothing else.

## What it is not

- **Not a CI system.** It does not gate merges or run on push. It gives
  work to a model and hands you what came back.
- **Not a hosted service.** It runs on one computer, with your credentials,
  in a window you can close. Machines are local VirtualBox VMs.
- **Not autonomous.** It is built so that the loop *can* run unattended and
  the outward half cannot. If that ever stops being true, it is a bug.

## Where to go next

- [How work moves end to end](workflow/README.md) — issue to pull request,
  and where a person stands in it
- [Open a workspace](howto/open-a-workspace.md) — the first thing to do
- [Build a machine](howto/build-a-machine.md) and
  [sign it in](howto/sign-in-a-machine.md)
- [Work in a machine yourself](howto/work-in-a-machine-yourself.md) — the
  same lane, driven by hand, when you want to be the one typing
- [What a person may do, and what a machine may do](permissions/README.md)
