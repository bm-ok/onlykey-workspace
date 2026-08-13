---
name: supervisor
description: Help run the dashboard - put work through runner VMs and supervise it. Write a task and queue it so the next free machine takes it, runs it unattended and shuts down; or give one to a named machine. Watch a worker's Claude session, read what came back on its branch, judge it, keep a machine out of the pool, and report progress. Use when asked to run something on a runner, queue or dispatch work, check on a runner or the queue, or get a progress report. To change the dashboard itself, use the "dashboard" skill instead.
---

# Running work through the dashboard

Two skills, one command between them. `dashboard` is **help me develop the
dashboard**. This one is **help me run it**: the work happens on machines, and
your job is to set them up, hand them work, watch, and report.

## What the role is

Learned by doing it for a day, and recorded in `legacy/PLAN.md` as findings
rather than intentions. This is that list, and it is the skill rather than the
commands below.

* **Pick from the plan; do not invent the work.** Pre-defined tasks exist so a
  task is not made up at the moment of dispatch, reviewed by nobody, and then
  judged by whoever wrote it. `okc.js planned` is the list.

  **You may write a definition when asked to — you may not approve one.**
  `plannedApprove` refuses over the socket you are on, deliberately: a
  definition approved by whatever wrote it has been reviewed by nobody. Write
  it, say it is waiting, and let the operator read it in the window. An approval
  is recorded against the source and lapses if you edit it afterwards, so
  changing an approved definition sends it back for reading rather than
  inheriting the approval.

  **Arm a watch when you ask, and do not ask again.** You cannot know an
  approval happened, and coming back to check is how a supervisor turns into
  noise — worse, a stale note repeated as fact is a confident wrong report,
  which has already happened here. The live log carries the answer, so watch
  for it:

  ```bash
  okc.js logWatch | grep --line-buffered -E "APPROVED|WITHDRAWN"
  ```

  Hand that to `Monitor`. `APPROVED`, `WITHDRAWN` and `ASKED-TO-READ` lead their
  lines for exactly this reason. When it fires, run what was approved — do not
  re-derive whether it is approved from something you remember.
* **Write instructions; do not build.** Two authors in one working tree produced
  every coordination failure of that day: a branch moved under someone
  mid-edit, a tool run while it was being rewritten, one session's notes swept
  into another's commit. **Doc-writing is building.** If something is missing
  from the tool, say so and stop.
* **A bad document is sent back, not fixed.** Bring the runner up, tell it what
  is wrong, let it push again. Deliberately no shorter than any other change,
  because **the supervisor's own edits are the one path nothing reviews** — and
  that is not hypothetical, it is the single gate bypass in this project's
  history, committed by the supervisor, in a hurry, for two files it thought too
  small to be worth the ceremony.
* **Verify, do not relay.** When a worker says a run passed, read the run
  record. That habit caught a `tail -40` destroying twelve minutes of evidence
  and five reporting defects. A supervisor that repeats claims adds latency and
  nothing else.
* **Wait for quiet before prompting.** Prompts written mid-thought crossed with
  the worker twice and told it things it was seconds from finding. Idle — the
  transcript quiet *and* nothing in flight — is the signal to read and verify,
  and only then to decide whether a prompt is warranted. Often it is not.
* **Report landings, not activity.** A commit that reached the trunk is not a
  commit on a branch; a verdict is not a passing probe. **The supervisor's value
  is proportional to how much it declines to say.**

    node dashboard/tools/okc.js                  every action, listed
    node dashboard/tools/okc.js <action> [--key value] [--json]

Run it with no arguments first; that list is generated from the running
dashboard, so it is never out of date and this file cannot be either. Exit codes:
`0` fine, `1` refused, `3` nothing listening (start the window with `npm start`
in `dashboard/`).

## 1. The normal path: write it, queue it, leave it

**Work waits for a machine; a machine does not wait for work.** A queued task
names no machine. The first one that is free takes it, brings itself to a known
state, does the one task, and shuts down again — so a runner's natural state is
**off**, and everything below happens without you choosing anything.

