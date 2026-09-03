# A machine's life

    create ─► install ─► base snapshot ─► (run ─► put away)* ─► remove

## Create

`vmCreate --vm {...}`: a name, an Ubuntu Server ISO, CPUs, memory, disk,
tags, and whether it is a supervisor. The spec is kept; `vmList` shows it
with the live state beside it. A machine gets a serial console file in the
app's data folder from the start — it is the only thing that can say
anything during an install.

## Install

`vmInstall`: unattended, from the ISO, with the app's autoinstall answers
and its provisioning scripts fetched from this host at the very end
(`GET /provision/*`). About twenty-five minutes. Nothing else comes up
while it does, and **the app must not be restarted during one**. The
scripts put on the machine: the agent that dials in, the toolchain, the
credential helper, the MCP that gives Claude the supervisor API, the skill
for its kind, and the hook that keeps a machine to its role.

## Base

When the install ends the machine is snapshotted as `base`, off. Every run
starts there and ends there.

## A run

The queue (or `vmDispatch`) brings it up, sets up its workspace on the
branch pointed back at this host, lends it a credential, runs the job,
follows the output, and when the run ends: takes the credential back,
keeps the log and the meter, hands over artifacts, and **restores the base
snapshot and switches it off**. Off, on base, claiming nothing, holding
nothing.

## Borrowed

`vmBorrow` takes one out of the pool for a person and brings it up clean;
`vmReturn` puts it back — clean, or `--keep` to release the claim without
rolling back. A borrowed machine is never picked by the queue.

## Dialled in

A machine reaches this host on three ports: 7383 (https), 7384 (the
certificate authority), 7385 (the channel). *Connected* means the agent
is on the channel; *running, not dialled in* for more than a few minutes
means look at the host first — `nothing is listening for machines` in the
events is the host holding its own ports, and a restart of the app fixes
it. `vmAwait --name X --for connected` waits.

## Remove

`vmRemove` deletes the machine and its disks and forgets it; `vmForget`
stops managing one without deleting it; `vmRebuild` removes and makes it
again from the same spec.
