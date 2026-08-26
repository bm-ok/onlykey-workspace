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
    202 defined here (174 of theirs, plus 28 this app added)
     84 not defined here BY NAME

**84 is not the size of the work.** Names changed in the move, and a rename
counted as a gap makes the remaining work look bigger than it is. Cross-checked,
those 84 come apart into three piles, and only the third is work.

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

| dashboard/ | here |
|---|---|
| `machines` | `vmList` |
| `branchArtifact` | `branchArtifacts` |
| `judgements` | `judging` |
| `taskGive` | `vmDispatch` |
| `taskStop` | `vmRunStop` |
| `repoTarget` | `repoTargetSet` |
| `prComment` | `judgementSay` |
| `supervisorThinking` | folded into `supervisorState` |

---

## 2. Blocking the loop

The loop is: **supervisor decides → a person approves → worker runs → judge
reads → PR cut → a person merges.** These stop it closing.

### 2a. The approval library is not here — 15 actions

`library/server.js` defines the five READERS (`jobs`, `job`, `prompts`,
`contracts`, `contract`) and nothing else. Missing:

    jobSave      jobApprove      jobWithdraw      jobUse      jobForget
    promptSave   promptApprove   promptWithdraw   promptUse   promptForget
    contractSave contractApprove contractWithdraw contractUse (no contractForget)

**Why it is first.** The supervisor proposes a job or a prompt and there is no
way to approve it in this app, so nothing it proposes can ever run. It is also
the human gate — *"human, approves prompts, jobs, contracts"* — so it is the one
part of the loop that must be a person at this window and cannot be delegated.

Note the shape of the refusal, which has to survive the move: written at the
window it is approved by whoever wrote it; **written over the wire it waits.**

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

### 2c. Relayed actions log nowhere we can see

A relayed action does its logging in `dashboard/`, so every line it would have
written is missing from Live — the log viewer both a person and a model watch a
run through. A quiet Live is not a quiet app. This closes as 2a closes.

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
