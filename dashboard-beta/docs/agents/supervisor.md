# The supervisor

A machine, tagged `supervisor`, running Claude with the supervisor sign-in
and one skill: to run the loop without being the person. It sees this host
through **one door** — `POST /supervisor/do`, the supervisor API — and
nothing else: no filesystem, no shell, no git, no other tool. What it may
call is a list with a reason on every line (`supervisorMay`).

## A turn

Woken, it reads `whatsNew` since its bookmark and `triage`, decides, acts,
says one thing to you with `supervisorSays`, and stops. Between turns it
does nothing. See [Waking the supervisor](../workflow/waking-the-supervisor.md).

## What it may do

- read everything on the board: repositories, branches, lines, tasks,
  judgements, pools, drafts, issues, pull requests
- write tasks under approved jobs, cut branches, queue judgements
- make a line, write what a pull request will say, **cut a pull request**,
  refresh one
- draft replies, closes and reviews for a person to release
- propose jobs, prompts, contracts and changes to its own skill — all of
  which wait for a person
- keep its own triage and todo list

## What it may not do

There is no tool for it: merge, delete anything, approve anything, touch a
machine, read a credential, close or edit pull requests, allow a pull
request to be judged, hand itself an issue, release a draft, change a
setting. A supervisor that finds itself planning around one of these is
told in its skill that the plan is wrong.

## Where to watch it

- **Supervisor → Chat** — the conversation, its messages signed with its
  machine name, yellow lines for each waking.
- **Supervisor → Todo** — `T` refs: things it saw and did not act on.
- **Supervisor → Skill** — what it works to; proposals and history.
- **Supervisor → What it may do** — the list, with reasons.
- `events` — every action it asked for, one line each.

## Its skill

`skills --which supervisor` reads it; the shipped default is
`src/app/vms/provision/scripts/supervisor-skill.md`, and the served copy is
the approved one in the workspace's provision folder. It proposes changes
to itself; you approve them. See [Skills](skills.md).
