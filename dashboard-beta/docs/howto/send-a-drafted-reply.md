# Send a drafted reply, close or review

Everything the app would say on GitHub in your name is written first and
sent by you. Three kinds: a **reply** on an issue or pull request, a
**close** of an issue, a **review** of a pull request.

## Where drafts show

- **Inbox** — *a reply is waiting to be sent* (or close, or review), with
  the first line and who wrote it.
- **Repositories → Issues** — pick the repository, then the issue or pull
  request; the draft is a card with **Send it** / **Close it** / **Post the
  review**, and **Throw it away**.
- **Judge → Judgement** — a review draft also sits with the judgement that
  wrote it.

## Steps

1. Read the whole draft. It goes out under your account; a maintainer reads
   it as yours.
2. Send it, or throw it away. To change the words, throw it away and say so
   to the supervisor on Chat — it writes again.
3. A review pinned to a commit the author has since pushed over is refused
   at release: judge again first.

## Sending everything at once

Repositories → Issues → **Send all N waiting** (purple) releases every
waiting draft through the same door as sending them one at a time: the
thread must still have been addressed and tagged, a review pinned to a
commit the author has pushed over is still refused, and one that refuses is
named while the rest go.

## Making it automatic

Settings → Trust → **Speaking in your name**: three purple switches, one per
kind — replies, closes, reviews — go out directly. With replies on, an
`okc:` comment on a pull request gets its answer under the pull request
with nobody pressing anything. The draft step stays for the kinds you leave
off.

## Command line

    node tools/okc.js issueDrafts --json          what is waiting
    node tools/okc.js issueApprove ...            refused — a person's press
    node tools/okc.js issueDiscard ...            refused — likewise
