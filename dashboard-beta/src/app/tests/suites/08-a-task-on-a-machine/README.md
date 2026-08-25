# A task on a machine

The point of the whole tool, and the last part of it that nothing checked.

Everything else here proves a piece: a branch is cut, a task is written, a
machine comes up, a change goes out as a pull request. This is the piece that
joins them — work written down on this host, given to a machine that did not
exist an hour ago, done by something running inside it, and delivered back onto
a branch where it can be read and judged.

**It costs minutes and it holds a machine**, so it is off unless asked for:
`suiteRun --slow true`. Run all reports it as "could not be tried" and says how
to ask, which is the honest answer rather than a machine borrowed out from under
somebody.

**It uses a job that does not call Claude.** `api-tour` exercises every helper a
job is handed and hands back a file, which is exactly what this drill needs to
watch: dispatch, work, delivery, artifact. A drill that waited on a model would
be slower, would need a credential, and would prove less about this app —
whether a worker writes good code is not a question this suite can answer.

**The queue does the work, not the drill.** Nothing here brings a machine up or
sets a workspace by hand: the task is queued and the queue is left to it, because
the thing being tested is the queue. A drill that dispatched by hand would prove
that dispatching works and say nothing about whether work waiting in the queue
ever reaches a machine.

**Everything is put back.** The task is removed, the branch is deleted, and the
machine is returned to its base snapshot — which the queue does itself when the
work ends, and which the last check confirms rather than assumes.

## What used to be here: `04-what-a-worker-is-handed`

The app this is ported from has a fifth drill in this suite, and it is the only
file in the whole kit that was **removed rather than rewritten**. It read the
generated run script and asked four things of it: that the three commands are
written and made executable, that none of them carries a credential, that
`okc-say` can never fail the work it was describing, and that the skill is
fetched per run rather than baked in when the machine was built.

**It could not survive the port as a drill.** It reached for
`machines/dispatch` by `require`, and a drill here runs from `dist/suites` with
only the harness beside it. More than that, reading a string this host built is
a unit test wearing a drill's clothes — there is no machine in the question — so
it belongs in `test/` the way the rest of this suite's arithmetic does.

**Where its four checks live now:**

| it asked | asked now by |
|---|---|
| the three commands are written, and each is executable | `test/vms/dispatch-script.js` — `okc-artifact` and `okc-say`; `test/vms/dispatch-payloads.js` for the `okc-watch` launcher |
| none of them carries a credential | `test/vms/dispatch-script.js` — the token is never an environment assignment, never present with no job, and both commands that reach this host authenticate as the machine |
| `okc-say` never fails the work it was describing | `test/vms/dispatch-script.js` |
| the skill is fetched per run, not installed once | `test/vms/dispatch-script.js` |

**Writing this table is what found the two holes it had left.** Nothing asserted
that `okc-say` is made executable, and nothing asserted that either command
authenticates as the machine — every credential check over there is a NEGATIVE
one, and all of them pass just as happily if the two commands carry no
credential at all and fail on the guest twenty minutes in with a 401. The source
did both correctly; it was the asking that had gone. Both are asked now.

**Which is the argument for this section existing.** A drill that is rewritten
says in its own header what it stopped asking — every other file in this kit
that moved coverage into `test/` carries that block, and following one is how a
person checks the move was honest. A drill that is deleted has nowhere to say
it, so the only trace is a file that used to be in a list. This is that trace.
