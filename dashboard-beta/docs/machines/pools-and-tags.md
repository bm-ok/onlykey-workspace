# Pools and tags

A machine carries tags, and a tag is a pool. The queue never picks a
machine by name.

## Tags

`worker` and `judge` are the kinds; a machine may be both. `supervisor`
is one machine's, set on its spec. `test` is what the drills borrow —
never whichever machine is free. `vmTags --name X --tags worker,judge`
changes them; a machine that carries no tag is put into the ordinary pool
by the `machine-pools` timer so every machine is in one.

## Picking

`pools` is the whole answer: per tag, which machines, how many free, how
many busy, and how many are kept back (`vmForTasks --enabled false`). A
task with no tag takes any free machine; a tagged one takes only its own
kind and waits. A judgement takes a `judge`.

## Free

Free means: off or idle, on its base snapshot, claiming no branch, borrowed
by nobody, holding no credential. A machine that still claims a branch is
correctly never picked up — that is what lets a machine be destroyed
mid-task without the task being lost — and it looks exactly like a queue
that has gone quiet. `vmList` shows the claim; `vmReturn` releases it.

## Credentials follow the tag

A worker run is lent a worker sign-in, a judge run a judge sign-in. A
machine tagged both needs `--role` when a credential is put on it by hand
(`vmCredentialsPut --name X --role judge`). Spend is metered per sign-in,
which is why the two kinds are different sign-ins.
