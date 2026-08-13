What the design projected, and what this does not do yet
========================================================

A reading of `legacy/PLAN.md`, `legacy/ROADMAP.md` and `legacy/EXPLAINER.md`
against what is actually built here.

Those documents are worth mining and are not a specification to implement. They
describe a tool for ONE ecosystem — firmware fixes, an emulator, a hardware key
on a USB port — and much of their shape is that ecosystem wearing a tool's
clothes. This dashboard found a more general spine, and `npm test` keeps it
there: **branches are where work lives, tasks are what produce it, a supervisor
drives.** Everything below is measured against that spine, not against the
documents.

So each item is one of three things:

    GAP        the projected shape is general, this spine needs it, it is missing
    BAGGAGE    it belongs to one ecosystem. Named so nobody imports it, with the
               general form beside it where there is one
    AHEAD      the projection was worse than what got built, and why


The gaps, in the order they matter to the spine
------------------------------------------------

### 1. A task cannot be paused, because nothing keeps the session

PLAN treats this as load-bearing rather than convenient: *"runners are scarce and
tasks compete for them. Two runners cannot carry five tasks unless a task can be
parked."* Resume needs three things paired — the session id, the credential, and
the session's own **folder** — and it is explicit that the folder is taken whole,
because *"identifying the minimal sufficient set is a guess that fails quietly
later."*

What is here: `--resume <id>` is plumbed end to end, from `vmDispatch` through to
`claude --resume`. Nothing captures a session, `task.session` is declared and
never written, and the queue rolls every machine back to `base` before it starts.
So the flag names a session the tool itself deleted a moment earlier. It looks
supported and is a trap.

Why it matters to the spine rather than in general: the task is meant to be the
durable identity and the machine a resource it borrows. Today a task is bound to
one uninterrupted run on one machine — the moment that machine is rolled back,
the task can only start again from nothing. **A branch survives; how it was
reached does not.** That is also the answer to PLAN's own test, *if everything
stopped right now, what would be lost?*

The operator's case for it is sharper than the docs': several tasks on one
branch, wanting the same session so context is not re-read every time.

### 2. Work that has not reached a branch is invisible until something is about to destroy it

PLAN's six states of a commit, of which *"the first row is the one that
matters"*: uncommitted in the runner, visible to **nobody**. It notes the hub
could ask, and that *"nothing asks yet."*

Here, something does ask: `vmHolds` runs on the guest and reports uncommitted and
unpushed work per repository. But it is only ever called by things about to
destroy something — deleting a machine, restoring a snapshot, releasing a branch.
Nothing shows it while work is happening.

That is a strange shape for a tab called Branches: the one state a branch view
cannot see is work that has not become a commit, and the tool can see it and does
not look.

### 3. The live log is tagged by where a line came from, not by why anyone would filter

PLAN is explicit, and warns against exactly what got built: *"The tempting
taxonomy is by source — run id, VM, component — because that is what the code
already has. But the question actually asked of a live console is 'is anything
waiting on me, or broken', and the answer drowns."* Its taxonomy is `needs-human`,
`verdict`, `lifecycle`, `output`, `api`, tagged **at emit**, never by parsing
text afterwards.

The tags in use are `server`, `window`, `channel`, `ipc`, `queue`, `vm`, `guest`,
`task`, `git`, `capture`, `provision` — every one of them a source. The Live tab
builds its filters from whatever tags exist, so the mechanism is there and the
taxonomy is the missing half.

For a supervisor whose value is *"proportional to how much it declines to say"*,
"is anything waiting on me" is currently answered by reading.

### 4. Nothing checks what a worker claims

Two projected pieces, both absent:

* a **worker-authored change note** — what was wrong, the mechanism, the fix, the
  evidence, what was deliberately not touched
* an **independent adversarial pass** that reads the diff, the note AND the
  surrounding source, because *"a plausible-and-wrong note is worse than none,
  optimized to reassure"*. ROADMAP promotes this early rather than deferring it.

The supervisor skill carries the discipline — verify, do not relay — as
instructions to a session. The tool provides no artifact to verify and nothing
that verifies. A verdict today is a person reading a diff, which is exactly the
thing that does not scale past watching one run at a time.

### 5. A run record cannot say what it ran against

PLAN wants a run record naming *"the steps, their exit codes, the captured output
and the commits the work was done at"*, and is clear about why: it is the third
leg of async review, *"without it a verifier is left checking a claim about a test
against another claim about a test."*

