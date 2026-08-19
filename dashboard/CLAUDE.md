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
| `test/outline.md` | **the kit**: every suite, test and check, in the order a person sets this app up — warm the host, do the work, cool it down. Generated; `npm test` fails when it goes stale. Half the checks pass by being REFUSED. Add one when a change makes a claim code review cannot settle. |
| `test/unused.md` | what nothing appears to use, and comments that name a caller which is not there. Suspects, not verdicts. |
| `ROADMAP.md` | what is next, and what was decided against |

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

**Write code to a file; do not pass it as an argument.** Backticks and quotes
have been mangled writing JavaScript through `bash -c` or `node -e`, corrupting
`ui.js`, `branches.js`, `remotes.js` and `vbox.js`, once inserting a literal NUL
byte. The safe shape is unchanged: **write the file, then run it.**

WHAT IS BETTER THAN IT WAS, checked on 2026-08-19 rather than assumed: a quoted
heredoc (`cat > f <<'EOF'`) now preserves backticks, `${...}`, nested quotes,
`$(...)` and single backslashes exactly, with no NUL bytes. So writing a whole
file that way is reliable, and the python-script detour it used to need is not
required.

**The one that still bites is a doubled backslash**, and it is not the shell
doing it. Content loses one level of backslash before bash receives it at all —
shown with a single-quoted string, which is where bash does no escape processing
whatever, so it cannot be the culprit. Two typed arrive as one; four arrive as
two; a lone one survives.

**So double them.** A JavaScript string holding a Windows path, or a regex whose
subject IS the backslash character, needs four typed for every two wanted.
Ordinary escapes like a digit class need nothing. Writing the file through a
helper does not help — the loss happens before anything on this machine sees it.

**Use Edit or Write when the passage is ABOUT escaping.** This one ate itself
three times in a single session: twice here and once in a memory file, each time
turning the examples in the sentence explaining the rule into nonsense. The
examples are exactly the part that cannot survive being processed.

**Prefer plain, single-purpose shell commands.** Long `cd … && … && …` chains
cannot match any permission pattern, so every one of them interrupts the user.
One command, one job.

**Never chain a restart to a wait.** This one has wedged the terminal in session
after session, and each time it was rediscovered rather than remembered:

```
npm run restart >/dev/null 2>&1; until node tools/okc.js | grep -q X; do sleep 2; done
```

The restart detaches a process, the redirect closes the stream that says the call
ended, and the loop then blocks for ever having printed nothing — so there is no
output to diagnose from and it has to be killed by hand. Run `npm run restart` on
its own, in the background, and let it report that it finished. Then ask the
dashboard with a separate plain command. Do not sleep, and do not poll.

**Measure before claiming.** Check which tab is open, which workspace is served,
which machine is claimed — do not infer state from an earlier screenshot or an
earlier run. A wrong diagnosis costs more than no diagnosis.

## Proving a change

`node --check` is not enough — it passes on a file whose exports name functions
that no longer exist, which is a startup crash, and it passes on **every bare
identifier that nothing declares**. Splitting a file is how those get made: the
new require block is written from what the code appears to need, and anything
that was simply in scope before falls out silently. `files` did this and hung the
artifact endpoint; `port` did it and broke every task whose branch existed. Both
fail only when their line is reached, which is inside an action, in a queue, on a
machine that has already booted.

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

Then **read the event stream** to find out what happened. Not a poll, not a
sleep — the record is durable and survives the restart it is telling you about:

```
node tools/okc.js events                      # what this app has done
node tools/okc.js events --since <bookmark>   # only what is new since last time
```

Every call hands back a `bookmark`. Pass it to `--since` and the next call
returns only what has happened since — one call, no timer, and it says what went
wrong rather than only whether something is up yet.

Then **do the actual task from the command line**, not a smoke test, and
photograph the window if it changed:

```
node tools/okc.js windowShot --view repos --pick todo
```

**Never restart while a machine is installing.** The install fetches its scripts
from this host twenty-five minutes in, and a restart at the wrong moment throws
the whole thing away.

## The shape of it

* **The chain, and every arrow carries a copy.**

      branch <- task <- job <- prompt <- contract

  A contract is the rules, a prompt is the words that must hold to them, a job is
  the script that gives them to a worker, a task is one occasion. A task stores
  the prompt's TEXT and the contract's TEXT, never their names — read six weeks
  later a reference proves nothing about what a worker was held to. All three of
  job, prompt and contract are hashed and approved, and approving any of them is
  refused over the wire.
* **One surface.** Every capability is an action in the table in `server.js`,
  reached by the window, the CLI and the drills through `call()`. If the CLI
  cannot do something, add an action — do not reach around it.
* **A worker's memory belongs to the branch line, not to the machine and not to
  the task.** `~/.claude` is archived when a run ends and unpacked before the next
  one starts, keyed by LINE and LANE — `worker--cut--fix-thing` and
  `judge--cut--fix-thing` are two conversations about one branch, one that wrote
  it and one that read it. Per-task was the old rule and made every task on a line
  a stranger to the last. The guest never names a session; the host looks it up
  from the work that machine is running, exactly like an artifact.
* **A credential and a session are not tied.** A key is replaceable in a minute at
  a login page; what a worker worked out about a branch is not replaceable at all.
  A session records which sign-ins carried it as PROVENANCE, and nothing in that
  path may refuse for credential reasons. The credential is excluded from the
  archive on purpose.
* **A machine's role comes from its tags, and silence is not an answer.**
  `worker`, `judge`, `supervisor` — and a machine may carry both `worker` and
  `judge`, serving either, one at a time. A machine with NO role tag gets no
  automatic work at all: the queue picks which sign-in to hand over from the
  machine's role, so an unlabelled machine means guessing whose identity to send.
  It can still be borrowed and worked on by hand. The role a piece of work needs
  comes from the WORK — a task wants a worker's sign-in, a judgement a judge's —
  which is the only thing that can answer it for a machine that is both.
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

## App Process
You own the dashboard process, keep it running and restart it when code changes are made. The dashboard process is the only one that can start and stop virtual machines. 
The dashboard can be restarted at any time, a virtual machine will keep running without dashboard.
