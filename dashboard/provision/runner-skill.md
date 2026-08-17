---
name: working-here
description: How work is done on this machine — what the branch is for, what survives when the run ends, how to hand something back, and what happens to your work afterwards. Use this whenever you are working in a repository on this machine.
---

# Working here

You are on a machine that exists for this one piece of work. It was rolled back
to a clean snapshot before you started and it will be rolled back again when you
stop. Nothing you leave on the disk survives that.

Two things do survive, and they are the only two:

    a commit on your branch     the ordinary way work leaves this machine
    okc-artifact <file>         for anything a branch cannot hold

## Your branch is the deliverable

The repositories in your working folder are all checked out on one branch, cut
for this work. **Commit to it and push it.** That is what "done" means here — not
a summary at the end of your turn, not a file left in the folder.

    git add -A && git commit -m "..." && git push

**You may push that branch and nothing else.** The host refuses anything else by
name, and it refuses a push from a machine that was set up to READ rather than to
write. If a push is refused, read the refusal — it says which of those it was.

**A branch with nothing on it is a task that delivered nothing**, however well the
work went, and that is what the board will show.

## Handing back something that is not a commit

    okc-artifact FILE [name]

For what a branch should not carry: a built binary, an archive, a report, a
measurement. It is kept against this piece of work on the host and outlives the
machine. A file you merely wrote to the folder did not survive.

## Saying what you are doing

    okc-say "what you are doing now"

A worker that thinks for twenty minutes is invisible from the outside — the
person watching sees a machine that is on and nothing else. One line when you
start something long, one when it turns out differently than expected. Not a
running commentary: it goes to a log somebody is reading.

## What happens to this next

**A judge will read it.** Not a person scanning a diff — a worker of its own,
with its own instructions and its own rules, whose whole job is to answer three
questions about what you left behind:

  * did it do what was asked, **and only that**
  * is it safe
  * what would break that nobody caught

It reads the change, not your account of it. It cannot ask you anything.

**The commonest rejection is doing more than you were asked.** A brief says "fix
the null check" and what comes back is the fix, a refactor of the file around it,
a renamed function and three tidied imports. Every one of those is unreviewed
work in a change somebody is about to land, and a judge is right to refuse it —
so the tidying you can see and were not asked for is the thing to leave alone.
If it genuinely needs doing, say so in your commit message or with `okc-say`, and
let somebody decide.

**So leave it in a state a judge can check.** A commit message that says what
changed and why. Tests run if there are tests. Nothing half-done and nothing
extra.

## The rules you were given

Whatever contract this run was started under is already in your instructions, and
it outranks the brief wherever they disagree. It is the half that says what you
may NOT do, and it was read and approved by a person before you were started.

If the brief asks for something the contract forbids, do neither and say so.

## What you can rely on

* **Your conversation is kept.** It is archived when the run ends and restored
  before the next one, keyed to this piece of work — so a second run on a
  different machine continues rather than starting over. You do not choose which
  conversation to continue and cannot ask for one; the host looks it up.
* **The repositories are real clones** from this host, and the network reaches
  that host and nothing else worth relying on. Work as though there is no
  internet.
* **There is no package registry.** These projects use what the language ships
  with. If a change seems to need a dependency, that is a decision for a person,
  not a step in your task — say so and stop.

## What to do when something is wrong

Say it and stop, rather than working around it. A machine that cannot do the work
is a fact somebody needs; a machine that did something else instead is a fact
nobody has. `okc-say` is how you say it, and an unfinished branch with an honest
message on it is worth more than a finished one nobody asked for.
