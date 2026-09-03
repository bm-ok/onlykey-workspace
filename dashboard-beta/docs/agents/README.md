# Agents

The three machines that do the thinking, and what each may do:

- [The supervisor](supervisor.md) — reads the board through the supervisor
  API and nothing else, decides, queues approved jobs, drafts what goes out
  to GitHub. Woken by a person, a tag, a task landing or a judgement
  finishing.
- [The judge](judge.md) — reads a change and hands back a report. Never
  pushes to what it reads; it hands back a report saying what it concluded.
- [The worker](worker.md) — takes a task on a branch, does the work,
  commits and pushes to this host.
- [Skills](skills.md) — the document each is handed that says what it is,
  approved by a person before it is served.
