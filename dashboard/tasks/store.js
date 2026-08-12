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

const STATE = process.env.OKC_STATE || path.join(__dirname, '..', 'state')
const FILE = path.join(STATE, 'tasks.json')

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

// TWO IDENTITIES, and they are for different readers.
//
// `number` counts from 1 and never repeats, and it is what a person says out
// loud: "what happened to 3". Short enough to type, ordered, and it says how
// many pieces of work there have been, which a name cannot.
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
    if (t.number && t.uid) return t
    changed = true
    return { ...t, number: t.number || ++next, uid: t.uid || t.id }
  })
  if (changed) { try { write(done) } catch { /* readable either way; only not kept */ } }
  return done
}

// Tolerant in the same way and for the same reasons as the machine registry: a
// byte-order mark, or one entry saved as an object rather than a list. Neither
// should empty the board and make it look as though no work was ever written
// down.
function read () {
  if (!fs.existsSync(FILE)) return []
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^﻿/, ''))
    return withIds(Array.isArray(data) ? data : [data])
  } catch (e) {
    log.on('task').bad(`${FILE} could not be read (${e.message}). Fix or delete it; no task is listed until then.`)
    return []
  }
}

const write = list => {
  fs.mkdirSync(STATE, { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2))
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
    // Counted from the highest ever used rather than from the length, so
    // throwing task 2 away does not hand its number to the next one written.
    // Two different pieces of work sharing a number is exactly what a number is
    // for preventing.
    number: Math.max(0, ...existing.map(t => Number(t.number) || 0)) + 1,
    uid: uid(),
    title,
    brief,
    branch,
    // A path on THIS host. Read at dispatch and carried with the run, so the
    // rules that governed a run sit beside it -- and so editing this file later
    // cannot change what a finished run was told.
    contract: input.contract ? String(input.contract) : null,
    folder: input.folder ? String(input.folder) : null,
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

module.exports = { read, write, get, add, update, remove, newId, FILE, STORED }
