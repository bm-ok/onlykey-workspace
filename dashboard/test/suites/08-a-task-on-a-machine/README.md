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
