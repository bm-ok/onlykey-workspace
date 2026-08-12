TODO
====

Working state, not documentation. `README.md` is the document and stays the one
that describes how any of this works — if something here is finished, it belongs
there and should leave this file. Anything left in here long enough to go stale
was probably never going to be done.


Outstanding
-----------

* **`vmCredentialsPut` onto a machine that has never been signed in at all.**
  Proven on `runner1`, which had been signed in before, been rolled back, and
  had Claude Code installed by hand. A machine straight off a fresh install has
  not been tried, and the install step for the worker is new.
* **Nothing has been left running for days.** Every run so far has been minutes.
  A worker that hits a token refresh, a network drop or a full disk mid-task has
  never been observed.
* **The `lost` run state has never been seen in the wild.** It was written from
  a run that genuinely died, but that run predated the pid file, so the branch
  that reports it is reasoned rather than exercised. Kill a running worker and
  check `vmRuns` says `lost`.
* **A worker has never pushed.** The hook, the branch claim and the refusal to
  touch the default branch are all proven from this host. No dispatched task has
  yet produced a commit and pushed it back, which is the thing the whole
  workspace half exists for.


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

What remains beyond the list above is the "Honest gaps" section of `README.md`,
which is a different kind of thing: what has never been tried, rather than what
is half-built.


Where the machines are
----------------------

Volatile, and the first thing to check rather than trust:

    okc.js vmList --json

At the time of writing: **`runner1`** up and connected, holding the worker
credential, Claude Code 2.1.228 installed, one finished run in `~/.okc-runs`,
still recording `fix/try-one` as what it may push, with a clean
`on-fix-try-one` snapshot taken before it ever held a credential.
**`runner2`** up and connected, holding the worker credential, **and with no
snapshots at all** — its only one was deleted, see below.

**`fix/try-one` no longer exists in the workspace repositories** — it was test
debris and was deleted. `runner1` still claims the name, which is deliberate
rather than stale: setting it up again cuts the branch afresh from `master`, and
the claim stops another machine taking the name meanwhile.

**Both machines are holding a credential, so neither can be snapshotted.** That
is the refusal working, not a problem to route around. `vmCredentialsForget`
first, and `runner2` in particular wants a clean base taken once it has been
given one.
