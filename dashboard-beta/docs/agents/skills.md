# Skills

A skill is the document a machine is handed that says what it is: the
supervisor's, the worker's, the judge's. Three files, served to machines
from this host's provisioning door.

## Where each copy is

| copy | where | who writes it |
|---|---|---|
| shipped default | `src/app/vms/provision/scripts/*-skill.md` | the developer, in git |
| the served copy | the workspace's `provision/` folder in the app's data | a person, by approving |
| the seed | `okc-bootstrap.tar` in the repository | `bootstrapShip` |

The search path is the served copy first, then the workspace, then the
app — so an approved copy shadows the shipped one, and a fresh workspace
starts from the shipped one until something is approved.

## Changing one

- The **supervisor proposes** (`skillPropose --which supervisor --from
  file --why ...`); so can the model at the command line. A proposal waits
  in the inbox and on Supervisor → Skill → Review, as a diff with the
  argument under it.
- A **person approves** (`skillApprove`) or turns it down with a reason
  (`skillReject`); the reason is said into the conversation, which is all
  the next proposal has to go on.
- `skillSave` rewrites the served copy directly — refused while the window
  has unsaved edits in it, because a save from elsewhere would quietly
  overwrite them (`skillHolding`).

Every version a person put a name to is kept: `skillVersions`,
`skillVersion --at`, `skillHistory` (when, by how much, and the argument).

## What the supervisor's says

The playbook for an issue, what each verb means, what it may never do,
that it is helping somebody else's project, and the shape of a good
message to the person. Read it: `skills --which supervisor`. It is written
to be argued with — `skillReading` is on its own list precisely so it can
say what is wrong with its instructions.

## After approving

The tar is behind until `bootstrapShip` — see
[Refresh the bootstrap tar](../howto/refresh-the-bootstrap-tar.md).
