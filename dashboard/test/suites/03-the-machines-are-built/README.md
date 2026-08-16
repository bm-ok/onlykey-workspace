# Building a machine from nothing

The most expensive drill here and the only one that proves the beginning of
everything else: a machine defined, installed unattended, provisioned, and
dialling in — with nothing to start from but an ISO.

**It costs about half an hour and it holds the whole host.** An install does not
dial in until its first boot, so for most of that time there is no agent, no
channel and nothing to ask — which is why nothing else may come up while it runs
(see `machines/busy.js`) and why a restart of the dashboard in the middle throws
the whole thing away.

**So it is off unless you say otherwise.** `assert.needs(slow, …)` on the first
check, and `suiteRun --slow true` is how you say it. Run all reports it as "could
not be tried" with that sentence, which is the honest answer rather than a
half-hour somebody did not ask for.

**Everything it makes is named `drill-`.** `drillSweep` lists machines with that
prefix and removes them with `--remove`, the same as branches and tasks — because
a drill that dies half-way through an install leaves a virtual machine and a disk
image behind, and those are the most expensive debris in this project.

**What it is really for** is the pair of questions no code review can settle: does
the unattended install still work with the ISO in use, and do the provisioning
scripts still produce a machine this app can talk to? Both break silently, and
both break at the worst possible moment — twenty-five minutes in, on a machine
somebody needs.
