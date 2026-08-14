ROADMAP — from here to the vision
=================================

`../EXPLAINER.md` is the why and does not change. `GAPS.md` is what the older
design projected and what of it was one ecosystem rather than a tool. This is the
order to build in, and it is expected to change — when it does, change it here
rather than remembering.

**The spine this is built around:**

    branch <- task <- claude  <- supervisor
    branch <- task <- person <- supervisor
    supervisor = person || claude

and, where the work is a job done more than once:

    branch <- task <- defined-task <- defined-prompt

The chain is the same either way and only one step differs: how work is started,
and how it is known to be finished. Anything that does not serve that is not on
this list.

**The third line is not a footnote to the first two.** A supervisor is a role,
not a person -- it is whoever writes the task, gives it out, and judges what
comes back -- and either kind can fill it, in any combination with the worker
below it. A person supervising Claude is the ordinary case today. Claude
supervising a person is not a joke: it is what a queue of pre-defined tasks and a
board of verdicts already almost is.

It is also why the boundaries in this app are drawn where they are rather than
around "the human". Approving a pre-defined task is refused down the pipe --
`_overTheWire` -- because a model may write one and may not ratify its own; the
dashboard sits between the supervisor and the workers so distribution goes
through a channel that can be watched, whichever kind is supervising. Neither
rule would make sense if the supervisor were assumed to be a person, and both are
load-bearing precisely because it is not.

**The second line is the same chain seen from further back**, and it only appears
when a job is worth doing more than once. A task is one occasion; a defined task
is the standing intention to do that job; a defined prompt is the instruction
itself, which is the part worth improving and worth having exactly one of. Most
work never needs it -- a task written for an afternoon is a task -- and the
moment the same brief is being retyped for the third time it is the shape that
was already wanted. See "Prompts, and the jobs that consume them" below.


Where it actually stands
------------------------

The vision names five separable pieces and says the compounding payoff rests on
the first two, which are the cheapest. Three of the five are built:

    review gate          DONE, and enforced at the guest. A worker was told to
                         push master; the hook refused, master did not move, and
                         the message said what was refused and why
    firmware discipline  DONE IN SHAPE. The contract is a per-task file this tool
                         carries and never interprets, so the discipline is an
                         input rather than something anybody pastes in
    isolation            DONE and drilled. Cable pulled, credential vanished,
                         dashboard restarted mid-run
    orchestration        DONE. Two machines took two tasks in the same tick and
                         both delivered
    self-maintained      NOT STARTED. Nothing proposes work
    backlog

**The one thing that has never happened: a real repository has never been through
this loop.** Everything above is proven against `local-repo-a`, `local-repo-b` and
`local-repo-c` with shell tasks and toy commits. That was the right way to build
it — a channel and a firmware fix cannot be debugged at once — and it means every
assumption in here is currently held against a substitute.


0. One real fix, end to end
----------------------------

**Not a feature, and it comes before the features.** Point the workspace at real
repositories, write one real task, let it run, read the branch, land it by hand.

This will find more than another week of building, because it is the first time
any of these are tested rather than assumed: how large a real diff is, how long a
real suite takes, whether a real `setup.sh` survives provisioning, whether a
contract actually constrains a worker doing work that matters.

**Nothing blocks it now.** The workspace is a folder the app points at, changeable
from the title bar, and what belongs to a workspace follows it -- see "Which
repositories this is about" in `README.md`. What remains is a decision rather than
work: which repositories, and whether the first real task is a fix or a read. A
task that only READS and reports exercises the whole loop with nothing at stake on
the branch, which makes it the cheaper first one.


1. Keep the session, so a task can be paused
---------------------------------------------

The task is meant to be the durable identity and the machine a resource it
borrows. Today a task is bound to one uninterrupted run: the machine is rolled
back when the work ends and the session goes with it.

`--resume` is already plumbed from `vmDispatch` to `claude --resume`. It names a
session this tool deletes a moment earlier, so it looks supported and is a trap —
fixing that is most of this step.

    capture   the whole session folder when a run ends, not the .jsonl. Picking a
              minimal set is a guess that fails quietly later
    key       to the BRANCH, not the task. A branch is the durable unit; several
              tasks against one branch should share one session rather than
              re-reading context every time
    restore   push it into the one machine resuming that branch, before the run
              starts. Never a share — one session belongs in one machine
    forget    one click to start fresh, because a session that spans ten tasks
              eventually carries more noise than context

Unlocks: pause and resume, several tasks on scarce runners, and reading how a
branch was reached rather than only what it contains.

