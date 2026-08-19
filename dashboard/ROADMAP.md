ROADMAP — from here to the vision
=================================

`../EXPLAINER.md` is the why and does not change. What the older design
projected was read once against what is built here, and the parts of it that
were one ecosystem rather than a tool were separated out; that reading is done
and its conclusions are in the sections below.

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
what a rotated-away token looks like.

**SETTLED ON 19 AUGUST, AND NOT THE WAY THIS ASSUMED.** Two sign-ins of one
Claude account — `runner3` and `runner4`, both `bmatusiak@gmail.com`, signed in
twenty-five minutes apart — were given to two machines and ran AT THE SAME TIME.
Both spent real money, both were still good afterwards, and a third sign-in of
the same account was working throughout. No mutual rotation was observed at all.

So the premise this item was built on is wrong, and what killed credentials here
was two other things entirely: one was destroyed by this app writing a cleared
file over a working one, and one was an old token cleared out of the account by
hand. Both are fixed or explained; neither wanted a credential per machine.

**That drops this from "highest-value item here" to a hardening exercise**, which
is what the paragraph above promised it would mean. It is still worth having —
one sign-in per machine is a cleaner story than a pool, and it makes "whose run
was this" answerable without a meter — but it is no longer solving an outage.

What DID come out of settling it is the thing to keep: this host records which
account a sign-in belongs to now, so "are these two the same account" is a fact
on the card rather than a theory. They share a fate — anything done to the
account reaches both at once — which is a real reason to want more than one
account, and a different reason from the one written here.

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
counted in firmware files, which is the shape of one ecosystem rather than of a
tool.


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


What used to be here
--------------------

Four sections were cut once they were BUILT: the contract/prompt/job chain,
judging getting a home, judging as its own kind of run, and the supervisor
getting a machine of its own. Two of their labels had gone stale in place —
judging was marked "NEVER YET USED FOR REAL" after it had judged a stranger's
pull request, and the supervisor's own machine was still filed under "AN IDEA,
not decided" while it was running on one.

**That is the failure this file is prone to**, and it is worth naming rather
than quietly fixing: a roadmap that keeps its BUILT sections becomes two-thirds
history, and then nobody can tell where anything stands — which is what the
heading labels were introduced to solve and did not. What is built belongs in
`README.md`; why it went that way belongs in `LEARNED.md`; this file is for the
road ahead and for what was decided against.
