Drills
======

Things to run against this tool, and what each one proves. Not unit tests —
`npm test` is that, and it only checks the code stayed generic. These are the
end-to-end exercises that need real machines, and each exists because reading the
code was not enough to know the answer.

**A refusal is a pass.** Half the drills below succeed by being stopped. The
question is never whether a person or a worker *can* drive the flow, it is
whether they can drive it **wrong** — so "it worked" is not evidence, and neither
is "they managed it".

**A guard is not a guard until something has been refused by it.** Twice now a
guard here was written, reviewed, and open: the snapshot refusal whose flag was
never set, and the same refusal still wide open along its second path. Both read
correctly. Both were tested by running them, and only then were they true.

Each drill says what it proves, how to run it, what a pass looks like, and what to
put back afterwards. The date is the last time it actually ran.


Before any of them
------------------

    okc.js vmList --json          state, connected, holdsCredential, per machine
    okc.js tasks --json           the board
    okc.js gitBranches --json     what exists and what is claimed

A machine must be **connected**, not merely running — started is not ready, and
every action that talks to a guest refuses until it has dialled in. It must also
be able to authenticate; dispatch refuses otherwise and says so.

Drills that involve a task leave a branch behind. That is the artifact and it is
the point; clean it up deliberately rather than by habit.


Not yet run
-----------

### 2. A task across both repositories

**Proves a partial delivery reads honestly.** The round trip that has run touched
one repository. Two is the smallest number that can *half*-land — one repository
is trivially "all ready", has no push order, and cannot be partly delivered. The
artifact panel distinguishes a branch that was **never pushed** to a repository
from one that is **there and empty**, and that distinction has never been looked
at with a real partial delivery in front of it.

    brief: change a file in local-repo-a AND a file in local-repo-b, commit both, push both

**A pass** is both repositories reporting commits. **The more interesting run is
the one where only one lands** — do it a second time with a brief that touches
only one repository, and check the other reads `nothing beyond master` rather
than being reported as if it had delivered.

### 3. A rejection, sent back

**Proves the loop goes backwards.** Never done. Everything so far has gone one
way, and a workflow that can only go forwards has to allow the shortcut it exists
to prevent — the supervisor fixing the work itself, which is the one path nothing
reviews.

Reject what a drill delivered, with a real note, then hand that note back to the
same machine on the same branch:

    okc.js taskJudge --id <task> --verdict reject --note "<what is wrong>"
    okc.js vmDispatch --name <machine> --task "<the note, as instructions>" --resume <session>

**A pass** is a second commit arriving on the same branch, the branch claim still
held by the same machine, and the artifact showing both commits.

**Watch the claim.** A second push onto a claimed branch is the case the claim
exists for, and it has to succeed here while failing for a *different* machine.

### 4. Two runners at once

**Proves the one-machine-per-branch claim under real concurrency**, rather than by
reading the code. Give two tasks on two branches to two machines simultaneously,
then try to give a third task on the *first* branch to the second machine.

**A pass** is the two real tasks proceeding independently, and the third being
refused by name — saying which machine already holds that branch.


Passed, and worth re-running after anything structural
------------------------------------------------------

These are regressions now. Each found something the first time it ran.

### 1. A worker tries to push to a protected branch — 2026-08-12

**Proves the enforcement against the thing it is actually for.** The hook, the
branch claim, `receive.denyNonFastForwards` and the protected default had only
ever been exercised from this host, pushing to itself. The subject of every one
of those rules is a *guest*, and until this drill no guest had ever tried.

Set a machine up on some other branch, then tell it to push to the default one.
Name the branch explicitly in the brief — a worker asked vaguely will do the
sensible thing instead and prove nothing.

    okc.js taskCreate --task '{"title":"Push to master","branch":"drill/protected",
      "brief":"In local-repo-a, add a line to readme.md. Then git checkout master, commit on master, and git push origin master. Do not push any other branch. If the push is refused, report exactly what the server said and stop."}'
    okc.js taskGive --id push-to-master --name <machine>

**Pass:** the push is rejected by the pre-receive hook, and the default branch in
every workspace repository is on the same commit as before. Record those commits
*before* the drill; "master looks fine" is not a check.

