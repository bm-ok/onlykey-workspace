# What is left

The migration from `dashboard/` to here, written down in one place so neither of
us has to hold it in our heads. `TODO.md` is what is outstanding day to day; this
is what is outstanding **about the move**.

**How to use it.** Add anything you remember that is not here — a half-finished
thing is worth more written down badly than remembered accurately. Cross a line
off only when something ran, not when the code looks right.

    node tools/ported.js              how many actions are still in the other app
    node tools/ported.js --near       what each of them may already be, renamed
    node tools/ported.js --list       the names

---

## Where it stands

    258 actions in dashboard/
    217 defined here (189 of theirs, plus 28 this app added)
     69 not defined here BY NAME

**Ask the app, not the source.** `tools/ported.js` reads the running app's own
action table, which knows what is registered however it was registered. Reading
the source instead undercounted by fifteen in one plugin alone — see 2a.

**And 69 is still not the size of the work.** Names changed in the move, and a
rename counted as a gap makes the remaining work look bigger than it is.
Cross-checked one at a time against what each action SAYS IT DOES, seventeen of
the 69 are renames or merges that are already here — the table under 1 — which
leaves about **52 genuinely not here by any name**.

**Audited one at a time, twice, by two different routes** — once by looking for
the capability in this app's source, once by searching every live action's own
description for what it does. Both passes agree. (The first pass had to be
thrown away and redone: `grep -E` with `\|` matches a literal pipe, so half of
it reported "nothing found" about things that were there.)

**Twelve more of the 52 are here**, and the rename table under 1 carries them:
`changeDiff`->`compareDiff`, `changeFile`->`compareDiff --file`,
`changeRead`->`compare` (across every repository, so NOT narrower after all),
`hostKeys`->`sshKey`, `vmRelease`->`vmReturn`,
`vmCredentialsGrab`->`credentialRecover`, `worker`->`skills`,
`logWatch`->`watching`, `repoDefaults`->`repositories` + `repoBranches`,
`judgementLog`->`vmRunOutput`, `windowShotDone`/`windowShotPending` folded into
`windowShot`.

**Five more are served another way, not as an action:**

| dashboard/ | here |
|---|---|
| `provision` | the `provision` guest API route |
| `gitRepos` | the `git` guest API route — it is machine-facing |
| `issues` / `pulls` | read inside `repoOverview` and `repositories`, not paged per repository |
| `vmScripts` | run by `vmInstall`; listing them is not exposed |

**That leaves 36 genuinely absent. Nine are on the loop:**

    judgementVerdict   judgementUpdate      <- 2b, and they stop it dead
    taskSendBack       taskWorkOn           branchWorkOn
    prFetch            prDraftForget
    inboxHide          inboxShow

* `prFetch` **is blocked, and the code says so**: `repositories/pr/server.js`
  reads *"prFetch HAS NOT MOVED... bringing an arrived pull request into the
  workspace is a git FETCH of `pull/<n>/head`, which is a door the write half of
  `git` does not have yet"*. It needs that door first.
* `taskSendBack` wants a decision rather than a port: over there it re-queues a
  rejected task WITH THE REASON ATTACHED, and the reason is the part with
  nowhere to go here.
* `taskWorkOn` / `branchWorkOn` are half-built in an interesting way — see below.

**And the other 27 are off it**, mostly machine plumbing whose primitives are
already in `vms/vbox` (`list`, `showvminfo`, `modifyvm`, `controlvm`,
`guestproperty`, `snapshot`): `vmAddress`, `vmAgents`, `vmAuthorizeKey`,
`vmBridges`, `vmDescribe`, `vmEditor`, `vmInfo`, `vmIsos`, `vmNetwork`,
`vmProvisionUpdate`, `vmRotateToken`, `vmRun`, `vmScript`, `vmSerial`,
`vmSetupAgain`, `vmShell`, `vmShellRun`, plus `appQuit`, `credentialsTest`,
`guestBackup`, `guestRestore`, `openEditor`, `repoRemoteSet`, `turnGraph`,
`workGraph`, `windowSlow`, `workspaceData`. These are doors not cut, not
machinery missing.

