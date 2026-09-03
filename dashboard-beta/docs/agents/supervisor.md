# The supervisor

A machine, tagged `supervisor`, running Claude with the supervisor sign-in
and one skill: to run the loop without being the person. It sees this host
through **one door** — `POST /supervisor/do`, the supervisor API — and
nothing else: no filesystem, no shell, no git, no other tool. What it may
call is a list with a reason on every line (`supervisorMay`).

## A turn

Woken, it reads `whatsNew` since its bookmark and `memory`, decides, acts,
says one thing to you with `supervisorSays`, and stops. Between turns it
does nothing. See [Waking the supervisor](../workflow/waking-the-supervisor.md).

## Its memory

Between wakings it keeps **one number** — the bookmark — and whatever it wrote
down. Everything else about a turn is gone when the turn ends.

So it has a memory: `memory`, `memorySet`, `memoryForget`, keyed by a name it
looks things up by. Writing the same name again changes that entry rather than
adding a second, so it cannot fill with three versions of one fact and nothing
saying which is current. Two kinds of thing go in it, and both belong:

- **what it is owed** — a judgement it queued, a task it queued, a proposal
  waiting on you. Where the name is a task or a judgement, `memory` looks up
  what has actually happened to it, so "still running" and "the answer is
  sitting there" stop looking the same from its own notes.
- **what is simply true** — how you like your commits, which repository not to
  touch without asking, a hazard worth knowing before commissioning work.

**It may forget.** A memory it could not correct would be a worse one. What is
left of the auditing the old todo list gave you is the record: every write and
every forget is an event under the `memory` tag.

## Teaching it what a project is

A supervisor **cannot read code** — that is the design, not a gap, so everything
it believes about a codebase a judge told it. On a project nobody has
bootstrapped it has been told nothing, and manages the work anyway.

**Settings → Bootstrap → Teach it about this project** is one press. It asks for
a single `investigate-the-codebase` judgement — that prompt surveys every
repository in the workspace, a paragraph each — reads what comes back, and writes
what it learned into its memory. Several wakings, one judge run.

It switches self-waking on if it is off, and says so: without that, nothing wakes
it when the survey lands, so it would commission one and never read the answer.

## What it may do

- read everything on the board: repositories, branches, lines, tasks,
  judgements, pools, drafts, issues, pull requests
- write tasks under approved jobs, cut branches, queue judgements
- make a line, write what a pull request will say, **cut a pull request**,
  refresh one
- draft replies, closes and reviews for a person to release
- propose jobs, prompts, contracts and changes to its own skill — all of
  which wait for a person
- keep its own memory: what it knows about this project, and what it is
  waiting on

## What it may not do

There is no tool for it: merge, delete anything, approve anything, touch a
machine, read a credential, close or edit pull requests, allow a pull
request to be judged, hand itself an issue, release a draft, change a
setting. A supervisor that finds itself planning around one of these is
told in its skill that the plan is wrong.

## Where to watch it

- **Supervisor → Chat** — the conversation, its messages signed with its
  machine name, yellow lines for each waking.
- **Supervisor → Memory** — what it knows, and what the stores say about each
  of those things. Where the two differ, the store is right.
- **Supervisor → Skill** — what it works to; proposals and history.
- **Supervisor → What it may do** — the list, with reasons.
- `events` — every action it asked for, one line each.

## Its skill

`skills --which supervisor` reads it. The shipped default is an entry inside
`okc-bootstrap.tar` — `provision/supervisor-skill.md` — and the served copy is
the approved one at `.okc/provision/supervisor-skill.md` in the open workspace.
There is **no copy in `src/`**; this page said there was, naming a path that has
never existed since the skills became bundle entries.

It proposes changes to itself and you approve them; `bootstrapShip` is what
carries an approved one back into the tar, and the tar goes stale by hand. See
[Skills](skills.md).
