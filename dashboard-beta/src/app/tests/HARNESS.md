# What is not here yet, and what it costs

`./runs.js` is the store the drills write to. It came over whole because it is
answerable on its own: it keeps results, decides when one has gone stale, and
recovers a run the app was restarted in the middle of. `test/runs.test.js`
proves all three, and four sabotages prove the proofs can fail.

**Nothing calls it.** That is stated here rather than left to be discovered,
because a store with no writer looks identical to a store whose writer is broken.

## What the board needs

The Test tab is drawn from one action, `suites`, and its first line over in the
app being ported from is:

```js
const registered = ready()
```

`ready()` is the list of drill files that have registered themselves — their
suites, their tests, and the checks each test is made of. So `suites` cannot be
ported before the thing that enumerates drills, and that is the harness.

Measured, in the app being ported from:

| | lines | |
|---|---:|---|
| `actions/tests.js` | 1018 | `suites`, `suiteRun`, `suiteStop`, `testsForget`, `drillSweep`, `drillCommit` |
| `tasks/harness.js` | 635 | registration, `needs`, fingerprints, series semantics |
| `test/*.js` | 1309 | the catalogue tools: claims, outline, unused, and the static checks |
| | **2962** | |

The drills themselves — `test/suites/`, 65 files and 10,268 lines — **are already
here**, at `./suites`. See `./suites/README-PORT.md` for what was rewritten on the
way over and what was deliberately left pointing at nothing.

## Why it is not simply a big copy

**The drills drive the app.** They require nothing but node — the harness hands
them everything — and what they do is call this app's own actions: write a task
and remove it again, take the worker credential off a machine and prove a
signed-out machine is refused work, then put it back. Every one of those actions
is answered here now — for a long time most were relayed to the app this one was
ported from, which made a drill written then a drill about the relay.

**The gate is one thing again.** `settings` and `suiteRun` are both answered
here, so the switch a drill reads and the switch a person presses are the same
switch. They were split while `suiteRun` was still relayed, and
`../ui/banners/testing.js` existed to name which was which when they disagreed.

**`_fromTest` has no counterpart here.** Over there, three marks are refused when
arming the drills: `_overTheWire`, `_driven` and `_fromTest`. Two of them are
covered — the pipe by the mark, the driven press by `../core/drive` refusing to
press a guarded button at all. The third closed a real hole: the harness calls
the action table in process, exactly as the window does, so **a drill asking to
switch the drills on looked like somebody clicking**. Whatever brings the harness
over has to bring that back with it, and `../settings/server.js` says so at the
top for the same reason.

## What changed in the store on the way over

Two functions were deleted rather than ported. `tests.json` sat in the app drawer
with the workspace written *inside* it — a `workspace` field, a `claim(dir)` that
noticed when it changed, and a `forWorkspace(dir)` every reader had to remember
to call. That is `../core/state`'s `here` drawer, hand-rolled, in the drawer next
to it.

The behaviour changed in one place and it is an improvement: `claim()` **cleared
the board** when the folder changed. Right in spirit — the same check against
another set of repositories is a different question — and wrong in effect, since
going to another workspace and coming back left you with nothing. A drill that
builds a machine from an ISO is half an hour of evidence, and it was thrown away
by glancing elsewhere. Each workspace has its own drawer now, so those results
are not shown and not lost.