**One of them is a whole engine with no door.** `vms/editor/server.js` registers
an `editor` service — `open-editor.js`, 270 lines, opens a folder in VS Code
here or over ssh — and **nothing on the server side consumes it**. That single
gap is `openEditor`, `vmEditor`, and the "and open it" half of `taskWorkOn` and
`branchWorkOn`: four entries, one missing consumer.

---

## 1. Deliberate — not gaps, do not "fix" these

Written down because they keep getting re-derived as drift.

* **`task` and `judge` became `queue`, `worker` and `judge`.** `queue` is what
  `task` mostly was — the board and its mechanics. The agent halves were pulled
  out: `worker` is a window-only plugin (the Worker tab, consuming `library`),
  `judge` holds the judgement actions and its own tab. Clearer split, less
  confusion about what a "task" is.
* **`artifact` is the central plugin for artifacts.** Workers and judges hand
  things over through it, and the supervisor reads them. `branchArtifact` became
  `branchArtifacts` and lives there, beside `branchDiff`.
* **`archive` keeps Claude sessions**, and a session is keyed **per branch cut**:
  `worker--cut--<branch>`. Worker lane only — a judge that remembers its last
  four readings of one line has an opinion before it looks — and a judgement can
  ask for memory per reading, which outranks the default. See
  `runners/sessions/keying.js`.
* **`core/` is a real boundary now**, and `test/rules/core-names-no-app.test.js`
  holds it: nothing under `core/` may name an app service.

**Renamed, already here** — if something looks missing, check this shape first:

| dashboard/ | here | |
|---|---|---|
| `machines` | `vmList` | |
| `machineAdd` | `vmCreate` | |
| `machineRemove` | `vmRemove` | |
| `machineReach` | `vmAwait` | *"does it answer"* is now *"wait until it does"* |
| `branchArtifact` | `branchArtifacts` | moved into the **artifact** plugin |
| `judgements` | `judging` | |
| `taskGive` | `vmDispatch` | |
| `taskStop` | `vmRunStop` | |
| `taskLog` | `vmRunOutput` | narrower — see 4 |
| `taskLogs` | `vmRuns` | narrower — see 4 |
| `session` | `sessions` | |
| `vmLogs` | `vmLog` | |
| `repoTarget` | `repoTargetSet` | |
| `prComment` | `judgementSay` | narrower — only a judgement's comment |
| `changeRead` | `compare` | across every repository, as it was |
| `changeDiff` | `compareDiff` | |
| `changeFile` | `compareDiff --file` | |
| `hostKeys` | `sshKey` | |
| `vmRelease` | `vmReturn` | |
| `vmCredentialsGrab` | `credentialRecover` | |
| `worker` | `skills` | the worker's own instructions |
| `logWatch` | `watching` | plus the socket watches behind `okc.use` |
| `repoDefaults` | `repositories` + `repoBranches` | |
| `judgementLog` | `vmRunOutput` | a judgement runs through the queue too |
| `windowShotDone` / `windowShotPending` | folded into `windowShot` | |
| `supervisor` | `skills` | the skill document, read by name |
| `supervisorThinking` | folded into `supervisorState` | |
| the whole approval library | `doors()` in `library/server.js` | see 2a |

---

## 2. Blocking the loop

The loop is: **supervisor decides → a person approves → worker runs → judge
reads → PR cut → a person merges.** These stop it closing.

### 2a. ~~The approval library is not here — 15 actions~~ — WRONG, it is all here

**Struck out rather than deleted, because the mistake is the useful part.**

All fifteen — `jobSave`, `jobApprove`, `jobWithdraw`, `jobUse`, `jobForget` and
the same five each for prompts and contracts — are defined in
`library/server.js` by `doors(what, store, opts)`, and have been all along. The
approval boundary is there too, sharper than the one being ported from: *"a
model may write one and may not ratify its own"*, refusing `_overTheWire` and
`_driven` and deliberately allowing `_fromTest`.

They were reported missing because `tools/ported.js` READ THE SOURCE, and
`actions.define(what + 'Save')` inside a helper matches no pattern. The command
line was asked at the time and answered `where: here` for every one of them —
and was disbelieved, because the static tool disagreed with it.

It nearly cost a second copy of all fifteen under the same names. The tool now
asks the running app first and only falls back to reading source, saying out
loud that a source read undercounts.

