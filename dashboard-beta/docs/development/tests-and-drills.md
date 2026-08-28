# Tests and drills

Two halves, and they answer different questions.

## `npm test` — fast, against stand-ins

`node --test` over `test/`, two and a half thousand of them in about two
minutes. Each plugin's server half is built against a bare host with
stand-ins for git, GitHub, machines and the other plugins, so a test can
hand it any situation and read the answer without a workspace, a token or
a machine.

`test/rules/` is the shape of the app held by test: one or two levels of
plugins, no pane naming a class, nothing in `core/` naming an app service,
no secret in a capture, no stray control character in a source file. When a
rule test goes red the answer is almost never to change the rule.

Run the file you touched first; the whole suite is the final gate before a
commit. Cap it with `timeout` — it can finish and never exit, and an exit
of 124 means a plugin failed to start.

## Stand-ins lie the way they are written

Twice in one day a bug hid behind a stand-in that answered synchronously
where the real drawer was async: every judgement read as "nothing handed
back" and no worker ever received a judge's report. A stand-in easier to
satisfy than the thing it stands for is a stand-in being tested. Make it
answer the way the real one does — a promise where the real one promises —
and use the real pool, not a stub that runs one at a time.

## The drills — slow, against the running app

The Test tab. They drive the real app through `okc.js`: write a task,
borrow a machine, take a credential, tag an issue, and check what happened.
Half pass by being refused. They are written whenever a change makes a
claim code review cannot settle. See [Run the drills](../howto/run-the-drills.md).

## `npm run walk`

Opens every tab and pane against the running app and reports which came
up, which crashed, and which had nothing on screen. It stops on `failed`
rather than walking fifty panes against a dead app.
