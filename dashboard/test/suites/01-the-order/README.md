# The order the work goes

The order every piece of work goes through here, stated as a series and checked in that order.

`UI_OUTLINE.md` is the same thing in prose, and prose is where this drifts: that
file was written by reading the markup and the action table, so it says what the
app **does** rather than what it was meant to do — and the two are only the same
on the day it was written.

**The order is defined as much by what is refused out of order as by what works
in it.** "Cut a branch, then write a task" is only a rule if writing the task
first is refused; otherwise it is a habit, and a habit is what a UI enforces and
an API does not. So every test here does the step, and then tries the step before
it out of order.

This is the suite that is meant to grow. What is here stops at promoting a cut;
the rest of the order — giving a task out, a worker delivering, judging it,
cutting the PR — is still prose in `TEST-PLAN.md`, and belongs here as numbered
files once it can be stated without a machine.

**Every write is named `drill/` or `drill:`** and undone in `cleanup()`. A
cleanup does not run when a process is killed, so `drillSweep` in
`actions/tests.js` is the backstop.

The stages that need a machine — installing a runner, giving a task out, a
worker delivering — stay in `TEST-PLAN.md`, because they cost minutes and
because a suite that mostly reports "no machine was on" teaches somebody to stop
reading it.
