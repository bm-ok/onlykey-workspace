---
name: dashboard
description: Help develop the dashboard - add or change an action, the window, the git server, provisioning scripts or the machine layer, and prove the change from the command line. Use when editing anything under dashboard/ or workspace/provision/, when an action is missing, when the window misbehaves, or when a change needs restarting and re-testing. To run work through a machine rather than change the tool, use the "supervisor" skill instead.
---

# Developing the dashboard

Two skills, one command between them. This one is **help me develop the
dashboard** — changing the instrument. `supervisor` is **help me run it** —
giving work to machines through it. They share `okc.js` and nothing else, and
staying on one side of that line is the point: a supervisor that starts editing
the tool is editing the thing it is meant to be watching through.

    node dashboard/tools/okc.js                    every action, listed
    node dashboard/tools/okc.js <action> [--key value]
    node dashboard/tools/okc.js <action> --json    for a script

Run it with no arguments first. That list is **generated from the running
dashboard**, so it cannot go stale and neither can this file — if something here
disagrees with it, the list is right.

Exit codes: `0` fine, `1` refused, `3` nothing listening.

## Read these three first

They are deliberately separate, and each answers a different question:

* `dashboard/TODO.md` — what is outstanding and where the machines were left.
  **Start here**, because it says what state the world is in.
* `dashboard/README.md` — how it is used, and its "Honest gaps" section. If a
  change makes an entry there false, fix it in the same change.
* `dashboard/LEARNED.md` — what went wrong before and what it taught. Read it
  **before "simplifying" anything**. Most of what looks redundant here is
  load-bearing and that file says why.
* `dashboard/TEST-PLAN.md` — the end-to-end drills. Re-run the relevant ones
  after anything structural, and add one whenever a change creates a claim that
  code review cannot settle. **Half of them pass by being refused.**

## The rules the code is built to

* **Nothing may know about a particular project.** `npm test` in `dashboard/`
  enforces it and also enforces that **only `machines/` drives `VBoxManage`**. A
  second opinion about a machine's state is the bug that rule exists to prevent.
* **Node and git, nothing else.** No external binary, no dependency. The git
  server is git's own subcommands over http; the certificates use the openssl
  that ships with git. If a change needs something installed, it is the wrong
  change.
* **One surface.** An action added to the table in `server.js` exists for the
  window, the command line and the next person at once. If you need something
  the CLI cannot do, **add an action** — do not reach around it, and do not call
  `VBoxManage` yourself.
* **Two managers, meeting at one point.** `machines/` is one half; `tasks/` is
  the other, and they touch only where a task is *given* to a machine. A task
  knows the name of its machine and nothing else about it; a machine knows
  nothing about tasks. That is what lets a machine be destroyed mid-task.
* **Nothing is fetched at run time.** What this uses beyond NW.js is checked in
  under `vendors/` — see `vendors/README.md`. `package.json` has no
  dependencies and that is a property worth keeping.
* **The window is an app page**, loaded from disk by NW.js. It has node and its
  own Inspect, and it calls the action table in-process. There is no `/api`; the
  ports this app listens on are for machines.

## Proving a change

**Use the command line to do the actual task, not a smoke test.** A change is
proven by running it the way it will be used. This has repeatedly been the
difference between "it works" and "it printed something".

    npm test                    # in dashboard/ — generic, and machines-only VBoxManage
    node --check <file>         # syntax, before restarting anything

Then restart, because **the window loads `server.js` at startup** and nothing you
changed exists until it does:

```bash
# Windows: stop every nw process, then start again
powershell -c "Get-Process -Name nw | Stop-Process -Force"
npm start        # in dashboard/, backgrounded
```

Wait for it by asking the dashboard, not by sleeping:

```bash
until node tools/okc.js 2>/dev/null | grep -q myNewAction; do sleep 1; done
```

**Never restart while a machine is installing.** The install fetches its scripts
from this host at the very end, twenty-five minutes in, and a restart at the
wrong moment throws the whole install away.

## Following the user's flow

When something fails, **do what they would do at the window**: delete the machine
and its storage, then create it again. Do not install over the top and do not
invent a repair path that has no button — a fix that only exists in a shell is
not a fix to this tool.

    okc.js vmRemove --name runner2
    okc.js vmCreate --vm '{...}'
    okc.js vmInstall --name runner2

## The queue runs whether or not you are watching

`tasks/queue.js` is started by the server, not the window, and ticks every
fifteen seconds. Two things follow that catch people out:

