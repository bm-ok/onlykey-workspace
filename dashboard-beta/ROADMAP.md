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

**And twenty of those are `vm*` machine plumbing**: `vmBridges`, `vmIsos`,
`vmSerial`, `vmScript`, `vmScripts`, `vmShell`, `vmShellRun`, `vmSetupAgain`,
`vmRotateToken`, `vmAuthorizeKey`, `vmDescribe`, `vmEditor`, `vmNetwork`,
`vmAddress`, `vmAgents`, `vmInfo`, `vmProvisionUpdate`, `vmRelease`,
`vmCredentialsGrab`, `vmRun`. None of them is on the loop. Some may be
deliberate — `vmRun` is "run any command on a machine and wait", which is a
large door to reopen without deciding to.

**So what is actually left on the loop is about a dozen:**

    judgementVerdict  judgementUpdate  judgementLog
    taskSendBack
    changeDiff        changeFile
    prFetch           prDraftForget
    issues            pulls
    inboxHide         inboxShow

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
| `taskLog` | `vmRunOutput` | narrower — see 3 |
| `taskLogs` | `vmRuns` | narrower — see 3 |
| `session` | `sessions` | |
| `vmLogs` | `vmLog` | |
| `repoTarget` | `repoTargetSet` | |
| `prComment` | `judgementSay` | narrower — only a judgement's comment |
| `changeRead` | `compareLog` | narrower — see 3 |
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

### 2b. No repository points at a fork — the whole drill chain is blocked

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

### 2c. Relayed actions log nowhere we can see

A relayed action does its logging in `dashboard/`, so every line it would have
written is missing from Live — the log viewer both a person and a model watch a
run through. A quiet Live is not a quiet app.

With 2a struck out this is smaller than it looked, and it is still true of the
69: whatever is left over there logs over there.

---

## 3. Here, but narrower than it was — decisions, not ports

Each of these is a real difference somebody should decide about, rather than a
missing file.

* **`taskLog` / `taskLogs` vs `vmRunOutput` / `vmRuns`.** The old pair is *every
  run log kept on this host, including tasks that were thrown away*; the new pair
  is *one machine's runs* and *a tail*. This is the one that matters for "no run
  goes off and loses its output" — a log tied to a machine dies with the machine.
* **`changeRead` vs `compareLog`.** Old: per-repository across a whole line. New:
  one repository.
* **`taskWorkOn` / `branchWorkOn` vs `vmBorrow`.** `vmBorrow` brings a machine up
  clean; it does not set it up on the branch or open it in VS Code or a terminal.
* **`Watch it`** on the Supervisor tab. It follows a turn's transcript through an
  interactive shell; this app's Terminal is a console *reader* by design — a
  file, not bytes both ways. Needs the shell relay before it can exist here.
* **`issues` / `pulls`** as paged per-repository readers. `repoOverview` gives
  everything open as one row each, which is not the same question.

---

## 4. Built, never run — nobody knows if these work

* **Claude session backup and restore, per branch cut.** The keying is written
  and reasoned (`runners/sessions/keying.js`), the storing is written, and the
  two drills that would prove it — *what a branch remembers* and *a new task on a
  remembered branch* — have **never run**, because of 2b. So: unknown, and one
  setting away from being knowable.
* **`a worker credential`** is `asks you` — it needs a person to answer.
* **`judging`** has never run.

---

## 5. Known small faults

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

## 6. Not started

* `TODO.md` and `LEARNED.md` have no counterpart here. The old app's rule was to
  read them before simplifying anything.
* The Supervisor tab's other panes — Todo, Skill, What it may do, Graph — have
  not been checked against the old app the way Chat now has.
* No pane outside Supervisor has had a line-by-line migration check at all.

---

## 7. Things we may have missed

*(Add here. A line with a question mark is worth more than a blank.)*

* Does anything still write to the old app's `%LOCALAPPDATA%\okc-dashboard`
  state? Nothing should, and nothing is known to — but it has never been checked
  from this side.
* need a dedicated plugin for "open in vscode",  when click it setup ssh key and launched vscode that connects to the vm directly.   this button should termperally exist on in runners->virtual machines->Actions area for selected vm, (old dashbaord had this button somewhere)
* lightgraph ui plugin is not ported yet,  it was in old dashboard,  it was used to show the graph of the line,  and also to show the graph of the branch.  this plugin should be ported to new dashboard. use markdown and editor in ui plugin group as examples. 2 placed i remember (repositories0>graph) and (supervisor->graph)

