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

    branch <- task <- job <- prompt <- contract

Read right to left. A contract is the rules; a prompt is the words that have to
hold to them; a job is the script that gives those words to a worker; a task is
one occasion of that; a branch is what comes back. Each arrow is one thing being
carried into the next, as a COPY rather than a reference, so what a run was
actually held to stays readable after the library it came from has moved on.

The contract sits at the far end because it is the thing that changes least and
governs most. It hangs off the prompt rather than off the job because the prompt
is what has to be consistent with it — a brief saying "refactor across every
repository" under rules saying "touch nothing you were not asked about" is a
contradiction visible only when the two are read together, which is the moment
one is approved.

The chain is the same either way and only one step differs: how work is started,
and how it is known to be finished. Anything that does not serve that is not on
this list.

**The third line is not a footnote to the first two.** A supervisor is a role,
not a person -- it is whoever writes the task, gives it out, and judges what
comes back -- and either kind can fill it, in any combination with the worker
below it. A person supervising Claude is the ordinary case today. Claude
supervising a person is not a joke: it is what a queue of jobs and a board of
verdicts already almost is.

It is also why the boundaries in this app are drawn where they are rather than
around "the human". Approving a job, a prompt or a contract is refused down the
pipe -- `_overTheWire` -- because a model may write one and may not ratify its
own; the dashboard sits between the supervisor and the workers so distribution goes
through a channel that can be watched, whichever kind is supervising. Neither
rule would make sense if the supervisor were assumed to be a person, and both are
load-bearing precisely because it is not.

**The second line is the same chain seen from further back**, and it only appears
when a job is worth doing more than once. A task is one occasion; a job is the
standing intention to do that work; a prompt is the instruction itself, which is
the part worth improving and worth having exactly one of; a contract is the
limits it holds to, which change least of all. Most work never needs any of it --
a task written for an afternoon is a task -- and the moment the same brief is
being retyped for the third time it is the shape that was already wanted. See
"Contracts, prompts, and the jobs that run them" below.


Contracts, prompts, and the jobs that run them — BUILT
-------------------------------------------------------

    branch <- task <- job <- prompt <- contract

**This section used to describe a different design and it is worth saying what
changed, because the difference is the whole lesson.** It planned a "defined
task": a data binding of a prompt to its circumstances — which branch, which
contract, which kind of worker — with a second kind whose body was a checked-in
JavaScript function, the ten drills. Three things went wrong with that on
contact.

A binding is a form, and every job worth having wanted one more field than the
form had. The drills were the same thing with a body of code, filed in the same
list, and the only thing wrong with them was that asserting something was the
*only* thing a definition could do. And the two kinds needed one approval rule
between them, which is a rule about two different substances.

**So a job is a Node script, and it runs on a machine.** Not a binding, not a
function in a checked-in file. It is handed one object and everything it can do
is on that object: the prompt, the contract, a shell, a worker, a way to hand
files back, and assertions for a job that checks rather than does. The drills
became one kind of job with nothing special about them, which is what they should
always have been.

It runs on a MACHINE, and that was proved rather than assumed: `require` gives a
module everything Node has, so the API was never a sandbox — an approved job was
arbitrary code running as the operator, and a three-line job printed the host's
name to show it. On a machine the blast radius is something that gets rolled back
to a snapshot when the work ends.

**The four layers, as built.**

    contract  the rules: what a worker may NOT do. Kept for this computer, since
              "do not force-push" names no repository
    prompt    the words: what it is told to do. Names the contract it must hold
              to, because that pairing is what somebody reads while approving
    job       the script: how the words get given to a worker, and what is
              checked about the result
    task      one occasion, carrying a copy of what it was given

**Everything is copied, never pointed at.** A task carries the text of the brief
it went out with; a run carries the contract's words in `contract.md` beside its
own script. Read six weeks later, a reference proves nothing about what the
worker was actually held to, and the library it named has moved on since.

**Approval is per substance, and the ladder composes.** Each of the three hashes
its own words — a job the bytes of its file, a prompt and a contract their text —
and an edit lapses it rather than silently keeping the tick. A job is runnable
when its script is approved AND its prompt is usable, where usable means the
prompt is approved and its contract is ready. The job asks the prompt rather than
reaching past it to the contract, so the chain only runs one way, and `whyNot`
names the one rung that is missing rather than reporting "not approved" about the
thing that plainly is.

Approving is refused over the wire for all three, and it is sharpest for the
contract: that is the text saying what a worker may not do, and a model ratifying
its own limits is the review that reviews nothing.

**What is still a file path.** A task's contract. The task dialog takes a path on
this host, from before the library existed, and a task written from a prompt
should simply take that prompt's contract. It is a small change to what a stored
task MEANS, which is why it is not folded in with the rest.

**Still open:**

* whether a job names a branch or a branch PATTERN. A reading job wants a fresh
  branch each time; a maintenance job may want the same one always
* whether a prompt takes parameters, and how hard to resist that. A prompt with
  placeholders is a template language eventually, and this app has no business
  growing one
* what a task keeps of its prompt: the text at the time, its id, and its hash, so
  "what was this worker actually told" is answerable a month later without
  depending on the prompt still existing
* where a job's artifacts are read. They are kept under the run id rather than a
  task uid, so they land on disk and no pane in the window shows them


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
as much as to a job.

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
* **`_overTheWire` gets more load, not less.** Approving a job, a prompt or a contract is
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
