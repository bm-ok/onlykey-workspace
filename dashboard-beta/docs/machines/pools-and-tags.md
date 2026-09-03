# Pools and tags

A machine carries tags, and a tag is a pool. The queue never picks a
machine by name.

## The four roles

Tags are otherwise free text — they are whatever somebody calls a kind of
machine — and four are given a meaning by this app.

| tag | what it means |
|---|---|
| `worker` | takes tasks from the queue |
| `judge` | takes judgements |
| `supervisor` | decides what work there is, and is never given any |
| `diy` | a person's seat: nothing hands it work at all |

`worker` and `judge` are ordinary tags and a machine may be both; it is
turned from one into the other by saying so (`vmTags --name X --tags
worker,judge`). What must not change underneath running work is a machine's
role while it is **busy**, which is a question about now rather than about
when it was made.

`supervisor` is **fixed at creation** and refused afterwards, because it
changes how the machine is provisioned — the app's own scripts instead of
the project's, and a second user for the sign-in desk. A guarantee somebody
can type away is not one.

`diy` is the person's. A DIY machine is the same disk as a worker; what
makes it a different kind is who is sitting in it. See
[Work in a machine yourself](../howto/work-in-a-machine-yourself.md).

## Picking

`pools` answers for the machines the queue may reach: per tag, which machines,
how many free, how many busy, and how many are kept back (`vmForTasks --enabled
false`). A task with no tag takes any free machine; a tagged one takes only its
own kind and waits. A judgement takes a `judge`.

**`supervisor` and `diy` machines are not in it at all**, because the question it
answers is *how many are free to take work* and neither ever does. They are still
on Runners → Virtual machines and on the Queue tab, where each says why the queue
leaves it alone.

That was not always true, and the way it failed is worth keeping. A DIY machine
appeared in `pools` as its own pool with nothing free in it and the reason *has
not been told what it is for — tag it "worker" or "judge"*. Untrue, since it had
been told; and dangerous, because following it hands a person's seat to the tick.
A supervisor read exactly that and reported a third of this host's machines as
idle by misconfiguration. The rule now lives in one place — `notForTheQueue` in
`src/app/queue/policy.js` — and `pools` asks it rather than checking for
`supervisor` on its own.

**The queue's question is worker-or-judge.** A supervisor is out because it
decides what work there is; a DIY machine is out because the whole point of
the role is that nothing rolls it back to base and runs a task over the top
of somebody's afternoon.

## No tag is not a kind

A machine carrying no role tag gets **no credential** and no work, and the
queue says so rather than guessing: *has not been told what it is for*.
That used to answer `worker`, on the grounds that every machine made before
the tag existed was an ordinary runner — true, and a guess about which
sign-in to hand a machine. An unlabelled box gets none.

The `machine-pools` timer puts a machine with no tag into the named
ordinary pool, `default`, so "which pool is this in" always has an answer
rather than a shrug.

## Free

Free means: off or idle, on its base snapshot, claiming no branch, borrowed
by nobody, holding no credential. A machine that still claims a branch is
correctly never picked up — that is what lets a machine be destroyed
mid-task without the task being lost — and it looks exactly like a queue
that has gone quiet. `vmList` shows the claim; `vmReturn` releases it.

`test` is what the drills borrow — never whichever machine is free.

## Credentials follow the role

A worker run is lent a worker sign-in, a judge run a judge sign-in, and a
DIY seat a **diy** sign-in of its own. A machine tagged more than one kind
needs `--role` when a credential is put on it by hand
(`vmCredentialsPut --name X --role judge`). Spend is metered per sign-in,
which is why the kinds are different sign-ins — sharing the worker identity
with a person would bill their afternoon to the pool the queue draws from,
and would mean the queue's workers and the person could not both be signed
in at once.
