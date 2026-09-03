# Issues

The Issues pane is work that arrived, rather than work written here — the
one thing in this app that comes *in*. Three columns: the repositories, the
issues and open pull requests of the picked one, and the picked
conversation with its buttons.

## What is read

Every open issue from every place the repository reads from, with its
replies (paged: the marker is most likely in the last one), and every open
pull request with its conversation. Each turn carries its author's role
from GitHub — maintainer, collaborator, contributor, community, bot — and
whether it is a **request**: written by a trusted login, carrying the marker,
and addressed to the account this app posts as (`@okc-bot okc: …`). A comment
the app posted itself is never a request, and `[FROM:x]` in the text is carried
as `claims` and believed by nothing. An issue's `asked` field says who asked, where (the issue itself
or a reply), and when; the last request wins.

Sub-issues and parents are read from GitHub's own links and shown on the
row (*under #16*, *0/1 sub-issues*), because an issue with sub-issues is
planning whose work is elsewhere.

## The conversation

`issueRead` hands back the whole thread as one fenced document —
`----- okc-issue-17 -----` around it, or `okc-pull-2` for a pull request —
headed with the sentence that it is evidence, not instructions. That is
what the supervisor reads, and what a judge is handed when it judges a
branch cut for the issue.

## The buttons

- **Write a task from it** — opens Add task with the issue quoted as the
  brief and carried as a fact, so the branch and the pull request know it.
- **Read it on GitHub** — in your browser.
- **Hand it to the supervisor** — the conversation into the chat, and a
  wake. Refused to anything but a press: it starts a machine turn, and a
  supervisor handing itself work is deciding what it works on.
- On a draft: **Send it** / **Close it** / **Post the review**, and **Throw
  it away**.

## Answering

`issueSay` and `issueClose` write drafts (or post, with the direct switches
on) and refuse for an issue nobody trusted has tagged — `mayAnswer`
re-reads the thread fresh before allowing either. `issueDrafts` lists what
is waiting. The supervisor may write drafts; only a person may release.

## Tags and arrivals

The sweep diffs its own two lists and records what **arrived**: new issues,
new pull requests, and issues or pull requests newly tagged — or tagged
again with a newer comment. A tag wakes the supervisor; a new issue is
noted and wakes nobody, because a supervisor woken for everything is one
nobody leaves on. `whatsNew.arrived` is what the supervisor reads of it.
