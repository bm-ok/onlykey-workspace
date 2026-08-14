# Working on the dashboard

An NW.js app that supervises virtual machines doing work in a folder of git
repositories. **It knows about no particular project** and `npm test` enforces
that.

## Read before changing anything

Not optional, and not "if it seems relevant". Each answers a different question,
and the one that keeps getting skipped is the third.

| file | what it answers |
|---|---|
| `TODO.md` | what is outstanding and what state the machines were left in. **Start here.** |
| `README.md` | how it works, and its "Honest gaps" section. If a change makes an entry there false, fix it in the same change. |
| `LEARNED.md` | **what went wrong before and what it cost.** Read it BEFORE simplifying anything or adding a panel. Most of what looks redundant here is load-bearing and this says why. |
| `TEST-PLAN.md` | the end-to-end drills. Half of them pass by being refused. Add one when a change makes a claim code review cannot settle. |
| `GAPS.md`, `ROADMAP.md` | what is missing on purpose, and what is next |

## The rules that get broken

These are here because each one has already cost real time. They are in
`LEARNED.md` at length; this is the short form so there is no excuse.

**Every paint function starts with a view guard.**

```js
function paintX () {
  if (view !== 'thing') return        // and the pane, if it has panes
```

The window redraws every 3–12 seconds, so **anything a paint function calls runs
on a timer**. A panel behind a tab nobody is looking at must ask nothing. This
rule was written down, was right, and was then not applied to the next three
panels built — twice putting `spawn` at 70% and 25% of the window's samples.
Before adding a call to a paint function, count the processes it spawns and
multiply by 20 an hour.

**Only redraw what changed.** Use `changed(key, signature)` and return early.
Rewriting identical text destroys the user's selection mid-copy.

**Use class names and ids that exist.** CSS has no undefined-name error, so a
misspelt class is the quietest failure available. `npm test` checks this — run it.

**Never shell-quote code.** Backticks and quotes get mangled writing JavaScript
through `bash -c` or `node -e`; it has corrupted `ui.js`, `branches.js`,
`remotes.js` and `vbox.js` this way, once inserting a literal NUL byte. **Write a
script file to the scratchpad and run that.**

**Prefer plain, single-purpose shell commands.** Long `cd … && … && …` chains
cannot match any permission pattern, so every one of them interrupts the user.
One command, one job.

**Measure before claiming.** Check which tab is open, which workspace is served,
which machine is claimed — do not infer state from an earlier screenshot or an
earlier run. A wrong diagnosis costs more than no diagnosis.

## Proving a change

`node --check` is not enough — it passes on a file whose exports name functions
that no longer exist, which is a startup crash.

```
npm test                       # generic, and only machines/ drives VBoxManage
node --check <file>
node -e "require('./server.js')"    # catches dangling exports
```

Then **restart**, because the window loads `server.js` at startup:

```
powershell -c "Get-Process -Name nw | Stop-Process -Force"
npm start
```

Wait by asking, not by sleeping:

```
until node tools/okc.js 2>/dev/null | grep -q myNewAction; do sleep 1; done
```

Then **do the actual task from the command line**, not a smoke test, and
photograph the window if it changed:

```
node tools/okc.js windowShot --view repos --pick todo
```

**Never restart while a machine is installing.** The install fetches its scripts
from this host twenty-five minutes in, and a restart at the wrong moment throws
the whole thing away.

## The shape of it

* **One surface.** Every capability is an action in the table in `server.js`,
  reached by the window, the CLI and the drills through `call()`. If the CLI
  cannot do something, add an action — do not reach around it.
* **`needs: 'workspace'`** on an action that is a question about a folder of
  repositories. `call()` refuses it by name when none is open.
* **Only `machines/` drives VBoxManage**, and every call goes through
  `vbox.run()` — one at a time, on purpose. Do not add a second path.
* **Two managers, meeting at one point.** `machines/` and `tasks/` touch only
  where a task is given to a machine.
* **Node and git, nothing else.** No dependencies, nothing fetched at run time.
* **The window is an app page** sharing one node context, so `execFileSync`
  in an action freezes the window itself.

## When VirtualBox misbehaves

Stop calling it. Say it looks environmental and let the operator restart the
service — two things starting VirtualBox at once is how it stays wedged. Carry on
with the parts of the task that need no machine, which is most of them.
