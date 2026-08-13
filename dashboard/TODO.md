TODO
====

Working state, not documentation. `README.md` is the document and stays the one
that describes how any of this works — if something here is finished, it belongs
there and should leave this file. Anything left in here long enough to go stale
was probably never going to be done.

Something that needs *exercising* rather than building belongs in
`TEST-PLAN.md`, which is where the four unrun drills went. It is a different
list: not what is missing, but what is unproven. Something that is not built yet
because it is not its turn belongs in `ROADMAP.md`.


The window can be looked at now
-------------------------------

NW.js can photograph itself, so it does. `okc.js windowShot --view <tab>` leaves
a request that the window answers on its next draw — switching to that tab first,
so a panel nobody clicked is checkable too — and Ctrl+Shift+D saves a picture
beside the markup it already saved. Both were needed: the markup says what the
window is MADE of and can be searched; only the picture says what it looks like,
and the faults that matter here -- a class matching no rule, a panel off the
bottom, an empty badge -- are invisible in the first and obvious in the second.

It has now caught, among others: a tasks list that could not be selected, a
Branches tab photographed blank because its panels fill asynchronously, a banner
scolding somebody for a credential the same window had just told them to place,
and a machine reported "changed" one minute after being reverted. `npm test`
catches the cheaper half of that class without a photograph — every class the
window applies, every custom property it reads and every id it looks up.


Where the bigger picture lives now
----------------------------------

Two documents took most of what used to be listed here, because it was not
"outstanding" so much as "not built yet", which is a different thing and wants a
different shape:

    ROADMAP.md   the order to build in, from here to the vision. Step 0 is not a
                 feature: no real repository has ever been through this loop
    GAPS.md      what the older design projected, what of it was one ecosystem
                 rather than a tool, and where this is already ahead of it

What stays below is the near ground: things half-done, things that bit and were
not fixed, and the state of the machines.


Outstanding
-----------

* **The one-click credential flow is built and has never been run.** `Keys → Get
  Claude Code credentials` now borrows a free machine, brings it up clean, signs
  in, keeps the credential here and puts the machine away with nothing on it —
  `credentialsBegin` and `credentialsFinish`. Every part of it is proven
  separately and the whole has not been, because the middle is a person visiting
  a sign-in page. The next time a credential is actually needed is the test.

* **`runner1` is running an agent two fixes behind.** It never got the read
  timeout or the unit change, and it has not got the TLS locking either — so it
  is the only machine left that still drops its channel whenever a command
  produces output. It needs the same push, which needs it started and dialled in.
  It has booted since, so this is now ordinary work rather than blocked.

* **Nothing has been left running for hours.** A five-minute soak passed on a
  timer; the overnight one is written and waiting as **#17**, ten hours of
  heartbeats. What it is looking for is what only shows up over time: a channel
  that drops, an agent that dies, a disk that fills. Worth queueing on a night
  when Windows updates are deferred — an overnight update killed a runner
  mid-credential once already.

* **The queue adopts work it did not dispatch.** A task handed straight to a
  machine with `taskGive` is picked up by the queue on the next restart, treated
  as in flight, and its machine put away — which rolled back a workspace somebody
  had set up by hand. Either adoption should be limited to tasks the queue
  started, or handing one over directly should say that this is what happens.

* **`taskUpdate` can force a task into any stored state.** Bounded — the set is
  checked, and `working` and `delivered` are derived rather than settable — but
  still a way round the state machine from the command line, and it was used to
  fix a task the queue had stranded. Either that is a legitimate repair tool and
  should say so, or it should refuse the transitions that make no sense.

* **The Branches tab runs past the bottom of the window.** The baselines block
  pushed the left column past the viewport and the page scrolls. Same class of
  thing as the terminal's height, which is measured rather than guessed.

* **`legacy/contracts/dashboard/supervisor-mode.md` is still on disk.** Its rules
  now live in the supervisor skill. The file is two sentences of generic filler
  that nothing loads, and deleting it needs a hand that is not this one —
  `legacy/` is untracked.

* **The task contract is runtime state, and it should not be.** It sits in the
  per-user data directory with the registries, having moved out of the repository
  along with them — right for a registry, wrong for this. It is project
  *configuration*: the rules a worker is given are worth a history, and it is now
  further from version control than it was.


The next joints
---------------

Not tasks. Two things the shape of this now implies, either of which is a
session's work on its own and neither of which should be started by accident.

**Nothing merges.** `taskJudge` deliberately does not — a verdict is a person's
decision and landing work is a separate act with its own rules — and nothing
else does either. So accepted work sits on its branch for ever, and the two
branches on the board are both accepted and both still sitting there. That is
the next joint after the round trip: the loop currently goes out, comes back,
and stops. In `legacy/` this is what the gate was for, and its rules are written
down there rather than here.

Worth being clear that this is a *decision*, not an omission: everything
delivered so far is on a branch precisely because nothing has decided it should
be anywhere else.

**Nothing runs the supervisor.** Every piece is in place — the queue drives
machines, pre-defined tasks are written and approved, a worker is given rules and
watched, and what comes back is judged — and a person still writes every task by
hand. `legacy/PLAN.md` describes the AI-driven mode and is explicit about why it
is allowed at all: the dashboard sits between the model and the workers, so
distribution goes through the observable channel rather than a private call
inside an orchestrator. That constraint is already satisfied by the queue; what
does not exist is anything proposing the work.


Unproven, and unexplained
-------------------------

Not missing work — things that have been reasoned about rather than seen. The
drills themselves live in `TEST-PLAN.md`, and all of them now pass, including
the four that only have anything to look at while a machine is mid-work.

* **A machine sometimes sits at the Ubuntu splash for ten minutes or more after
  a restore, and this is now REPRODUCIBLE and unexplained.** Seen on `runner2`
  this afternoon (nine minutes, then it came back) and on `runner1` tonight
  (eleven minutes, still there when it was powered off). Both followed
  force-stop → restore → start.

  Two theories are dead. The double rollback was the first suspect and is fixed,
  yet this happened after a single restore. `Wants=network-online.target` in the
  agent unit was the second, and is also a real fault worth fixing — but it
  would cost ninety seconds, not eleven minutes.

  **What would settle it:** the boot messages rather than the splash. Ubuntu
  hides them behind `quiet splash`; taking those off the kernel command line for
  one boot would say which job is hanging, and `systemd-analyze blame` afterwards
  would say how long everything took. Neither has been tried.

  A machine in this state is recovered by powering it off; it costs nothing but
  the ten minutes, and rebuilding one takes twenty.


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
  borrowed by nobody, and in the pool. Kept as a heading because this is the
  state to return them to, not because there is anything to do.


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