* **A restart interrupts running work.** The queue adopts what was in flight —
  waits on the run if it is alive, keeps the log, puts the machine away — and
  re-queues anything that had not dispatched yet. That is recovery, not a
  reason to restart casually: **never during an install**, and not during a
  drill you are measuring.
* **Every step goes through the actions.** The queue drives the same surface a
  person does, so every refusal still applies. Do not give it a private path to
  the machines; the second set of rules is always the one that turns out to be
  wrong.

A machine is put back to **off, on its base snapshot, claiming nothing, holding
nothing** after every task. If you change that, check the queue still has
anything free: a machine that still claims a branch is correctly never picked
up, and the failure looks exactly like a queue that has gone quiet.

## Changing the window

* **Only update an element that changed.** Rewriting text that is identical
  makes it flicker and **destroys the user's selection mid-copy** — a snapshot
  count that ticks is uncopyable. Compare a signature of what you are about to
  draw against what is there and return early.
* **Disable what must not be clicked**, in the action *and* the button. A
  snapshot of a running machine stores its RAM; both refuse, and the button says
  why rather than going quiet.
* `nw.Shell.openExternal` is how a link reaches the user's real browser.
* **Use the class names that exist.** CSS has no undefined-name error, so a
  misspelt class is the quietest failure available here: task cards were given
  `picked` when the stylesheet has `pick` and `on`, and the result was a list
  that worked and looked dead. Grep `ui.css` before inventing one.
* **Code that is read gets an editor, not a `<pre>`.** `codeBlock()` wraps the
  vendored Ace, read-only. A hundred lines of undifferentiated JavaScript is
  something a person scrolls past and approves anyway.
* **A dialog is bounded and scrolls in the middle.** Title and buttons are
  pinned; use `console read` rather than `console tall` inside one, or the
  confirm button lands below the bottom of a fixed overlay.
* **Say when a panel is broken.** `paintTasks` used to swallow its errors and
  draw nothing, which looks exactly like having nothing to show — and that is
  the question somebody is asking when they look at an empty tab.

## Things that cost real time here

* **`$(...)` on a VirtualBox installer command line is expanded by VirtualBox
  first.** A fingerprint check written that way compared empty to empty and
  **passed**, accepting any authority. Build the command as a pipeline into
  `grep -q` instead. The same expansion will eat it again inside a
  `git commit -m` argument.
* **ASCII only in anything git shows a remote.** Git relays hook messages as raw
  bytes; an em-dash arrives as mojibake in the guest's terminal.
* **`.gitattributes` pins `*.sh` and the hooks to `eol=lf`.** Without it a fresh
  clone on Windows serves `#!/bin/bash\r` to a guest and nothing runs.
* **An ignored *directory* is never descended into**, so a later `!` negation
  inside it does nothing — silently. `/workspace/*` plus `!/workspace/provision/`
  works; `/workspace/` plus a negation does not.
* **Print generated shell before running it.** A `continue` outside a loop and a
  self-matching `pkill -f` both survived review and died on the machine. `pkill`
  matches its own argv — record a pid and `kill -- -PID`.
* **A pty returns drawing instructions, not text.** Anything scraped from
  `script -qec` needs the terminal escapes stripped, or a URL arrives wrapped and
  doubled.
* **Powered off is not unlocked**, and one `VBoxManage` call is not a real
  attempt. Both are already handled in `machines/vbox.js`; do not undo them.
* **A force-stop sends no FIN**, so a machine reads as connected for another
  seventy seconds. Anything that stops or restores a machine must drop the
  channel first.
* **`chmod 0600` on Windows is theatre.** It toggles the read-only bit. At-rest
  protection for anything worth keeping goes through `core/secret.js` (DPAPI).

## Provisioning scripts

`workspace/provision/*.sh` are the **project's** half; the app's own scripts do
not know what a machine is for. They are checked in — `bash -n` them before
committing, and remember that a header of `OKC_*` values and `say`/`report` is
prepended by the dashboard, so those are defined even though nothing in the file
defines them.

## Troubleshooting

**`no dashboard is listening` (exit 3)** — start the window with `npm start` in
`dashboard/`. The CLI refuses to start its own copy on purpose: a second one has
an empty registry and reports every machine as disconnected while sitting beside
the real one.

**An action exists in `server.js` but not in the list** — the dashboard is still
running the old code. Restart it.

**`npm test` fails on a name** — something in the generic half learned a
project's name. Move it to `workspace/provision/` or take a parameter.

**A machine installs and then nothing happens** — `okc.js vmScreenshot --name X`.
It is the only thing that answers "working or stuck" before the agent connects,
and it has already caught two silent failures that produced no log output at all.