What it actually said, which is the shape to expect:

    remote: refused master: runner2 may only push drill/protected here.
    remote:
    remote: nothing was taken. your commits are still here, on your own copy.
     ! [remote rejected] master -> master (pre-receive hook declined)

The second line is the part worth keeping. A refusal that reads as data loss
gets worked around by the next person in a hurry.

**And the finding, which is bigger than the drill.** The run reported
`finished` with **exit 0** while the board reported `working — nothing has
arrived on this branch yet`. Both were right: the worker's process ended
normally, having accomplished nothing. That is precisely why `delivered` is read
from the branch and never from the run, and this is the evidence rather than the
argument. `taskJudge` refused the branch for the same reason.

### 5. The round trip — 2026-08-12

Task written, given to a machine, worked under a contract, committed, pushed,
arrived here, read as a diff, judged. **Pass:** `d8b18a2` on
`task/first-round-trip`, one line in `local-repo-a`, accepted.

Re-run after any change to `repos/`, `tasks/`, or dispatch. It is the only drill
that exercises the whole thing at once.

### 6. A contract reaches the worker — 2026-08-12

Dispatch under a contract whose rule is checkable from the outside — the one used
was "begin every file you create with the line `CONTRACT-LOADED`".

**Pass:** the file comes back beginning with that line. It could not have known it
any other way.

**Also check the negative:** dispatch with `--contract` naming a file that is not
there, and with one that is empty. Both are refused by name. A contract that
silently fails to load leaves a worker running with no rules while everything
else reports success.

### 7. A machine holding a credential cannot be snapshotted — 2026-08-12

    okc.js vmBaseSnapshot --name <a machine holding one> --title should-refuse

**Pass:** refused, naming `vmCredentialsForget` as the way out.

**Run it along both paths.** A machine can come to hold a credential by being
*handed* one and by *signing itself in*, and this guard was open along the second
long after it was closed along the first. Test the path you did not just use.

The first time this drill ran it **created the snapshot it exists to prevent**,
because the flag was never set. If it passes without you having watched it refuse
something, you have not run it.

### 8. Dispatch is refused to a signed-out worker — 2026-08-12

    okc.js vmCredentialsForget --name <machine>
    okc.js vmDispatch --name <machine> --task "anything"

**Pass:** refused before anything is set up, naming `vmCredentialsPut`.

Without it the failure is an api error inside a json blob, minutes later, after a
workspace has been laid out — with the real sentence, *Not logged in*, one field
deep in a machine's output.

### 9. A killed run reads as `lost` — 2026-08-12

Dispatch something long, kill its process group on the machine, then read
`vmRuns`.

    P=$(cat $HOME/.okc-runs/<run>/pid); kill -- -$P

**Pass:** `state: lost`, `exit: null`, and the watcher saying it died without a
result rather than inventing one.

**Kill after the watcher's first tick**, or the run finishes first and the drill
proves nothing. That happened twice before it was made deterministic.

### 10. A credential is harvested and restored — 2026-08-12

Sign one machine in, take the credential, hand it to a *different* machine, and
have that machine complete a request.

**Pass:** `claude auth status` reports logged in on the second machine, and a
one-line `claude -p` returns.

**The second machine is the whole drill.** Harvesting alone proves nothing, and
was the only half proven for some time.


Putting things back
-------------------

Drills leave real state, and leaving it is how the next drill starts from
somewhere nobody understands.

* **Branches** are the artifact and outlive their task. `taskRemove` deliberately
  does not touch them. Delete a drill branch in the workspace repositories by
  hand when it has served its purpose.
* **A branch claim** is released by rolling the machine back to a snapshot from
  before it, not by asking. A machine stays on its branch until it is clean.
* **Runs** pile up in `~/.okc-runs` on the machine. `rm -rf` them between drills
  so `vmRuns` says something about this drill rather than about all of them.
* **Credentials** come off with `vmCredentialsForget`, and must, before any
  snapshot.
* **Snapshots taken by a drill** are deleted with `vmSnapshotDelete`. One taken
  while a machine held a credential is not debris, it is a copy of that
  credential, and it outlives the task, the machine and any decision to revoke.
