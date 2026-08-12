dashboard
=========

Make a virtual machine, install an operating system on it, snapshot it, throw it
away. An NW.js app with no dependencies beyond NW.js itself, no build step and no
framework.

    npm install             once, for NW.js (the SDK build, so devtools exist)
    npm start               the app window
    npm run headless        the same server with no window
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


Provisioning is four scripts, meant to be swapped
-------------------------------------------------

    provision/
      unattended.sh   the installer is told about this one and nothing else;
                      it decides what else to fetch and in what order
      first-boot.sh   once: an ssh server and a key, so the machine is
                      reachable at all. Deliberately almost empty
      toolchain.sh    THE ONE TO SWAP -- what the machine is for, as opposed
                      to making it exist
      normal-boot.sh  every boot, so it installs nothing and changes nothing

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


The shape
---------

    main.js         NW.js node-main: boots the server in the app's own Node
    server.js       one flat table of actions, and the page in front of it
    ui/             the window. boot.html waits, then loads the real page
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


Why NW.js, and why the API is still an HTTP server
--------------------------------------------------

NW.js hosts the server inside its own Node context, so the app is one process.
`boot.html` waits for it and then navigates, which means the window loads the UI
over http from the same origin a browser would get — one UI, one code path.

The API stays a real HTTP server for one reason: **a machine being installed has to
be able to reach it.** That is where its scripts come from and where its progress
goes. Nothing else needs it to be one.

Dialogs are in-page overlays rather than `<dialog>` or `confirm()`. Under
`--disable-features=nw2` the native ones do not appear and silently return false,
which cancels the action behind them without saying so.


Honest gaps
-----------

* **The unattended install has not been run end to end.** Every part around it is
  exercised; that path is not. Treat it as unproven.
* **A bridged guest cannot reach a server bound to loopback.** Installing one
  needs `HOST=0.0.0.0`, which puts this API on your network — a decision to make
  on purpose, so it is not the default.
* **`toolchain.sh` installs a compiler and little else.** It is a starting point,
  not a recommendation.
