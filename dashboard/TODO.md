TODO
====

Working state, not documentation. `README.md` is the document and stays the one
that describes how any of this works — if something here is finished, it belongs
there and should leave this file. Anything left in here long enough to go stale
was probably never going to be done.

Something that needs *exercising* rather than building belongs in
`TEST-PLAN.md`, which is where the four unrun drills went. It is a different
list: not what is missing, but what is unproven.


Outstanding
-----------

* **`runner1` can never enter the queue's pool.** Its only snapshot was taken
  while it was already on `fix/try-one`, so rolling back does not release the
  claim — and a machine claiming a branch is correctly never free. It needs a
  snapshot from before any workspace existed, which means taking the credential
  back, rolling it to that snapshot, and taking a base there; or rebuilding it.
  The queue says why rather than skipping it silently, but it is one machine
  doing nothing.
* **Only one machine has ever been in the pool at a time.** Everything about
  the queue that concerns *choosing* between machines is therefore unexercised:
  two tasks starting at once, and a machine being picked when several are free.

* **`vmCredentialsPut` onto a machine that has never been signed in at all.**
  Proven on `runner1`, which had been signed in before, been rolled back, and
  had Claude Code installed by hand. A machine straight off a fresh install has
  not been tried, and the install step for the worker is new.
* **Nothing has been left running for days.** Every run so far has been minutes.
  A worker that hits a token refresh, a network drop or a full disk mid-task has
  never been observed.
* **`legacy/contracts/dashboard/supervisor-mode.md` is still on disk.** Its rules
  now live in the supervisor skill, which is where PLAN says supervisor mode is
  entered. The file is two sentences of generic filler that nothing loads, and
  deleting it needs a hand that is not this one — `legacy/` is untracked.


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

* **Both machines are holding a credential, so neither can be snapshotted.**
  Deliberate rather than pending — each already has a clean snapshot from before
  it held one. Taking a newer starting point means taking the credential back
  first, which is the flow rather than an obstacle to it.
* **The task contract lives in `dashboard/state/`, which is runtime state and
  untracked.** It is project configuration and does not belong there; it was put
  where it was to prove the mechanism. Somewhere it can be version-controlled
  would be better, since the rules a worker is given are worth a history.


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

At the time of writing: **`runner1`** up and connected, holding the worker
credential, Claude Code 2.1.228 installed, no runs left in `~/.okc-runs`, still
recording `fix/try-one` as what it may push, with a clean `on-fix-try-one`
snapshot taken before it ever held a credential. This is the working machine.

**`runner2`** up and connected, holding a credential, claiming
`drill/protected` — a branch that no longer exists here, because the drill that
made it was cleaned up. Rolled back to `base` once already, which is what
released its previous claim; that is the only way off a branch and it worked.
It did the first real task and then drill 1.

**`fix/try-one` no longer exists in the workspace repositories** — it was test
debris and was deleted. `runner1` still claims the name, which is deliberate
rather than stale: setting it up again cuts the branch afresh from `master`, and
the claim stops another machine taking the name meanwhile.

**Neither machine can be snapshotted while it holds a credential.** That is the
refusal working, not a problem to route around — see Housekeeping above.

**`task/first-round-trip` exists in both repositories, carrying one commit in
`local-repo-a`.** It is accepted but not merged, which is the intended shape: a
verdict is a person's decision, and landing work is a separate act.
