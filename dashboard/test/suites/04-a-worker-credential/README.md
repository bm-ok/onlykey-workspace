# A worker credential

The second door a person has to open, and it is deliberately not beside the
first one.

A GitHub token is about this host: it pushes, it opens pull requests, it syncs
forks, and it is checked before anything is cut. A **worker** credential is
about a machine — it is lent to one for the length of a job and taken back when
the work ends — so asking for it before any machine exists means asking a
question that cannot be answered properly.

Here, machines exist. So this suite can do the thing that matters, which is not
"is there a file" but **can a worker actually sign in with it**: hand it to a
machine, ask, take it back, put the machine away. A credential that is present
and no longer accepted is worse than a missing one, because it fails at the far
end — after a branch is cut, a machine is up and a job has started.

**It reads nothing.** Whether one is held, which plan it is on, how long it has
left, and whether a machine could authenticate with it. Never the credential.

**Its first check is a door.** No credential is `asksYou`, not a failure: a
person signs a worker in, and every run says so until they have.
