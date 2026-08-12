The generic contract
====================

What the core is allowed to know, and what isolation means here. This is the
document to read before adding anything; if a concept is not defined below, the
core may not have it.

The dividing question, applied to every addition: **would this exist if the repos
held a recipe collection?** If no, it is ecosystem data, not core code.


A repo
------

**A git working clone on a path, and the name of the one branch work happens
on.**

    { "name": "repo-a", "path": "../../workspace/local-repo-a", "branch": "master" }

That is the whole definition. `name` is what a person calls it, `path` is where it
is (resolved relative to the ecosystem file, so a pack can be moved), `branch` is
the single branch — defaulting to `master`, never assumed beyond that default.

What a repo is **not**:

* **Not a URL.** A repo need not have a remote, and the repos this is developed
  against have none. Cloning is not how a repo comes to exist.
* **Not a role or a kind.** There is no `hardware | emulator | both`, no device
  identity, no type. A repo has no kind.
* **Not owned by the tool.** The tool commits to your branch and manages your
  index. It does not manage your repos, move them, or require them arranged its
  way.
* **Not required to be present.** A path that does not resolve is reported
  absent, out loud. Silence there is the failure mode where a tool looks healthy
  while pointing at nothing.


A workspace
-----------

**Your local copies. The ones you already have, where you already have them.**

Not a directory the tool creates or expects a shape from. It is the source of
truth: work starts from what is on your disk.

* The tool never needs network access to do anything.
* The tool never needs a credential, for anything, ever.
* Two repos in unrelated directories are as valid as twenty in one tree.
* Delete the tool and your repos are ordinary git on an ordinary branch. There is
  no state inside them that only this can read.


Isolation — what it is, now that there is no branch
---------------------------------------------------

**One branch. The attempt lives in the working tree, and the working tree is not
history.**

There are no `work/<id>` branches, nothing is cut from a base, and nothing is
merged back. That machinery is gone, so the thing it used to provide has to be
provided another way, and it is worth being exact about how — this section is
load-bearing.

**The boundary is `HEAD`, and it is a rule about direction:**

* Everything **at or below `HEAD`** is history. The tool never rewrites it. No
  reset, no revert, no amend, no force-push — not as a fallback, not on failure.
* Everything **above `HEAD`** is the attempt. The tool never commits it without a
  review.

That single rule is what makes the tool's promise survive the loss of the branch:
**nothing reaches your branch unread**, because unreviewed work was never in a
commit in the first place. `accept` is the act that creates the commit. Any design
where the tool checkpoints as it goes would break that promise and would make
throwing an attempt away into a revert — losing both properties at once.

**Consequences, stated rather than hidden:**

* **Throwing away performs no git history operation at all.** It restores the
  tree to `HEAD`. The branch tip does not move, so there is nothing to half-land,
  nothing to force-push, and no permanent noise in the log. This matters more
  once a branch has been pushed anywhere, because then rewriting is off the table
  permanently and a revert would be the only history-level undo.
* **Throwing away still destroys real labour**, so the attempt is written to
  `state/thrown-away/<id>.patch` before the tree is restored, and putting it back
  is one action. Plain files — no refs, no branches, nothing in git's namespace.
* **Nothing the tool did not cause is ever discarded.** An attempt records the
  `HEAD` it started from. If `HEAD` has moved since — you committed by hand, or
  pulled — throwing away refuses instead of restoring over a changed world.
* **`start` refuses unless the tree is clean.** The tree *is* the attempt now, so
  pre-existing uncommitted edits would be absorbed into it and then destroyed.
  This check is load-bearing rather than cosmetic.
* **The tool owns the index.** It stages freely, because the attempt is defined as
  everything above `HEAD` and a partially staged tree would make that ambiguous.
  The index is not history, so this costs nothing that cannot be redone.
* **One attempt at a time, per repo.** A working tree holds exactly one. This is a
  real capability loss compared with branches, not a detail.
* **No isolation from anyone else committing to the same branch.** If the branch
  is shared, their commits can land under you mid-attempt. The tool detects that
  and refuses to act; it cannot prevent it.

