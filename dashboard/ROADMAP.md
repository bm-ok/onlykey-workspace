ROADMAP — from here to the vision
=================================

`../EXPLAINER.md` is the why and does not change. `GAPS.md` is what the older
design projected and what of it was one ecosystem rather than a tool.

**This is mostly the road TAKEN, and partly the road ahead** — which is why it
was hard to tell where anything stood. Every section now says which in its
heading:

    BUILT                 it exists, and this is why it is shaped that way
    NOT BUILT             decided, not written. There is a draft check for it
    AN IDEA, not decided  worth doing, and nobody has settled what it means yet

**The difference between the last two is the useful one.** A thing whose
behaviour is decided can be stated as a check before it is built — so it is
`draft(name, note)` in the suite where it would happen, carrying what has to
exist, what the check would be, and what has to be settled first. Those are
gathered at the top of `test/outline.md`, and the app rewrites that file on
startup while testing mode is on, so the list of what is outstanding cannot go
stale the way a document does.

A thing whose behaviour is NOT decided cannot honestly be a check — a check
would be asserting an answer nobody has chosen. It stays here as reasoning until
somebody decides, and then it becomes a draft and leaves.

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

**And a worker's memory belongs to the task — BUILT.** A machine is rolled back
when its work ends, so a session died with it and a task given out twice was two
strangers. `~/.claude` is now archived when a run ends and unpacked before the
next one starts, keyed by task uid, one per task, credential excluded. Proved
across machines: a conversation started on runner1 was carried on by runner2.

The guest never chooses which conversation — `resume` is refused, and the host
looks it up from the task the machine is running. That is the same rule an
artifact follows, and for the same reason: a machine that can name its
destination can name somebody else's.

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


Judging needs a home of its own — BUILT, AND NEVER YET USED FOR REAL
-------------------------------------------

**A verdict is somebody reading what came back.** "Judge it" was a button on the
task's own card, which is where the BRIEF is — so the screen that asked for a
decision showed the question and not the answer. The button is gone; `taskJudge`
is untouched and is still on the command line.

What it wants is a screen built around the delivery: the branch's commits, the
diff, the files handed back, the run's log, and the two buttons underneath all
of it. That is close to what the board's third column already shows, so the open
question is whether judging is a pane of its own or the bottom of that column
once something has actually arrived.

**Accepting must still not merge.** Landing work is a separate act with its own
rules, and a verdict that quietly merged would make reading the work and
publishing it the same button.


Signing a worker in, as a job rather than as code — NOT BUILT
-------------------------------------------------------------

**The flow is hard-coded, and it no longer has to be.** `credentialsBegin`
borrows a clean machine, starts a sign-in on it and hands back a URL;
`credentialsFinish` takes the code and keeps the credential here. Every step of
that lives in `actions/credentials.js` and `machines/auth.js` — a sequence of
guest commands written into the dashboard, which is where it had to live before
there was any other way to run a sequence of guest commands.

There is one now. A job is a Node script that runs ON a machine, with an API for
the things it needs: a shell, a way to hand files back, a way to say what is
happening, and a worker. That is the same shape as the sign-in dance, and it
would be a better home for it than the app:

* **It becomes readable and approvable.** The flow is a script somebody reads
  before it runs, hashed and approved like every other job, instead of behaviour
  compiled into the tool.
* **It becomes editable without a release.** The sign-in that Anthropic serves
  will change; today that means changing the dashboard and restarting it, which
  is the same cost as changing anything else in the app.
* **The URL stays where the sign-in is.** Right now the dashboard receives it and
  logs it:

      log.on('vm', name).good(`${name} is waiting to be signed in — open ${out.url}`)

  which is why `core/events.js` redacts URLs before anything reaches disk — an
  authorize link is a credential in transit. A job could keep the whole exchange
  on the machine and hand back only the finished credential.
* **It stops being a special case.** Borrowing a machine, bringing it up clean,
  doing something on it and putting it away IS the queue's job, and this is the
  one flow that reimplements it.

