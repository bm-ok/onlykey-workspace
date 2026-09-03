# Use the command line

Everything the window can do, the command line can ask for — with a few
presses held back for a person (see
[Purple, and the wire](../permissions/purple-and-the-wire.md)).

## The one command

    node tools/okc.js                    every action, listed, with its arguments
    node tools/okc.js <action>           run one, printed for a person
    node tools/okc.js <action> --json    the same answer as JSON, for a script
    node tools/okc.js <action> --key value --flag

The list is generated from the running app, so it cannot go stale. If a
page here disagrees with it, the list is right.

Exit codes: `0` fine, `1` refused (the reason is the output), `3` nothing is
listening — start the app with `npm start`.

## Reading first

A good session starts by asking what state things are in:

    node tools/okc.js status             can this host work, and with what
    node tools/okc.js inbox              everything waiting on you
    node tools/okc.js queueState         what is running, what is waiting
    node tools/okc.js vmList             the machines and their stage
    node tools/okc.js events --limit 40  what the app has done lately

`events` is the receipt for everything: tasks, judgements, wakes, sweeps,
refusals. When something did not happen, read it there before guessing.

## Writing

Most writes are open from the command line — `taskCreate`, `docWrite`,
`branchCreate`, `prCutMake` — and the answer says what was done. The
refusals name their reason and, where there is one, the way that works:

    $ node tools/okc.js issueApprove --on o/r --number 2
    A waiting reply is released by a person at the window, in Repositories
    → Issues. Something that can approve what it wrote has not written a
    draft, it has posted with extra steps — which is the whole of why the
    draft exists.

## Two habits

- **`--json` for anything you will parse.** The printed form is for eyes and
  changes wording; the JSON is the answer.
- **Ask, do not poll.** After a long act, read `events` or the thing's own
  state (`taskProgress`, `judging --ref J9`) rather than sleeping and
  looking again.
