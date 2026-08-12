dashboard
=========

Make a virtual machine, install an operating system on it, snapshot it, throw it
away. An NW.js app with no dependencies beyond NW.js itself, no build step and no
framework.

    npm install             once, for NW.js (the SDK build, so devtools exist)
    npm start               the app window
    npm run headless        the API alone, with no window and no UI
    npm test                checks it stayed generic


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
the machine still exists and `vmInstall` will try again without remaking it.

Neither has a button of its own in the window any more: making a machine already
installs on its own, and both remain as actions, listed with everything else in
**All actions**. Removing a button is not the same as removing what it did.

**The server listens on every interface, and that is deliberate.** A guest reaches
this host by its network address; loopback would be useless to it. So the two
halves are split by what they can do: `/provision/*` answers anyone, because all a
guest can do is read its own scripts and report progress, while `/api/*` — which
can delete a machine — answers **this machine only** and returns 403 to anything
else.


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
and in what order. That is deliberate after a wrapper script caused a real bug: the
installer downloaded the wrapper to `/root/okc-first-boot.sh` and a stage derived
that same path, so bash — which reads a script by byte offset — carried on inside
the new content, re-ran part of it and silently skipped everything after. One
bootstrap file, and stages go to `/root/okc-stages/`.

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
and the log survives it. Newline-delimited JSON over plain TCP: no dependency, and
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


The workspace's repositories, over http
---------------------------------------

A machine clones what it is going to work on from this app, over the same server
it already fetches its scripts from. Node and git, nothing else: git's transport
is a pair of programs — `upload-pack` reads, `receive-pack` writes — and the HTTP
protocol is a thin wrapper around piping them.

    git clone http://<machine>:<its token>@<host>:7373/git/<repo>

Nothing here knows the name of a repository. It serves what it finds in
`../workspace`, and `OKC_REPOS_DIR` moves that — the same arrangement as the
provisioning scripts, read fresh per request, so adding a repository needs
nothing restarted.

**Why http rather than a writable shared folder.** A guest pushing to a mounted
path runs `receive-pack` *itself*, on its own side of the share — so the
repository's hooks execute in the guest, and the guest can rewrite them, because
the mount is writable and they live inside it. Enforcement at that end is a
request rather than a rule. Served over HTTP the pack programs run **here**, in a
directory no guest can reach, and a refusal is a refusal — reported to the guest
as a failed push, which is where the mistake was made.

It also makes a push attributable. Each machine already has its own token; the
same secret it dials in with is what it authenticates a clone with, so this is
`runner1` asking, not whoever could reach the port. That is why the paths answer
three different questions:

    /provision/*   anyone -- a guest can only read its own scripts and report
    /git/*         a machine this app made, proving it with its own token
    /api/*         this machine only -- these can delete a machine

**Cloning is built; pushing is not, and says so.** A `git-receive-pack` request
is refused with that sentence rather than a 404, which would read as "no such
repository". The shape it is being built towards: a guest pushes `master`,
because that is what a worker naturally does, and the host decides which branch
that becomes — so the worker never types a branch name, and cannot type one that
picks a gentler review than the change deserves.


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
    machines/
      vbox.js       VirtualBox: state, snapshots, isos, bridges, delete
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

Two machines have been built end to end and checked ON the machine afterwards, not
from the log: Ubuntu 26.04 and 24.04. Both installed unattended, ran all four
provisioning scripts, rebooted and dialled in as the ordinary user. What follows is
what is still not proven.

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
* **The window is the only interface.** `npm run headless` serves the API alone, so
  with no window there is no UI at all.


What was learned the hard way
----------------------------

Written down because each cost real time, and each is invisible in the code that
now looks obvious.

* **A script that overwrites the file it is running from.** Bash reads a script by
  byte offset, so the overwritten file carried on at the old offset inside new
  content: part of it ran twice and everything after it silently never ran. Hence
  one bootstrap script, and stages written somewhere else entirely.
* **`sshd -t` needs host keys.** During an install they do not exist yet, so the
  check failed for a reason that had nothing to do with the config being tested —
  and the config was deleted as a result. It passed on one image and failed on
  another purely by timing.
* **`.bashrc` returns immediately when not interactive.** Anything added to it is
  therefore invisible to a command sent to the machine, while looking perfectly
  correct in an interactive shell. This caught both node and `DISPLAY`, separately,
  the second time after the lesson was already written down three files away.
* **A destroyed machine keeps its connection.** A VM killed mid-flight sends no FIN,
  so the socket looks healthy forever — and a new machine of the same name inherited
  it and reported itself provisioned. Silence is not the same as health, so a session
  that says nothing is now treated as gone.
* **Checking the wrong shell proves nothing.** Every check that matters asks a login
  shell, because that is what a dispatched command gets.
* **VirtualBox releases a lock after the command that took it has returned.** Taking
  a snapshot locks the machine, so starting it on the next line lost the race every
  time — and `SessionState` read `Unlocked` 100ms before the start was refused for
  being locked, so asking was not enough either. Waiting and retrying are both
  needed, because they cover different things.
* **An error can name the half that did not matter.** That same failure said the
  restart failed, which was true and harmless: the snapshot it exists to produce had
  already been taken and recorded. What it did not say was why the machine was now
  powered off. A failed operation whose real work succeeded reads as though nothing
  happened, which is the more expensive direction to be wrong in.
