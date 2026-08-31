# Work in a machine yourself

The **DIY** tab is a worker lane with no queue in it. The same acts a task
gets — a machine, a branch cut laid on it, a sign-in, an editor open on it
— driven by hand, for a person, with nothing picking the machine, judging
the result or tidying it away.

## What a seat is made of

A piece of work on this tab holds three things, and the pane says which of
them it has:

- **a machine of my own** — tagged `diy`, so the queue will never take it
  and nothing rolls it back while you are in it
- **a branch cut to push into** — every repository on that branch, with
  origin pointing back at this host, so a push lands here and not on GitHub
- **my Claude sign-in on it** — a `diy` sign-in, yours, metered separately
  from the pool the queue draws from

## Steps

1. **DIY → +**, give the piece of work a title and pick a cut. The cut is
   one branch across the repositories; make one on **Branches Cut** first
   if there is none.
2. **Open it in VS Code.** One press does the rest: takes a free `diy`
   machine, starts it, waits for it to dial in, lays the cut on it, lends
   it a `diy` sign-in, opens the editor on `~/workspace`, and installs the
   Claude Code extension **on the machine**.
3. Work in it. `claude` in a terminal in there is signed in as you.
4. **Put it to sleep** when you stop for the day: the sign-in comes home,
   the machine shuts down, and your work stays on the disk. Opening it
   again wakes it and lends the sign-in back.
5. **Clear the machine** when you are done: it rolls back to its base
   snapshot and returns to the DIY pool. That throws the disk away.

## It only asks what it cannot know

One free machine is not a choice, and neither is one free sign-in — the
press takes them. Two of either is a decision nobody else can make, because
which machine has last week's work on its disk is not a fact this app
holds, and the refusal lists them.

Every step is skipped if it is already true. The second press of the day
does not re-lay a workspace over work in progress or lend a credential that
is already there.

## The editor half

The extension runs in the **remote** extension host, so the one installed
on this desktop is not the one that window uses — it says so itself. The
press installs it on the machine, waits for VS Code to push its server
there first, and says what happened either way.

Three things it handles that are easy to hit:

- **A window already open on that machine.** If its connection is healthy
  the press brings that window forward rather than opening a second one on
  the same folder. If the connection is dead — which is what a rollback
  leaves behind, and VS Code holds it for three hours — the press closes
  that window and opens a new one. While such a window is up, every launch
  aimed at that machine does nothing at all.
- **A server that is still being unpacked.** VS Code downloads into
  `<build>.staging/` and renames it when it has finished; a binary being
  there is not the server being ready. It skips staging directories and
  proves a candidate runs before using it.
- **Which platform the far end is.** Remote-SSH asks the first time it
  meets a host and waits for an answer; the entry is written before the
  launch, because Remote-SSH reads it at connect time.

If the extension does not go on, the press says so and says why, in the
machine's own words. The editor is open either way — that is not a failure
of the press, and neither is reported as one.

## Command line

    node tools/okc.js diy --json                 the seats, and what each holds
    node tools/okc.js diyOpen --id diy-1         refused: this one is a person's press
    node tools/okc.js diySleep --id diy-1
    node tools/okc.js diyClear --id diy-1

Opening an editor is a person's press and the command line is refused: it
starts a program on somebody's desktop.

## What it does not do

No judge reads it, no sweep tidies it, no supervisor asks about it, and
nothing is cut from it or sent anywhere until you decide there should be a
pull request. **Name it as a line** on the pane is the step between what
you have pushed and sending it anywhere — see
[Branches, lines and cuts](../repositories/branches-lines-and-cuts.md).
