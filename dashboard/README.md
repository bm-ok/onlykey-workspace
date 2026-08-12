dashboard
=========

Pick a task, work, offer it, review it, accept it. Nothing reaches your main
branch unread.

No dependencies, no build step, no framework.

    node server.js          then open http://127.0.0.1:7373
    node cli.js tasks       the same five actions from a terminal
    npm test                the two tests from CONTRACT.md


What this is
------------

Software that controls how a set of repositories gets changed, reviewed and
merged. It is **generic on purpose** — it ships knowing nothing about any
project, including the one it was built for. What a repo and a workspace are to
it is written down in **[CONTRACT.md](CONTRACT.md)**, which is the document to
read before adding anything.

Point it at your own repos by writing one JSON file. That is the whole
integration:

    {
      "name": "My things",
      "repos": [{ "name": "app", "path": "../../code/app" }],
      "sandbox": { "kind": "local" },
      "tasks": [{ "id": "tidy", "title": "Tidy the readme" }]
    }

Drop it in `ecosystems/`, or keep it anywhere and pass the path.


The shape
---------

    CONTRACT.md     what the core may know. Read this first.

    core/           domain-free, and a test enforces that
      git.js        git, and nothing about any project
      ecosystem.js  loads a pack of data the tool is pointed at
      checks.js     runs what an ecosystem declared; learns only pass or fail
      work.js       the loop, and the only place status lives
      log.js        one tagged live log that everything writes into

    machines/       the machines you have. The loop does not know it exists
      vbox.js       VirtualBox: state, snapshots, isos, bridges, delete
      vms.js        the registry of VMs THIS APP MADE -- a safety boundary
      provisioner.js  make one, and install an operating system on it
      scripts.js    serves provision/*.sh with a header of values
      store.js      other machines, reachable over ssh
      provision.js  setup steps run on a machine, streaming into the log
      editor.js     one click to open the work in VS Code

    provision/      SWAPPABLE shell scripts a new machine runs. Plain files,
                    read fresh on every request, valid on their own
      unattended.sh   fetches and orders the rest; the installer starts here
      first-boot.sh   once: ssh and a key, so the machine is reachable
      toolchain.sh    THE ONE TO SWAP: what the machine is actually for
      normal-boot.sh  every boot: says it is up, safe to run again

    ecosystems/     packs. `local.json` is the two repos in ../workspace
    ui/             the page: the loop, the machines, the live log
    server.js       one flat map of actions, and the page in front of it
    cli.js          the same five loop actions from a terminal
    test/           the tests, runnable rather than asserted


Why it is a rewrite
-------------------

The previous version is in [../legacy/](../legacy/) as reference, not
foundation. Two findings drove the restart, both recorded 2026-08-11:

**It stopped being legible to a person.** In the operator's words: *"the
direction was good, but the outcome will be bad — confusing operation, keeps
driving human out of the loop."* The mechanism was a pattern, not an accident:
friction reported by a human was answered with an artifact only an agent reads.
Couldn't tell whether a button worked → a run record. Couldn't tell which repo a
task was → a field in a JSON manifest. Asked whether pushing was safe → told to
run `git remote -v`. State migrated into agent-shaped places until a person
needed an agent to find out what their own tool had just done.

So: **legibility is load-bearing, not polish**, and the test for any answer to
human friction is *does it put the answer where the person was already looking?*
This is why a review shows the diff itself rather than a link to where the diff
is recorded, and why a refusal names the repos that are missing work instead of
saying the set is not ready.

**It was welded to one project.** Measured rather than felt: 99 mentions in the
old `dashboard/src` and `gate/`, **47 of them in code**, concentrated in 8 files.
The proof was deleting the project folder — nine of ten registered repos dangled,
because the repo list sat inside the tool while tasks and commands had already
moved out. Being *configurable* looks exactly like being *separated*, right up to
the moment the two are pulled apart.

The worst single piece was `role: hardware | emulator | both` — one project's
concept welded into the VM lifecycle, deciding which USB filters a machine got.
It is gone here, and so is the VM: **a guest is just an ssh target.** How you got
that machine — a VM, a spare box, a laptop — is not the core's business, so no
lifecycle, no filters, no roles, and the default path needs no second machine at
all.


What it will not do
-------------------

* **No credentials, anywhere, ever.** Work starts from what is on your disk, so
  nothing needs a network to begin. This is enforced by absence, which is weaker
  than topology — worth knowing the day someone adds a credential for an
  unrelated reason.
* **No merge without a reviewer note.** Under eight characters is refused. The
  friction is the feature: it is what catches the 1am wave-through, and it leaves
  a record in the merge message worth having.
* **No half-landed set.** A task declares the repos it spans and lands on all of
  them or none. One repo is not a set — two is the smallest number that can
  half-land, which is why `../workspace` has two.
* **No state only this can read.** Delete the tool and your repos are ordinary
  git, on ordinary branches.


Machines, virtual machines, provisioning, the editor
----------------------------------------------------

Separate from the loop, and the loop does not know about any of it. Configurable
from the page rather than from a file you have to find.

* **Machines** — add and remove them. `This machine` always exists and cannot be
  removed. Another machine is an address reached over ssh.
* **Virtual machines** — make one, delete one, start and stop it, snapshot it
  under a title you choose, go back to a snapshot. VirtualBox, found even when it
  is not on `PATH`; if it is not installed the page says so and everything else
  still works.

  **Only machines this app made ever appear, and only they can be acted on.** That
  is a safety boundary rather than tidiness: these actions delete disks, so
  membership comes from the app's own registry and never from VirtualBox. On a host
  with three VMs it lists the one it made and refuses the others by name.

* **Provisioning is four shell scripts in `provision/`, meant to be swapped.** The
  installer is told about `unattended.sh` and nothing else; that script decides
  what else to fetch and in what order. A VM's spec can name a different file for
  any stage, so making a different kind of machine is editing a script rather than
  changing this app. They are served with a small header of `OKC_*` values and a
  `say`/`report` helper prepended, and are otherwise passed through unchanged — so
  each one is valid shell on its own and can be run by hand on the machine to
  debug it. A guest's output comes back into the same live log as everything else,
  which is what makes a long install watchable instead of silent.
* **Provisioning** — setup steps you write per machine, run in order, streaming
  into the live log. It stops at the first failure, because a later step almost
  always assumes an earlier one worked.
* **Open in VS Code** — one click. A local folder opens directly; a folder on an
  ssh machine opens through VS Code's own remote. The command is configurable,
  because `code` is often not on `PATH`.

The live log is one tagged stream you narrow, not several you correlate. The
filter chips are built from the tags actually present, so a new tag anywhere shows
up as a filter without being registered anywhere.


Honest gaps
-----------

* **`vmCreate` makes a machine and a disk; it does not install an operating
  system.** Attach an installer image and boot it.
* **Provisioning and the editor are exercised by hand, not by the tests.** The
  tests cover the loop and the two contract bans. Machine actions were verified
  against real VirtualBox on this workstation.
* **Nothing stops two people editing the same branch.** The tool notices a commit
  it did not make and refuses to act, which is detection rather than prevention.
