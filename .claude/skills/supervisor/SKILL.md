---
name: supervisor
description: Help run the dashboard - give work to runner VMs and supervise it. Set a machine up on a branch, sign a worker in or hand it a saved credential, dispatch a task it does unattended, watch its Claude session as it works, check what it is holding, and report progress. Use when asked to run something on a runner, start or babysit work in a VM, check on a runner, or get a progress report. To change the dashboard itself, use the "dashboard" skill instead.
---

# Running work through the dashboard

Two skills, one command between them. `dashboard` is **help me develop the
dashboard**. This one is **help me run it**: the work happens on machines, and
your job is to set them up, hand them work, watch, and report.

**You do not build here.** If something is missing from the tool, say so and stop
— switching into changing the dashboard mid-supervision is how a supervisor ends
up editing the thing it is meant to be watching through.

    node dashboard/tools/okc.js                  every action, listed
    node dashboard/tools/okc.js <action> [--key value] [--json]

Run it with no arguments first; that list is generated from the running
dashboard, so it is never out of date and this file cannot be either. Exit codes:
`0` fine, `1` refused, `3` nothing listening (start the window with `npm start`
in `dashboard/`).

## 1. Get a machine ready

```bash
okc.js vmList --json                    # name, state, connected, holdsCredential
okc.js vmStart --name runner1
```

**Started is not ready.** A machine boots for a minute or two before its agent
dials in, and every action that talks to a guest refuses until it has. Wait on
the fact, not on a sleep:

```bash
until okc.js vmList --json | grep -q '"runner1"[^}]*"connected": *true'; do sleep 10; done
```

Then give it a workspace. One branch, every repository, remotes pointing back
here:

```bash
okc.js gitBranches --json               # what exists, and which are taken
okc.js vmWorkspace --name runner1 --branch fix/the-thing
okc.js vmEditor --name runner1          # opens it in VS Code over ssh
```

## 2. Give it a credential

A worker cannot do anything signed out. Either sign this one in:

```bash
okc.js vmAuthBegin  --name runner1      # prints the URL for the user to open
okc.js vmAuthCode   --name runner1 --code <what the page gave them>
okc.js vmAuthStatus --name runner1
```

…or hand it the one already kept on this host, which is the normal path once a
single machine has been signed in:

```bash
okc.js credentialsHeld
okc.js vmCredentialsPut --name runner1
okc.js vmCredentialsForget --name runner1     # when the machine is done with it
```

**A machine holding a credential cannot be snapshotted, and the refusal is
deliberate.** A snapshot would keep a copy of the token for as long as the
snapshot exists. `vmCredentialsForget` first, then snapshot. Do not look for a
way around this; the first time it was tested it had not been wired up, and the
test itself produced exactly the snapshot it exists to prevent.

## 3. Dispatch, and let go

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

`--contract <file on the machine>` appends a system prompt; `--resume <session>`
continues one instead of starting fresh.

## 4. Watch, do not poll

```bash
node .claude/skills/supervisor/watch.mjs runner1 --every 30
```

Hand that to the `Monitor` tool with `persistent: true`. It emits one line per
thing worth knowing — a file written, a question asked, a verdict, a run
finishing, the channel dropping, the session going quiet — and nothing else. Then
events arrive as notifications instead of a timer that mostly wakes into nothing.

Read on demand between events:

```bash
okc.js vmSessions   --name runner1 --json
okc.js vmSessionTail --name runner1 --session 09458b48 --since 0 --limit 40
okc.js vmRuns       --name runner1 --json
okc.js vmRunOutput  --name runner1 --run run-2026-08-12T18-40-11 --lines 60
```

**Keep the bookmark.** `vmSessionTail` returns `bookmark`; pass it back as
`--since` next time so each report is a delta. `--since` is a **line number in
the transcript**, not a message count — only ever use one the tool printed. A
watch that re-reads from the top spends its whole budget re-deriving what it
already reported.

If a machine has gone silent and there is nothing in the log to read:

```bash
okc.js vmScreenshot --name runner1
```

That is the only thing that answers "working or stuck?" before an agent
connects, and it has already caught two failures that produced no log output at
all.

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

* **A machine stays on its branch until it is clean.** There is no way to move
  it, on purpose. The only way off is restoring a snapshot taken before that
  branch — and that discards everything since.
* **The default branch is protected** and is not offered. Work is merged into it
  on this host, never done on a machine.
* **One machine per branch.** A second is refused by name.
* **A machine may push only the branch it was set up on**, and cannot push at all
  until it has been. Enforced by a hook here, not in the guest.
* **Snapshots need the machine shut down** — `vmBaseSnapshot` does the shutting
  down and starting again for you — **and a machine holding a credential is
  refused outright.**

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

**`vmSessions` returns nothing after a dispatch** — Claude Code has not written
its transcript yet, or it is not installed on that machine. Check with
`okc.js vmRun --name X --command 'bash -lc "command -v claude"'`.

**A dispatch returns a run id and the run immediately fails** —
`vmRunOutput --name X --run <id>`. The usual cause is a worker that is signed
out; `vmAuthStatus` says so in one line.

**That matches N sessions** — a prefix matching two sessions is an error, not a
guess. Deliberate: silently watching the wrong session produces confident wrong
reports, which is the failure this exists to prevent rather than commit.