**What has to be settled first.** A job hands files back through `okc-artifact`,
and a credential is not an artifact — it is the one thing that must not be filed
next to build outputs. Either the job gets a way to hand back a secret that goes
through `core/secret.js`, or the credential keeps its own door and only the
*steps* become a job. The second is smaller and probably right.

Also: this is the one job that would run on a machine with no credential, to get
one — so it cannot use `claude()`, and the approval rule that protects everything
else ("nothing unapproved runs") has to be true of it before it is trusted with
the thing every other run depends on.


A key exchange between host and guest, for the credential — HALF BUILT
---------------------------------------------------------------------

**The credential going DOWN is sealed to the machine that asked for it**, since
2026-08-17. The machine generates an ephemeral X25519 pair, keeps the private
half, and publishes the public one; this host derives a shared key from it and
sends AES-256-GCM ciphertext. `core/handover.js` is this end,
`provision/okc-credential.js` the other, and the drill "nothing travels as
cleartext" decodes every base64 run in what was sent before searching it —
because the way this used to travel WAS base64, and a check that cannot tell the
difference would have passed the thing it was written to condemn.

**What is still loose** is written below as it was, because the reasoning holds
for the two halves that remain: the credential coming back up (in a command's
output, which is not a `ps` line but is not sealed either), and the authorize URL.

The description of the fault, kept because it says why:

    printf '%s' '<the whole credential>' | base64 -d > "$HOME/.claude/.credentials.json"

Base64 is not encryption. The channel is TLS and the file at rest is sealed by
`core/secret.js`, so the two ends are covered — what is not covered is the middle,
which is a command line:

* it exists in this host's process memory as a plain string, in a variable
  nothing treats as a secret
* it is a shell argument on the guest, so it is visible in `ps` for as long as
  the command runs, to anything else on that machine
* it lands in the guest's shell history and in whatever the channel agent does
  with the scripts it is handed

None of that is exposure to the network; TLS handles the network. It is exposure
to everything ON the two machines, which is the part a transport cannot fix.

**What ECDH gives — and this half is now built.** The guest generates an
ephemeral key pair, hands the public half up, and the host encrypts the
credential to it. The plaintext then exists only inside the guest process that
will write the file — never as a shell argument, never in a command string,
never in a variable on this host after the seal is opened. `sealed for one
machine, for one delivery` is a stronger claim than `sent over a good pipe`, and
it is the one worth making about a credential.

One pair per handover, and the private half is removed whether the decryption
worked or not: a key that outlived the delivery would make that machine a place
where every credential it is ever handed can be opened. The two-command shape is
what puts it briefly on disk (0600, in a directory only that user can enter),
because a shell command is one shot and the exchange is a round trip.

The guest half is SENT rather than provisioned — a machine built last month would
otherwise run last month's end of a protocol changed today, and that failure is a
decryption error on a machine at two in the morning.

**What ECDSA gives.** The channel already proves which machine is talking, by
token. Signing adds the other direction and makes it durable: a machine can
verify that a credential came from THIS host rather than from whatever answered,
and the host can verify a request to be signed in came from the machine it
believes it is talking to. It also gives the delivery a receipt — something the
guest can hold that says what it was given and by whom, which is the thing that
would let a machine refuse a second, different credential arriving later.

**And it is a tunnel, not a one-way delivery.** The credential going down is the
obvious half; the sign-in going up is the half that is loose today. The whole
exchange belongs inside it:

    guest -> host   the authorize URL, and later the code
    host  -> guest  the credential, once it exists

That URL is the reason `core/events.js` redacts links before anything reaches
disk — an authorize link is a credential in transit, and right now it arrives
here in the clear and gets logged:

    log.on('vm', name).good(`${name} is waiting to be signed in — open ${out.url}`)

Inside a tunnel keyed to that one machine it never needs to be in a log line, a
command, or a variable on this host at all: it goes from the guest to whoever is
signing in, and the dashboard carries a sealed blob it cannot read. The redaction
stays either way — it costs nothing and it catches the next line nobody thought
about — but it stops being the only thing standing between an authorize URL and
a file.

