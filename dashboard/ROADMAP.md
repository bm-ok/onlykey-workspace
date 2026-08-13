ROADMAP — from here to the vision
=================================

`../EXPLAINER.md` is the why and does not change. `GAPS.md` is what the older
design projected and what of it was one ecosystem rather than a tool. This is the
order to build in, and it is expected to change — when it does, change it here
rather than remembering.

**The spine this is built around:**

    branch <- task <- claude <- supervisor
    branch <- task <- person <- supervisor

The chain is the same either way and only one step differs: how work is started,
and how it is known to be finished. Anything that does not serve that is not on
this list.


Where it actually stands
------------------------

The vision names five separable pieces and says the compounding payoff rests on
the first two, which are the cheapest. Three of the five are built:

    review gate          DONE, and enforced at the guest. A worker was told to
                         push master; the hook refused, master did not move, and
                         the message said what was refused and why
    firmware discipline  DONE IN SHAPE. The contract is a per-task file this tool
                         carries and never interprets, so the discipline is an
                         input rather than something anybody pastes in
    isolation            DONE and drilled. Cable pulled, credential vanished,
                         dashboard restarted mid-run
    orchestration        DONE. Two machines took two tasks in the same tick and
                         both delivered
    self-maintained      NOT STARTED. Nothing proposes work
    backlog

**The one thing that has never happened: a real repository has never been through
this loop.** Everything above is proven against `local-repo-a`, `local-repo-b` and
`local-repo-c` with shell tasks and toy commits. That was the right way to build
it — a channel and a firmware fix cannot be debugged at once — and it means every
assumption in here is currently held against a substitute.


0. One real fix, end to end
----------------------------

**Not a feature, and it comes before the features.** Point the workspace at real
repositories, write one real task, let it run, read the branch, land it by hand.

This will find more than another week of building, because it is the first time
any of these are tested rather than assumed: how large a real diff is, how long a
real suite takes, whether a real `setup.sh` survives provisioning, whether a
contract actually constrains a worker doing work that matters.

**Nothing blocks it now.** The workspace is a folder the app points at, changeable
from the title bar, and what belongs to a workspace follows it -- see "Which
repositories this is about" in `README.md`. What remains is a decision rather than
work: which repositories, and whether the first real task is a fix or a read. A
task that only READS and reports exercises the whole loop with nothing at stake on
the branch, which makes it the cheaper first one.


1. Keep the session, so a task can be paused
---------------------------------------------

The task is meant to be the durable identity and the machine a resource it
borrows. Today a task is bound to one uninterrupted run: the machine is rolled
back when the work ends and the session goes with it.

`--resume` is already plumbed from `vmDispatch` to `claude --resume`. It names a
session this tool deletes a moment earlier, so it looks supported and is a trap —
fixing that is most of this step.

    capture   the whole session folder when a run ends, not the .jsonl. Picking a
              minimal set is a guess that fails quietly later
    key       to the BRANCH, not the task. A branch is the durable unit; several
              tasks against one branch should share one session rather than
              re-reading context every time
    restore   push it into the one machine resuming that branch, before the run
              starts. Never a share — one session belongs in one machine
    forget    one click to start fresh, because a session that spans ten tasks
              eventually carries more noise than context

Unlocks: pause and resume, several tasks on scarce runners, and reading how a
branch was reached rather than only what it contains.

Rule to hold when this lands: **a free runner and a parked task produce a prompt,
never an assignment.** The queue may act on work a person queued; it must not
decide that a parked task resumes.


2. A change note, and something that checks it
-----------------------------------------------

The piece that turns *watch it work* into *read what came back* — and attention
does not fan out to three sessions, so this is what makes more than one job in
flight possible at all.

    note      the worker writes what was wrong, the mechanism, the fix, the
              evidence, and what it deliberately did not touch. A deliverable
              like the branch, not a nicety
    verify    an independent pass reads the diff, the note AND the surrounding
              code. A plausible-and-wrong note is worse than none: it is
              optimised to reassure, which is exactly what floats a bad diff past
              a reviewer
    evidence  a run record that names the commits it ran against. Without that a
              verifier checks a claim about a test against another claim about a
              test

**Do not automate further before this exists.** The thing that prevents a
firehose is not a smaller fan-out — it is that every returned change is checked
by something other than what wrote it. Automation without verification only
scales trust in claims.


3. Something proposes the work
-------------------------------

The front door of the vision: ask for a list, read it, pick one. Least useful of
the three until the back door is trustworthy, which is why it is third.

Two guards, both general, both worth keeping when the ecosystem-specific version
is written:

* **provenance** on every proposal — human-written or model-written. An
  agent-authored proposal steering an agent worker is the case to watch
* **a proposal is not a narrative.** It is pickable only once something it
  carries has actually been run. The ecosystem's version is "the repro
  reproduces"; the general version is that a proposal arrives with evidence


Smaller things, worth doing when they are in the way
-----------------------------------------------------

* **Tag the log by why you would filter**, not by where a line came from. Every
  tag today is a source — `vm`, `channel`, `queue`, `task`. The question a
  console is actually asked is "is anything waiting on me", and it is answered
  here by reading. Tag at emit, never by parsing afterwards.
* **Show what a machine is holding while it is working**, not only when
  something is about to destroy it. `vmHolds` already asks the guest; only the
  delete, restore and release dialogs call it. Uncommitted work is the one state
  a branch view cannot see.
* **The experiment bench is nearly free.** Three approaches is three tasks on
  three branches, which the machinery already does. What is missing is comparing
  them side by side.
* **Record who wrote a task.** Provenance exists in exactly one place —
  `_overTheWire`, used to refuse approvals from a supervising session.
* **Keep a task's state transitions.** Attempts append and verdicts append; state
  does not, so a task that went queued → given → done → rejected → given keeps
  only the last.
* **Nothing checks the assumption the whole thing rests on.** The emulator can
  drift from real silicon, and "the suite is green" then means something narrower
  than it sounds. When a real ecosystem is wired in, this is the natural place to
  hold that counter — last reconciled against hardware, N days ago — so it decays
  visibly rather than quietly.


Not on this list, on purpose
-----------------------------

**Merging.** A verdict is a person's decision and landing work is a separate act
with its own rules. It is named in `TODO.md` as a joint, not scheduled here.

**Anything from `legacy/` that belongs to one ecosystem.** The seven-step
hardware chain, a repository list naming firmware repos, review thresholds
counted in firmware files. `GAPS.md` sorts those out from the parts worth taking.
