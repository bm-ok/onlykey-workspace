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

    make  ->  install  ->  unattended.sh  ->  first-boot.sh
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
      unattended.sh   the installer is told about this one and nothing else;
                      it decides what else to fetch and in what order
      first-boot.sh   once: an ssh server, a key, and the agent -- everything
                      needed to reach the machine at all
      toolchain.sh    THE ONE TO SWAP -- what the machine is for, as opposed
                      to making it exist
      normal-boot.sh  every boot, so it installs nothing and changes nothing
      agent.py        dials the dashboard and stays connected. Python 3
                      because Ubuntu already has it, standard library only

Three of them do the same job every time — make a machine exist and be reachable.
Only `toolchain.sh` is about what kind of machine it is, which is why it is a
separate file rather than a section of another one. A machine's settings can name a
different file for any stage.

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

* **No install has been watched all the way to a login prompt.** The mechanics are
  verified: a machine is created, started, and told where to fetch its scripts; all
  four are served over the real network address as valid shell with the right values
  in them; and a guest's reports and output arrive in the live log. What has not
  been sat through is the twenty-odd minutes in between.
* **The operating system install depends on the image.** `VBoxManage unattended
  install` drives the installer, and an image it does not understand will not
  install unattended however correct everything here is.
* **`toolchain.sh` installs a compiler and little else.** It is a starting point,
  not a recommendation.
