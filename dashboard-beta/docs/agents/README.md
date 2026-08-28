# Agents

The three machines that do the thinking, and what each may do:

- **Worker** — takes a task on a branch, does the work, commits and pushes to
  this host. Sees its brief, its job and its contract, and the judge's report
  the task was raised because of.
- **Judge** — reads a change and hands back a report. Never pushes to what it
  reads; its last line (`RECOMMENDATION`, `CLAIM`) is the verdict the host
  parses.
- **Supervisor** — reads the board through the supervisor API and nothing
  else, decides, queues approved jobs, drafts what goes out to GitHub. Woken
  by a person, a tag, a task landing or a judgement finishing.

Each has a skill — the document that says what it is — approved by a person
before it is served. Pages in this suite are about those three and their
skills.
