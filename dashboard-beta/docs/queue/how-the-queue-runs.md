# How the queue runs

The queue is started by the server half, not the window, and ticks every
fifteen seconds whether or not anybody is watching. `queueState` is what it
is doing; `crons` lists the timers it runs beside.

## One tick

1. Judgements first — they read work already waiting — then tasks, oldest
   first.
2. For each, find a free machine of the right kind: a task with no tag
   takes any free machine; a tagged one (`worker`, `judge`, `test`) takes
   only its own kind and waits. `pools` is the answer to "is anything
   free".
3. Bring the machine up on its base snapshot, **lend it the credential for
   the role the run is** (`vmCredentialsPut --role worker|judge`), set up its
   workspace (every repository, on the branch, pointed back at this host's git
   server), put the judge's report on it if the task was raised because of one,
   and run the job.

   Those are timed separately and named on the attempt — `bringUp`, `credential`,
   `workspace`, `work` — which is where "bringing a machine up costs about thirty seconds
   before any work starts" comes from. The credential goes on **before** the
   workspace, and the timings are kept per attempt.
4. Wait for the run: follow its output, keep the log on this host, meter
   what the sign-in spent.
5. Take the credential back, keep what the worker refreshed, roll the
   machine back to its base snapshot and switch it off. **Off, on base,
   claiming nothing, holding nothing** — every time.

## Every step goes through the actions

The queue drives the same surface a person does, so every refusal still
applies. There is no private path to the machines; the second set of rules
is always the one that turns out to be wrong.

## Restarts

A restart adopts what was in flight: waits on a run if it is alive, keeps
its log, puts the machine away, and re-queues anything that had not been
given out. That is recovery, not a reason to restart casually — never
during an install, and not during a drill being measured.

## Stopping

`queueStop --why` stops giving out new work; a run in flight finishes.
`queueStart` resumes. **It comes up running on every start** — there is no
setting for that any more, and a stopped queue was stopped by somebody. Stopping
survives a save; only starting the app brings it back. `taskUnqueue` and
`judgementUnqueue` take one thing back out without stopping the rest.

## What can go quiet

A machine that still claims a branch is correctly never picked up, and the
failure looks exactly like a queue that has gone quiet — `vmList` shows
the claim, `vmReturn` releases it. A sign-in that failed to authenticate is
paused and nothing lends it until `guestResume` says the pause was wrong.
