TODO
====

Working state, not documentation. `README.md` is the document and stays the one
that describes how any of this works — if something here is finished, it belongs
there and should leave this file. Anything left in here long enough to go stale
was probably never going to be done.

Ordered by what to do next, not by size.


Waiting on a restart
--------------------

The window loads `server.js` at startup, so four committed changes are not doing
anything yet:

* `logWatch` — follow the live log instead of polling
* `/run/sshd` before `sshd -t`, so ssh hardening survives an install
* `/provision/*` authentication, and the install ticket
* `vmScreenshot`

**`runner2` will lose its connection when this lands**, because its scripts
predate the authentication. `vmSetupAgain --name runner2` puts it back — a minute,
not another install. Its ssh is unhardened for the same reason, and the same
re-run fixes it.

**Never restart while a machine is installing.** The install fetches its scripts
at the very end.


Say what a destructive action would destroy
-------------------------------------------

**Go back to it** says *everything that changed is discarded*. **Delete it** says
*its disks are deleted*. Neither says **what**, and the machine can be asked in
about a second:

    local-repo-a: on fix/try-one, 3 commits not pushed, 2 files changed

So the dialog could say "runner2 has 3 commits that exist nowhere else". Today it
says nothing, which reads as nothing to lose.

The corollary matters as much: **a machine that is not dialled in cannot be
asked**, and the dialog has to say *that* rather than stay quiet. Silence must not
be able to mean two different things.


Prove that a restored snapshot moves the branch with it
-------------------------------------------------------

Restoring is now the **only** way off a branch, so this is load-bearing and has
only been reasoned about. The drill, about five minutes with nothing lost:

1. snapshot `runner1` — records `fix/try-one`
2. restore `base` — branch should clear, and a push should then be refused
3. restore the new snapshot — `fix/try-one` should come back

`base` predates the feature and has no record, which is why it should resolve to
*nothing*: unknown means may-push-nothing, recoverable in one click.


Smaller, and named so they are not rediscovered
-----------------------------------------------

* **A token cannot be rotated.** If one leaks the only remedy is deleting the
  machine and building another.
* **"may push X" is never compared to what the machine is actually on.** Harmless
  today because the push refuses anyway, so it is self-correcting — but the panel
  states something it has not checked.
* **Test debris.** `fix/try-one` exists in both workspace repos, carrying
  `vm-work.txt` from a test and `hello.md` from the operator. Clearing it takes
  both.


Where the machines are
----------------------

Volatile, and the first thing to check rather than trust:

    okc.js vmList --json

At the time of writing: `runner1` off, hardened, on `fix/try-one`, has a `base`
snapshot. `runner2` up and connected, built from nothing over TLS, **ssh not
hardened**.