`archive.keep` records task, run, machine, state, exit and when it was kept, plus
the output. **Not the commits.** So evidence exists and cannot be tied to the code
it is evidence about.

### 6. Nothing proposes work

EXPLAINER's *"I ask for a list of tasks… I read it. I pick one"* — the machine
proposes, the human disposes. Every piece around it exists; nothing generates the
list. Already in `TODO.md` as the second joint.

The general form of the two guards is worth keeping when it is built: proposals
carry **provenance** (which matters because an agent-authored proposal steering
an agent worker is the case to watch), and a proposal is pickable only once
something it carries **has been run** — the ecosystem's version of that is "the
repro reproduces", the general version is "a proposal is not a narrative".

### 7. A task does not record who wrote it

Provenance exists in exactly one place: `_overTheWire`, used to refuse approvals
from a supervising session. Nothing records whether a task was written by a
person or by a model, which is the same question one layer up. Cheap to add and
much harder to reconstruct later.

### 8. Nothing merges

Deliberate, already in `TODO.md`, and the reason is written down: a verdict is a
person's decision and landing work is a separate act. Named here only so the list
is complete.


Ecosystem baggage — named so it is not imported
------------------------------------------------

**The seven-step chain** (ROADMAP 1b): base snapshot, source in the runner, UDC
up, GUI session real, firmware builds to a `.hex`, the hex reaches a real key, the
suite runs against hardware. Steps 1, 2 and 4 are general and are built. The rest
is one device. The general form is already here and better: what a machine is
*for* lives in swappable provisioning scripts, and `npm test` refuses code that
knows a project's name.

**The gate, and `gate/repos.json`.** Merging is general; a repository list naming
firmware repos is not. PLAN's own warning applies to whoever builds it here — *"a
rule kept only in a document loses to a default in a config file, every time."*

**"Rank by suspicion"**: *a branch touching more than the test plus one firmware
file, and any diff that modifies an existing test.* Those thresholds are one
ecosystem's. The general shape is worth taking whole: **the review surface should
open with what warrants attention, above the diff, and what counts as a signal is
configuration rather than code.** This dashboard already has the right home for
that — the per-task contract, which is a file the operator writes and the tool
only carries.

**Hardware assignment as a MOVE, not an attach.** Real, general to VirtualBox,
and irrelevant until something here passes a USB device through. Worth reading
again at that point rather than now.

**"The workspace must not be the subject of the proof."** A rule about a tool that
lived inside the ecosystem it worked on. This one is generic by construction and
has no ecosystem, so the rule does not bind — and its stronger form, enforced by
a test rather than remembered, is already in place.


Where this is ahead of what was projected
------------------------------------------

Worth recording, because the documents read as authoritative and are not.

* **The task is the durable identity.** PLAN diagnoses the legacy build as having
  it backwards — *"runs belong to VMs… the durable identity is the task and the
  machine is a resource it borrows, which is the reverse of how the dashboard is
  built today."* Here it is the right way round already.
* **One registry, one spelling.** Legacy described a repository in two files
  keyed differently and needed an alias table to bridge them. There is one here.
* **Artifacts that are not commits.** PLAN states flatly that only git and the
  session survive a machine, and treats a built binary as *"a constraint on what
  a task may rely on"*. A run can now hand a file over before its machine is
  rolled back, which removes the constraint rather than documenting it.
* **The contract is a per-task input, not code.** The ecosystem's discipline —
  minimal, direct, strict — is a file this tool carries and never interprets.
  That is the generic form of EXPLAINER's *"built into how the worker starts, not
  something I paste in"*.
* **Enforcement is at the guest, not in prose.** A worker may push one branch and
  no other, refused by a hook on this host, proven against a real machine.


The two questions worth keeping
--------------------------------

PLAN offers two tests for any new state, and both still earn their place:

**If everything stopped right now, what would be lost?** Today: an in-flight
run's uncommitted work, and the session that produced it. Both are gap 1 and gap
2, which is a good sign that those two are the real ones.

**What does a later SUCCESSFUL operation overwrite?** Stopping is not the only way
a record is lost. Attempts append, verdicts append, run logs and artifacts refuse
to overwrite. A task's state transitions do not — a task that went queued → given
→ done → rejected → given keeps only the last, and its history is reconstructable
only from the live log, which is in memory and bounded.