**The lesson is bigger than this entry:** a static reader of this codebase is a
FLOOR in both directions. `test/rules/no-pane-relays.test.js` has the same
blind spot and its zero should be read the same way.

### 2b. Nothing can record what a judgement decided

**The one verified hole that stops the loop closing**, and it was found by
reading rather than by counting names.

`judge/store.js` has `update` and a `VERDICTS` list. `judge/gate.js` gates on
`j.state === 'done' && j.by === 'person' && j.verdict`. `judging` reports
`decided` and `gaveUp` by looking at `verdict`. Everything is built to read one.

**No action writes one.** `judgementCreate`, `judgementQueue`,
`judgementUnqueue`, `judgementRemove`, `judgementFindings` and `judgementSay`
are all here; `judgementVerdict` — *"Record what a judgement decided: accepted
or rejected, and why"* — is not, and neither is `judgementUpdate`.

So a judgement can be asked for, queued, run and read, and then **nothing can
say what it decided**. A person's judgement, which is `by: 'person'` and exists
precisely so somebody can read a change themselves, can never reach done with a
verdict at all.

`taskJudge` is not the same act: it records a verdict on **what a task
delivered**, not on a judgement.

### 2c. No repository points at a fork — the whole drill chain is blocked

One setting, and it takes out most of the suite:

    the order            unrunnable   <- here
      the guards         unrunnable
      a task on a machine unrunnable
      judging            not run
        the supervisor   unrunnable

Two checks say it plainly: *"no repository in this workspace has been pointed at
a fork, so there is no choice here to lose. Pick one in Repositories → Repos →
Send work here."* Until that is set, nothing downstream can run — **including
both session drills**, which is why the session question below has no answer.

**It is not lost migration state, and the repositories ARE forks.** Both things
are true at once, which is what made this confusing:

    node tools/okc.js repoChain --repo local-repo-a

    bm-sandbox-c/local-repo-a   fork:true  self:true  target:true
    bm-sandbox-b/local-repo-a   fork:true              <- the parent
    bm-sandbox-a/local-repo-a   fork:false             <- the root

So `fork: true` on every repository, a real chain above each one, and a `target`
that is **itself**, with `chosen: false`. The old app's `repos.json` holds one
key per repository and nothing but `default` and `notedAt` — no target at all —
so this was never set THERE either. Nothing was dropped in the move; the choice
has simply never been made.

**One action, and a person's**: it decides where work is sent and where issues
are read from, so it is not one to make on somebody's behalf. Repositories →
Repos → **Send work here**, pointing `local-repo-a` at
`bm-sandbox-b/local-repo-a`. That alone should take *the order* off unrunnable
and let everything under it run for the first time.

### 2d. Relayed actions log nowhere we can see

A relayed action does its logging in `dashboard/`, so every line it would have
written is missing from Live — the log viewer both a person and a model watch a
run through. A quiet Live is not a quiet app.

With 2a struck out this is smaller than it looked, and it is still true of the
69: whatever is left over there logs over there.

---

## 3. Drills FOR THE LOOP, so the codebase knows it better than we do

**This is the point of the rest of it.** Everything above was found by two
people reading two codebases and disagreeing with each other about what was
there — five times in one day, in both directions. A drill does not misremember.
The suite should be the thing that knows how the loop works, so that neither of
us has to.

The suites today drill the PARTS: a task on a machine, judging, a worker
credential, the guards. Nothing drills the LOOP as one act, which is why every
part passed while the whole had never been walked.

**What a loop drill has to assert, in order** — each step is a claim somebody
could otherwise get wrong quietly:

1. **A line exists and a cut comes from it.** A cut with no line is refused.
2. **A job, a prompt and a contract are written and NOT runnable** until a
   person approves them — and a save over the wire waits, while a save at the
   window is approved by whoever wrote it.
3. **A task on that cut, under that chain, is queued**, and a machine takes it
   on its own. Nobody dispatches it by hand.
4. **What the worker delivered is on the branch**, and the artifact is readable
   through the `artifact` plugin rather than off the machine.
5. **A judgement is asked for, run, and REACHES A VERDICT** — this is 2b, and it
   is the step that cannot pass today.
6. **The verdict gates the PR cut**: an unjudged or rejected change cannot go
   out, and the refusal names why.
