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


Prove that a restored snapshot moves the branch with it
-------------------------------------------------------

Restoring is now the **only** way off a branch, so this is load-bearing and has
only been reasoned about. The drill, about five minutes with nothing lost:

1. snapshot `runner1` — records `fix/try-one`
2. restore `base` — branch should clear, and a push should then be refused
3. restore the new snapshot — `fix/try-one` should come back

`base` predates the feature and has no record, which is why it should resolve to
*nothing*: unknown means may-push-nothing, recoverable in one click.


Where the machines are
----------------------

Volatile, and the first thing to check rather than trust:

    okc.js vmList --json

At the time of writing: `runner1` off, hardened, on `fix/try-one`, has a `base`
snapshot. `runner2` up and connected, built from nothing over TLS, **ssh not
hardened**.
