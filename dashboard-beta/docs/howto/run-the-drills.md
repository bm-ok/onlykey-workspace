# Run the drills

The drills are end-to-end tests that drive the running app the way a person
does: they write tasks, cut branches, borrow machines, and take credentials
off them. Half of them pass by being refused. They are on the **Test** tab.

## Before

Drills are switched on **per workspace, at the window** — Settings →
General → *Testing mode*, which names the folder it is on for. The yellow
banner says so while it is. From the command line `testsAsk --why ...`
asks; a person answers in the window (`testsAnswer`), standing in front of
the folder the request was raised about — a request raised elsewhere is not
on the table here, and answering yes where nothing was asked is refused.

Switching workspace switches them off, because the switch is the new
folder's own and it has never been pressed. Switching back turns them on
again — nothing was cleared. The refusal names the folder they *are* on for,
so "off" never reads as a switch that did not work.

**Only against a sandbox.** Settings → General → *Sandbox owners*: a list of
GitHub owners (`bm-sandbox-a`, `bm-sandbox-b`, `bm-sandbox-c`). With names
on it, the drills refuse unless every repository's remote — and every
repository in the chain it sends work to — belongs to one of them, and the
refusal names the offender. Empty, the list checks nothing. Window-only,
like the switch.

**Off, the plugin is off.** The Test tab is not in the row, and every
action in it — `suites`, `suiteRun`, `suiteSource`, `drillSweep`,
`drillCommit`, `testsForget` — answers with the switch's own sentence.
A drill cannot switch itself on: the press is refused to a driven window.

## Steps

1. **Test** → pick a suite → **Run the suite**, or one test, or one check.
   **Run everything** runs them all in order; the early suites are what
   the later ones need (a workspace, a token, a machine).
2. Watch the log under each check. A check ends *passed*, *failed*, *asks
   you*, *changed* (the code under it moved since it last passed), or
   *unrunnable* (what it needs is not here — it says what).
3. **Stop** asks the run to end after the check it is on.

## Command line

    node tools/okc.js suites                       every drill and its last result
    node tools/okc.js suiteRun --suite "what this host has"
    node tools/okc.js suiteRun --suite 10-the-supervisor --test 07 --keepGoing
    node tools/okc.js suiteSource --suite ... --test ... --check ...   what a tick means
    node tools/okc.js drillSweep --remove          what the drills left behind

The drills borrow machines tagged `test`, never whichever one is free.

## What they are for

A drill is written whenever a change makes a claim code review cannot
settle — "a tag wakes the supervisor", "a review pinned to a stale commit is
refused". `src/app/tests/outline.md` is the catalogue of them, rewritten
from the suites. The unit tests (`npm test`) are the other half: fast,
against stand-ins, run before every commit.