**A credential per machine, not one shared out.** This host holds ONE credential
and hands it to whichever machine is next, which has a failure nobody had
noticed: a worker refreshes while it runs, and if Anthropic rotates refresh
tokens on use, the machine now holds a newer credential than the host does — and
the old one is dead. The machine is then rolled back and the new one goes with
it, so the host keeps handing out a token that stopped working the first time it
was used.

That may be exactly what was seen on 2026-08-15: `credentialsHeld` reported the
refresh token good until September while the worker answered "OAuth session
expired and could not be refreshed". A clock-valid token the server rejects is
what a rotated-away token looks like. **Worth settling rather than assuming** —
run one task, `vmCredentialsGrab` from that machine before it is put away, and
compare the refresh token to this host's copy. Same string means no rotation and
the failure was something else; different means this is the highest-value item
here rather than a hardening exercise.

So: a credential is **assigned to a machine**, and there are as many as there are
machines that need one. Each is its own sign-in, so each has its own refresh
chain and no two can rotate each other away. The Keys tab becomes a list with
assignments rather than a single held credential, `vmCredentialsPut` hands a
machine ITS one, and a machine with none is refused with the reason rather than
handed somebody else's.

**And the refreshed credential comes home.** It rides the session round trip the
job API already does — down before a run, back up after — through the tunnel
above, sealed by `core/secret.js` and NOT inside the tar. The archive exclusion
stays: an archive is kept for a long time and read by anything that can open a
gzip, which is the opposite of what a credential wants. What changes is that the
refresh a worker performs is no longer thrown away with the machine.

**A machine that is deleted leaves a live token assigned to nothing, and nothing
about that is automatic.** Revoking it on the machine's way out would be wrong
more often than right: replacing a runner is ordinary — deleted, rebuilt, same
job — and the credential is meant to carry over. A rule that destroys it is a
rule that costs a sign-in every time somebody rebuilds a machine, to solve a
problem they were in the middle of solving.

So it is SAID, not acted on, and it uses the two things this window already has
for exactly this shape:

* **the banner under the title bar**, which is where a fact about the whole app
  goes when it is nobody's tab in particular — the same place a machine that
  VirtualBox no longer has, or a repository parked off its default, already
  appears. It names the credential, says its machine is gone, and goes to Keys.
* **the card, marked so it cannot be scrolled past.** An orphaned credential is
  not an error and it is not fine either; it is a live token nobody is using,
  which is the one state where "I will deal with it later" costs something.

Then the operator decides, and both answers are one click: assign it to the
machine that replaced the old one, or revoke it. Revoking is real revocation
rather than deleting the file — a forgotten file is still a working credential
somewhere, which is the whole reason this is on the screen at all.

**Note what it does not fix.** Once written, the credential is a file on a
machine that can be snapshotted — which is why snapshotting a machine holding one
is already refused, and why the session archive excludes it. A key exchange
protects the delivery, not the destination.

Same shape as the sign-in rework above, and probably the same piece of work:
both are about the credential path being the one thing that still goes through
a shell.


Judging, as its own kind of run — BUILT
---------------------------------------

**Built on 17 August 2026.** A judgement is a piece of work with its own store,
its own actions, its own library and its own place in the queue — see the
section above and README.md. The reasoning below is what it was built to and is
kept for that reason.

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


Served over http, to a browser that is not on this computer — NOT BUILT
-----------------------------------------------------------------------

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


The supervisor gets a machine of its own — AN IDEA, not decided
---------------------------------------------------------------

**A supervising model runs on the host today, and that is the wrong side of the
line.** It reaches every action through the local pipe — the same door a person
at a keyboard uses — so what it may do is decided by refusals written into the
actions one at a time. That works while somebody remembers to write each one,
and the failure mode is silent: a capability added for the window is a capability
the supervisor gained at the same moment, and nothing says so.

**So it moves into its own machine, with its own API.** The isolation stops being
a set of refusals and becomes a boundary the supervised party cannot reach — the
same argument as the pre-receive hook, which is the guard that works precisely
because it runs in a directory no guest can touch. A model in a VM cannot open a
named pipe on the host, so everything reachable only through that pipe is out of
its reach by construction rather than by remembering.

