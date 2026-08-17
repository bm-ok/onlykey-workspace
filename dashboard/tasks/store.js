'use strict'

// Tasks: what is to be done, who is doing it, and what came back.
//
// The unit is deliberately not "a command sent to a machine". A dispatch is one
// thing happening once; a task outlives it -- it is written before any machine
// exists for it, survives that machine being thrown away, and is still there
// afterwards holding the verdict. Runs come and go inside a task.
//
// THE ARTIFACT IS A BRANCH, and that shapes everything here. A task is not
// finished when its worker stops talking; it is finished when something arrived
// on this host that can be read. So `delivered` is not a state anyone sets, it
// is a fact about the repositories -- see artifact.js -- and a task whose worker
// exited cleanly having pushed nothing has produced nothing, which is exactly
// how it reads.
//
// Kept apart from machines/ on purpose. A task knows the NAME of the machine it
// was given to and nothing else about it; a machine knows nothing about tasks at
// all. The previous version welded work to VM lifecycle and could not be used
// without one.

const fs = require('node:fs')
const path = require('node:path')
const log = require('../core/log')

const data = require('../core/data')

// PER WORKSPACE, because a task delivers to a branch in one set of
// repositories. Kept in one place, switching workspace would leave the board
// listing work against branches that do not exist here -- and worse, a task
// could be given to a machine on a branch name that means something else in the
// folder now being served. Read through a function rather than fixed at load,
// so switching takes effect without a restart.
const workspaces = require('../core/workspaces')

const STATE = () => workspaces.stateDir()
// NULL WHEN NO WORKSPACE IS OPEN, and every reader below treats a missing file
// as an empty board -- which is the right answer, and the one `path.join(null)`
// was replacing with a TypeError about an argument nobody passed. Writing is
// stopped at the action instead, where it can say why. See `needs` in server.js.
const FILE = () => { const at = STATE(); return at ? path.join(at, 'tasks.json') : null }

// The highest number ever used, kept OUTSIDE the list of tasks.
//
// Counting from the tasks that exist looked right and was not: remove the
// highest-numbered task and the next one written takes its number back. That
// happened -- #11 was removed, and the next task became #11 -- which quietly
// makes a number ambiguous in exactly the places numbers get used: a commit
// message, a note, somebody saying "what happened to eleven".
//
// A number is meant to be the one identity a person can say out loud, so it has
// to survive the record it was issued against being thrown away. This file is
// the only thing that remembers deleted tasks, which is precisely its job.
const COUNTER = () => { const at = STATE(); return at ? path.join(at, 'tasks-highest.json') : null }

function highest () {
  let kept = 0
  try { kept = Number(JSON.parse(fs.readFileSync(COUNTER(), 'utf8')).highest) || 0 } catch { /* first run */ }
  // Never below what is on the board: the counter can be deleted, and a board
  // that survived it must not start handing out numbers already in use.
  return Math.max(kept, ...read().map(t => Number(t.number) || 0), 0)
}

function claimNumber () {
  const next = highest() + 1
  try {
    fs.mkdirSync(STATE(), { recursive: true })
    fs.writeFileSync(COUNTER(), JSON.stringify({ highest: next, at: new Date().toISOString() }, null, 2))
  } catch { /* the number is still right for this call; it is only not remembered */ }
  return next
}

// The states a task can be in, and the one thing each means.
//
// `working` and `delivered` are DERIVED rather than stored -- a run's outcome
// and a branch's contents are facts elsewhere, and copying them here is how two
// answers to one question start disagreeing. What is stored is what nothing else
// can tell us: what was asked, who it went to, and what a human decided.
// `done` means the run ENDED. Not that it worked, and not that anybody has
// looked at it — it is the difference between a task still in flight and one
// waiting for a verdict. Without it a finished task sits in `given` for ever,
// and the queue picks it up again on every restart, puts its machine away
// again, and reports the same completion as though it had just happened.
const STORED = new Set(['draft', 'queued', 'given', 'done', 'accepted', 'rejected'])

// Who does the work. See `worker` below for why this is a slot rather than the
// boolean it started as.
const WORKERS = ['claude', 'shell', 'person']

