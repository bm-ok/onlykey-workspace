TODO
====

Working state, not documentation. `README.md` is the document and stays the one
that describes how any of this works — if something here is finished, it belongs
there and should leave this file. Anything left in here long enough to go stale
was probably never going to be done.


Waiting on a restart
--------------------

The window loads `server.js` at startup, so these are committed and inert:

* `vmRotateToken` — give a machine a new token without rebuilding it
* the "may push X, but its work is on Y" line in the two dialogs that ask
* dropping a machine's session when its power is pulled or it is rolled back

**Never restart while a machine is installing.** The install fetches its scripts
at the very end.


Nothing else is outstanding
---------------------------

Everything on the previous list is done, and each was checked by running it
rather than by reading it. The snapshot drill passed in all three directions,
the actions are off the network entirely, the destructive dialogs say what they
would destroy, ssh hardening survives an install, and the debris is cleared.

What remains is the "Honest gaps" section of `README.md`, which is a different
kind of thing: what has never been tried, rather than what is half-built. No
server image has been installed, the source-build fallback in a project script
has never run, and nothing here has been left running for days.


Where the machines are
----------------------

Volatile, and the first thing to check rather than trust:

    okc.js vmList --json

At the time of writing: `runner1` off, restored to the `on-fix-try-one`
snapshot, hardened, recording `fix/try-one` as what it may push. `runner2` up
and connected, built from nothing over TLS, ssh hardened, with no workspace set
up on it.

**`fix/try-one` no longer exists in the workspace repositories** — it was test
debris and was deleted. `runner1` still claims the name, which is deliberate
rather than stale: setting it up again cuts the branch afresh from `master`, and
the claim stops another machine taking the name meanwhile.
