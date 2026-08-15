dashboard
=========

Make a virtual machine, install an operating system on it, snapshot it, throw it
away. An NW.js app with no build step, no framework, and nothing fetched at run
time — what it uses beyond NW.js is checked in under `vendors/`: the Ace editor,
xterm.js, marked, and nanotar. Four files, no package manager. See
`vendors/README.md` for why that is a directory rather than a dependency, and
for what each one is doing here.

    npm install             once, for NW.js (the SDK build, so devtools exist)
    npm start               the app window
    npm run cli             every action, from a terminal
    npm test                checks it stayed generic

This is how to use it, and why it behaves as it does where that changes what you
should do. Two other documents sit beside it and are deliberately not this one:

    LEARNED.md   what went wrong and what it taught -- why parts of the code
                 look odd. Archaeology, not instructions
    TODO.md      what is outstanding right now, and where the machines were
                 last left. Working state, and the first thing to distrust
    TEST-PLAN.md the end-to-end drills, what each proves, and when it last ran.
                 Half of them pass by being REFUSED
    GAPS.md      what the older design projected that this does not do yet, and
                 what of it was one ecosystem rather than a tool. Read against
                 this one's spine: branches hold work, tasks produce it, a
                 supervisor drives
    ROADMAP.md   the order to build in, and why that order. Step 0 is not a
                 feature: no real repository has been through this loop yet


It is generic on purpose
------------------------

It ships knowing nothing about any particular project. What a machine is *for*
lives in swappable shell scripts and in each machine's own settings, never in the
app. `npm test` checks that rather than trusting it, and measures code rather than
comments — a note explaining why something would be a mistake couples nothing, and
a test that cannot tell those apart is a test that gets ignored.

Only one rule beyond that: **just `machines/` drives the VirtualBox command line.**
Naming VirtualBox anywhere is fine, and the window has to be able to say it was
not found. What must not spread is *driving* it, because a second place shelling
out to `VBoxManage` means two opinions about a machine's state, and they will
disagree.


Only machines this app made
---------------------------

The list shows virtual machines this app created, and nothing else. That is a
safety boundary rather than tidiness: these actions delete disks, so membership
comes from the app's own registry and never from VirtualBox. On a host with three
machines it lists the one it made and refuses the other two by name.

Everything was exercised for real: created a machine, snapshotted it under a
title, started it, refused a restore while it was running, restored it once off,
deleted it, and confirmed its disks were gone while the two machines it does not
own survived untouched.


One click, then it builds itself
--------------------------------

**Make it** in the dialog does the whole thing: makes the machine and its disk,
starts it, installs the operating system unattended, and as that finishes the
machine fetches its own scripts from here and runs them. Progress arrives in the
live log, from inside the machine, while it happens.

    make  ->  install  ->  first-boot.sh  ->  ssh, your key, the agent
                                          ->  toolchain.sh
                                          ->  installs normal-boot.sh for later

That is two actions, not one — make, then install — because they fail differently
and the second is the one that takes half an hour. If the install will not start,
the machine still exists and `vmInstall` will try again without making it again.

**Installing blanks the disk first, every time.** The boot order is disk before
dvd, so a machine whose disk already boots never reaches the installer at all —
it starts the operating system that is already there. Installing a second time
therefore did nothing, while the dashboard reported *installing* and the machine
sat at a login screen. Recreating the disk rather than reordering boot: an empty
disk is not bootable, so the dvd is reached without touching the order, and the
installer meets the same blank disk it met when the machine was new.

Neither has a button of its own in the window any more: making a machine already
installs on its own, and both remain as actions, listed with everything else on
the **API** tab. Removing a button is not the same as removing what it did.

