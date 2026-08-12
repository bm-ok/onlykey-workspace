---
name: dashboard
description: Drive the okc dashboard - make, install, watch and delete virtual machines, set a machine up on a branch, open it in VS Code, follow the live log, and take a picture of a machine's screen. Use whenever working on or with dashboard/, or when a task involves a runner VM, provisioning, the workspace repositories, or the git server.
---

# Driving the dashboard

Everything goes through **one command**, over a local socket:

    node dashboard/tools/okc.js                    every action, listed
    node dashboard/tools/okc.js <action> [--key value]
    node dashboard/tools/okc.js <action> --json    for a script

Run it with no arguments first. The list is **generated from the running
dashboard**, so it is never out of date and this file cannot be either — if
something is missing here, ask the dashboard rather than trusting this.

## Do not reach around it

The ports this app listens on are for machines, not for you. **Do not drive
`VBoxManage` directly either** — only `dashboard/machines/` may, and a second
opinion about a machine's state is the bug that rule exists to prevent.

If something you need is missing, **add an action**. Then it exists for the
window, the command line and the next person at once.

The command line talks to a dashboard that is **already running** and refuses to
start its own — a second copy has its own empty registry and reports every
machine as disconnected while it sits there connected to the real one. If it
says nothing is listening, start the window with `npm start` in `dashboard/`.

Exit codes: `0` fine, `1` refused, `3` no dashboard running.

## Watching, rather than asking repeatedly

    node dashboard/tools/okc.js logWatch

Streams the live log until stopped. Use this for anything slow. An install is
about twenty-five minutes of complete silence followed by everything at once, so
polling either misses it or spends the whole time asking.

    node dashboard/tools/okc.js logWatch --since 240   carry on from an id

## Seeing a machine that is not talking

    node dashboard/tools/okc.js vmScreenshot --name runner2

The **only** thing that answers "is it working or stuck?" during an install,
because until the agent connects there is no log line and nothing to ask. Saves a
PNG under the app data directory and puts the path in the live log; read the file
to look at it. This has already caught two silent failures that produced no log
output at all.

## The usual flows

Make a machine, from nothing:

    okc.js vmCreate --vm '{"name":"runner2","iso":"24.04","network":"bridged","user":"okc","password":"okc","fullName":"okc","sshKey":"ssh-ed25519 AAAA..."}'
    okc.js vmInstall --name runner2

`iso` matches on a substring of an image VirtualBox already knows about, so
`"24.04"` is enough — check with `vmIsos`. **Use a substring or forward slashes,
never a Windows path with backslashes**: a shell eats them before the JSON is
parsed.

Start work on it:

    okc.js vmWorkspace --name runner2 --branch fix/the-thing
    okc.js vmEditor --name runner2

Run something on it, or look around:

    okc.js vmRun --name runner2 --what "check node" --command "node --version"
    okc.js vmList --json
    okc.js gitBranches --json

Throw it away and start again — this is the flow to follow when an install
fails, rather than installing over the top:

    okc.js vmRemove --name runner2
    okc.js vmCreate --vm '{...}'

## Rules the dashboard will enforce, so do not fight them

* **A machine stays on its branch until it is clean.** There is no way to move
  it. The only way off is restoring a snapshot taken before that branch.
* **The default branch is protected** and is not offered. Work is merged into it
  here, never done on it.
* **One machine per branch.** A second one is refused by name.
* **A machine may push only the branch it was set up on**, and it cannot push at
  all until it has been. Enforced by a hook on this host, not in the guest.
* **Snapshots need the machine shut down**, and so does restoring one.

If an action refuses, read the message — it says what to do instead. Do not work
around it.

## When changing the dashboard itself

* `npm test` in `dashboard/` checks it stayed generic: nothing may know about a
  particular project, and only `machines/` may drive `VBoxManage`.
* **The window loads `server.js` at startup**, so any change to it needs the
  dashboard restarted before it does anything.
* **Never restart while a machine is installing.** The install fetches its
  scripts at the very end.
* `dashboard/README.md` is the only document, and its "Honest gaps" section is
  the part most worth trusting — if a change makes an entry there false, fix it
  in the same change.