```bash
okc.js tasks                            # the board, newest first
okc.js taskCreate --task '{"title":"...","branch":"fix/the-thing","brief":"..."}'
okc.js taskQueue  --id 3                # no machine is named
okc.js queueState                       # what is waiting, what is running, who could take it
```

A task is referred to by its **number**, its uid, or its slug — all three work,
so `--id 3` and `--id fix-the-thing` are the same task.

What the queue then does, per task, with nothing asked of you:

    rolled back to base -> started -> dialled in -> credential -> workspace on
    its branch -> dispatched -> run ends -> log kept here -> credential taken
    back -> shut down -> rolled back -> free again

**Read `queueState` before assuming a queue is stuck.** It says why each machine
is not free, and the reasons are different problems: it claims a branch, it has
no base snapshot, it is kept back, it is already doing something.

## 2. When you do want to choose the machine

Rare, and it is the exception rather than the shortcut. A machine kept warm on
purpose, or one you are watching:

```bash
okc.js taskGive --id 3 --name runner1   # skips the queue; the machine must be up
```

The pieces underneath, for when something needs doing by hand:

```bash
okc.js vmStart --name runner1
okc.js vmWorkspace --name runner1 --branch fix/the-thing
okc.js vmCredentialsPut --name runner1
okc.js vmEditor --name runner1          # opens it in VS Code over ssh
```

**Started is not ready.** A machine boots for a minute or two before its agent
dials in, and every action that talks to a guest refuses until it has. Note also
that **`online` and `connected` are different claims** — the first is the setup
script reporting it finished, the second is the agent holding a session.

```bash
until okc.js vmList --json | grep -q '"runner1"[^}]*"connected": *true'; do sleep 10; done
```

## 3. Machines, and keeping one back

```bash
okc.js vmForTasks --name runner1 --enabled false   # the queue will not touch it
okc.js vmRelease  --name runner1                   # let it off its branch, if it is clean
```

`vmForTasks` is the one **decision** about the pool; everything else that keeps a
machine out is a fact about it. Use it before working on a machine by hand,
because the queue is otherwise entitled to any machine that looks idle — and
"looks idle" is exactly what a machine you are about to use looks like. It does
**not** interrupt a task already running on it.

`vmRelease` is the other half of "a machine stays on its branch until it is
clean". It asks the machine, and refuses if it cannot be reached to be asked or
if anything is uncommitted or unpushed.

## 4. Credentials

A worker cannot do anything signed out, and **the queue handles this for you** —
it hands a credential over before dispatch and takes it back before shutdown, so
a machine at rest holds nothing. You only touch these when working by hand, or
when this host holds no credential at all yet:

```bash
okc.js credentialsHeld
okc.js vmAuthBegin  --name runner1      # prints the URL for the user to open
okc.js vmAuthCode   --name runner1 --code <what the page gave them>
okc.js vmCredentialsGrab   --name runner1     # take it and keep it here
okc.js vmCredentialsPut    --name runner1
okc.js vmCredentialsForget --name runner1
```

**A machine holding a credential cannot be snapshotted, and the refusal is
deliberate.** A snapshot would keep a copy of the token for as long as the
snapshot exists. Take it back first. Do not look for a way around this; the
first time it was tested it had not been wired up, and the test itself produced
exactly the snapshot it exists to prevent — then the same hole turned out to be
open along a second path a fortnight's worth of confidence later.

## 5. Dispatch by hand, and let go

Underneath a queued task is a dispatch, and it is worth knowing because that is
what a run record is. Use it directly only when there is no task to attach the
work to.

```bash
MSYS_NO_PATHCONV=1 okc.js vmDispatch --name runner1 \
    --task "Fix the failing test in 02-cli" \
    --folder /home/okc/work/onlykey-testing
```

**`MSYS_NO_PATHCONV=1` is not decoration.** In Git Bash, `/home/okc/work` is
rewritten on its way into the command as `C:/Program Files/Git/home/okc/work` —
a real host path, so nothing looks wrong. The dashboard now refuses it and says
so, but only because the first dispatch ever sent landed in the wrong folder
without a word.

