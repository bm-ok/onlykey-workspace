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
const STORED = new Set(['draft', 'given', 'accepted', 'rejected'])

// Tolerant in the same way and for the same reasons as the machine registry: a
// byte-order mark, or one entry saved as an object rather than a list. Neither
// should empty the board and make it look as though no work was ever written
// down.
function read () {
  if (!fs.existsSync(FILE)) return []
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^﻿/, ''))
    return Array.isArray(data) ? data : [data]
  } catch (e) {
    log.on('task').bad(`${FILE} could not be read (${e.message}). Fix or delete it; no task is listed until then.`)
    return []
  }
}

const write = list => {
  fs.mkdirSync(STATE, { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2))
}

const get = id => {
  const task = read().find(t => t.id === id)
  if (!task) throw new Error(`There is no task called "${id}".`)
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

  const task = {
    id: newId(title),
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
    run: null,
    session: null,
    verdict: null,
    created: new Date().toISOString(),
    updated: new Date().toISOString()
  }
  write([...read(), task])
  log.on('task', task.id).good(`task "${title}" written, delivering on ${branch}`)
  return task
}

function update (id, changes) {
  const list = read()
  const i = list.findIndex(t => t.id === id)
  if (i === -1) throw new Error(`There is no task called "${id}".`)
  if (changes.state && !STORED.has(changes.state)) {
    throw new Error(`"${changes.state}" is not a state a task is put into. Working and delivered are read from the run and the branch, not set.`)
  }
  list[i] = { ...list[i], ...changes, id, updated: new Date().toISOString() }
  write(list)
  return list[i]
}

function remove (id) {
  const list = read()
  const task = list.find(t => t.id === id)
  if (!task) throw new Error(`There is no task called "${id}".`)
  write(list.filter(t => t.id !== id))
  log.on('task', id).good('task removed')
  // Said rather than done. Deleting the branch would destroy the artifact, which
  // is the one thing here nobody can rewrite -- and a task is a note about work,
  // while the work itself is in the repositories.
  return { removed: id, note: `The branch "${task.branch}" is untouched. Removing a task throws away what was asked, not what came back.` }
}

module.exports = { read, write, get, add, update, remove, newId, FILE, STORED }
