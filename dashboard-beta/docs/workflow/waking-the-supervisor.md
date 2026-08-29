# Waking the supervisor

The supervisor is a machine that takes one turn when something wakes it,
reads what changed, decides, acts through the supervisor API, says one
thing to you, and stops. It does nothing between turns.

## What wakes it

| trigger | gate |
|---|---|
| a person says something on Chat | `supervisorWakes` (Answers by itself) |
| **Wake it** on Chat, or `supervisorWake --why` | always |
| a task lands | `supervisorWakes` |
| a judgement finishes | `supervisorWakes` |
| a trusted person's `okc:` tag on an issue or pull request | `watchGitHub` and `supervisorWakes` |
| *Hand it to the supervisor* | always |
| a pull request this host cut merges | `watchGitHub` and `supervisorWakes` — the sweep reads it as gone, asks GitHub, and says `landed` |

Every wake is one line in the events: `waking it — J34 finished — it
concluded "reject"`. The reason is what it reads first.

## What it reads

1. `whatsNew --since <bookmark>` — what was said to it, what landed, what
   is waiting, and `arrived`: what turned up on GitHub since it last looked.
   The event trail comes only with `events: true`.
2. `triage` — what it is in the middle of, and which of those things
   finished while it was away.
3. Then the specifics: `issueRead`, `judgementFindings`, `branchBoard`,
   `prCuts`, `jobs`.

It cannot see files, run commands, or reach anything but the actions on
[what the supervisor may call](../permissions-and-guards/what-the-supervisor-may-call.md).

## What it leaves behind

- **Chat** — one message, signed with its machine, saying what it did and
  what it needs from you.
- **Triage** — what it is carrying and in what state (*waiting on a judge*,
  *needs a person*).
- **Todos** — `T` refs, for things it saw and did not act on.
- Drafts in the inbox, tasks on the queue, judgements on the board.

## When it cannot be woken

`it could not be woken — this host is shutting down` means the server half
reloaded mid-turn; the guest usually finishes anyway and the next wake
catches up. `nothing is listening for machines on port 7383` means the
host's ports are held — restart the app, not the machine.
