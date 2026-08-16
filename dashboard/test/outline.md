<!-- generated: node dashboard/test/outline.js --write -->
<!-- 7 suites, 17 tests, 69 checks -->
## 00 — the order
  # 00.00 — a cut comes first
    01. a task cannot be written on a branch that does not exist yet
    02. a cut is made, on a line
    03. and now the task can be written on it
  # 00.01 — a draft can change
    01. a cut to work on, and a contract to be held to
    02. a task written on it is a draft, and a draft can be rewritten
    03. and it carries a COPY of the rules, not a pointer to them
  # 00.02 — a cut becomes a line
    01. a cut is made
    02. while it is a cut, it is not protected
    03. promoting it to a line protects it
    04. and a line is not deleted like an ordinary branch
  # 00.03 — a change goes out and comes back
    01. a cut is made, and a change is committed on it
    02. what the cut carries can be read, on the cut
    03. a cut becomes a line before it leaves
    04. and now it can be compared with the line it was cut from
    05. and it leaves as one pull request, from the repository that carries something
    06. the pull requests are merged as one act
    07. the fork is behind its parent, and syncing pulls it up
    08. and this host follows, with the change on its default branch
    09. and the branch it came from is taken off the fork
    10. and nothing is left behind here
## 01 — the guards
  # 01.00 — a task cannot be written wrong
    01. a task with nowhere to deliver is refused
    02. a cut to write the rest of these against
    03. a contract that is not there is refused
  # 01.01 — a verdict is about something
    01. an empty cut, and a task delivering on it
    02. a verdict on a branch with nothing on it is refused
    03. a rejection with no reason is refused
  # 01.02 — a machine is not asked to lose work
    01. a machine holding a credential cannot be snapshotted
    02. a signed-out machine is not given work
  # 01.03 — one machine per branch
    01. a machine is not moved off the branch it is on
    02. a branch already claimed is not handed to a second machine
## 02 — the refusals
  # 02.00 — approving is refused over the wire
    01. a job cannot be approved down the pipe
    02. a prompt cannot be approved down the pipe
    03. a contract cannot be approved down the pipe
  # 02.01 — a branch is not named by accident
    01. setting a machine up on a branch that does not exist is refused
    02. a cut must start from a line or a cut, and not both
    03. a cut must say what it is for
  # 02.02 — a task carries what it was given
    01. a task under a contract that is not approved is refused
    02. a task cannot name a job that does not exist
    03. what a task was asked cannot change once it is out
  # 02.03 — a machine is not asked the impossible
    01. a machine that is not dialled in cannot be given a workspace
    02. a branch nobody has is not a branch to sync
## 03 — the machines
  # 03.00 — a machine at rest
    01. every machine this app made is known to it
    02. a machine that is not running claims no branch
    03. and holds no credential it was lent
    04. and at least one is free for the queue to use
  # 03.01 — a machine comes up and goes away
    01. two branches to work on, and a machine to work on one
    02. it is borrowed, and it dials in
    03. and it answers
    04. it is set up on the branch, and claims it
    05. and it is not moved off the branch it is on
    06. and a second machine, dialled in, is not handed the same branch
    07. and it goes away clean
## 04 — provisioning
  # 04.00 — a change reaches a machine
    01. the app serves the script that is on disk
    02. and the header it promises is on the front of it
    03. and the change made to it is in there
    04. and a live machine fetching it gets the same thing
## 05 — building a machine
  # 05.00 — from an iso to a machine that answers
    01. there is an ISO to install from, and this was asked for
    02. a machine is defined, and it is only defined
    03. the install runs unattended, and the machine dials in
    04. and it is a machine this app can use
    05. and it can be thrown away completely
## 06 — a task on a machine
  # 06.00 — a task goes out and comes back
    01. there is a machine free, a job to run, and this was asked for
    02. a cut is made, and a task is written on it
    03. and queued — after which nothing here touches it
    04. the queue gives it to a machine, on its own
    05. the work runs there and the task ends
    06. and what it did came back here
    07. and the machine was put away clean
    08. and judging it is refused, because this worker pushed nothing
