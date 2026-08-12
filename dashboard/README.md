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
the machine still exists and the button to try again is right there.

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

What that buys is the fast path: **Set it up again** re-runs the setup on a live
machine in a minute, where reinstalling to try a change takes half an hour — and
nobody iterates on a half-hour loop. The machine fetches the script fresh, so an
edit made since it was built is included.


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