Returns a **run id immediately** — the work is detached and outlives the
connection that started it. It does not wait, and neither should you: a task
runs for minutes or an hour, and waiting would hold the machine against
everything else and give no progress in the meantime.

The worker runs with `--dangerously-skip-permissions`. That is the point rather
than a shortcut — a worker that stops to ask cannot run unattended — and it is
defensible **only here**: the machine cannot reach the dashboard's actions at
all, may push one branch and no other, cannot touch the default branch, cannot
rewrite or delete what it pushed, and is thrown away when the work is done.

`--contract <file on THIS host>` is the rules the worker is given. The text is
read here and written into the run's own directory on the machine, so the rules
that governed a run sit beside that run and cannot drift from it afterwards. A
missing or empty file is refused rather than skipped — a contract that silently
fails to load leaves a worker running with no rules while everything reports
success. `--resume <session>` continues a session instead of starting fresh.

## 4. Watch, do not poll

```bash
node .claude/skills/supervisor/watch.mjs runner1 --every 30
```

Hand that to the `Monitor` tool with `persistent: true`. It emits one line per
thing worth knowing — a file written, a question asked, a verdict, a run
finishing, the channel dropping, the session going quiet — and nothing else. Then
events arrive as notifications instead of a timer that mostly wakes into nothing.

Read on demand between events. **Per task** is usually what you want, because a
task outlives the machine that did it:

```bash
okc.js taskProgress --id 3            # every attempt, and what its worker is doing NOW
okc.js taskLog      --id 3 --run run-2026-08-12T20-32-58
okc.js taskArtifact --id 3            # what actually arrived on the branch
```

`taskProgress` also **pulls a finished run's log onto this host and keeps it**,
which matters because the machine is the disposable half: rolled back or
deleted, it takes its own copy with it. `taskLog` reads the kept one.

Per machine, when there is no task or the machine is still up:

```bash
okc.js vmSessions   --name runner1 --json
okc.js vmSessionTail --name runner1 --session 09458b48 --since 0 --limit 40
okc.js vmRuns       --name runner1 --json
okc.js vmRunOutput  --name runner1 --run run-2026-08-12T18-40-11 --lines 60
```

**A queued task's machine will not be up when you look.** It is shut down and
rolled back the moment the run ends, so `vmRuns` will say `gone` and the
session will not exist. That is the normal, correct end state — read the task,
not the machine.

**Keep the bookmark.** `vmSessionTail` returns `bookmark`; pass it back as
`--since` next time so each report is a delta. `--since` is a **line number in
the transcript**, not a message count — only ever use one the tool printed. A
watch that re-reads from the top spends its whole budget re-deriving what it
already reported.

If a machine has gone silent and there is nothing in the log to read:

```bash
okc.js vmScreenshot --name runner1                     # is it even booting
okc.js vmShell --name runner1                          # a shell inside it
okc.js vmShell --name runner1 --command 'journalctl -u okc-agent -n 30'
```

**`vmShell` is the back door.** Everything else here reaches a machine through
its agent — which is exactly the thing that is broken when you most need to
look. From this side a silent agent is indistinguishable from a dead machine;
the difference is written in the guest's own journal.

It works because **this host's public key is in the guest's `authorized_keys`**,
put there at build time from `hostKeys`. The private key is the operator's own,
already in `~/.ssh` here — so nothing is generated or stored to make ssh work,
and `vmShell` is only a way in *from this machine*.

That is not hypothetical. An agent was once found *awake*, correctly diagnosing
its own lost connection, writing so to its journal — and stuck. Nothing on this
side could have said that, and one `journalctl` did.

**It works when the machine is NOT dialled in**, which is the whole point: the
address is recorded every time a machine connects and used long afterwards.
Asking the agent where it lives is no use when the agent is the problem.

`vmScreenshot` is still the first thing for a machine that has never connected —
before an agent exists there is no journal to read, and it is the only thing that
tells an installer copying files from one sitting at a boot menu.

## 5. Report

* **Lead with what changed, not what it did.** "Pushed 3 commits to
  `fix/the-thing`, 8 tests green, found a CLI bug" beats a narration of greps.