**There is no sandbox concept in the loop.** Work happens in your copies. A
remote *worker* would need branches or a transport, which is the machinery this
section exists to say is gone — so if that is ever wanted, it is a new design and
not a flag on this one.

Machines are a separate thing, and the distinction is the whole point of the
earlier failure. `machines/` manages machines you have — add and remove them, run
setup steps on them, start and stop virtual machines, open a folder in an editor.
**The loop does not know it exists.** What was wrong before was not the word
"VM"; it was VM lifecycle welded into the work loop, so the tool could not be used
without one. So `machines/` may say `virtualbox`, and `core/` may not — the
contract test scans `core/` only, and that asymmetry is deliberate rather than an
oversight.


An ecosystem
------------

**A single JSON file naming repos and tasks.** Data the tool is pointed at, never
code inside it. `ecosystems/local.json` is the worked example.

    { name, about, repos[], tasks[] }

Everything that makes a project *itself* lives here. The tool ships knowing
nothing about any project, including the one it was built for. A pack may live
anywhere; the loader takes a name from `ecosystems/` or a path to any file.


A task
------

**An id, a title, the repos it spans, and optionally what must be true
afterward.**

    { "id": "...", "title": "...", "detail": "...", "repos": ["repo-a"], "checks": [] }

Omit `repos` and the task spans every repo in the ecosystem, because the common
case should not need saying.

**A task spanning several repos commits to all of them or to none.** Accepting
runs a pre-flight over every repo first — the recorded `HEAD` still current, real
staged changes present — and commits only once all of them pass. If a commit
still fails partway, the commits already created are rolled back with
`reset --soft`, which is permitted under the `HEAD` rule only because those
commits were created by this same action, seconds earlier, and have not left the
machine. Proving every repo is *ready* is not the same as proving every repo
*will succeed*; the pre-flight is there to prove the second.


A check
-------

**A name, a shell command, and a sentence saying why it matters.**

    { "name": "The readme is not empty", "run": "test -s readme.md", "why": "..." }

The ecosystem says what to run and what it means; **the core learns only pass or
fail.** It does not know what is being checked and must never branch on it. A
check runs in the repo it is about, against the working tree, before a review.

An ecosystem with nothing to check declares nothing, and the concept disappears
rather than needing an answer to a question that does not apply to it.


What the core may never contain
-------------------------------

    grep -riE 'onlykey|firmware|emulator|teensy|usb|udc|vbox|virtualbox|\brole\b' core/

Measured on code, not comments — comments recording *why* couple nothing and are
worth keeping. `test/contract-test.js` enforces this.

Also banned, being the same mistake in other clothes: any repo `role` or `kind`;
any hardcoded device identity; any path defaulting into a named project
directory; any list of an ecosystem's own command names held so the tool can
report them unset.

And banned by the `HEAD` rule: any call to `git reset --hard` on a branch tip the
tool did not just move, `revert`, `commit --amend`, `push --force`, or
`filter-branch`. The one permitted exception is the accept rollback described
above.


The tests
---------

1. **The grep above returns nothing in code.**
2. **The whole loop runs against repos with no remotes and no second machine** —
   pick, work, offer, review, accept. If the core cannot do that, it is not
   generic.
3. **Throwing away does not move `HEAD`, and the attempt is recoverable.** The
   test asserts the branch tip is byte-identical before and after, and that
   putting it back restores the files.
4. **A conflicting or impossible accept moves `HEAD` in no repo at all.** Not
   "fails cleanly" — moves nothing.

Tests 3 and 4 are the load-bearing ones, because they are the properties that
replaced the branch.


Vocabulary
----------

The core is allowed these words: **repo, workspace, ecosystem, task, check,
branch, attempt, work, offer, review, accept, throw away, put back.**

The operator is allowed five: **pick, work, offer, review, accept.** Everything
else is how promises get kept, and none of it should have to be understood to use
it. It surfaces when something goes wrong, which is the only time it is worth a
person's attention.
