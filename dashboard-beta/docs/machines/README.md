# Machines

The virtual machines this app makes and runs work on: how one is built,
what it holds while it works, what it is put back to afterwards, and the
sign-ins it is lent. The Runners tab is where they live; only
`src/app/vms/vbox` may speak to VirtualBox, and a second opinion about a
machine's state is the bug that rule exists to prevent.

- [A machine's life](a-machines-life.md) — create, install, base, run, put away
- [Pools and tags](pools-and-tags.md) — how the queue picks one
- [Consoles, snapshots and holds](consoles-snapshots-and-holds.md) — what to read when one goes quiet
- how to [build one](../howto/build-a-machine.md) and [sign one in](../howto/sign-in-a-machine.md)