// TWO IDENTITIES, and they are for different readers.
//
// `number` counts from 1 and never repeats -- not even after the task that held
// it is deleted, which is what the high-water mark above is for. It is what a
// person says out loud: "what happened to 3". Short enough to type, ordered, and
// it says how many pieces of work there have been, which a name cannot.
//
// `uid` is the durable one. It is what anything STORED points at -- the kept
// logs in particular -- because a title can be edited and a slug derived from it
// would then point somewhere else, silently orphaning everything filed under the
// old one. A number cannot serve for that either: numbers are only unique within
// this file, and this file can be deleted and rebuilt.
//
// The slug stays as `id` because it is what makes a command line readable, and
// all three resolve to the same task.
let counter = 0
const uid = () => {
  // Time-ordered and unique per task without pulling in a dependency for it.
  // Sorting by uid therefore sorts by creation, which makes a directory of kept
  // logs read in the order the work happened.
  counter = (counter + 1) % 0x10000
  return `${Date.now().toString(36)}${counter.toString(36).padStart(3, '0')}${Math.floor(Math.random() * 0x1000).toString(36).padStart(3, '0')}`
}

// Filled in for anything written before these existed, once, on the next read.
//
// A task record that predates a field is not a broken record -- it is a record
// from before, and refusing to read it would throw away the history this file is
// for. The uid of an older task is its slug, which is exactly right: that is
// what its kept logs are already filed under, so migrating does not orphan them.
function withIds (list) {
  let changed = false
  let next = Math.max(0, ...list.map(t => Number(t.number) || 0))
  const done = list.map(t => {
    if (t.number && t.uid && t.worker) return t
    changed = true
    return {
      ...t,
      number: t.number || ++next,
      uid: t.uid || t.id,
      // Who did it, for tasks written before that was a question anybody asked.
      // Derivable rather than unknown: a task with `shell` set was run by a
      // script and everything else was run by a worker, which is exactly what
      // the boolean meant.
      worker: t.worker || (t.shell ? 'shell' : 'claude')
    }
  })
  if (changed) { try { write(done) } catch { /* readable either way; only not kept */ } }
  return done
}

// Tolerant in the same way and for the same reasons as the machine registry: a
// byte-order mark, or one entry saved as an object rather than a list. Neither
// should empty the board and make it look as though no work was ever written
// down.
function read () {
  if (!FILE() || !fs.existsSync(FILE())) return []
  try {
    const data = JSON.parse(fs.readFileSync(FILE(), 'utf8').replace(/^﻿/, ''))
    return withIds(Array.isArray(data) ? data : [data])
  } catch (e) {
    log.on('task').bad(`${FILE()} could not be read (${e.message}). Fix or delete it; no task is listed until then.`)
    return []
  }
}

const write = list => {
  fs.mkdirSync(STATE(), { recursive: true })
  fs.writeFileSync(FILE(), JSON.stringify(list, null, 2))
}

