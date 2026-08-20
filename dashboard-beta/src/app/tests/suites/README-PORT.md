# These drills are here, and nothing here can run them yet

Copied from `dashboard/test/suites` on 20 August 2026 — 65 drill files, 10,268
lines, twelve suites in the order somebody sets this app up: warm the host, do
the work, cool it down.

**They were brought over so that changes to them happen HERE.** The app being
ported from is the reference; editing it while porting means the thing being
copied moves under the copy. A drill that had to change because a refusal's
wording changed is exactly that situation, and it is what prompted this.

## What runs them: nothing, yet

`../harness.js` does not exist. Every file here opens with

```js
const { it } = require('../../harness')
```

which is a path pointing at where the harness will live — inside this plugin,
beside `../runs.js`, which is the store it writes results to. **The path was
rewritten on the way over**, from `../../../tasks/harness`. Left as it was it
would have resolved to `src/app/tasks/harness` — and `src/app/tasks/` is a real
plugin here, so the day somebody put a file there the drills would have bound
silently to the wrong thing.

The other requires were **not** rewritten, and that is deliberate. Twenty-four
modules are reached into — `core/guests`, `tasks/sessions`, `machines/vms`,
`repos/landings` and the rest — and where each one lands is decided when it is
ported, not guessed now. They are dead paths until then, which is the honest
state and is visible the moment anything tries to load one.

`helpers.js` came with them, one level up: 28 of the 65 use it.

## What a drill is, so the count is not misread

A folder is a **suite**, a file in it is a **test**, and the `it()`s inside that
file are the **checks** that test is made of — because what this app does is an
ORDER, and an order cannot be stated as a bag of independent assertions. A check
that fails stops the ones after it in the same file; that is the point.

**Half of them pass by being refused.** They are not a unit-test suite that grew
too big. They drive this app for real — one writes a task on a branch cut and
removes it again, one takes the worker credential off a machine, proves a
signed-out machine is refused work, and puts it back.

Which is why `../../settings/server.js` guards what it guards, and why the
counterpart to all of this is a permission a person gives while looking at which
folder is open.

## The one thing that must come with the harness

`_fromTest`. Over there, arming the drills refuses three marks: `_overTheWire`,
`_driven` and `_fromTest`. Two are covered here — the pipe by the mark, a driven
press by `../../core/drive` refusing to press a guarded button at all. The third
closed a real hole: **the harness calls the action table in process, exactly as
the window does, so a drill asking to switch the drills on looked like somebody
clicking.** `../../settings/server.js` says the same thing at the top, in the
file that would have to change.

## What was added here and does not exist over there

`02-the-refusals/04-the-ways-round-a-refusal.js` gained two checks: the folder
half of the drills permission, and forging a standing request. Both are about a
hole found while porting `core/settings.js` — the switch was guarded and the
folder it points at was not, so moving the folder armed the drills without the
guarded key ever being named.

The fix went into both apps. The checks went only here.
