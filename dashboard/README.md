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
      sandbox.js    where work happens: your copies, or an ssh target
      work.js       the loop, and the only place status lives

    ecosystems/     packs. `local.json` is the two repos in ../workspace
    ui/             the page. Plain words, five actions
    server.js       a local page and a handful of calls behind it
    cli.js          the same five actions from a terminal
    test/           the two tests, runnable rather than asserted


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


Honest gaps
-----------

* **The host fetches; it does not receive a push.** The old design argued the
  guest should push, so publishing has a moment attached. Here the guest does
  push — to a bare repo in its own home — and the host fetches from that, because
  a workstation running an ssh server is a bigger ask than one ssh direction. The
  moment is preserved; who initiates the last hop is not.
* **The ssh sandbox is written but not yet exercised end to end.** The `local`
  path is what the tests cover.
* **No agent at the far end.** Deliberately last. The environment is the same
  either way, so that step changes who is typing and nothing else.
