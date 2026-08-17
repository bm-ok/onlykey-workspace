'use strict'

// A job: a script this app runs, given a prompt.
//
//     task <- job <- prompt
//
// A prompt is what a worker is told. A JOB IS CODE -- a Node script that decides
// what to do with that prompt: write a task from it and queue it, run it against
// three repositories in turn, dispatch it and then assert something about what
// came back. The drills that used to live in tasks/planned.js are one kind of
// job, and the reason they were awkward is that they were the only kind there
// was and they were checked into the repository.
//
// A FILE PER JOB, IN THE WORKSPACE'S OWN FOLDER. Not checked into the repository,
// because writing one should not be a code change and a bad one must not be able
// to stop the dashboard booting -- nothing requires these at startup, they are
// read when they are run. Not a string in a JSON record either: it is code, and
// code that is READ has to look like code, which means a file an editor and a
// linter can both open.
//
// APPROVED BY THE BYTES THAT WILL RUN. The hash is of the file's contents, so
// editing it -- here, or in an editor, or by anything else -- lapses the
// approval. That is the whole reason approval is on the FILE rather than on the
// record: a record can say "approved" while the thing beside it has changed, and
// this is the case where that would be a program running unread.
//
// TAGS, because a job is not one kind of thing. A drill, a maintenance job, a
// reading job and a release job want to be found separately, and a list of forty
// with no way to narrow it is the state the ten drills were already in.

const fs = require('node:fs')
const path = require('node:path')
const workspaces = require('../core/workspaces')

const DIR = () => {
  const at = workspaces.stateDir()
  return at ? path.join(at, 'jobs') : null
}
const FILE = () => {
  const at = workspaces.stateDir()
  return at ? path.join(at, 'jobs.json') : null
}
const codePath = id => {
  const at = DIR()
  return at ? path.join(at, `${id}.js`) : null
}

function hash (text) {
  const s = String(text || '')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return `${h.toString(16)}-${s.length}`
}

const read = () => {
  const file = FILE()
  if (!file) return []
  try {
    const kept = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''))
    return Array.isArray(kept) ? kept : []
  } catch { return [] }
}

const write = list => {
  const at = workspaces.stateDir()
  if (!at) return list
  try { fs.mkdirSync(DIR(), { recursive: true }) } catch { /* it exists */ }
  try { fs.writeFileSync(FILE(), JSON.stringify(list, null, 2)) } catch { /* the answer still stands for this call */ }
  return list
}

const codeOf = id => {
  const at = codePath(id)
  if (!at) return ''
  try { return fs.readFileSync(at, 'utf8') } catch { return '' }
}

// Every job, with its code read from disk and compared against what was
// approved. `lapsed` is the state nothing else can report: it reads as approved
// and the bytes are not the bytes anybody read.
const all = () => read().map(j => {
  const code = codeOf(j.id)
  const now = hash(code)
  return {
    ...j,
    code,
    // FILLED AT READ TIME, so every job written before there were two libraries
    // answers the question rather than answering `undefined`. Everything that
    // existed then was written to do work.
    kind: j.kind === 'judge' ? 'judge' : 'task',
    hash: now,
    there: !!code,
    approved: !!(j.approval && j.approval.hash === now),
    lapsed: !!(j.approval && j.approval.hash !== now),
    approvedAt: j.approval ? j.approval.at : null,
    approvedBy: j.approval ? j.approval.by : null
  }
})

const get = id => all().find(j => j.id === id) || null

const idFor = name => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)

