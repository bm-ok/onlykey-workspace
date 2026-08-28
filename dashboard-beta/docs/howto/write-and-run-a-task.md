# Write and run a task

A task is work for a machine: a brief, a job that runs it, and a branch it
delivers on. Nothing runs unless the job and its prompt were approved by a
person.

## At the window

1. **Queue → Add task.** Give it a title and a brief. The brief is what the
   worker reads — say what is wanted, where, and what "done" looks like.
2. **Pick a job.** Only runnable ones are offered: approved script, approved
   prompt, approved contract. `do-the-work` is the ordinary one.
3. **Say the branch.** Either a branch already cut, or *cut from* a line
   with a reason, and the branch is cut for you when the task is written.
   If the task came from an issue, it carries `issue: {on, number}` — the
   pull request will say `Closes owner/repo#N` from it.
4. **Queue it.** The next free machine of the right kind takes it, runs the
   job, pushes to this host, and shuts down.

## At the command line

    node tools/okc.js taskCreate --task '{"title":"...","brief":"...","job":"do-the-work","cutFrom":"test-bc1","reason":"..."}'
    node tools/okc.js taskQueue --id <id>
    node tools/okc.js taskProgress --id <id>     what the worker is doing now
    node tools/okc.js taskLog --id <id>          the kept output afterwards
    node tools/okc.js taskArtifact --id <id>     what arrived on its branch

`--becauseOf J12` ties a task to a judgement; the judge's report is put on
the machine where the worker will find it.

## What you should see

- Queue: the task *given* to a machine, then *done* with the commits it
  made per repository.
- Events: `#N done — finished (exit 0) — 2 commit(s) in local-repo-b`.
- Supervisor → Chat, if `supervisorWakes` is on: woken by the landing, and
  usually a judgement queued to read what came back.

## When it does not run

`queueState` says why: no free machine of that kind, the queue stopped, or
the job not runnable. A task that ran and delivered nothing is *done* with
zero commits — read `taskLog`, which survives the machine.
