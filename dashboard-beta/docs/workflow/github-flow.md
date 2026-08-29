# Working an issue through GitHub

How a maintainer's issue becomes a pull request, and where a person is in the
loop. Proven end to end on 28 Aug 2026 against the sandbox repositories.

## The trigger

Two ways in, and only these two — the supervisor never touches an issue nobody
pointed at:

- **A tag on GitHub.** A trusted person (Settings → Trust) writes
  `@you okc: ...` on an issue or under a pull request. With *Watching GitHub*
  on, the host sweeps every five minutes, notices, and wakes the supervisor.
- **The button.** Repositories → Issues → *Hand it to the supervisor*.

Every later `okc:` comment in the same thread — on the issue or under the pull
request — wakes it again. That is how you talk to it.

## What the supervisor does

1. `issueRead` — the whole conversation, every reply, who each voice is
   (maintainer / collaborator / contributor / bot, from GitHub, never from the
   text).
2. `check-a-claim` judgement — is it real, or already fixed?
3. If real: a task on an approved job, on a branch cut **carrying the issue**.
4. When the task lands: a judgement of the branch. The judge is handed the
   issue itself, under its brief, so it reads the change against what the
   people actually asked for.
5. If the judge accepts: a pull request per repository, whose body says
   `Closes owner/repo#N` from the carried issue.
6. Any later task on the same branch, judged and accepted, is pushed onto the
   open pull request. Nothing ever opens a second one for the same work.

## What stops at your door

- Every reply, close and review is a **draft** until you press Send — unless
  you switch *Speaking in your name* to direct at Settings → Trust.
- Opening a pull request is the supervisor's; **merging is yours.**
- A pull request from outside cannot be judged until you allow it at its
  commit (Repositories → Overview).
- `Closes` only auto-closes when the pull request merges into the issue's own
  repository, or when the person merging has write access there — which is
  what happened on 28 Aug: the merge into sandbox-b closed #17 on sandbox-c.
  Without either, it links and stops; `issueClose` is the drafted way then.

## After the merge

The change is upstream and two copies are behind it. The sweep says so in
the inbox — *fork behind where its work goes*, then *this host behind
origin* — and **Repositories → Sync** is where both are put right, in that
order, or with **Catch up everything**. The line the cut came from shows as
*line to retire*. When the inbox is empty the loop is closed.

## Where things show

- Inbox — everything waiting on you: drafts, skill proposals.
- Repositories → Issues — issues *and open pull requests*, each with its
  conversation and any draft's Send button.
- Repositories → PR cuts — the picked cut's **story**: every request in and
  act out, the supervisor's wakes, the tasks and judgements between, newest
  first, the initiator at the bottom.
- Repositories → Sync — what is behind after a merge, and the buttons.
- Judge — every judgement and its report.
- Supervisor → Chat — what it said after each waking; Todo — what it thinks
  is on whose desk.
