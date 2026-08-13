dashboard
=========

Make a virtual machine, install an operating system on it, snapshot it, throw it
away. An NW.js app with no build step, no framework, and nothing fetched at run
time — what it uses beyond NW.js is checked in under `vendors/`, currently the
Ace editor and nothing else. See `vendors/README.md` for why that is a
directory rather than a dependency.

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
installs on its own, and both remain as actions, listed with everything else in
**All actions**. Removing a button is not the same as removing what it did.

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

The Terminal tab is a real shell on a machine: pick one, open it, type.

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
has none to hand over.

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

    okc.js windowShot          ask it to photograph itself
    Ctrl+Shift+D               markup AND a picture, saved together

The window is the one part of this that cannot be checked from a terminal, and
for a long time it was not checked at all. NW.js can photograph its own page,
so `windowShot` leaves a request and the window answers on its next draw —
which is why it returns a path rather than an image.

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
    server.js       one flat table of actions; the API and nothing else
    ui/             the window: an app page, loaded from disk
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
* **No dispatched worker has pushed anything.** The whole workspace half — the
  branch claim, the hook, the refusal to touch the default branch — is proven
  from this host. A task that produces a commit and pushes it back, which is
  what all of it is for, has not been run.
