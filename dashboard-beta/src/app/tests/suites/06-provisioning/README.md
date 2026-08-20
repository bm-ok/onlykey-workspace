# Provisioning

What a machine is handed, and how a change to it reaches one.

**The scripts are fetched, not baked in.** A machine asks this host for
`first-boot.sh` at install time and for any stage again afterwards, over the
same authenticated endpoint — so editing a script here is how a machine changes,
and nothing has to be rebuilt for an edit to take effect. That property is the
whole reason provisioning is iterable at all: the alternative is a
twenty-five-minute reinstall to try a one-line change, and nobody iterates on a
half-hour loop.

**So what is checked here is the path, not the effect.** That the app serves
exactly the file on disk, with the header it promises to prepend, and that a live
machine fetching it gets the same bytes. What a script *does* to a guest is
proven by the guest afterwards — and the expensive half of that, a fresh install,
is a drill a person decides to spend twenty-five minutes on, not a check.

**Nothing here re-bases a machine.** A change applied to a live machine is
discarded by the next rollback, which is correct and is why these drills leave no
trace. Making a change permanent means a new base snapshot, and that is a
deliberate act by whoever owns the machine — not something a test does on its
way past.
