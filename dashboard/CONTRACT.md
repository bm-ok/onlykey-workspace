The generic contract
====================

What the core is allowed to know. This is the document the rewrite exists for:
the last version was configurable, which looked like being separated right up to
the moment the two were pulled apart — nine of ten registered repos dangled and
the list did not go with the thing it described.

So the line is written down first, and it is a short list on purpose. If a
concept is not defined below, the core may not have it.

The dividing question, applied to every addition: **would this exist if the
repos held a recipe collection?** If no, it is ecosystem data, not core code.


A repo
------

**A git working clone on a path, and a branch name to measure it against.**

    { "name": "repo-a", "path": "../../workspace/local-repo-a", "base": "master" }

That is the whole definition. `name` is what a person calls it, `path` is where
it is (resolved relative to the ecosystem file, so a pack can be moved), `base`
is the branch work is cut from and lands on — defaulting to `master`, never
assumed beyond that default.

What a repo is **not**, each one a thing the last version believed:

* **Not a URL.** A repo need not have a remote, and the two repos this is
  developed against have none at all. Cloning is something an ecosystem may
  offer; it is not how a repo comes to exist.
* **Not a role.** There is no `hardware | emulator | both`. That was one
  project's concept welded into the machinery, and every path that branched on it
  inherited the assumption. A repo has no kind.
* **Not owned by the tool.** The core reads and writes branches in your copies.
  It does not manage them, move them, or require them to be arranged its way.
* **Not required to be present.** A path that does not resolve is reported as
  absent, out loud. Silence there is what hid the last seam violation.


A workspace
-----------

**Your local copies. The ones you already have, where you already have them.**

The workspace is not a directory the tool creates, owns, or expects a shape from.
It is wherever your clones live, and it is the source of truth — work starts from
what is on your disk, not from what a server thinks is current.

Consequences worth stating, because each is a thing the core must therefore not
do:

* The core never needs network access to start work.
* The core never needs a credential, for anything, ever.
* Two repos in unrelated directories are as valid as twenty in one tree.
* Deleting the tool leaves your repos exactly as they were, on ordinary branches
  any git can read. There is no state in them that only this can understand.


An ecosystem
------------

**A single JSON file naming repos, tasks, and how to reach the sandbox.** Data
the tool is pointed at, never code inside it. `ecosystems/local.json` is the
worked example and the one the tool is developed against.

    { name, about, repos[], sandbox, tasks[] }

Everything that makes a project *itself* lives here. The tool ships knowing
nothing about any project, including the one it was built for.


A task
------

**An id, a title, the repos it spans, and optionally what must be true
afterward.**

    { "id": "...", "title": "...", "detail": "...", "repos": ["repo-a"], "checks": [] }

`repos` is the set — omit it and the task spans every repo in the ecosystem,
because the common case should not need saying. A task spanning more than one
repo lands as one unit or not at all; one repo half-landing is the failure a set
exists to prevent.


A check
-------

**A name, a shell command, and a sentence saying why it matters.**

    { "name": "The readme is not empty", "run": "test -s readme.md", "why": "..." }

This is the seam that used to be a hardcoded role and a list of USB identities.
The ecosystem says what to run and what it means; **the core learns only pass or
fail.** It does not know what is being checked and must never branch on it.

An ecosystem with nothing to check declares nothing, and the entire concept
disappears rather than needing an answer to a question that does not apply to it.


A sandbox
---------

**Where the work happens. Two kinds, and neither is a virtual machine.**

    { "kind": "local" }
    { "kind": "ssh", "host": "user@box", "dir": "okc" }

`local` works in your own copies on a branch — the branch is the isolation, and
this is the default path, so the tool is usable with no second machine anywhere.

`ssh` works on another machine reached over ssh. **That is all a "guest" is
here.** How you got that machine is not the core's business: a VM, a spare box,
or a laptop on the desk are the same thing to it. VirtualBox is one way to obtain
an ssh address and appears nowhere in the core.

The transport is git over ssh, in one direction only — **the host reaches the
guest, and nothing listens on the host.** The guest publishes by pushing to a
bare repo in its own home, which is a local path with no credentials involved;
the host fetches from that when work is offered. Push stays the act that makes
work visible, without requiring a server on your workstation.


What the core may never contain
-------------------------------

A grep that must come back empty, and the number to beat is the last version's
47 code-level sites in 8 files:

    grep -riE 'onlykey|firmware|emulator|teensy|usb|udc|vbox|virtualbox' core/

Also banned, being the same mistake wearing other clothes: any repo `role` or
`kind`; any hardcoded device identity; any path defaulting into a named project
directory; any list of an ecosystem's own command names held so the tool can
report them unset.


The two tests
-------------

1. **The grep above returns nothing.**
2. **The whole loop runs green against `workspace/` with the `local` sandbox** —
   two repos, one commit each, no remotes, no second machine, no checks that need
   hardware. If the core cannot review and land a change under those conditions,
   it is not generic, and it cannot be exercised at all today, because the
   project it was built for is not in this workspace.

Test 2 is the load-bearing one. It means the default path has no second machine
in it. The last version fused a server, a channel, a VM lifecycle owner and a
task runner into one process, so the VM was unavoidable even when it was
irrelevant.


Vocabulary
----------

The core is allowed these words: **repo, workspace, ecosystem, task, check,
sandbox, branch, work, offer, review, accept, throw away.**

The operator is allowed five: **pick, work, offer, review, accept.** Manifests,
receipts, freshness, evidence and set tracking are how promises get kept, and
none of them should have to be understood to use it. They surface when something
goes wrong, which is the only time they are worth a person's attention.