**What it gets is an allowlist, not the table.** A narrow surface built for
supervising: the board, the queue, what machines are free, what came back.
Explicitly not: approving anything, driving the window, the keys, or the
workspace switcher. Adding to that surface is then a deliberate act with a
diff, which is the property the current arrangement does not have.

**This is why `windowClick` and `windowFill` are not gated.** They are a
developer's door for testing the window from outside, on the local pipe, with
the operator watching. The gate is that a supervisor in its own machine has no
pipe to reach — so nothing needs to be checked at the call, and nothing can be
forgotten. A press is still marked as driven rather than as a person's, because
the record should say what happened; see `whoAsked` in actions/shared.js.

**Still open:**

* what the supervisor's API is served over. The channel machines already dial in
  on is the obvious candidate, and it is currently for machines being supervised
  rather than machines supervising
* whether the supervisor machine is an ordinary machine from the pool or a
  distinct kind. It wants a credential, and it must not be handed work
* how the operator sees what it is doing. The event stream is the record; a
  supervisor acting through its own API should be as legible there as the queue is


A conflict is a decision, so it is a task — AN IDEA, not decided
----------------------------------------------------------------

**An idea, recorded rather than scheduled.** Bringing a line into a branch that
was cut before it can conflict, and a conflict is the one thing here that no
amount of code resolves: it is two people having meant different things, and
somebody has to decide which. That is not a failure mode to be handled — it is
work, and this app already has a shape for work.

**Detecting one is free, which is what makes this cheap.** `git merge-tree
--write-tree A B` reports the conflicting files and exits non-zero WITHOUT a
working tree, a checkout, or anything to clean up afterwards. Checked on git
2.55. So a branch can be told "this will conflict, in these three files" before
anybody commits to anything, and the card that already says "12 behind" can say
it without becoming a thing that changes repositories.

**Then the resolution is an ordinary task.** A cut made for it, a brief that is
the conflict, a machine, and an artifact that is the resolved merge — with the
same accounting as everything else: what was asked, who did it, what came back,
and a verdict. Either worker can take it, which is the point of the spine: a
person in VS Code and a worker given the conflict are the same task with one step
different.

**And the intent is that a JOB does it, with Claude.** Which is the strongest
argument for the shape, because the whole approval ladder already applies with
nothing added: the script is approved, the prompt it runs is approved, the
contract those hold to is approved, and none of the three can be ratified over
the wire by the thing that wrote them. A conflict resolved by a model is exactly
the case where "who reviewed what was going to run" needs an answer, and here it
has one already.

**The line the job may not cross is what makes it safe.** Most conflicts are
mechanical — both sides added an import, both touched adjacent lines — and those
are worth automating and dull to do by hand. The dangerous ones are two people
having meant different things, and there the right output is not a resolution:
it is a refusal that says what the disagreement is. So the contract's job is to
separate them, and the failure to design for is a model that produces a clean
diff by quietly picking a side, because nothing downstream can tell that apart
from a correct merge. `assert` in the job API is the place to make that a
mechanical check rather than a hope.

**What it wants that does not exist yet:**

* the resolution has to happen ON A MACHINE. The host's repositories are served
  to guests, and leaving one with a half-merged working tree would hand every
  machine a broken checkout. The queue already brings a machine up on a branch;
  this is that, with a merge started before the worker is let in
* a contract almost writes itself, and should be written rather than assumed:
  reconcile only, do not change behaviour, and if the two sides disagree about
  intent then STOP and say so rather than picking one. A conflict resolved by
  guessing is invisible afterwards — the diff looks clean
* the verdict matters more here than anywhere else, for that same reason, so
  this is an argument for the judging screen rather than a separate feature
* whether the merge is attempted at all before a human looks. Starting it makes
  the conflict markers real and gives the worker something to edit; not starting
  it keeps the branch clean. Probably start it on the machine, never here
