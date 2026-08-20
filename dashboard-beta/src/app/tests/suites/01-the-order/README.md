# The order the work goes

The order every piece of work goes through here, stated as a series and checked in that order.

There was a prose version of this, written by reading the markup and the action
table — so it said what the app **does** rather than what it was meant to do, and
those are only the same on the day it is written. It is gone, having served its
purpose, which was describing what this suite should check. Prose is where an
order drifts; this is the copy that runs.

**The order is defined as much by what is refused out of order as by what works
in it.** "Cut a branch, then write a task" is only a rule if writing the task
first is refused; otherwise it is a habit, and a habit is what a UI enforces and
an API does not. So every test here does the step, and then tries the step before
it out of order.

This is the suite that is meant to grow. What is here stops at promoting a cut;
the rest of the order — giving a task out, a worker delivering, judging it,
cutting the PR — is checked in the suites that follow, and the parts that cannot
be stated without a machine are `draft()` entries there rather than prose
anywhere.

**Every write is named `drill/` or `drill:`** and undone in `cleanup()`. A
cleanup does not run when a process is killed, so `drillSweep` in
`actions/tests.js` is the backstop.

The stages that need a machine — installing a runner, giving a task out, a
worker delivering — are not here, because they cost minutes and because a suite
that mostly reports "no machine was on" teaches somebody to stop reading it.
They live in the suites that own them, marked as needing one.
