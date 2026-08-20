# The machines are built

The warming stage, and the beginning of everything else: two machines defined,
installed unattended, provisioned, and dialling in — with nothing to start from
but an ISO.

**Warming and proving are the same act here.** Nothing is faked to get the host
ready. The machines everything downstream uses are made from nothing and watched
doing it, on the serial console, step by step — the installer talking, curtin
writing the disk, the handover to what was installed, provisioning running, the
agent starting. A kit that only worked on a host which already had runners would
not be a kit; it would be a habit.

**Two, at the same time.** Two because one machine cannot show "this branch is
already being worked on by another machine", and a queue with one machine never
has to choose. At the same time because that is the interesting case — two
installs competing for disk and cores — and because twice ten minutes is twenty
and once is ten.

**`kit-1` and `kit-2`, always.** Stable names are what make this stage
idempotent: "are they built?" becomes a question about the world rather than
about a note, and a note can be perfectly true about a machine somebody deleted
by hand this morning. On a warm host this suite passes in seconds having built
nothing, because the claim it makes is *two machines are built and ready*, not
*I built two machines*.

**It is off unless you say so**, with `--slow true` — but only when there is
something to build. On a host where both already exist it needs no permission,
because it is about to do nothing.

**Nothing here removes them.** Taking them away is `09 cooling the host`, asked
for on purpose with `--teardown true`, and doing it marks this suite dirty again
so the ledger says a rebuild is owed.

## What it is really for

The pair of questions no code review can settle: does the unattended install
still work with the ISO in use, and do the provisioning scripts still produce a
machine this app can talk to? Both break silently, and both break at the worst
possible moment — twenty-five minutes in, on a machine somebody needs.
