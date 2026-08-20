# The machines

The half of this app the other suites can only describe. Everything before this
folder runs against branches, tasks and GitHub — all of which answer in
milliseconds and none of which can be half-on.

**A machine is slow, and that is the whole difficulty.** Coming up is a minute or
two, an install is twenty-five, and a worker is however long the work is. So a
check here says what it will cost — `it(..., { minutes })` — and the suite is
built so that the expensive ones are the ones that could not be arranged any
other way.

**The resting state is the claim being made.** Off, on its base snapshot,
claiming no branch, holding no credential. Every refusal the queue depends on is
written against that state, and a machine left running with a claim on it is a
machine the queue correctly ignores for ever — which looks exactly like a queue
that has gone quiet.

**What is here needs a machine that is already installed.** Making one is
`vmCreate` then `vmInstall`, twenty-five minutes, and it fetches its scripts from
this host at the very end — which is why nothing here restarts the dashboard and
why the install is a drill a person decides to run rather than a check.

**Anything started here is put back.** A machine borrowed by a drill is returned
in `cleanup()`, and `cleanup` runs even when the series stopped early. What it
cannot survive is the process being killed — after that, the Runners tab is the
thing to look at, and `vmReturn` is the button.
