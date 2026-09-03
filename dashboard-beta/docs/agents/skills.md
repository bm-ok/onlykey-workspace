# Skills

A skill is the document a machine is handed that says what it is: the
supervisor's, the worker's, the judge's. Three files, served to machines
from this host's provisioning door.

## Where each copy is

| copy | where | who writes it |
|---|---|---|
| what a person approved | the app's own drawer | `skillApprove`, `skillSave` |
| the workspace's | `<workspace>/.okc/provision/*-skill.md` | unpacking a bundle |
| the shipped seed | `provision/*-skill.md` inside `okc-bootstrap.tar` | `bootstrapShip` |

`provision/scripts.js` searches those in that order and the first hit wins, so
an approved copy shadows the workspace's and the workspace's shadows nothing
until a bundle is imported. **A skill is not source.** There is no `*-skill.md`
under `src/` — that folder holds the shell scripts a machine is provisioned
with, and a skill is a provisioning file that arrives in a bundle. Changing one
needs no build.

The approved copy is kept in the app's drawer rather than written back over
whichever file it was read from, because in a checkout that file is under a
build output: an edit made at the window was reverted by the next rebuild, with
nothing said.

A bundle's `provision/` **is** a workspace's `.okc/provision/`, name for name —
so unpacking a bundle is setting a workspace up, and tarring a `.okc` is making
a bundle. That is why the skills live in there rather than in a `skills/` folder
of their own: carried under a second name, they were put somewhere nothing
looked and were never read.

One name is worth knowing before you go looking: the worker's skill is
**`runner-skill.md`**, not `worker-skill.md`.

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