// What a new one starts as, so an empty editor is not the first thing somebody
// sees. It names every part of the API in a shape that runs.
const STARTER = `'use strict'

// A job. It runs ON A MACHINE, not on the dashboard's computer, and it is given
// one object -- everything it can do is on that object.
//
//   prompt      the prompt it was run with, or null: { id, name, text }
//   claude(t)   give a worker a brief HERE and wait for it. No argument means
//               the prompt above -- which is the ordinary case
//   log(line)   a line of output, kept with the run and readable afterwards
//   report(s)   how far along it is, while it is still going
//   sh(cmd)     a command in the guest, returning what it printed
//   artifact(f) hand a file back to the dashboard, kept against this run
//   gitUrl(r)   where this machine clones and pushes, credential included
//   assert      ok, equal, refuses -- for a job that checks rather than does
//   workspace   the folder it is actually in
//   configured  the folder it was set up to use, which is not always the same
//   machine     the name of the machine it is running on
//   run         the id of this run
//
// There is no \`okc\` and that is deliberate: a machine cannot reach the
// dashboard's actions, which is what makes it safe to run a script on one.
//
// It is async, and whatever it returns is written to the log when it finishes.
module.exports = async ({ prompt, log, sh, workspace }) => {
  log('running in ' + workspace)

  const repos = sh('ls -1').trim().split('\\n').filter(Boolean)
  log(\`\${repos.length} thing(s) here: \${repos.join(', ')}\`)

  if (prompt) log('the prompt was: ' + prompt.name)

  return { saw: repos.length }
}
`
// Written, or rewritten. The code goes to its own file; everything else to the
// record beside it.
function save (fields, by = 'the window') {
  const name = String(fields.name || '').trim()
  if (!name) throw new Error('Give it a name. A job with no name is one nobody finds again.')

  const list = read()
  const id = fields.id || idFor(name)
  if (!id) throw new Error('That name has no letters or numbers in it.')

  const at = list.findIndex(j => j.id === id)
  const now = new Date().toISOString()

  // Only replaced when something was actually sent, so saving the NAME does not
  // silently blank the script.
  const code = fields.code === undefined
    ? (at === -1 ? STARTER : codeOf(id))
    : String(fields.code)

  try { fs.mkdirSync(DIR(), { recursive: true }) } catch { /* it exists */ }
  fs.writeFileSync(codePath(id), code)

  const next = {
    id,
    name,
    about: String(fields.about || '').trim() || null,
    // A job may name the prompt it is usually run with. It is a default, not a
    // binding: the same job pointed at a different prompt is the point of
    // separating them.
    promptId: String(fields.promptId || '').trim() || null,
    // Left alone when nothing was sent, for the same reason as the code above:
    // a save that means "rename this" must not quietly empty the other fields.
    tags: fields.tags === undefined
      ? (at === -1 ? [] : list[at].tags || [])
      : Array.isArray(fields.tags)
        ? fields.tags.map(t => String(t).trim()).filter(Boolean)
        : String(fields.tags).split(',').map(t => t.trim()).filter(Boolean),
    // WHAT THIS IS FOR: doing work, or judging it.
    //
    // Two libraries in one store. A judging chain is a different question from a
    // working one — "did this follow the rules, is it secure, what bug was
    // missed" against "make this change" — and mixing them means a task can be
    // queued under a judge's rules, or a judge can be run under a worker's, with
    // nothing but a name to tell somebody which they picked.
    //
    // DEFAULTS TO `task`, AND AN EXISTING ONE KEEPS WHAT IT HAD. Everything
    // written before this was written for work, and a save that means "rename
    // this" must not quietly move it to the other library.
    kind: fields.kind === undefined
      ? (at === -1 ? 'task' : list[at].kind || 'task')
      : (String(fields.kind) === 'judge' ? 'judge' : 'task'),
    written: at === -1 ? now : list[at].written,
    edited: at === -1 ? null : now
  }

  // A person writing it at the window has read it by writing it. Anything else
  // starts unapproved, however it got here.
  next.approval = by === 'the window' ? { at: now, by, hash: hash(code) } : null

  if (at === -1) list.push(next)
  else list[at] = next
  write(list)
  return { ...get(id), created: at === -1 }
}

function approve (id, note = null) {
  const list = read()
  const at = list.findIndex(j => j.id === id)
  if (at === -1) throw new Error(`There is no job called "${id}".`)
  list[at] = { ...list[at], approval: { at: new Date().toISOString(), by: 'the window', note: String(note || '').trim() || null, hash: hash(codeOf(id)) } }
  write(list)
  return get(id)
}

function withdraw (id) {
  const list = read()
  const at = list.findIndex(j => j.id === id)
  if (at === -1) throw new Error(`There is no job called "${id}".`)
  list[at] = { ...list[at], approval: null }
  write(list)
  return get(id)
}

function forget (id) {
  const list = read()
  const found = list.find(j => j.id === id)
  if (!found) throw new Error(`There is no job called "${id}".`)
  write(list.filter(j => j.id !== id))
  // The script goes with the record. Leaving it would be a file nothing lists
  // and nothing runs, which is the shape of every stray this app has had.
  try { fs.unlinkSync(codePath(id)) } catch { /* it may never have been written */ }
  return { forgotten: found.id, name: found.name }
}

// Every tag in use, so a list of forty can be narrowed by something real rather
// than by a search box guessing.
const tags = () => {
  const seen = new Map()
  for (const j of read()) for (const t of j.tags || []) seen.set(t, (seen.get(t) || 0) + 1)
  return [...seen.entries()].map(([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag))
}

module.exports = { all, get, save, approve, withdraw, forget, tags, hash, idFor, codePath, DIR, FILE, STARTER }
