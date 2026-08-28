# Consoles, snapshots and holds

What to read when a machine goes quiet, and what it is keeping that is not
here.

## The console

Every machine writes its serial console to a file this app named, and the
**Terminal** tab shows it live. `vmLog --name X --which serial` reads it;
`--which serial-previous` reads the boot before this one, kept aside on
start because starting a machine truncates its console and the record of a
boot that went wrong is destroyed by the obvious response to it. It is the
only thing that says anything during an install.

`vmScreenshot --name X` is a picture of the screen — the one answer to
"working or stuck" before the agent connects. `vmWatching` renders what the
model on a machine is doing now; `vmSessions` and `vmSessionTail` read its
Claude sessions.

## Snapshots

`base` is the clean starting point every run returns to. `vmSnapshotTake`
keeps another with a title; `vmSnapshotRestore` goes back to one,
discarding everything since (`--keepBorrow` keeps a borrow through it);
`vmSnapshotDelete` merges one away. `vmBaseSnapshot` shuts down, snapshots
as the new base, and starts again — for a machine that was set up by hand.
A snapshot of a running machine stores its RAM, so it refuses; stop it
first.

## Holds

`vmHolds --name X` says what a machine is holding that is not here:
commits not pushed, files not committed. Read it before restoring or
removing a machine somebody worked on by hand. `credentialRecover` starts a
machine holding a sign-in, takes the sign-in back with whatever the worker
refreshed, and leaves the machine as it was found.

## A force-stop sends no FIN

A machine pulled down with `vmStop --force` reads as connected for another
seventy seconds, because TCP was never told. The `channel-silence` timer
notices a machine that stopped answering; anything that stops or restores a
machine drops the channel first.
