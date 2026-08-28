# Branches, lines and cuts

Three words for three things, and the panes are named after them.

## A branch

A git branch, cut **across every repository** at once (`branchCreate`),
from a named line, from another branch, or from each repository's own
default. It carries a **reason** — the app refuses to cut one without — and,
when it was cut for a GitHub issue, the issue as a fact (`issue: {on,
number}`). Both are recorded in the cut note and travel to the pull request.

**Branches Cut** is the board: every branch, who claims it (a machine
working on it), what is on it, and whether it can be deleted. `branchDiff`
shows one repository's changes on it whole; `branchArtifacts` what a task
handed over on it.

## A line

A line is a branch that has been **named as a point work can be measured
against**: one branch per repository, under one name. Work is cut *from* a
line; a change is compared *against* a line; a pull request is cut from one
line *into* another. `branchAsLine` makes one out of a branch;
`lineSave --name X --on {...}` names one from existing branches.

**Branches Lines** lists them with how in step each is with origin. A line
that is *proposed* (`linePropose`) appears on the left of comparisons and
is protected; `lineWithdraw` takes that back. `lineRetire` forgets a line
whose change has landed and, if asked, deletes its branches.

## A cut

A cut is a pull request per repository, opened as **one act** from one line
into another and tracked together as one landing (`prCutMake`). See
[Pull requests and cuts](pull-requests-and-cuts.md).

## Protected

**Protected** lists every branch that may not be built on — default
branches, proposed lines — and whether that could be changed. A task cannot
deliver onto one; the refusal names the rule.

## Compare and Changes

**Changes** compares any two refs across every repository: which commits
one carries that the other does not (`compare`, `compareLog`), and the
diff per repository or per file (`compareDiff`). **Conflicts** lists every
branch that moved on both sides and which files would actually conflict.