**The server listens on every interface, and that is deliberate.** A guest reaches
this host by its network address; loopback would be useless to it. **This port is
for machines**, and there are two things on it — both of which name the machine
they are for and make it prove that:

    /provision/*   a machine's own scripts and its progress
    /git/*         the repositories

**Both name a machine and make it prove it is that machine**, which is a
stronger question than whether it is a machine at all. Answering the weaker one
was a real hole: a script carries the machine's token, so serving it to anything
that asked meant any machine could read any other machine's secret and then *be*
that machine — dial in as it, push to its branch. Encryption settled who could
read it in transit and did nothing about who could ask.

A built machine proves it with its token. One still being installed has no token
yet — the script it is fetching is where the token comes from — so it carries an
**install ticket**, made when the install starts and put on the installer's
command line, the one channel that reaches a machine holding nothing. The ticket
dies the moment the machine dials in, because the command line outlives the
install: VirtualBox writes it into `vboxpostinstall.sh` in the machine's folder,
where it stays. A token there would be a live secret in a plain file; a spent
ticket opens nothing.

`vmRotateToken` gives a machine a new one without rebuilding it. The order is
the whole thing — the machine must hold the new token before the registry
expects it, or it is locked out by the act meant to keep it working.

**The actions are not on it at all.** They were, behind a check that the caller
was loopback — and that check was the only thing standing between anything able
to reach the port and an action that deletes a machine. A check is a line of
code: right until somebody edits it, and it has to keep being right for as long
as the route exists. The actions live on a local socket now, which cannot be
reached from another machine at all, so there is no address to compare and
nothing to keep enforcing. The strongest version of a check is not needing one.

That answers a real question rather than tidying: a machine here may be running
something that would start or delete another machine if it could, and *it cannot
reach the actions* is a better sentence when nothing has to be asked.


Provisioning is four scripts, meant to be swapped
-------------------------------------------------

    provision/
      first-boot.sh      once, at the end of the install. The installer is told
                         about this one and no other: it makes the machine
                         reachable -- ssh, your key, sudo, the agent -- then
                         runs the four below in order
      toolchain.sh       the baseline, as ROOT: packages, docker, groups, the
                         desktop
      toolchain-user.sh  the baseline, as the USER: their shell files, node
                         through nvm
      normal-boot.sh     every boot, as the user. Installs nothing, changes
                         nothing, safe to run hundreds of times
      agent.py           dials the dashboard and stays connected, as the user.
                         Python 3 because Ubuntu already has it

`first-boot.sh` is the only one the installer knows about; it decides what else runs
and in what order. **Stages are written to `/root/okc-stages/`, never beside the
bootstrap script** — a stage that lands on the path the running script came from
overwrites it mid-run, and the result is silent rather than loud. See
`LEARNED.md`.

`toolchain.sh` is about what kind of machine it is, which is why it is a separate
file rather than a section of another one.

**Root and user are separate scripts, and so are the app's and the project's.** Four
run in order, and every one may be missing without breaking anything:

    toolchain.sh        the app,     as root     the baseline
    toolchain-user.sh   the app,     as the user
    extra.sh            the project, as root     added on top
    extra-user.sh       the project, as the user

The project's are found in `../workspace/provision`, and they **add to** the app's
rather than replacing them — so every machine gets the same baseline and a project
only writes down what is only its own. Give a file the same name as one of the app's
instead, and it replaces that one outright.

Splitting root from user is not tidiness. Doing user-space work as root and fixing
ownership afterwards is how a root-owned file ends up in a home directory, where it
fails quietly — dconf and anything else saving state writes there.

**Nothing runs as root that does not have to.** The agent runs as the ordinary user,
both service units say so, and privilege is asked for per command with `sudo` — which
is what a person at a terminal would type. That is also why the user gets passwordless
sudo: an agent cannot type a password, and without it there would be no way to install
a package at all. It is a deliberate trade, judged low risk because the machine is a
throwaway that holds nothing and can be rebuilt in one action.

The log says whose copy of a script it served, so an override is visible rather than
discovered.

Each is served with a header of `OKC_*` values and `say`/`report` helpers
prepended, then passed through byte for byte. So every script is valid shell on
its own: copy one onto a machine and run it by hand to debug it, which a template
built out of strings could never be. They are read fresh per request, so editing
one takes effect on the next boot with nothing to restart.

A guest's output comes back into the same live log as everything else. That is
what makes a long install watchable instead of silent, and neither `say` nor
`report` is ever fatal for the guest — a machine must not fail to build because
the app was restarted while it was talking.


The machine dials in
--------------------

Once a machine is up it connects back and stays connected, and the list says
**connected** — which is a stronger statement than *running*, because it means the
machine is talking and things can be run on it.

**The dashboard listens and the machine dials in, not the other way round.** A
reboot is then an ordinary reconnect rather than something anyone has to handle,
and the log survives it. Newline-delimited JSON over TLS: no dependency, and
trivial to re-implement in a guest in any language.

The agent is deliberately dumb. It connects, runs what it is told, streams the
output back and says what the exit code was. It knows nothing about what any
command is for, so changing what a machine does never means replacing anything
inside it. Each machine gets its own token when it is made, so it can only ever
dial in as itself.

What that buys is the fast path: `vmSetupAgain` re-runs the setup on a live machine
in a minute, where reinstalling to try a change takes half an hour — and nobody
iterates on a half-hour loop. The machine fetches the script fresh, so an edit made
since it was built is included.


Which repositories this is about
--------------------------------

A **workspace** is a folder of repositories. It was `../workspace`, fixed, with an
environment variable as the only way out -- which is fine for a tool with one
subject and useless for one meant to serve any ecosystem. It has its own tab now,
opened from the name beside the title, and changing it takes effect without a
restart.

**The part that is not obvious is contamination.** Some of what this app knows is
about the HOST and some is about the WORKSPACE, and they were in one drawer:

    about the host       the machines it made, machines reachable over ssh, the
                         approvals recorded for its own drills. True whatever
                         repositories are being worked on
    about the workspace  every task, because a task delivers to a branch in these
                         repositories. Every branch's reason. Every repository's
                         default branch and chosen baseline

Both of the workspace files are keyed by NAME, and a name means something
different in a different folder. Kept together, switching would apply
`local-repo-a`'s remembered baseline to an unrelated repository that happens to
share the name, and attach a branch's recorded reason to a branch somebody else
cut. **None of it would error.** All of it would be quietly wrong, which is the
worst way for a tool whose job is oversight to be wrong.

So the second kind lives under the workspace it belongs to, and the files that
were written before there was more than one move into the workspace that was
already being served -- once, automatically, because that is the one they
describe.

**Switching is refused while anything ties a machine to the current one**: a
machine borrowed, a machine set up on a branch, a task out on one. A machine
checked out on a branch cannot be reasoned about from a folder that has no such
branch, and the refusal names what is holding it. The same list is shown in the
picker before it is offered, so the window never offers what the action turns
down.

Forgetting a workspace does not delete what is known about it. It means "stop
offering me this" -- point at the folder again and its tasks are where they were.

### None open is a state

A workspace can be **closed** without being forgotten, and without quitting: the
honest answer at the end of a day, or while working on this app rather than
through it. Closing is refused for exactly the same reasons switching is, because
a machine left naming a branch nothing is serving is the same problem either way.

What that state means is one rule in one place. An action declares
`needs: 'workspace'` if it is a question about a folder of repositories, and
**`call()` in `server.js` -- which the window, the pipe and a drill all go
through -- turns it down by name**. There is no second list to keep in step, and
`workspaces` reports the marked ones so the window can say what stops working
before somebody walks into it.

    refused        everything under Repositories, Branches, PR cuts and Tasks
    still working  the machines, the ssh hosts, the keys, the approvals, the log

That split is not a convenience, it is the same one drawn above: the second
column is true whatever is being worked on, and it is exactly what somebody needs
while nothing is open -- **putting a machine away is how you get to close a
workspace**.

Everything downstream reads it as "there is nothing to say anything about": the
git server serves no repository, the state directory is `null` and its readers
treat that as an empty board, and the queue says so once and stops dispatching
rather than reading an empty list and calling it idle. The window disables the
four tabs, names the reason on each, and shows a welcome landing.

Nothing it produces lives in the repository
-------------------------------------------

Everything this app makes by RUNNING is in the per-user data directory --
`%LOCALAPPDATA%\okc-dashboard` on Windows, `~/.local/share/okc-dashboard`
elsewhere -- and nothing it makes by running is in the working tree.

    state/         which machines it made, machines reachable over ssh, what has
                   been approved — the things that are true whatever repositories
                   are being worked on
    workspaces/    one folder per workspace: its tasks, its branch reasons, its
                   repositories' defaults and baselines
    credentials/   the worker credential, sealed
    task-logs/     what a run left behind, kept where a machine cannot take it
    artifacts/     what a task handed over that was not a commit
    window/        photographs of the window
    ca.pem, server.key, id_okc, ssh_config, known_hosts

**The registries used to be in `dashboard/state/`**, covered by `.gitignore`,
which is where they were written before this directory existed. Ignored is a
rule, and a rule can be changed, overridden with a `-f`, or simply not apply to
whoever clones this next -- and a machine registry inside a working tree is one
`git clean -xdf` away from every machine this app made becoming unmanageable,
with the machines themselves still sitting there in VirtualBox. Outside the tree
there is nothing for git to decide about, which is a stronger statement than
asking it not to.

They MOVE THEMSELVES, once, the first time anything asks for the directory and
before any of it is read -- because the alternative is an app that starts up
having forgotten its machines. Nothing is overwritten: a file already at the
destination is the live one, and a leftover beside it is from before the move.
The start that does it says so in the log.

`OKC_STATE` still points the whole lot somewhere else, and when it is set nothing
is moved -- somebody who has chosen where this goes is not helped by having their
files relocated.

Handing back something that is not a commit
--------------------------------------------

A branch is the artifact for anything that IS source, and it is the better one:
reviewable, diffable, and already what a verdict is about. It is not everything.
A firmware build produces a `.bin` that was the POINT of the task and whose
source is only how it got made; a packaging task produces an archive. The branch
held what went in and nothing held what came out.

A run hands one over by calling a command that is already on its PATH:

    okc-artifact build/firmware.bin

That is the whole interface. The task does not know a URL, a port, or where on
this host anything lands -- it names a file, and the host decides the rest.

**The guest never supplies a path, only a name.** Which task an artifact belongs
to is not asked for, it is LOOKED UP: a machine is running exactly one task or it
is running none, and the host is the only side that should be deciding where
something is filed. A guest that could name its destination could name somebody
else's, and the defence against that would then be a list of spellings of "the
parent directory" that somebody has to keep complete for ever. There is no
directory component to traverse out of, because none is ever sent. A name with a
path in it is refused with the reason; so is an unauthenticated push, and so is
one from a machine that is not running anything.

**Filed under the task's uid**, beside the run logs and for the same reason: a
uid is never reused and never renamed, so throwing the task away does not orphan
what it produced. Two deliveries of one name never overwrite each other -- two
runs of one task both produce `firmware.bin`, and silently keeping the last one
means the file on disk belongs to whichever finished last with nothing saying so.

**The credential is the machine's own token** -- exactly what it already uses to
push commits, which git replays from the remote URL on every push. This adds no
exposure that pushing did not already have.

ONE ORDERING MATTERS AND IT WAS WRONG. A run starts the moment dispatch returns,
detached, and the first thing it may do is hand something back -- which arrives
at a host that decides where to file it by asking which task the machine is
running. So that has to be recorded BEFORE the work starts, not after. Written
afterwards it was a race the run usually won, and an artifact pushed two seconds
in was refused with "this machine is not running a task" by a host that was about
to record that it was. The queue always had this right; giving a task straight to
a named machine did not.

What a task is made of
-----------------------

A task used to be a title, a brief and a branch. It is now the last link of a
chain, and each link is a thing with a name, a hash and an approval:

    branch <- task <- job <- prompt <- contract

Read right to left. A **contract** is the rules — what a worker may not do. A
**prompt** is the words it is told, and it names the contract those words have to
hold to. A **job** is a Node script that gives the prompt to a worker and checks
what came back. A **task** is one occasion of that, and the branch is what
arrives.

**Every arrow carries a copy, never a name.** A task written from a prompt stores
that prompt's words in its brief and its contract's words in its rules; a run
carries those down as `contract.md` beside its own script. Read six weeks later,
a reference proves nothing about what a worker was actually held to, and the
library it named has moved on since. Editing a contract lapses its own approval
and changes nothing about a task already written under it — which was proved by
doing it.

**Three approvals, and the ladder composes.** A job is runnable when its script is
approved and its prompt is usable, where usable means the prompt is approved and
its contract is ready. The job asks the prompt rather than reaching past it to
the contract, so the chain only runs one way, and the refusal names the rung that
is missing rather than reporting "not approved" about something that plainly is.
Approving any of the three is refused over the wire, and it is sharpest for the
contract: that is the text saying what a worker may not do, and a model ratifying
its own limits is the review that reviews nothing.

A job runs on a machine and cannot reach this app's actions. It is handed one
object: the prompt, the contract, a shell, a way to hand files back, assertions,
and `claude()` — which is the same command a task's dispatch writes into a run
script, so a worker a job starts and a worker the queue starts are the same
worker.


What a worker remembers
------------------------

A machine is rolled back when its work ends, so a worker's memory used to go with
it. A task given out twice was two strangers rather than one worker having a
second go, and the only record of WHY it did what it did — the transcript — lasted
until somebody tidied up.

So `~/.claude` is archived when a run ends and unpacked before the next one
starts, keyed by task uid, one per task. The whole folder rather than the
transcript file: Claude files a session under a slug made from the working
directory, and putting a `.jsonl` back in the wrong place restores a transcript
nothing will ever find. An archive puts itself back.

Proved across machines, which is the point: a conversation started on runner1 was
carried on by runner2, same session id, and the second worker knew which file it
had already written.

**Except the credential, and that exclusion is load-bearing.** `~/.claude` also
holds `.credentials.json`. This host already keeps one copy, sealed; letting it
ride along would write an unsealed one per task into a folder whose whole purpose
is to be kept for a long time.

**The guest does not choose which conversation.** `resume` is refused rather than
ignored — which conversation a run continues is a question about the task, and a
run that could name any id could read the transcript of work it has nothing to do
with. The host looks it up from the task the machine is running, exactly like an
artifact.

The archive is read once, when it arrives, and what Runners -> Claude guest shows is
that summary: how many turns, which model, which tools, which files were touched,
how many tokens. A run's log says what a worker printed; this says what it did.


Encrypted, and how a bare machine comes to trust it
---------------------------------------------------

Everything a machine says is over TLS: its scripts, its repositories, and the
channel it dials in on. All of it against one certificate, made on first start
and kept in the per-user data directory — outside the repository, where git has
nothing to decide about it rather than being asked not to.

**The reason is not eavesdropping in the abstract.** A machine's token decides
what it may push, and it used to cross the network in clear twice over: baked
into the script header that the installer fetched with plain `curl`, and sent
again on every reconnect. The first of those happened on every machine ever
built, as the first thing that happened.

**One thing is served unencrypted, on a port of its own: `ca.pem`.** It has to
be. A machine being installed holds nothing — no certificate, no authority,
nothing to check anything against. What it *can* hold is a **fingerprint**,
passed on the installer's command line, which is short and is not a secret. So
the order is: fetch the authority in the clear, check it against that
fingerprint, and only then fetch anything with something at stake in it.

    installer command line ──fingerprint──┐
    http  :7375  /ca.pem  ────────────────┴─> checked, or the install stops
    https :7373  first-boot.sh, git        ──> only after that
    tls   :7374  the channel

**The fingerprint is deliberately not served beside the certificate.** Fetching
both from the same unprotected place verifies nothing — whoever could substitute
one could substitute the other, and the check would pass while being worthless.
It has to arrive by a route that one cannot touch.

**Nothing anywhere turns verification off.** Not `http.sslVerify=false` for git,
not `CERT_NONE` in the agent. Those are the usual way a self-signed certificate
is made to work, and each leaves the thing accepting *any* certificate — no
better than the plaintext it replaced, while looking like it is.

The certificate lasts a year and names this host's addresses in
`subjectAltName`, not just a common name — clients have ignored the common name
for this for years, and a CN-only certificate is the usual reason a self-signed
setup fails with an error that never mentions names. It therefore stops working
in two unrelated ways: it expires, on a known date with a month's warning; or
this host's address moves and it no longer names where guests are told to go,
which has no date and no warning at all. Both are read off the certificate and
reported at startup and in `status`, and `tlsRegenerate` is the way out — never
automatic, because a new authority drops the trust of every machine holding the
old one.


The workspace's repositories, over https
----------------------------------------

A machine clones what it is going to work on from this app, over the same server
it already fetches its scripts from. Node and git, nothing else: git's transport
is a pair of programs — `upload-pack` reads, `receive-pack` writes — and the HTTP
protocol is a thin wrapper around piping them.

    git clone https://<machine>:<its token>@<host>:7373/git/<repo>

Nothing here knows the name of a repository. It serves what it finds in
`../workspace`, and `OKC_REPOS_DIR` moves that — the same arrangement as the
provisioning scripts, read fresh per request, so adding a repository needs
nothing restarted.

**Why http rather than a writable shared folder.** A guest pushing to a mounted
path runs `receive-pack` *itself*, on its own side of the share — so the
repository's hooks execute in the guest, and the guest can rewrite them, because
the mount is writable and they live inside it. Enforcement at that end is a
request rather than a rule. Served over https the pack programs run **here**, in a
directory no guest can reach, and a refusal is a refusal — reported to the guest
as a failed push, which is where the mistake was made.

It also makes a push attributable. Each machine already has its own token; the
same secret it dials in with is what it authenticates a clone with, so this is
`runner1` asking, not whoever could reach the port — which is the same question
`/provision/*` asks, and for the same reason.

**A guest never types a branch name.** It arrives with the right one already
checked out, cut here before it ever sees the repositories — so it cannot pick
one that gets a gentler review than the change deserves, and it cannot reach the
default branch at all. What it may push is decided here and refused here; see
below.


The host is the storage, and nothing lands on master
----------------------------------------------------

The repositories here are where work is kept, audited, and pushed onward from
later. So a machine never works on a default branch, and it is not asked to
remember not to: **the branch is cut here first, and the machine arrives with it
already checked out.** There is no moment at which the obvious thing to do —
commit, push — reaches master.

    pick a branch  ->  cut here where missing  ->  machine clones onto it  ->  open

**One name across every repository.** A change spans repositories — the fix in
one, the test that pins it in another — and matching names are what make those
one unit of work rather than several to be remembered together. So the dialog
asks for a branch, not a folder: which folder is the same answer every time, and
which work is the actual decision.

Cutting a branch touches no other ref and no working tree, so master is never
written to. Existing branches are listed with the repositories they are in, and
picking one carries on with it.

**A machine's copy is never reset to this one.** On a second visit the host's
copy is behind by exactly the commits made in the machine and not yet pushed, so
resetting to it would throw away the work that made the name worth returning to.
An existing local branch is checked out as it stands; uncommitted changes make
git refuse the switch, which is also right — that is somebody's work, and this is
a button rather than a decision to discard it.

**A machine stays on its branch until it is clean, and there is no button to move
it.** That is not tidiness. Switching is how half-finished work stops being
anywhere: the commits would still be on the machine, on a branch it may no longer
push, with nothing saying so — neither finished nor lost, which is the state that
gets discovered weeks later. The only way off a branch is back to a snapshot from
before it, which is an action that states plainly what it discards.

So opening the editor asks which branch **once**. After that, opening again just
opens — closing a window and clicking again is not a decision about which work to
do, and asking would make it one. The refusal lives in the action and not only on
the button, because the button is a courtesy and the action is the boundary.

**What a machine may push follows the disk.** A snapshot records what it was
allowed to push when it was taken, and restoring puts that back. A point from
before any workspace existed has no record, which reads as *nothing* — a machine
rolled back that far must be set up again before it can push. Unknown resolving
to nothing is the direction that is cheap to be wrong in: one click recovers it,
where a stale permission lets a machine put commits on a branch it no longer has.

**The token is not in any remote URL.** It would work, and it would then be in
`git remote -v`, in `.git/config`, and in every error git prints about that
remote — which is where a secret gets copied into a screenshot. Git's own
credential store holds it instead, in one file the machine could already read, and
the remotes stay clean enough to show anybody.


A machine pushes its branch, and nothing else
---------------------------------------------

Work comes back the way it went out. A machine may push **exactly the branch it
was set up on**; master stays readable and is never writable — not by convention,
by refusal:

    remote: refused master: runner1 may only push fix/try-one here.
    remote: nothing was taken. your commits are still here, on your own copy.

**The branch is read from the registry, not from the push.** The machine knows
which branch it is on and is exactly the thing the rule is about, which
disqualifies it as the source. It is recorded when the workspace is set up, and
`null` — a machine that never got one — may push nothing at all.

**Where the rule runs is what makes it one.** `receive-pack` is started here, so
the hook runs here, in a directory no guest can reach. `core.hooksPath` points
git at the app's own hook rather than one inside the repository, so nothing is
written into the repositories being protected — they stay ordinary checkouts that
git, VS Code and a person at a terminal all see identically.

Two more rules are git's own settings rather than hook logic, because git already
does them and a second implementation is only a chance to be wrong: history that
arrived in storage cannot be **rewritten** (`denyNonFastForwards`) or **removed**
(`denyDeletes`) from the far end.

What is deliberately *not* here is rewriting a push in flight. `receive-pack`
hooks can only accept or reject a ref — never rename one — so "push master and it
lands on the right branch" would mean receiving into a per-machine repository and
fetching out of it, which discards the name the pusher chose without telling
anybody. Refusing says the same thing at the moment it can still be acted on.


Then open it in the editor, in the machine
------------------------------------------

The other half of the same click. A machine clones the work from here, and **Open
in VS Code** opens that work *inside the machine*, over VS Code's own remote — so
the files being edited are the ones the machine will build and test, not a copy
on this desktop.

**The address is not configured, discovered or looked up.** The machine dialled
in, so we already know where it is, and one that moved has already said so. That
is why this needs it *connected* rather than merely running: running means
VirtualBox has it powered on, which says nothing about there being an address.
The folder is asked of the machine rather than assumed, because a home directory
is `/home/<user>` on most machines and not on all, and the cost of guessing is a
window that opens the wrong folder without saying so.

One folder, not a generated multi-root workspace. VS Code finds every `.git`
inside a folder and shows each repository's own status, so opening the tree that
holds the clones gives all of them with nothing to generate — and the editor
never has to know what the work spans.

**This is the surface where a button most easily does nothing at all**, so three
things here were measured rather than assumed, each having produced exactly that:

* **`code` is often not on PATH, and Insiders is a different binary.** Looking
  only for `code` finds nothing on a machine with a working editor installed.
  Both names are looked for, where they actually install.
* **Node refuses to spawn a `.cmd`** — `EINVAL`, thrown *synchronously*, before
  any callback or `error` event, so error handling written the ordinary way never
  runs. It goes through `cmd.exe` instead. Not `shell: true`: the editor installs
  to a path with spaces and the shell splits it.
* **Spawning is not opening.** `cmd.exe` starts perfectly well and only then
  reports that what it was asked to run does not exist — so resolving on spawn
  reports success for a button that did nothing.


A command line, over a socket with no address
---------------------------------------------

    node tools/okc.js                                 every action, listed
    node tools/okc.js vmList
    node tools/okc.js vmWorkspace --name runner1 --branch fix/thing
    node tools/okc.js gitBranches --json              for a script
    node tools/okc.js logWatch                        follow the log, live

**One action answers forever instead of once.** An install is twenty-five
minutes of silence and then everything at once, so asking repeatedly either
misses it or spends the whole time asking — `logWatch` keeps the socket and
prints each line as it arrives, from an id you give it or from the beginning.
It is in the actions table like everything else, with `stream` instead of `run`,
because that table is what says an action exists.

**Generated from the actions table, not from a list kept beside it.** `okc` with
no arguments asks the running dashboard what it can do, so an action that exists
is listed and one that does not cannot be — the same reason the window builds its
Actions tab from the same table rather than from a menu somebody maintains.

**Over a local socket, not a port** — a Unix domain socket where there is one, a
named pipe on Windows; node treats both as a path, so it is one implementation.
The point is not speed. The actions used to be on `/api/*`, answering loopback
only — and that was a *check*: a line comparing an address, correct until
somebody edits it, standing between a stranger on the network and actions that
delete disks. A local socket cannot be reached from another machine at all: no
address to get wrong, no interface bound by accident, no rule to keep enforcing.
The strongest version of a check is not needing one, so the route is gone rather
than guarded. On Unix the socket is `0600`, because there its permissions are the
whole of who may drive this.

**It talks to a dashboard that is already running, and says so when there is not
one.** It deliberately cannot start its own: a second copy would have its own
empty registry of dialled-in machines and would report every machine as
disconnected while it sat there connected to the real one — an answer that is
confidently wrong rather than missing. A refusal exits non-zero, so a script
driving this stops when something says no.


One long thing at a time, and it says what it would destroy
-----------------------------------------------------------

Snapshotting shuts a machine down, snapshots it and starts it again. Installing
wipes its disk and drives an installer for half an hour. Restoring throws the
disk away. Each is several VirtualBox commands with the machine unfinished in
between, and a second one arriving in that window is answered by VirtualBox with
a session lock error — a wall of COM text about an interface nobody asked about.

So a second one is **refused here**, where the refusal can name the machine and
what it is in the middle of. Refused rather than queued: waiting would mean a
command that appears to hang for twenty-five minutes, and the honest answer to
*start this machine* while it is being installed is no, not later. **Reads are
never blocked** — asking a machine's state, or what it has on screen, is exactly
what somebody does while something is taking a long time, and a lock that stops
you looking is a lock that gets worked around.

**And the two actions that destroy a disk say what is on it.** *Everything since
is discarded* and *its disks are deleted* are both true and neither says what, so
the machine is asked first — it answers in about a second:

    1 commit that exists nowhere else, 1 file changed and not committed

Three sentences, because there are three situations and only one of them is
"nothing to lose". The third is the one that matters: **a machine that is not
dialled in cannot be asked**, and reporting that as nothing would be an assertion
about a machine that is off — precisely the one nobody has looked at recently. It
says it could not ask. Silence must not be able to mean two different things.


The back door, and why every machine gets an ssh key
---------------------------------------------------

    okc.js vmShell --name runner1
    okc.js vmShell --name runner1 --command 'journalctl -u okc-agent -n 30'

Everything else here reaches a machine **through its agent**, which is precisely
the thing that is broken when you most need to look inside. From this host a
silent agent is indistinguishable from a dead machine, and the difference is
written in the guest's own journal.

**What makes it work is a public key in the machine's `authorized_keys`** — put
there by `first-boot.sh` from whatever the make-a-machine dialog offered.

**The app now has a key of its own**, and that is what it offers first. It lives
beside the certificate, in the app's data directory, and it exists for three
reasons that only matter once:

* A runner runs unattended code written by a model. Putting the key that opens
  everything else the operator can reach *inside* one is a larger statement than
  anybody meant to make.
* A key in somebody's home directory is not the app's to reason about — it
  cannot say when it was made, what else it protects, or whether to rotate it.
* And it disappears: absent on another account, on a rebuilt workstation, or
  anywhere this app runs without that profile loaded.

The operator's own keys are still offered underneath, because deliberately
wanting your own way in is a real thing to want. What changed is the default.

It is installed at build time rather than on request because the moment you need
it is the moment nothing can be arranged. An agent was once found awake,
correctly diagnosing its own lost connection, saying so in its journal — and
stuck. Nothing on this side could have reported that; one `journalctl` did.

**VS Code is why there is an ssh config.** `vmShell` can be told which key to use
with a flag; VS Code Remote runs plain `ssh <target>` and takes everything else
from ssh's own configuration — so a key that is not in a config file is a key it
will never offer, and "open in VS Code" would quietly fall back to whatever
default identity happened to be lying around.

So the app writes one: a `Host okc-<machine>` block per machine, naming its
address, its user, this app's key, and `IdentitiesOnly` so no other is tried.
The operator's `~/.ssh/config` gets a single `Include` line — the only edit this
app ever makes to a file it does not own, and it is idempotent. Both `vmShell`
and `vmEditor` go through the alias, so they reach a machine the same way.

    okc.js sshKey        the key, its fingerprint, and which machines accept it
    okc.js sshConfig     rewrite the config from what the registry knows
    okc.js tlsKey        what the certificate names, when it expires, its authority

The config is rewritten whole rather than appended to: addresses change and
machines are deleted, and a file that only grows accumulates entries pointing at
nothing — which fail slowly and confusingly rather than not existing.

**A machine only accepts the key it was built with.** `sshKey` says which
machines those are, because "the key exists" and "that machine will let it in"
are different questions and only the second one matters when you cannot get in.
Nothing here can change a machine's `authorized_keys` from outside — the only
thing that could is the key being replaced.

**It works when the machine is not dialled in**, which is the entire point. The
address is recorded every time a machine connects, and used long afterwards —
asking the agent where it lives is no use when the agent is the problem. Without
`--command` it is an interactive shell; the command line hands its terminal
straight to `ssh`, because the dashboard has no terminal to give.

A terminal in the window
------------------------

The Terminal tab is a real shell on a machine, and it is a place shells LAND
rather than a place they start. It had a machine picker and an "Open a shell"
button, and they were the last way in this window to end up on a machine with
nothing saying what the work is -- the same hole as the editor and shell buttons
that used to sit on the machines tab.

A terminal is started from a task now, exactly the way VS Code is: take a task,
choose "in a terminal", and a machine is borrowed, rolled back, checked out on
the branch in every repository, handed a credential, and the shell lands here
already in the folder the work is in.

**It does not type `claude` for you.** The point of a terminal is that a person
is at it; typing the command is how they decide what session this is, and a
window that types it for them has taken the one decision the terminal was opened
to make. The old way of working -- boot a machine, open a shell, type `claude` --
is exactly this, with a task around it saying what the work is.

**The pty is at the FAR end.** `ssh -tt` allocates one on the machine, which is
where the shell actually is; this side only moves bytes between a child process
and xterm.js. That matters because a pty on THIS side would mean a compiled
native module matching NW.js own Node ABI, and this app has none of those on
purpose -- so the thing that usually makes a terminal hard simply is not here.

**-tt rather than -t.** Without it ssh notices there is no terminal on this side
and runs without one, which gives a shell with no prompt, no line editing and no
job control -- something that looks like a broken terminal rather than a
deliberate one.

The remote pty is created at ssh idea of our size, which is 80x24 because there
is no terminal here to measure. The real size is sent as `stty rows R cols C`
once the shell is up and again whenever the window changes, which is the only
thing that makes anything full-screen lay out correctly.

It is spawned from the WINDOW rather than through an action, and that is not a
hole in one-surface: the command line half is `vmShell`, doing the same thing
with the same key. What cannot be shared is the terminal itself -- the dashboard
has none to hand over. That is also why `taskWorkOn --open terminal` returns the
folder and stops: it does everything a terminal needs and leaves the one part it
cannot do to whichever side has a terminal. On the command line, that is
`vmShell` handing its own to ssh.

**Several at once, each its own tab**, because a terminal is mostly somewhere you
wait -- for a build, for a sign-in, for an agent to say something -- and needing
a second one while the first is busy is the ordinary case. Each tab owns its own
terminal widget, its own ssh, and its own handlers.

That last part is not tidiness. The first version made ONE widget and reused it,
and `onData` returns a disposable that was never disposed -- so after closing a
shell and opening another, every keystroke was written to stdin once per session
ever opened. It reads as a stuck key rather than as a leak, and nothing here
reported it; a person noticed. A pane whose ssh has exited is struck through and
LEFT IN THE STRIP, because whatever it said before it died is the reason it died.

Whether the worker can authenticate is said here too
----------------------------------------------------

Typing `claude` in a shell on an idle runner gets a sign-in menu, and that is
correct: a credential is handed to a machine per task and taken back afterwards,
so a machine sitting idle is signed OUT by design. It is still a surprise every
single time, and until now the only cure was a command line.

So the Terminal tab says which it is for the shell you are looking at, with the
one button that changes it. It follows the front tab rather than a picker, which
is also the more useful question -- it used to describe a machine somebody was
considering, and now it describes the shell they are sitting in.

**A file on disk is not a signed-in worker.** `vmCredentialsPut` used to report
success for placing bytes, and a credential can be placed perfectly and still be
expired: the file arrives, the wizard flag is set, and the worker answers "OAuth
session expired and could not be refreshed" while every panel says the machine is
signed in. It now asks the worker, in the same remote command, and reports what
the worker says. `ready` is `true`, `false`, or `null` when the question was not
answered -- and "it did not answer" is deliberately not "no".

A `claude` that is ALREADY RUNNING will not notice a credential appearing
underneath it. Start it again.

**A valid token is not a usable worker**, which cost an evening to learn. Claude
Code decides whether to run its first-run wizard from a flag in its config, not
from whether it can authenticate -- so a machine holding a perfectly good
credential still opens on "choose a theme", and then on "Select login method": a
sign-in it does not need and cannot finish there. The two halves of the same
program disagreed out loud, `claude auth status` reporting the right account and
the right plan while the screen asked how to log in, because they read different
files. Handing over a credential now marks the wizard done in the same breath.
The config is merged rather than written over -- it is Claude Code's file and
holds the account and everything cached -- except on a machine just rolled back,
where there is no file and that one key is all of it.

`vmShellRun` -- the back door, used rather than described
---------------------------------------------------------

`vmShell` says how to get in; `vmShellRun` goes in and runs one command.

What it does NOT need is the point. `vmRun` speaks to the agent, and the agent is
exactly what is broken when somebody wants to look inside a machine. It also
cannot hold a long command: the agent answers this host's beats from the same
loop that runs the command, so anything slow makes it look dead and the
connection is dropped out from under the work. That is not a worry, it is what
happened trying to run a single headless prompt -- the machine redialled and the
command was lost.

ssh has neither problem. It is already provisioned, it is how the Terminal tab
and VS Code get in, and it holds its own connection. The command runs under a
LOGIN shell, because that is where a guest's PATH is set and without it `claude`
and `node` are simply not found. A non-zero exit is returned as an answer rather
than raised as a failure -- `grep` finding nothing is exit 1 and is exactly what
was asked.

It is not a shell for a person; that is the Terminal tab, which needs a terminal
this side does not have. This is one command, run to completion, output returned
-- and redacted on the way in like everything else a machine says, because a
command run here can print an environment.

Two spellings of one path, in ssh config
-----------------------------------------

`vmShell` says the way in is `ssh okc-runner2`, and that alias comes from a
config file of this app's own with one `Include` line added to `~/.ssh/config`.

There are two different `ssh` programs on a Windows machine and THEY DO NOT READ
THE SAME STRING. Windows OpenSSH -- the one VS Code Remote runs -- wants
`C:/Users/...`. The `ssh` that ships with git is an MSYS build, and to it that is
a RELATIVE path: it looks for a file called `C:` inside `~/.ssh`, does not find
one, and carries on saying nothing, because a missing include is not an error in
either program. The alias is then simply absent, and the command this tool told
you to type answers "could not resolve hostname" as though the machine were at
fault.

Both lines are written. Each program reads the spelling it understands and
ignores the other -- the same silence that caused the bug, used deliberately.

The machines tab answers what a machine is DOING
-------------------------------------------------

It was the first tab, built when a machine was the whole product, so it answered
"what is this machine". Its details panel was a spec sheet: eight of thirteen
rows -- memory, processors, disk, network, user, installer image, hostname, when
it was made -- cannot change after the machine exists, and they had the widest
panel in the window. The one fact that decides everything, the branch it claims,
was row five and worded as a permission.

Tasks, branches, a terminal and a credential store arrived since, and the
question became "what is this machine doing, and what is in the way". So the
panel leads with what changes: whether it is reachable, whether its DESKTOP is up
(collected on every beat and never once shown), what it is running, what the
QUEUE says about it in the queue own words, what branch it claims, and whether it
is holding a worker credential -- which is what stops a snapshot being taken, and
which survived a host restart on a powered-off machine without this panel
mentioning it.

The spec is still there, one click away under "How it was made". It is what
people copy values out of; it is just not the answer to a question anybody asks
twice.

AND IT LINKS OUT NOW. Branches links into Tasks; this linked nowhere, so getting
from "runner2 is stuck" to the branch it is stuck on meant switching tabs and
picking the same machine out of a second list. The branch, the task it is
running, and a shell on it are all one click from the fact that mentions them.

Snapshots are a tree, and are drawn as one
-------------------------------------------

They were read as a flat list of names, so five taken one after another and five
taken from the SAME moment arrived identical. Those are completely different
situations -- one is a history, the other is five alternatives branching off one
point -- and which it is decides what deleting any of them costs.

The depth was in the data the whole time. VirtualBox writes the path of child
indices into the key itself:

    SnapshotName="post-install"     the root
    SnapshotName-1="setup"          its child
    SnapshotName-1-1="node-setup"   and its child
    SnapshotName-2="..."            a SECOND child of the root

so the parent is the key with its last segment removed. The current one is found
by `CurrentSnapshotNode`, which names the exact key, NOT by matching the name --
VirtualBox allows two snapshots to share a name, and this project has been caught
by that once already.

**When each was taken** is not reported by VBoxManage at all, which left "which
of these is the one from before I broke it" unanswerable. VirtualBox keeps it in
the machine's own `.vbox`, where its GUI reads it from, so that is its record
rather than a guess. Cached on the file's size and modified time, because the
panel redraws every three seconds and the file only changes when a snapshot does.

**Current state, and whether it CHANGED.** VirtualBox marks this in its own
window from an API property its GUI reads and VBoxManage does not report. The
flag is not the only way to know, and this host has better evidence than a flag:
THE MACHINE DIALLED IN AFTER THE SNAPSHOT WAS TAKEN, at a moment recorded here.
It booted and wrote to its disk, and that stays true until the disk is either
thrown away by going back to a snapshot or captured by taking a new one. The
reverse is never claimed -- never having heard from a machine is not evidence
that nothing ran on it, only that nothing reached us.

**Every button is on the thing it acts on**, which took three goes to get right.

    a snapshot        Revert to here         move the machine to this point
                      Delete this snapshot   remove the point; the machine stays
    current state     Take a snapshot of it  capture where it is now
                      Revert to <name>       discard it, back to where it came from

Each names WHERE IT GOES rather than what it destroys. "Throw it away" is
accurate about the current state and says nothing about where the machine ends
up, which is the thing worth knowing before pressing it -- and it is right there
in the tree above.

Nothing is labelled "on this one" any more either. The current state is its own
card hanging off the snapshot it came from, so where the machine is is shown by
POSITION rather than asserted by a label on a different card.

"Take a snapshot" used to sit in the row of things you do to a MACHINE, with its
object -- the current state -- somewhere else on the screen. And the snapshot the
machine was already on offered "go back to it" while the current state below it
offered nothing, which is one operation described from the wrong end: the machine
does not move, the changes since are discarded. So "Revert to here" is not
offered on the snapshot you are already at, because that is the current state's
own act and it lives on the current state's card.

There is ALWAYS a current state, including on a machine with no snapshots at all
-- it is the whole of the machine with nothing recorded behind it, and it is the
only place a first snapshot can be taken from.

A branch is cut on purpose, with a reason and a starting point
---------------------------------------------------------------

Branches used to be born as a SIDE EFFECT. Setting a machine's workspace up cut
whatever name the task happened to carry, in every repository -- so a mistyped
branch did not fail, it made a branch, and the workspace was built on a name
nobody meant. Every branch in the workspace arrived that way, which is exactly
why not one of them could say what it was for.

`drill/cable-pull` is the monument to it: pointing at the same commit as `master`
in both repositories, left behind by a drill about the NETWORK that never
committed anything, and indistinguishable on a list from a branch somebody cut
deliberately and abandoned. Telling those two apart matters right before deleting
one.

So `branchCreate` is the only way a branch is made, it takes a reason, and it
refuses without one. The reason is recorded once, when the branch is first cut,
and is never overwritten -- a branch reused for a second task keeps the reason it
was made for, because that is what reusing a name means. Deleting the branch
takes the note with it, or a branch cut again under the same name later would
inherit an account of something else.

**Setting a machine up now refuses a branch that does not exist**, and refuses it
BEFORE asking whether the machine is running -- a name that is not there is a
mistake whether or not anything is switched on, and the answer used to be five
minutes away and arrive as though the machine were the problem.

Branches with no reason are shown as having none rather than hidden. That is the
honest state of most of the board, and it is the state that made one of them
impossible to account for.

**And it is cut from a named baseline group, which is required.** `git branch x`
cuts from HEAD -- whatever was last checked out here -- so a review left on
another branch used to silently decide where the next task started. Cutting from
each repository's own baseline fixed that and left a quieter version of it: three
settings, decided at some earlier time, that nobody is looking at while typing a
branch name. A group is one branch per repository named together, so "what is
this work against" has one answer; choosing one is the act of putting work ON a
line rather than near it.

Required, not defaulted, for the same reason the reason is required. A workspace
with no named lines has not yet decided what its work is measured against, and
cutting in it produces branches whose "3 commits ahead" means nothing in
particular -- so with none named, `branchCreate` refuses and the dialog offers
the Baselines tab instead of a field that cannot be filled.

Choosing a group here does NOT move any baseline. That is `baselineGroupUse`, and
it is a different and larger act; making the safe one and the sweeping one the
same click is how a chain gets re-aimed by somebody who meant to cut a branch.

What it was cut from is recorded with the branch -- the group's name and the
branch per repository -- because git stops being able to answer it once those
branches move on. A merge base answers "where do these diverge now", which is a
different question and stops agreeing with this one as soon as the baseline
advances.

Naming a line is where its branches are chosen
-----------------------------------------------

The Baselines pane had a "Per repository" column: one card per repository with
its baseline, each clickable to change that repository on its own. Naming a group
then snapshotted whatever those happened to be -- so making a line meant setting
three things one at a time and afterwards giving the result a name.

Those three settings were the problem the group requirement exists to solve. They
were edited individually, nothing described them together, and what a branch got
cut from depended on all of them being right at once while nobody was looking at
any of them.

So the choice moved into the name-a-line dialog, where it is one decision with
one name on it: a select per repository, defaulted to what it counts from now, so
the ordinary case is still "name what is already true" -- read rather than
assumed. **A repository can be left out**, which is not an omission but the way a
line says it never reached that repository, and it is what scopes every task cut
from the group.

What each repository counts from is still shown, once, above the groups. It is
what every "commits ahead" on the board is measured against, so it is worth
reading; it is not worth being able to change one at a time.

`repoBaseline` remains an action. On a command line it is a deliberate single
step, and `baselineGroupUse` is built out of it -- what went away is the window
offering it as a row of controls.

The group is also the SCOPE
----------------------------

A group naming two of three repositories is not an incomplete group. It is a
line of work that never reached the third, and the third has no business being
part of the task. So the group a branch was cut from is the list of repositories
that branch exists in, is checked out in, is measured across, and is judged on.

    a group naming 2 of 3   ->  the branch is cut in 2
                            ->  the machine checks out 2
                            ->  the artifact has 2 rows
                            ->  the git server serves 2, to that machine

Every checkout on a machine is something a worker can read, change and push, so
handing over all of them for a change concerning two is a wider grant than
anybody asked for -- and the extra ones are exactly the ones nobody reviews
afterwards, because nobody expected the work to touch them.

**Enforced at the git server, not only at the checkout.** Being a machine this
app made used to be the whole of the authorization: any token reached any
repository, for reading as well as writing. Limiting what gets checked out is a
decision about convenience while nothing stops a worker cloning the rest itself,
and a limit that only holds while nobody tries is not a limit. A machine asking
for a repository outside its branch's scope is refused in git's own words:

    remote: refused: local-repo-c is not part of the work you were given.
    remote: "task/two-of-three" is about local-repo-a, local-repo-b.

Read from the branch on every request rather than recorded against the machine,
for the same reason the protected-branch check is: a recorded permission is not
evidence, it is a copy of a decision that may have changed since.

`missing` is asked of the repositories a branch is ABOUT. Against the whole
workspace, a correctly scoped branch would report the third as missing -- which
reads as damage, and is acted on, since setting a machine up refuses a branch
with anything missing. A correctly scoped branch would have been permanently
unusable, and the fix on offer would have been to extend it into a repository the
work has nothing to do with.

Branches cut before any of this have no group and reach everything, which is what
they were made as. That fallback is not a default anybody chooses -- cutting
requires a group -- it is how the branches already on the board keep meaning what
they meant.

The Branches tab
----------------

A branch is the unit of work here. It is what a task delivers, what a machine is
set up on, and what a verdict is about -- and THREE PLACES KNEW THAT AND NONE OF
THEM MET. The repositories know a name exists, the board knows a task claimed
one, the registry knows one is checked out on a machine. So a branch belonging to
a task that was thrown away looked exactly like one somebody cut by hand, and the
difference is the whole of what deleting it costs.

Each one gets a single word for what it IS:

    protected   a default branch. Nothing is built on it and nothing deletes it.
    in use      a machine is set up on it right now.
    claimed     a task named it. The task is where the verdict happens.
    orphaned    it carries work and nothing claims it. This is the one that is
                hard to reconstruct by hand, and the reason the tab exists.
    spare       nothing claims it and nothing is on it. A name and no more --
                usually a drill outliving its drill. Safe to sweep.

The number that decides everything else is how far ahead of the default it is.
Nothing ahead means the name is all there is; anything ahead means the work
exists here and nowhere else.

**It costs no git commands.** What is on each branch comes from the artifact
cache, which is keyed on where every ref actually is, so forty branches cost the
same two processes as one. That is not tidiness -- reading branches per-draw is
precisely what once put 94% of the window in `spawn`.

**Deleting is the only way work made here is ever unmade**, so the refusals
matter more than the action. A protected branch is refused outright. One a
machine is set up on is refused, because deleting it pulls the checkout out from
under a running job. One carrying commits no default branch has is refused unless
forced -- and when it is forced, the report names the commit each repository was
left at, because a branch is a pointer and deleting one does not delete what it
pointed at.

NOTHING MERGES, still. That is a separate joint with its own rules and it is not
here; this tab lets you see and remove, not land.

Seeing a machine that is not talking yet
----------------------------------------

An install says nothing for twenty-five minutes. There is no agent to ask and no
log line to read, so *still working* and *stopped at a prompt nobody is watching*
look exactly alike. **See its screen** — `vmScreenshot` — is the only thing that
tells them apart, and before it existed the only way to look was to open
VirtualBox by hand, which is the reaching-around this app exists to remove.

The picture is **kept**, not shown and dropped: written into the data directory
beside the certificate, and its path goes into the live log, because a file
nobody can find may as well not have been written.

The action returns that path rather than the image. Both callers are on the same
machine as the file, so a terminal gets what it actually wants and the window
reads the file itself, instead of a megabyte of base64 being carried to a caller
that would only write it back out.


Signing a worker in, once, for all of them
------------------------------------------

A machine that is going to do work needs a worker signed in on it, and signing
in is a browser flow — which a machine being driven from here does not have.

So the machine runs the sign-in and **this host relays it**. `vmAuthBegin`
starts it and returns the URL; the Keys tab makes that URL clickable and opens
it in the real browser with `nw.Shell.openExternal`; the page gives a code, and
`vmAuthCode` hands it back. The sign-in stays alive across all of that, which is
the part that took work: it is held open on a pty, its pid recorded, and the
terminal escapes stripped out of everything read back from it.

Doing that once per machine would be a browser flow per machine. Instead it is
done **once**, and the result is moved:

    vmCredentialsGrab   --name runner2      take it, and keep it here
    vmCredentialsPut    --name runner1      hand it to another machine
    vmCredentialsForget --name runner1      take it away again
    credentialsHeld                         whether one is held, and from where

Kept on this host **sealed with DPAPI**, so having the file is not enough: the
key is derived from the logged-in account by the operating system and there is
no key of ours stored next to it. That protects against the realistic threat —
the file being read *somewhere else*, in a backup, a sync folder or a support
bundle — and not against something already running as you, which nothing on a
single-user desktop can. `credentialsHeld` reports `sealed` so the difference is
legible rather than assumed.

On the machine it is a plain file, and that is structural rather than an
oversight: Claude Code reads it itself, as the user the worker runs as. So the
defence is around it, in three places:

* **Redacted at the boundary.** Transcripts and run output are pulled here and
  *kept*, so a token that reaches a worker's output — an env dump, a stack
  trace, a stray `cat` — is not a moment of exposure but a permanent filing.
  It is cleaned on the way in, which is the only place it can be stopped.
* **A machine holding one cannot be snapshotted.** A snapshot would keep a copy
  for as long as the snapshot exists, outliving the task, the machine, and any
  decision to revoke it. Both snapshot actions refuse, reading the fact from the
  registry rather than from the machine — a snapshot is taken while the machine
  is off, which is exactly when it cannot be asked.
* **Nothing is passed with a task.** Dispatch carries no credential at all. An
  environment assignment on the command that starts a run is inherited by the
  worker and printable by it.


Giving a machine work, and watching it do it
--------------------------------------------

    vmDispatch --name runner1 --task "..." [--folder ...] [--contract ...] [--resume ...]

**Fire and forget, on purpose.** It returns a run id as soon as the work has
started, not when it ends. A task runs for minutes or an hour; waiting for it
would make one command look like a hang, hold the machine against anything else,
and give no progress in the meantime. The run is detached with `nohup setsid`, so
it outlives the connection that asked for it — the channel is how it was asked,
not what holds it up.

The worker runs with `--dangerously-skip-permissions`, which is the point rather
than a shortcut: one that stops to ask cannot run unattended, and asking is what
nobody is there for. It is defensible **here and nowhere else**, because of what
this machine cannot do — it cannot reach these actions at all, may push one
branch and no other, cannot touch the default branch, cannot rewrite or delete
what it pushed, and is thrown away when the work is done.

Each run keeps a record on the machine in `~/.okc-runs/<id>/`: the task as
written, the script that ran, its pid, its output, and its exit status. Kept
rather than streamed and dropped, because "what actually ran" has no other
source — a claim in a transcript is the worker's account of itself, and the two
diverge.

    vmRuns      --name runner1              every run, newest first
    vmRunOutput --name runner1 --run <id>   the tail of one run's raw output

A run is `finished` with an exit code, `running` with a live process, or
**`lost`** — no result, and nothing left to produce one. Three states rather than
two because a missing status used to mean running, full stop, which is only true
while something is alive to write one.

Progress is **read**, as a delta:

    vmSessions    --name runner1
    vmSessionTail --name runner1 --session <id> --since <bookmark>

`vmSessionTail` returns a `bookmark`, which is a line number in the worker's
transcript; pass it back as `--since` and each report covers only what is new. A
watcher that re-reads from the top spends its whole budget re-deriving what it
already reported. It is strictly read-only, and it reports what is worth
attention rather than everything: a read of a file is not news, a tool result is
tens of kilobytes, and only the lines carrying a verdict come across.

    vmHolds --name runner1

What a machine has that this host does not: commits not pushed, files not
committed, per repository. Nothing has landed until it is here.


Two managers, and one point where they meet
-------------------------------------------

The tool has two halves and the split is its shape. **Virtual machines** is one:
make one, install it, snapshot it, throw it away. **Tasks** is the other: what is
to be done, who is doing it, and what came back.

They meet at exactly one point — a task is **given** to a machine — and nothing
else crosses. A machine knows nothing about tasks; a task knows the name of the
machine it went to and nothing else about it. That is what lets a machine be
destroyed mid-task without the task going with it, and it is the correction of a
previous version where the work loop could not be used without a VM at all.

### The artifact is a branch

A task delivers a **branch**, and that branch is what gets read — the way a pull
request is read.

    okc.js taskCreate --task '{"title":"...","branch":"fix/the-thing","brief":"...","contract":"..."}'
    okc.js taskGive     --id <task> --name runner1
    okc.js taskArtifact --id <task>
    okc.js taskDiff     --id <task> --repo <repo>
    okc.js taskJudge    --id <task> --verdict accept --note "..."

`taskGive` does both halves through the actions that already own their rules — it
sets the machine's workspace up on the task's branch, then dispatches the brief
under the task's contract. The branch claim, the protected default, the refusal
to move a machine off its branch and the contract being read from this host are
each enforced in one place, and this is a caller like any other.

**Delivered is not a state anybody sets.** It is read from the repositories here:
a branch with commits on top of the default has delivered, and a worker that
exited cleanly having pushed nothing has produced nothing to judge. The run's
exit code says the program ended, not that work exists. Every reading is against
the object database with an explicit `--git-dir` — nothing is checked out, because
checking a branch out to review it would move HEAD in a repository that is being
served, and would make the review branch look like the default one.

Two things are reported separately that are easy to collapse into "no changes":
a branch that was **never pushed** to a repository, and one that is **there and
empty**. Only the first is a worker that failed to deliver.

### The queue, and why a runner's natural state is off

    okc.js taskQueue --id 3        put it in the queue; no machine is named
    okc.js queueState              what is waiting, what is running, who could take work

**Work waits for a machine; a machine does not wait for work.** A queued task
names no machine — the first one that is free takes it — so which machine did
the work is a fact recorded afterwards rather than a decision made in advance.
That is what makes a second runner useful without anybody rebalancing anything.

A machine is switched on because there is something to do, brought to a known
state, given exactly one task, and switched off again. Between tasks nothing is
running, nothing holds a credential, and nothing goes stale.

    queued  ->  rolled back to base  ->  started  ->  dialled in
            ->  credential  ->  workspace on its branch  ->  dispatched
            ->  run ends  ->  log kept here  ->  credential taken back
            ->  shut down  ->  rolled back  ->  free again

**Rolled back at both ends, for two different reasons.** Before, because a
machine cleaned only afterwards is clean only if the last thing that touched it
finished properly — and the interesting failures are exactly the ones that did
not. After, because a machine that has finished a task still *claims* that
task's branch, and a claimed branch means not free. Without the second rollback
the queue deadlocks after exactly one task per machine.

**A machine with no base snapshot is never free.** There is nowhere clean to
bring it back to, so it is left alone and says so.

`done` means the run **ended** — not that it worked, and not that anybody has
looked. Whether anything arrived is read from the branch and stays a separate
question: a task can be done having delivered nothing, which is what a worker
refused by the push hook looks like.

**Every step goes through the actions**, so every refusal still applies. A
scheduler with its own private path to the machines would be a second set of
rules, and the second set is always the one that turns out to be wrong.

If the dashboard is restarted mid-task, the queue **adopts** what was in flight:
it waits on the run if it is still alive, keeps the log, and puts the machine
away either way. It does not try to resume the worker — it is either still going
or already gone, and neither can be re-entered from here.

A task that was being **set up** and never started goes back in the queue. That
is the honest answer from a process that has just lost its memory, and it is not
the end of it: **the machine says what it still has.** When a machine's workspace
is set up it is told which task it is for, in `$HOME/.okc-task`, and when it
dials in it is asked. A machine that is still up, still on that branch, and still
holding a queued task is put back on it; anything else — a task since given to
somebody else, a branch that has moved, a machine that was rolled back — is left
alone and said out loud.

The note is a **claim, not an instruction**. It carries four fields, all
identity, and it is checked against the board before anything moves: the worst a
lying guest achieves is being handed work that was already going to a machine.
It also has the right lifetime for free — rolling a machine back to its snapshot
destroys the workspace and the note together, which is exactly when the claim
stops being true.

### Pre-defined work, and who is allowed to approve it

The other half of the write-a-task dialog. **Writing** a task is authoring work;
**picking** a pre-defined one is choosing from work that was decided in advance.

The loop it exists for: the operator asks the supervising model to write a
definition, the model writes it, **the operator reads it and approves it**, and
only then can it be run — including by the model that wrote it.

    okc.js planned                  what is registered, and what is approved
    okc.js plannedRun --name "..."  run one, reporting per test as it goes

Definitions are declared the way tests are, with `describe`/`it`, ported from
[test-moniker](https://github.com/bm-ok/test-moniker). Registration is separate
from execution, so they can be listed without being run — opening a dialog is
not consent — and progress arrives through callbacks rather than being printed,
which is what puts each test's status into the live log as it happens.

Three things make the approval real rather than decorative:

* **An approval is of a definition, not of a name.** It is recorded against a
  fingerprint of the function that will run, and **lapses the moment that source
  changes**. Otherwise the way around it is quiet and obvious: get something
  modest approved, then edit what it does. "Never approved" and "approved, then
  changed" are reported separately, because one is waiting to be read and the
  other is a change waiting to be read.
* **Approving happens in the window and nowhere else.** `plannedApprove` refuses
  over the local socket, because that socket is what a supervising session
  drives. It is a boundary rather than a proof — anyone at this keyboard can open
  the window — and the person at the keyboard is exactly who approval is for.
  What it stops is approval becoming a step inside an automated run.
* **Nothing unapproved runs, whoever asks.** Checked in the action, not only on
  the button.

That is the supervisor's own rule applied one level up. A supervisor sends a bad
document back rather than fixing it, because **the supervisor's own edits are the
one path nothing reviews** — and a definition it wrote and approved itself would
be that path, reopened.

`assert.refuses` is the addition to the ported harness, and it is there because
half of what this project must prove passes by being **stopped**. It matches the
refusal's message as well as the fact of it: a refusal for the wrong reason is
not a pass.

### Stopping, and sending back

    okc.js taskStop     --id 3        kill the worker; the machine is put away as usual
    okc.js taskSendBack --id 3        a rejected task goes round again

**Stopping kills the run and nothing else.** The queue is already waiting on
that run: it sees it end, keeps the log, takes the credential back and puts the
machine away exactly as it would for one that finished. Unwinding the task here
as well would be a second place that ends a task, and the two would drift. The
run reads `lost` afterwards — no result, and nothing left to produce one, which
is precisely what a stopped run is.

**A rejection has to be answerable.** Sending back appends the reason to the
brief, dated, keeps the previous verdict, and re-queues on the **same branch** —
which still carries the first attempt, so the next machine continues rather than
starting again. Without it the only way to act on a rejection was to open the
work and fix it yourself, which is exactly what the rule forbids: *the
supervisor's own edits are the one path nothing reviews*. A rule whose only
compliant option does not exist is not enforced, it is ignored.

### Judging does not merge

`taskJudge` records what a person decided and nothing else. Landing work is a
separate act with its own rules, and a verdict that quietly merged would make
reading the work and publishing it the same button. A rejection must say why —
the note is what a worker is given, and a rejection with no reason is sent to
something that cannot ask what was wrong.

A verdict on an empty branch is refused rather than warned about: a judgement of
nothing is indistinguishable afterwards from a judgement of something.


Looking at the window itself
----------------------------

    okc.js windowShot --view <tab> [--pick <row>]   returns when the file is written
    okc.js windowShot --when loading                the placeholder, not the answer
    okc.js windowSlow --ms 4000                     hold a loading state, to judge it
    Ctrl+Shift+D                                    markup AND a picture, together

The window is the one part of this that cannot be checked from a terminal, and
for a long time it was not checked at all. NW.js can photograph its own page, and
the window loads this app in its own process — so it hands back a function that
photographs on demand, and `windowShot` returns when the file is on disk. Ten
tabs can be swept in sixteen seconds.

It used to leave a request for the next draw and let two more pass so the panel
had filled, which was half a minute a picture and silently lost one if a second
was asked for inside it. What those draws were buying is kept, said as what it
is: switch to the tab, then the pane, then the row, then let a beat pass. The old
poll remains for the case it was written for — nothing has registered because
there is no window, which is how a headless run and the tests load this file.

**Some of what the window does is shorter than the act of asking about it.** A
loading placeholder lasts a fifth of a second, so a photograph requested from
outside always arrives to find the finished panel — and every skeleton in this
window turned out to have been invisible for exactly that reason, created and
thrown away unseen, for weeks. Two switches answer it, and both are for the same
problem from opposite ends: `--when loading` has the window take the picture
ITSELF at the moment the placeholder is up and before it has read anything, and
`windowSlow` holds that moment for as long as you like so a person can look at
it. The second says so in a banner while it is on, or the next person to open the
dashboard finds it mysteriously slow and goes hunting for a fault that is not
there.

**The markup and the picture answer different questions.** The first says what
the window is made of and can be searched and diffed. Only the second says what
it looks like, and the faults that actually happen here are invisible in the
markup: a class name matching no rule renders as nothing at all and CSS reports
no error, a panel can be drawn off the bottom of a dialog, a badge can be empty
because the field behind it was never filled in. All three have happened.


The window keeps up on its own
------------------------------

Two things keep it honest, because neither is enough alone.

The **log** covers anything this app did, and reacts at once — a machine created or
deleted appears immediately, including when something other than the window did it.

The **poll** covers everything else, and there is plenty of it: a machine finishing
its install and powering itself off logs nothing here, and neither does starting or
stopping one in VirtualBox directly. Every three seconds while something is
running, every twelve when nothing is, and not at all while the window is not being
looked at.

One draw at a time. A draw asks VirtualBox about every machine, so a request
arriving mid-draw is remembered and run once rather than overlapping.

**A draw that changes nothing does nothing.** Each panel keeps a signature of
everything it reads and skips the repaint entirely while that has not moved. This
is not about speed: replacing a node destroys any selection inside it, so a value
polled every three seconds could not be selected long enough to copy, and refilling
the log sent the scrollback to the top. A signature has to name every field its
panel uses, including ones only a click handler reads — miss one and the panel
silently stops updating, which is a worse fault than the flicker it fixes.


The shape
---------

    main.js         NW.js node-main: starts the API for machines to reach
    server.js       serves machines, and fills the one table below; nothing else
    actions/        the table, grouped by what each action is ABOUT. Still one
      table.js      surface -- this is the object they are filled into, empty at
      shared.js     load, which is what lets an action call another across files
      app.js        the window, the log, what this process is
      machines.js   making, starting, snapshotting, borrowing, putting away
      runs.js       work in flight: dispatch, shells, editors, what it holds
      credentials.js  signing a worker in, handing it out, taking it back
      host.js       this computer's keys, and the machines it can reach
      branches.js   the work, the lines, what is waiting to go in
      tasks.js      the board, and judging what came back
      repos.js      the repositories, GitHub, and a change once it has left
      workspaces.js which folder of repositories all of this is about
    ui/             the window: an app page, loaded from disk. One file per tab,
      load.js       listed here, in an order that is load-bearing
      nwjs.js       what this window can ask of the computer it is on --
      browser.js    and, in the other file, what a page cannot
    core/log.js     one tagged live log that everything writes into
    core/ipc.js     the same actions, over a local socket, for the terminal
    core/keys.js    the certificate this host serves with, and its authority
    core/data.js    where anything produced by running goes -- outside the repo
    core/secret.js  sealing what is worth keeping, and redacting what comes back
    core/ssh.js     the key this app gets back into a machine with, and the
                    ssh config that makes VS Code use it
    tasks/
      store.js      what is to be done, who has it, and what was decided
      queue.js      work waits for a machine; a machine does not wait for work
      artifact.js   what came back: a branch, read the way a PR is read
      archive.js    a run's log, kept here, where the machine cannot take it
      harness.js    describe/it, ported from test-moniker
      planned.js    the drills, declared rather than written out in prose
      approval.js   a model writes a definition; a person approves it
    tools/okc.js    the command line, generated from the actions table
    vendors/ace/    the editor, checked in. Code that is READ needs to look
                    like code, or it gets approved without being read
    machines/
      vbox.js       VirtualBox: state, snapshots, isos, bridges, delete
      busy.js       one long operation at a time, per machine
      auth.js       holding a browser sign-in open on a machine, on a pty
      dispatch.js   giving a machine a task, and letting go of it
      session.js    reading a worker's transcript back, as a delta
      vms.js        the registry of machines THIS APP MADE
      provisioner.js  make one, and install an operating system on it
      scripts.js    serves provision/*.sh with a header of values
      store.js      other machines, reachable over ssh
      provision.js  setup steps run on such a machine
      editor.js     open a folder in VS Code, here or over ssh
    repos/
      serve.js      the workspace's repositories, over git's smart http
      branches.js   one branch name across every repository, cut here
      workspace.js  the script that lays a machine's workspace out
      hooks/        what a push is allowed to be. Runs HERE, not in a guest
    provision/      the swappable scripts above
    tools/nw.js     finds the NW.js binary and launches the app


An app page, not a web page
--------------------------

The window is opened from disk by NW.js as an **app page**, which is what makes
NW.js behave normally: the page has node, so it requires this app and calls the
same actions the API exposes — no fetch, no origin, no port, nothing to
reconnect — and the SDK build gives it its own right-click Inspect.

Serving the page over http instead makes it a *remote* page, and remote pages get
neither. That is worth knowing because it looks like the tidier arrangement and
costs both: the symptom is a window with no developer menu, and the temptation is
to hand-write one rather than to notice why it is missing.

**The HTTP server is only the API.** It hosts no page at all — `/` says so. Its one
client is a machine being provisioned, fetching its scripts and reporting progress,
which is the only thing here that ever needed a socket.

**No `chromium-args`.** The previous version passed `--disable-features=nw2`, which
selects the older window implementation — and under it NW.js's own `nw.Window` shim
throws `getRoutingID is not a function` on every page load and native `confirm()`
silently returns false. Nothing here needs the flag, so it is gone and both of
those went with it. If something ever does need it, expect that error back.

Dialogs are still in-page overlays, but for their own reason rather than that one:
each carries what the action does in plain words, what it costs when that cannot be
undone, and sometimes fields. A native `confirm()` holds none of that.


Honest gaps
-----------

Machines have been built end to end and checked ON the machine afterwards rather
than from the log — Ubuntu 26.04 and 24.04, most recently one built from nothing
over TLS: pinned the authority against a fingerprint, fetched everything
encrypted, ran all four provisioning scripts, rebooted and dialled in as the
ordinary user. What follows is what is still not proven.

* **Only Ubuntu desktop images have been used.** `VBoxManage unattended install`
  drives the installer, and an image it does not understand will not install
  unattended however correct everything here is. A server image has never been tried.
* **The source-build fallback in a project script has never run.** Where a tool came
  from the distribution on both images, the path that builds one from source was
  never taken, so it is untested.
* **Nothing has run for long.** Machines have been created, provisioned, used and
  deleted within an hour. Nothing here has been left running for days, and the
  reconnect logic has only been exercised by restarting the app and rebooting a
  machine, not by a network that goes away for a long time.
* **A worker has never been left to work for an hour.** Dispatched workers HAVE
  pushed — #1 and #10 delivered commits from runner2 and runner1 — but every run
  that has produced anything took minutes. Nothing here has been tested against a
  worker that thinks for a long time, fills a transcript, and has to be watched
  while it does.
* **Nothing has been judged by anything but a person.** `taskJudge` records a
  verdict and the Judge tab in `ROADMAP.md` is not built. Every accept and reject
  on the board was typed by hand.
* **A job's artifacts are only findable through a task.** A job run on its own is
  filed under its run id, and no pane shows those — only `taskFiles` reads them,
  and only for a task.
* **The credential's clock has been wrong once, in the direction that matters.**
  `credentialsHeld` said the refresh token was valid until September and the
  worker answered "OAuth session expired and could not be refreshed". Nothing
  marks a held credential as suspect after a run fails that way, so the Keys tab
  goes on saying it is good until somebody reads a log.