// Any of the three, because a person types the number, a script keeps the uid,
// and the slug is what reads well in a command. Refusing two of them would mean
// remembering which one this particular call wanted.
const get = ref => {
  const want = String(ref == null ? '' : ref).trim()
  const bare = want.replace(/^#/, '')
  const task = read().find(t => t.id === want || t.uid === want || String(t.number) === bare)
  if (!task) throw new Error(`There is no task "${ref}". Ask for the board to see what there is — a number, a uid or a name all work.`)
  return task
}

// Readable and sortable, and typed back by a person rather than pasted. The
// suffix keeps two written in the same second apart without making it a uuid.
const newId = title => {
  const slug = String(title || 'task').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'task'
  const taken = new Set(read().map(t => t.id))
  if (!taken.has(slug)) return slug
  for (let n = 2; ; n++) if (!taken.has(`${slug}-${n}`)) return `${slug}-${n}`
}

function add (input) {
  const title = String(input.title || '').trim()
  if (!title) throw new Error('Give the task a title, so the board is readable at a glance.')
  const brief = String(input.brief || '').trim()
  if (!brief) throw new Error('Say what the work is. The brief is what the worker is actually told.')
  const branch = String(input.branch || '').trim()
  if (!branch) throw new Error('Name the branch this task delivers on. That branch is the artifact, and a task with nowhere to deliver cannot be judged.')

  const existing = read()
  const task = {
    id: newId(title),
    // From the high-water mark, not from the board. Throwing the highest task
    // away must not hand its number back — two pieces of work sharing a number
    // is the one thing a number exists to prevent.
    number: claimNumber(),
    uid: uid(),
    title,
    brief,
    branch,
    // A path on THIS host. Read at dispatch and carried with the run, so the
    // rules that governed a run sit beside it -- and so editing this file later
    // cannot change what a finished run was told.
    //
    // Kept for the command line and for tasks written before there was a
    // library. A task written under a library contract uses the two fields
    // below instead, and taskCreate refuses both at once.
    contract: input.contract ? String(input.contract) : null,

    // THE RULES THEMSELVES, COPIED IN. The spine's rule: every arrow carries a
    // copy rather than a name. A path can be edited afterwards and a library
    // entry can be rewritten, and either would silently change what a finished
    // task appears to have been held to -- which is the one question a task
    // record exists to answer months later.
    //
    // The name is kept beside them only so the board can say which contract this
    // was. Nothing reads it to find the rules; the rules are right here.
    rules: input.rules ? String(input.rules) : null,
    contractId: input.contractId ? String(input.contractId) : null,
    contractName: input.contractName ? String(input.contractName) : null,

    // WHICH PROMPT THE BRIEF CAME FROM. The words are copied into `brief` and
    // that is what the worker gets -- but the tie was thrown away, so a task
    // could not say where its brief came from and the Prompts library could not
    // say what had been written from it. Kept as a name too, for the same reason
    // the contract's is: the library entry may be gone by the time anybody reads
    // this, and the task should still be able to say what it was.
    promptId: input.promptId ? String(input.promptId) : null,
    promptName: input.promptName ? String(input.promptName) : null,

    // WHETHER A WORKER ACTUALLY RAN, as opposed to what this task was written
    // to be done by. `worker` below is the plan and is set before anything has
    // happened; this is set when something has. See the note there.
    usedClaude: false,
    folder: input.folder ? String(input.folder) : null,

    // WHICH JUDGEMENT ESTABLISHED THIS WORK IS REAL, for a task written over the
    // wire. A supervisor cannot see the code, so every task it writes comes from
    // what a judge found — and "why was this done" is then answerable six weeks
    // later by reading that judgement rather than by asking whoever was
    // supervising. Null for a task a person wrote: they had their own reasons
    // and are not asked to file them here.
    becauseOf: input.becauseOf ? String(input.becauseOf) : null,
    becauseOfId: input.becauseOfId ? String(input.becauseOfId) : null,
    // WHO DOES IT. A slot with three implementations, not a special case.
    //
    //   claude   a worker session in the machine, given the brief as a prompt
    //   shell    the brief is a SHELL COMMAND, not a prompt. For work that is
    //            about this machinery rather than about anything a worker would
    //            do: a soak that has to last a stated length of time, a drill
    //            that needs a run to exist. Involving a worker in those makes
    //            the answer depend on whether it felt like taking an hour, and
    //            bills somebody for the privilege
    //   person   somebody works it by hand, in VS Code, in the machine
    //
    // The third one is why this is a slot rather than the boolean it was. Work
    // done by hand used to happen OUTSIDE all of this -- a machine borrowed, an
    // editor opened, and no task, no brief, no attempts, no verdict and no
    // record that any of it happened. The chain is the same either way:
    //
    //     branch <- task <- claude <- supervisor
    //     branch <- task <- person <- supervisor
    //     supervisor = person || claude
    //
    // What differs is one step: how the work is started, and how it is known to
    // be finished. Everything on both sides of that -- the branch, the contract,
    // the artifacts, the verdict -- is identical, and treating the human path as
    // a different kind of thing is what kept it off the board.
    worker: WORKERS.includes(input.worker) ? input.worker : (input.shell ? 'shell' : 'claude'),

    // WHICH JOB IS TO RUN IT, if one is. Optional, and most tasks have none: the
    // queue dispatches a worker with the brief and that is the ordinary path. A
    // job is for when the doing is itself a script.
    //
    // The id rather than the script, for the same reason the brief is a copy and
    // the contract is a path: a task records what it was told to do, and a job
    // that is edited afterwards must not silently rewrite what this task was for.
    job: String(input.job || '').trim() || null,
    // AND ITS NAME, for the same reason the prompt's and the contract's are
    // carried. An id is what the library is keyed by and a name is what it is
    // listed under, so a card showing the id names something nobody can find on
    // the Jobs tab — "api-tour" against a list that says "the whole job API,
    // once each". It is also the only thing that still says which job this was
    // once the library entry is gone.
    jobName: input.jobName ? String(input.jobName) : null,
    // Kept because a great deal reads it, and derived so the two cannot disagree.
    shell: WORKERS.includes(input.worker) ? input.worker === 'shell' : !!input.shell,
    // How long the queue waits before giving up on it, in hours. Six unless the
    // task says otherwise — enough for anything somebody is expecting back
    // today, and not enough for a soak left running overnight, which would
    // otherwise be abandoned at hour six while still working perfectly and have
    // its machine put away underneath it.
    hours: Number(input.hours) > 0 ? Number(input.hours) : null,
    // WHICH MACHINES THIS WILL RUN ON, or none for any of them.
    //
    // A task does not name a machine — the queue decides that, and a task tied
    // to one machine is a task that waits for it while three others sit idle.
    // But it may name a KIND: the machines tagged "test", or the one with the
    // hardware plugged into it. Empty is the ordinary case and means anything
    // free, which is what every task did before this existed.
    //
    // Lower-cased on the way in so "Test" and "test" are the same tag. A tag
    // that depends on how somebody typed it is a tag that silently matches
    // nothing.
    // AND ONE TAG A TASK MAY NOT ASK FOR. A supervisor machine is out of the
    // pool for good — see availability() in tasks/queue.js — so a task asking
    // for one is a task that waits for ever while the board says it is queued.
    // Refused where it is written rather than left to be discovered as silence.
    //
    // THE WORD, NOT THE CONSTANT, and deliberately. `machines/vms.js` exports
    // SUPERVISOR and importing it here would make the task store depend on the
    // machine manager — the two halves of this app meet at one point, where a
    // task is GIVEN to a machine, and this is not that point. A literal that can
    // never change is the cheaper of the two prices.
    tag: (() => {
      const want = String(input.tag || '').trim().toLowerCase() || null
      if (want === 'supervisor') {
        throw new Error('A task cannot ask for a machine tagged "supervisor". Those are out of the pool for good — a supervisor decides what work to give and is never given any — so this task would sit queued for ever waiting for one.')
      }
      return want
    })(),
    state: 'draft',
    machine: null,
    // The LAST run, kept for the things that only care about the latest.
    run: null,
    session: null,
    // Every time this was given out, oldest first.
    //
    // A single `run` field was the first shape and it lost the history the
    // moment a task was given out twice -- which is the ordinary case, not an
    // edge one: a rejection sent back is a second attempt at the same task, and
    // overwriting the first makes the record say the task was done once and
    // cleanly. What actually happened to a piece of work is most of what a
    // reviewer wants, and it is the part nothing else keeps.
    attempts: [],
    verdict: null,
    created: new Date().toISOString(),
    updated: new Date().toISOString()
  }
  write([...existing, task])
  log.on('task', task.id).good(`#${task.number} "${title}" written, delivering on ${branch}`)
  return task
}

function update (ref, changes) {
  // Resolved the same way everywhere, so a number works here exactly as it works
  // for reading. Two lookup rules for one kind of thing is how "no task called
  // 3" starts being an answer somebody has to interpret.
  const found = get(ref)
  const list = read()
  const i = list.findIndex(t => t.uid === found.uid)
  if (changes.state && !STORED.has(changes.state)) {
    throw new Error(`"${changes.state}" is not a state a task is put into. Working and delivered are read from the run and the branch, not set.`)
  }
  // The identities are pinned rather than merged: a caller passing a whole task
  // object back would otherwise be able to renumber it, or hand it another
  // task's uid, and the kept logs would follow.
  list[i] = { ...list[i], ...changes, id: found.id, uid: found.uid, number: found.number, updated: new Date().toISOString() }
  write(list)
  return list[i]
}

function remove (ref) {
  const task = get(ref)
  write(read().filter(t => t.uid !== task.uid))
  log.on('task', task.id).good(`#${task.number} removed`)
  // Said rather than done, and now true of two things. Deleting the branch would
  // destroy the artifact, which is the one thing here nobody can rewrite. The
  // kept logs are left for the same reason: they are the account of what
  // happened, filed under a uid that is not reused, so throwing away the note
  // about the work does not throw away the evidence of it.
  return {
    removed: task.id,
    number: task.number,
    note: `The branch "${task.branch}" and the logs kept for it are untouched. Removing a task throws away what was asked, not what came back.`
  }
}

// WHAT A MACHINE IS TOLD IT IS FOR, and it is a note, not the task.
//
// Written to `$HOME/.okc-task` when a machine's workspace is set up, and read
// back when it dials in — see the hello handler in server.js. Restarting this
// app puts an unstarted task back in the queue, which is right, because a fresh
// process knows nothing about what was in flight; the machine is what brings it
// back, by saying which task it still has.
//
// FOUR FIELDS AND NO MORE. The temptation is to write the task down there so
// nothing has to be looked up, and that is how a guest ends up holding the
// brief, the contract text and whatever else a task grew — on the machine the
// contract is meant to bind. Identity is enough; the task itself is read here.
//
// The branch rides along so the note can be checked rather than believed: a
// machine reverted and set up on something else has a note that no longer
// matches what it is on, and that mismatch is the whole safety of trusting it.
const noteFor = task => ({ id: task.id, number: task.number, uid: task.uid, branch: task.branch })

module.exports = { read, write, get, add, update, remove, newId, highest, noteFor, FILE, COUNTER, STORED, WORKERS }
