# Approve a skill change

A skill is the document that says what a supervisor, worker or judge is.
The supervisor may propose a change to its own; nothing is served from a
proposal until a person approves it.

## Where it shows

- **Inbox** — *a skill change is proposed*, with the argument made for it
  and the size change (`42,192 → 42,425 characters`).
- **Supervisor → Skill → Review** — the proposal beside what is served, as
  a diff.

## Steps

1. Open Supervisor → Skill. Pick the skill, then **Review**.
2. Read the diff. The argument for the change is under it — that sentence
   is the half being approved.
3. **Approve it** (purple) or **Turn it down** with a reason. The reason is
   said into the conversation; it is all the next proposal has to go on.

Approved, the new text is served from the supervisor's next waking. The
version is kept: `skillVersions --which supervisor` lists every one a
person put a name to.

## From the command line

Proposing is open — it is how the model at the command line contributes:

    node tools/okc.js skillPropose --which supervisor --from ./file.md --why "..."
    node tools/okc.js skillAsked --which supervisor      still waiting?
    node tools/okc.js skillHistory --which supervisor

Approving is not: `skillApprove` is the window's. Editing the served copy
directly (`skillSave`) is refused while the window has unsaved edits in it.

## Afterwards

The tar a fresh workspace starts from does not follow approvals by itself —
run [Refresh the bootstrap tar](refresh-the-bootstrap-tar.md).
