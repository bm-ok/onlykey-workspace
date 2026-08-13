TODO
====

Working state, not documentation. `README.md` is the document and stays the one
that describes how any of this works — if something here is finished, it belongs
there and should leave this file. Anything left in here long enough to go stale
was probably never going to be done.

Something that needs *exercising* rather than building belongs in
`TEST-PLAN.md`, which is where the four unrun drills went. It is a different
list: not what is missing, but what is unproven.


The window has not been looked at
---------------------------------

The one thing here that cannot be closed from a terminal. Everything in the
Tasks tab was built and driven from the command line, and **nobody has watched
it render**: the approvals card, the tab badge, the attempts panel with its
timings, the live session view, the queue panel, the queue buttons, the task
numbers, the Ace editor, the idle-machine banner and the two new machine
buttons. The one visual fault found so far — the task list not looking
clickable — was found by eye, and a misspelt CSS class produces no error at all.

**Open it and press things.** `Ctrl+Shift+D` captures the window as HTML, which
is how the last fault was diagnosed.


Outstanding
-----------

* **A running task cannot be stopped.** `taskUnqueue` refuses anything already
  given out, and the queue waits up to six hours. A worker that hangs, or that
  is doing the wrong thing entirely, has to be dealt with by hand on its machine.
* **Nothing has been left running for days.** Every run so far has been minutes.
  A worker that hits a token refresh, a network drop or a full disk mid-task has
  never been observed.
* **`legacy/contracts/dashboard/supervisor-mode.md` is still on disk.** Its rules
  now live in the supervisor skill, which is where PLAN says supervisor mode is
  entered. The file is two sentences of generic filler that nothing loads, and
  deleting it needs a hand that is not this one — `legacy/` is untracked.


Unproven, and unexplained
-------------------------

Not missing work — things that have been reasoned about rather than seen. The
drills themselves live in `TEST-PLAN.md`; this is what is outstanding against
them.

* **Drill 4 is half done.** Two machines working at once is proven (5c). The
  other half — a task on a branch another machine already claims, refused by
  name — is not, and needs a second machine on no branch of its own.
* **One definition is waiting to be read.** The claimed-branch drill was
  corrected after it passed for the wrong reason, so its approval lapsed and a
  re-read was requested with the reason. Until it is approved the whole guards
  suite refuses to run as a suite.
* **`runner2` failed to boot for nine minutes this afternoon and it was never
  explained.** The double rollback five seconds apart is the prime suspect and
  has been fixed, but every boot since has been thirty seconds, which is
  consistent with the fix rather than proof of it.


Debris
------

Cleared. Two tasks remain on the board and both are kept deliberately, because
between them they are the record of what this thing can do:

* **#1 `task/first-round-trip`** — accepted. The first time work went out and
  anything came back.
* **#10 `task/both-repos`** — accepted, having been **rejected and sent back
  once**. Two repositories, two attempts, the verdict that caused the second one
  still in its record. The whole loop, in one task.

The eight drill tasks and their branches are gone. Their kept logs are not:
those are filed under a uid that is never reused, so throwing away the note
about the work does not throw away the evidence of it.


Decisions waiting on the operator
---------------------------------

Not work, and not for a session to settle on its own.

* **Nine commits have never been pushed.** `origin` is
  `github.com/bm-ok/onlykey-workspace`, `main` is nine behind, and everything
  from the README split through the worker half is local only. This was one of
  the three things in the original handoff and it is the one that never got
  answered.


Housekeeping on the machines
----------------------------

* **Nothing.** Both runners are off, clean, claiming nothing, holding nothing,
  and in the pool. Kept as a heading because this is the state to return them
  to, not because there is anything to do.
* **The task contract lives in `dashboard/state/`, which is runtime state and
  untracked.** It is project configuration and does not belong there; it was put
  where it was to prove the mechanism. Somewhere it can be version-controlled
  would be better, since the rules a worker is given are worth a history — and
  no task has used one since, because the file is not where anybody would look.


Nothing else is outstanding
---------------------------

Everything on the previous lists is done, and each was checked by running it
rather than by reading it. The snapshot drill passed in all three directions,
the actions are off the network entirely, the destructive dialogs say what they
would destroy, ssh hardening survives an install, and the debris is cleared.

The credential round trip is proven end to end: signed in on `runner2`,
harvested, sealed on this host with DPAPI, handed to `runner1`, and `runner1`
authenticated and completed a request with it.

Dispatch is proven end to end as well — task given, run detached, session
appeared, file written, exit 0 — which is worth saying because until it was
actually used, every dispatch it produced had been dying instantly. See
`LEARNED.md`.

`lost` has now been observed rather than reasoned about: a run was killed with
its process group, `vmRuns` reported `lost`, and the watcher said so. Exercising
it found that the watcher announced "ended with status null" — describing a
result the run never produced, which sends a supervisor looking for one.

**The round trip is closed.** A task was written, given to `runner2`, worked on
under a contract, committed, pushed, and arrived here as `d8b18a2` on
`task/first-round-trip` — then read as a diff and accepted. That was the last
joint: work went out and nothing had ever come back before.

**Two machines worked at once.** #8 and #9 were queued together, taken in the
same tick by the two rebuilt runners, and both delivered — `3372dde` by
`runner1` and `635f542` by `runner2`. The log interleaves them: credentials at
:28 and :32, workspaces at :33 and :40, dispatches at :34 and :48. Until
tonight there had never been two machines in the pool, so everything about
*choosing* between them was reasoning rather than evidence.

**A machine built from nothing did work, credential and all.** `runner1` was
deleted, remade, installed, provisioned, snapshotted and then given a queued
task — and the credential reached it through the queue's ordinary path rather
than through a test. It had never been signed in. That was the last thing about
the credential half that had only ever been shown on a machine with history.

**The enforcement is proven against a guest.** A worker was told to commit on
`master` and push it; the hook refused, `master` did not move in either
repository, and the message said what was refused, why, and that nothing had
been taken. Every rule about pushing had until then been tested only by this
host pushing to itself. The same drill showed a run reporting `exit 0` while
nothing had arrived — which is exactly why `delivered` is read from the branch.
See `TEST-PLAN.md`, drill 1.

What remains beyond the list above is the "Honest gaps" section of `README.md`,
which is a different kind of thing: what has never been tried, rather than what
is half-built.


Where the machines are
----------------------

Volatile, and the first thing to check rather than trust:

    okc.js vmList --json

At the time of writing **both runners are off**, each on a single snapshot
called `base` that predates any branch, claiming nothing, holding no credential,
and both free to the queue. That is the resting state the whole design is
arranged around.

**Both were deleted and rebuilt tonight**, twenty minutes and eighteen minutes,
and neither has anything on it that a script did not put there — the worker is
installed by `extra-user.sh` rather than by hand, and neither has ever been
signed in. The credential arrives only when the queue gives them work, and
leaves before they shut down.

What they replaced is the reason: `runner1` had a hand-installed worker, a
snapshot tree carrying two entries called `base`, and disks merged twice in one
afternoon. `runner2` was the older build and carried some of the same history.

**`task/first-round-trip` exists in both repositories, carrying one commit in
`local-repo-a`.** It is accepted but not merged, which is the intended shape: a
verdict is a person's decision, and landing work is a separate act.