Rule to hold when this lands: **a free runner and a parked task produce a prompt,
never an assignment.** The queue may act on work a person queued; it must not
decide that a parked task resumes.


2. A change note, and something that checks it
-----------------------------------------------

The piece that turns *watch it work* into *read what came back* — and attention
does not fan out to three sessions, so this is what makes more than one job in
flight possible at all.

    note      the worker writes what was wrong, the mechanism, the fix, the
              evidence, and what it deliberately did not touch. A deliverable
              like the branch, not a nicety
    verify    an independent pass reads the diff, the note AND the surrounding
              code. A plausible-and-wrong note is worse than none: it is
              optimised to reassure, which is exactly what floats a bad diff past
              a reviewer
    evidence  a run record that names the commits it ran against. Without that a
              verifier checks a claim about a test against another claim about a
              test

**Do not automate further before this exists.** The thing that prevents a
firehose is not a smaller fan-out — it is that every returned change is checked
by something other than what wrote it. Automation without verification only
scales trust in claims.


3. Something proposes the work
-------------------------------

The front door of the vision: ask for a list, read it, pick one. Least useful of
the three until the back door is trustworthy, which is why it is third.

Two guards, both general, both worth keeping when the ecosystem-specific version
is written:

* **provenance** on every proposal — human-written or model-written. An
  agent-authored proposal steering an agent worker is the case to watch
* **a proposal is not a narrative.** It is pickable only once something it
  carries has actually been run. The ecosystem's version is "the repro
  reproduces"; the general version is that a proposal arrives with evidence


Smaller things, worth doing when they are in the way
-----------------------------------------------------

* **Tag the log by why you would filter**, not by where a line came from. Every
  tag today is a source — `vm`, `channel`, `queue`, `task`. The question a
  console is actually asked is "is anything waiting on me", and it is answered
  here by reading. Tag at emit, never by parsing afterwards.
* **Show what a machine is holding while it is working**, not only when
  something is about to destroy it. `vmHolds` already asks the guest; only the
  delete, restore and release dialogs call it. Uncommitted work is the one state
  a branch view cannot see.
* **The experiment bench is nearly free.** Three approaches is three tasks on
  three branches, which the machinery already does. What is missing is comparing
  them side by side.
* **Record who wrote a task.** Provenance exists in exactly one place —
  `_overTheWire`, used to refuse approvals from a supervising session.
* **Keep a task's state transitions.** Attempts append and verdicts append; state
  does not, so a task that went queued → given → done → rejected → given keeps
  only the last.
* **Nothing checks the assumption the whole thing rests on.** The emulator can
  drift from real silicon, and "the suite is green" then means something narrower
  than it sounds. When a real ecosystem is wired in, this is the natural place to
  hold that counter — last reconciled against hardware, N days ago — so it decays
  visibly rather than quietly.


Prompts, and the jobs that consume them
----------------------------------------

    branch <- task <- defined-task <- defined-prompt

Read right to left, the same way the spine is: a task comes from a defined task,
which consumes a defined prompt. Three layers where there is currently one and a
half, and the split is the whole idea rather than a filing decision.

**A defined prompt is the reusable half.** What to do, in words -- the thing that
is worth improving, worth versioning, and worth having ONE of. "Read the README
and the code and say where they disagree" is the same instruction whichever
repository it is pointed at, and today it would be retyped into a brief every
time, drifting a little each time until there are four versions of it and nobody
knows which is the good one.

**A defined task is the binding.** A prompt plus the circumstances: which branch
it works on, which contract it runs under, which kind of worker, how long it is
allowed. One prompt, several bindings -- the same reading job pointed at three
repositories is three defined tasks and one prompt, and improving the prompt
improves all three.

**A task is one occasion.** What already exists: written down, given out,
delivered, judged, done with. A defined task produces one whenever it is run, and
the task carries a copy of what it was given rather than a reference -- a task
must stay readable as what the worker actually got, and a prompt edited after the
fact would rewrite history that somebody is judging against.

**Why this is a tab and not a field.** A prompt library is a thing you browse,
compare and improve. Bolted onto the task definition as a text box it is
invisible, unsearchable and duplicated -- which is exactly the state the ten
existing definitions were in before they got a pane, one level up.

**Where the drills fit, and it is the "both" answered.** A drill IS a defined
task; its body is a function rather than a prompt, because asserting something
is code. So a defined task has one of two bodies:

    code    a function, declared in tasks/planned.js, fingerprinted, approved by
            reading it. What the ten drills are
    prompt  a reference to a defined prompt, plus the binding above. Written in
            the window, approved the same way, runs by creating a task

