# Hand an issue to the supervisor

Two ways, and the supervisor never touches an issue that came in neither.

## From GitHub, with a tag

1. Be on the trusted list (Settings → Trust) and have a marker set. The
   default marker is `okc`.
2. On the issue — in its body or in a reply — **address the account this app
   posts as** (Keys → GitHub says which) and write your marker:
   `@okc-bot okc: I will look at this`. Say it the way you would to the person
   who filed it; the marker is the signal, the issue is the ask. Without the
   mention it is not a request to this host, and `issueRead` says why.
3. With **Watching GitHub** on (Settings → Trust), the host sweeps every
   five minutes. When it sees the tag it writes `owner/repo#N was tagged by
   you` to the events and wakes the supervisor.

Every later marked comment in the same thread — on the issue, or under the
pull request that came of it — wakes it again. That is how you answer it.

## From the window

Repositories → Issues → pick the issue → **Hand it to the supervisor**. The
whole conversation goes into the chat and the supervisor is woken. It is a
purple press: the command line and a machine cannot do it, because a
supervisor that hands itself work is deciding what it works on.

## What you should see

- Supervisor → Chat: a yellow *it was woken* line, then its answer.
- Judge: a `check-a-claim` judgement queued, then its report.
- Queue: a task on a branch carrying the issue, if the claim held.
- Inbox: a drafted reply when it has something to say to the thread.

Command line: `node tools/okc.js issueRead --on owner/repo --number N`
shows what it will read, including the `asked` field that says who tagged
it and where.