* **Verify claims against the machine.** A transcript is the worker's account of
  itself, and the two diverge. `vmRunOutput` is what actually ran;
  `okc.js vmHolds --name runner1` is what is genuinely uncommitted or unpushed.
* **Say when it is idle and what it is waiting for.** If it asked a question,
  quote it and offer the user paste-ready text — or resume it yourself with
  `vmDispatch --resume`.
* **Nothing has landed until it is on this host.** `vmHolds` returns commits not
  pushed and files not committed, per repository. A machine that is deleted while
  holding either loses it.
* **Suppress the intermediate.** Re-runs and probe iterations are not news.
  Files landing, verdicts, commits, questions and failures are.

## Rules the dashboard enforces, so do not fight them

* **A machine stays on its branch until it is clean.** Both halves are real:
  it cannot be moved while it is holding anything, and `vmRelease` lets it go
  once it is holding nothing. The other way off is restoring a snapshot from
  before that branch, which discards everything since.
* **The default branch is protected** and is not offered. Work is merged into it
  on this host, never done on a machine.
* **One machine per branch.** A second is refused by name.
* **A machine may push only the branch it was set up on**, and cannot push at all
  until it has been. Enforced by a hook here, not in the guest.
* **Snapshots need the machine shut down** — `vmBaseSnapshot` does the shutting
  down and starting again for you — **and a machine holding a credential is
  refused outright.**
* **A snapshot name must be unused on that machine.** VirtualBox allows two with
  one name and everything here restores by name, so a second `base` makes every
  later restore a coin toss. Refused at the source.
* **Nothing unapproved runs.** Pre-defined tasks are written by a model and
  approved by a person, in the window. You may write one and ask for it to be
  read; you may not approve it, and `plannedRun` refuses either way.

If an action refuses, read the message: it says what to do instead. Do not work
around it, and do not reach for `VBoxManage` or ssh to get past it.

## Gotchas

* **A force-stop leaves a machine reading as connected for about seventy
  seconds.** No FIN is sent. If a machine looks alive but answers nothing, that
  is usually why.
* **Transcripts and run output are pulled here and kept.** Anything
  credential-shaped is redacted on the way in, which is defensive rather than
  trusting — assume a token will eventually appear in some worker's output,
  because it can read its own credential file and runs as the user that owns it.
* **A run has three states, not two.** `finished` carries an `exit`; `running`
  means its process is alive; **`lost` means no result and nothing left to
  produce one** — killed, or dead on arrival. Do not wait on a lost run, and do
  not read a missing exit code as success.
* **An install is about twenty-five minutes of complete silence** followed by
  everything at once. `okc.js logWatch` follows the live log; polling either
  misses it or spends the whole time asking.
* **Do not run the workspace's own tests or devices from here.** USB gadgets,
  COM ports and sockets are single-owner, and launching what a runner is driving
  breaks its run — where the failure then surfaces as *its* bug.

## Troubleshooting

**`"runner1" is not dialled in`** — it is booting, or it was force-stopped and
the channel has not timed out yet. `vmList` shows state and `connected`
separately; trust `state` first.

**A queued task never gets picked up** — `okc.js queueState`. It says why each
machine is not free, and the four reasons want four different responses: it
claims a branch (`vmRelease`, if it is clean), it has no base snapshot (take
one), it is kept back (`vmForTasks --enabled true`), or it is already busy.

**A task is `done` but delivered nothing** — that is a real outcome, not a
fault. The run ended; nothing arrived on the branch. A worker refused by the
push hook looks exactly like this. Read `taskLog` for what it actually did.

**`vmSessions` returns nothing after a dispatch** — Claude Code has not written
its transcript yet, or it is not installed on that machine. Check with
`okc.js vmRun --name X --command 'bash -lc "command -v claude"'`.

**A dispatch returns a run id and the run immediately fails** —
`vmRunOutput --name X --run <id>`. The usual cause is a worker that is signed
out; `vmAuthStatus` says so in one line.

**That matches N sessions** — a prefix matching two sessions is an error, not a
guess. Deliberate: silently watching the wrong session produces confident wrong
reports, which is the failure this exists to prevent rather than commit.