One list, one approval rule, one run -- two ways of saying what to do. Which is
the same shape as `worker: claude | person`: one object, one record, and the only
step that differs is how the work is started.

**Approval covers both, and matters more here.** A prompt that does work is
closer to a loaded gun than a drill that asserts something: nothing unapproved
runs, whoever is asking, and editing a prompt has to lapse every defined task
that consumes it -- otherwise a definition that was read and approved quietly
becomes a different instruction while still wearing its tick.

**Written, approved, edited, removed -- all four, and approval is what makes the
other three safe.** The drills already have the mechanism and it generalises
exactly: `fingerprint` is a hash of the function's source, and approval records
the hash it was given, so an edit makes a definition *lapse* rather than silently
stay approved. A prompt is text, which hashes the same way. So:

    create   a prompt or a defined task starts unapproved. It is written, and
             nothing runs it until somebody has read it and said so
    edit     changes the hash, which lapses it and everything that consumes it.
             Not a warning to dismiss -- it stops running until re-read
    approve  a person, in the window. `plannedApprove` already refuses over the
             socket, because a model may write one and may not ratify its own
    remove   refused while a defined task still consumes it, the same way a
             workspace in use refuses to be forgotten. What is gone should be
             gone because somebody meant it, not because nothing checked

**The code drills stay read-only in the window.** They are declared in
`tasks/planned.js` and the app requires that file at startup, so creating and
removing them means generating and deleting JavaScript in a checked-in file that
a bad edit stops the dashboard booting with. Editing them is a code change and
should look like one. The window's job for those is what it does now: read them,
approve them, withdraw approval, and say what running one would touch.

**Build order, and the run comes last.** The prompt is the leaf -- nothing
depends on it -- so it is first, and the record can be proved with nothing else
moving:

    1  defined prompts: the record, the tab, create / edit / remove / approve,
       and the hash that makes an edit lapse it
    2  defined tasks as data: the binding, consuming a prompt, the same four
       acts, and the refusal to remove a prompt something still consumes
    3  running one: it writes a task onto the board, carrying a COPY of what it
       was given. Last, because until it exists nothing can be run by accident

**Open, and worth settling before it is built:**

* whether a defined task names a branch or a branch PATTERN. A reading job wants
  a fresh branch each time; a maintenance job may want the same one always
* whether a prompt takes parameters, and how hard to resist that. A prompt with
  placeholders is a template language eventually, and this app has no business
  growing one
* what a task keeps: the prompt's text at the time, its id, and its version, so
  "what was this worker actually told" is answerable a month later without
  depending on the prompt still existing


Judging, as its own kind of run
--------------------------------

A tab of its own, because judging is not a task and pretending it is one is what
has kept it from existing. A task produces work; a judgement is a reading OF
work, it is short, something is waiting on it, and it goes stale on its own the
moment the thing it read moves.

**What is judged is a PR cut, at a state.** Not a task -- `taskJudge` already
records a person's verdict on what a task delivered to a branch, and that stays
what it is. This is the outgoing side: the change as it will actually land, one
line into another, across every repository that carries work. It is the first
thing in this app that reads a change the way a reviewer does rather than the way
its author does.

**A judgement is bound to the commits it read.** `prtemplate.about()` already
computes the tip of each repository's branch, so a judgement records
`{repo -> tip}` for every repository in the cut. Any tip moves and that judgement
is **stale** -- shown as stale rather than hidden, because "judged, then changed"
and "never judged" are different states and only one of them means somebody has
already read this.

Editing the title or the description does NOT make it stale. The judgement is of
the change; the description is the claim about the change, and invalidating a
reading of the code because a sentence was rewritten would train people to stop
believing the word. That is a decision, and it is the kind somebody will
reasonably question, so it is written here rather than left in the code.

**A cut carries MANY judgements, and carries none quite happily.** Not one field
that the next run overwrites -- a list that accumulates, each entry with its own
tips, its own verdict and its own author. Three things follow, and each is the
reason for the shape rather than a consequence of it:

* **Staleness is per judgement, not per cut.** A cut is not "stale"; it has
  judgements, some of which were made before the last push. What the tab shows is
  which ones still describe what is there now -- and a cut whose only judgement
  predates three commits is exactly as unjudged as one with none, said out loud.
* **Re-judging keeps the old one.** The point of recording the tips is that the
  history stays readable: this was judged, then it changed, then it was judged
  again. Overwriting would throw away the one thing that makes the second reading
  meaningful.
* **Two judgements may disagree, and that is information.** A model and a person,
  or two models, reaching different verdicts on the same tips is the most useful
  thing this list can show, and nothing should try to resolve it into a single
  answer. Reconciling them is a person's job and it is the job they came for.