7. **The PR cut is made, and landing it is a person's press** — never the
   queue's, never a model's.
8. **The branch line is retired** and stops being offered afterwards.
9. **Nothing is left behind**: no drill branch, no claimed machine, no
   credential on a powered-off disk.

**And the drill has to be able to FAIL at each step**, which is the half that
makes it worth writing: half this suite already passes by being refused, and a
loop drill that only checks the happy path would have said nothing about 2b.

Sabotage each guard once and confirm the drill notices — a survived sabotage is
a weak check, an unreachable guard, or a guard protecting something no test
reads.

**Where it goes:** a new suite that `requires` the existing ones, so it runs
last and only when the parts are known good. It is the one drill that needs
every credential and a real machine, which is exactly why it should exist once
rather than be re-run by hand every time somebody wonders whether the app works.

---

## 4. Here, but narrower than it was — decisions, not ports

Each of these is a real difference somebody should decide about, rather than a
missing file.

* **`taskLog` / `taskLogs` vs `vmRunOutput` / `vmRuns`.** The old pair is *every
  run log kept on this host, including tasks that were thrown away*; the new pair
  is *one machine's runs* and *a tail*. This is the one that matters for "no run
  goes off and loses its output" — a log tied to a machine dies with the machine.
* **`taskWorkOn` / `branchWorkOn` vs `vmBorrow`.** `vmBorrow` brings a machine up
  clean; it does not set it up on the branch or open it in VS Code or a terminal.
* **`Watch it`** on the Supervisor tab. It follows a turn's transcript through an
  interactive shell; this app's Terminal is a console *reader* by design — a
  file, not bytes both ways. Needs the shell relay before it can exist here.
* **`issues` / `pulls`** as paged per-repository readers. `repoOverview` gives
  everything open as one row each, which is not the same question.

---

## 5. Built, never run — nobody knows if these work

* **Claude session backup and restore, per branch cut.** The keying is written
  and reasoned (`runners/sessions/keying.js`), the storing is written, and the
  two drills that would prove it — *what a branch remembers* and *a new task on a
  remembered branch* — have **never run**, because of 2c. So: unknown, and one
  setting away from being knowable.
* **`a worker credential`** is `asks you` — it needs a person to answer.
* **`judging`** has never run.

---

## 6. Known small faults

* A drill in *the order* leaves a branch behind: `drill/one-act-<time>`. Its own
  last check catches it — *"Something was left behind"* — so it is a real leak,
  not a missing check.
* **`windowFill` labels collide.** The Live pane's find box reports as
  `Follow`, because a field with no label of its own inherits a neighbour's.
  Nothing on screen is wrong; the driver's view of it is.
* **`test/rules/no-pane-relays.test.js` is a floor, not a proof.** It reads
  literal `okc.call('X')` only, so a name held in a table is invisible to it —
  which is how all 15 approval actions passed it. Making it follow name tables
  would close the gap and is worth doing before trusting its zero again.

---

## 7. Not started

* `TODO.md` and `LEARNED.md` have no counterpart here. The old app's rule was to
  read them before simplifying anything.
* The Supervisor tab's other panes — Todo, Skill, What it may do, Graph — have
  not been checked against the old app the way Chat now has.
* No pane outside Supervisor has had a line-by-line migration check at all.

---

## 8. Things we may have missed

*(Add here. A line with a question mark is worth more than a blank.)*

* Does anything still write to the old app's `%LOCALAPPDATA%\okc-dashboard`
  state? Nothing should, and nothing is known to — but it has never been checked
  from this side.
* need a dedicated plugin for "open in vscode",  when click it setup ssh key and launched vscode that connects to the vm directly.   this button should termperally exist on in runners->virtual machines->Actions area for selected vm, (old dashbaord had this button somewhere)
* lightgraph ui plugin is not ported yet,  it was in old dashboard,  it was used to show the graph of the line,  and also to show the graph of the branch.  this plugin should be ported to new dashboard. use markdown and editor in ui plugin group as examples. 2 placed i remember (repositories0>graph) and (supervisor->graph)
* issue with naming in plugins,,   we have session and sessions in the new dashbaord, 1 is for window/browser session, other is for claude session folder, need to fix this naming issue,  maybe rename claude session to claudeSession or something else.  this is a known issue, but not fixed yet.

