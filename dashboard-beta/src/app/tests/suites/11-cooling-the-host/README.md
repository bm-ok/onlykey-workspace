# Cooling the host

The last suite, and the only one that takes things away.

The kit **warms** a host: it builds two machines, and everything after that
stands on them. This is the other end — the machines go, and the host is left as
it was found. It exists so the kit can be run on somebody's computer without
quietly leaving forty gigabytes of virtual disk behind.

**It is off unless asked for**, with `--teardown true`. That is not the same
gate as `--slow`, and the difference is the point: slow means "this takes twenty
minutes", teardown means "this UNDOES the twenty minutes somebody already
spent". While anybody is working on this app, the machines want to stay
standing — a warm host is the whole reason the build stage passes in seconds —
so taking them away is a thing to decide, not something a run does to you.

**Doing it marks the build stage dirty.** Not because anything failed: the
machines really are gone, so "two machines are built and ready" has stopped
being true. See `invalidates` in the harness — the same machinery as a
contradiction, fired on success instead of failure.

**It only removes what the kit made.** `kit-1` and `kit-2`, by name, and the
debris the drills leave under their reserved names. Somebody's own runners are
never in question, which is why the kit builds its own machines rather than
borrowing them.