**And judging is optional.** A cut with no judgement is an ordinary cut, not an
incomplete one. Nothing nags, nothing is blocked on it, and no count anywhere
reads as a chore -- a judgement is a thing somebody asked for, and the moment the
window implies one is owed, it is a checklist rather than a tool.

**So the cut carries a list of judgement cards, with a `+`.** The same shape as
the branch cuts and the task board, in the same place a person is already
looking: the cut's own panel, listing what has been judged, by whom, at which
tips, and whether each still describes what is there. `+` adds one.

**AND THE `+` ASKS THE SAME QUESTION THE TASK DIALOG ASKS: who is doing it.**

    + judgement  ->  claude   queued as a judgement run, taken ahead of tasks
                 ->  person   an editor, here, now -- no machine, no queue

That is not a convenience, it is the spine again. A task is `worker: claude |
person`, one board, one record, one contract, and the only step that differs is
how the work is started and how it is known to be finished. A judgement is the
same object with the same two answers, and building the person's kind as a
different thing -- a note field, a checkbox, a comment typed into GitHub -- is
exactly what kept work done by hand off the board for so long.

The case this is for: **Claude passes, then a person reads it themselves.** Two
judgements, both against the same tips, both in the list, both published, in
order, saying which was which. What makes that worth having is that it is
visible: a reviewer arriving later can see that a model read it and then a person
did, which is a different and much stronger claim than either alone -- and it is
the claim nobody can make today, because the person's pass leaves no trace at all.

**It recommends. A person still decides.** The judge writes its judgement onto
the PR cut and into the Judge tab, with reasons; accepting or rejecting stays a
person's act, and nothing lands on a judgement alone. That is the same rule
`taskJudge` already holds and for the same reason: a wrong judgement should cost
a read, not a landing.

This is also the first real piece of `supervisor = person || claude`. A judge IS
a supervisor act -- reading what came back and saying whether it is good -- run
by Claude. Which is exactly why the authority stops where it does: the spine
allows either kind in the role, and this app's refusals are drawn around the ACT
rather than around the human, so "may not ratify its own" applies to a judgement
as much as to a pre-defined task.

**A judgement says who made it, and a model's says so on its face.** Not a field
in a record somebody could fail to render -- in the judgement itself, wherever it
is read: the Judge tab, and the text published onto the pull requests. A
judgement is written once and read afterwards by people deciding whether to
trust it, and one that reads as a person's when a model made it has misled every
one of them. It is also the half of `supervisor = person || claude` that costs
something: the spine says either kind may fill the role, and the price of that is
that the role must always say which kind filled it. Which model and when, too --
a judgement from a model that has since been replaced is worth re-running, and
nobody can know that from prose alone.

**Queued, and taken first.** A judge run asks the same queue for a machine --
one path to a machine, not two -- and is taken before any queued task, but never
interrupts one that is running. That asymmetry is the whole reason it is
prioritised: a judgement is minutes and something is waiting on it, a task is
hours and nothing is. A judge run that sits behind a six-hour task is a feature
nobody uses twice.

**Publishing is a separate act, from the Judge tab.** The judgement exists first
and is pushed onto the pull requests second, because those are two decisions --
and because a judgement of a cut is one thing while the pull requests are N, so
publishing it is the same fan-out `prCutUpdate` already does.

**It goes on as a comment, not into the body.** The body is this app's one
statement of what the change IS, rewritten whenever the description is edited --
a judgement written there would be overwritten by the next edit, and a second
judgement would have to overwrite the first. Comments accumulate, which is the
shape a list of judgements already has. Publishing is per judgement too: some are
worth putting in front of reviewers and some were run to answer a question, and
deciding which is the kind of thing a person should not have done for them.

**Built in four steps, and not in one go.**

The temptation is the run -- it is the interesting part -- and building it first
is how the record ends up shaped around what the run happens to produce, rather
than the run being made to fill a record that was already right. So the run is
LAST, and every step before it leaves the app working and provable on its own.

**1. The record, and a person's judgement.** `repos/judgements.json` keyed like a
landing, holding a list; the card list on the cut with its `+`; the person's
answer behind it, which is an editor and a save. Staleness computed from the tips
`prtemplate.about()` already returns.

No machine, no queue, no credential, no GitHub. **Provable by hand:** judge a cut,
commit something on one of its branches, watch that judgement go stale and the
cut go back to reading as unjudged.

**2. Publishing.** One judgement onto the pull requests as a comment, per
judgement, chosen deliberately. The fan-out is the one `prCutUpdate` already
does. **Provable against the three pull requests that are already open**, which
is the same way the template was proven.

**3. The Judge tab.** Everything across all cuts: what was judged, by whom, at
which tips, what is stale, what disagrees. Read-only over what steps 1 and 2
built, which is what makes it cheap -- and it is the step where "optional" gets
tested, because this is the screen most likely to grow a number that reads as a
chore.

**4. The Claude judgement.** The run: what it is given, the queue lane, taken
ahead of tasks, never interrupting one. Last because it is the only part that
needs a machine, a credential and a dispatch -- and by the time it is written,
the record it writes into has been proven three times over by hand.

**Each step is a session or less, and none of them is finished until it has been
run rather than read.** That is not caution for its own sake: every one of the
faults this app has had that cost real time was in something built in one pass
and reasoned about rather than exercised, and they are listed in `LEARNED.md`.

**Still open, and it does not block step 1:** what a judge is asked to look FOR.
A judge with no stated rubric produces prose. The contract is the nearest thing
this app has to one, and whether that is what a judgement should be measured
against has not been decided -- step 4 is where it has to be, and steps 1 to 3
are worth having whatever the answer.

**What has to be true first.** Nothing merges yet -- see `TODO.md` -- so a
judgement currently has nothing to be acted on downstream of it. That is not a
blocker for building this, and it is the reason judging is worth having before
merging rather than after: the thing that should decide whether work lands ought
to exist before the thing that lands it.


Served over http, to a browser that is not on this computer
------------------------------------------------------------

The window is an app page loaded from disk, and that is what lets it call the
actions in its own process with no socket in between. A remote version is the
same panels reaching the same actions across a network, and the work splits into
one decision and a short list of chores.

**Started, and the reason the rest is legible.** The window's NW.js half is one
object with two implementations — `ui/nwjs.js` and `ui/browser.js`, chosen once
in `ui/load.js`. Everything else in `ui/` is ordinary DOM code. So the list of
what a browser cannot do is executable rather than remembered, and it is short:

    call         the actions run in this process; over http they are nowhere
    capturePage  a page can draw itself, it cannot see itself
    writeFile    not a browser's to do
    pickFolder   a browser is not allowed to know where a folder is
    openExternal works either way

The last four degrade honestly and already say so. Only the first is a design
question rather than a shim.

**The decision: what goes on a port, and who may reach it.**

The HTTP side today serves machines and nothing else, and says so in its own 404:
*the actions are not on this port at all.* That is not an oversight to correct on
the way to a browser — it is the property that makes the port safe to expose to a
guest being provisioned. Putting the table behind it changes what this app is:

* **The actions are not equally safe.** `vmRemove`, `branchDelete`,
  `workspaceForget` and everything under `credentials` are not "read the board".
  A remote surface needs to say which are reachable and by whom, and that is a
  list somebody has to keep — the kind that is wrong the first time somebody adds
  an action and does not think about it. Better: derive it, the way
  `needs: 'workspace'` is derived, so a new action is refused until it says what
  it is.
* **`_overTheWire` gets more load, not less.** Approving a pre-defined task is
  deliberately refused down the pipe, because a model drives the pipe and
  approval is a human ratifying what a model wrote. Over a network, "at this
  keyboard" stops being a boundary at all, and that distinction has to become a
  real one — a signed-in person — or be dropped honestly rather than kept as a
  word that no longer means anything.
* **The credentials are the sharp edge.** The worker credential and the GitHub
  token are sealed at rest, never shown, never handed to a machine. They are
  reachable through actions. A remote surface that can reach those actions can
  spend them.

**The chores, once that is settled.**

* Serve `ui/` — the markup, the scripts and the stylesheet are not served at all
  today.
* `host.call` over http, and a live log that streams. `logWatch` already answers
  forever on a socket rather than once, which is the right shape for it; the
  window currently reads `core/log` in-process.
* The terminal reaches a machine through a channel this host holds. Remotely it
  is a relay, not a connection, and that is its own piece.
* Everything that answers with a path — a screenshot, a capture, a task's files —
  is answering about a disk the reader cannot see.

**What it is worth.** Reading the board from another machine, and starting work
from one. Not driving a machine's install, which wants the host anyway.


Not on this list, on purpose
-----------------------------

**Merging.** A verdict is a person's decision and landing work is a separate act
with its own rules. It is named in `TODO.md` as a joint, not scheduled here.

**Anything from `legacy/` that belongs to one ecosystem.** The seven-step
hardware chain, a repository list naming firmware repos, review thresholds
counted in firmware files. `GAPS.md` sorts those out from the parts worth taking.
