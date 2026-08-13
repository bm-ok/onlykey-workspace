'use strict'

// What a run left behind, kept HERE, where the machine cannot take it away.
//
// THE PROBLEM THIS FIXES, which was found the hard way and more than once. A
// run's output and the worker's transcript live in `~/.okc-runs` on the machine
// that did the work -- and a machine is the disposable half of this tool. It
// gets rolled back to a snapshot, or deleted, or rebuilt, and every one of those
// is a normal and correct thing to do. Doing it takes the only account of what
// happened with it.
//
// That was not hypothetical: two rollbacks in one afternoon erased the record of
// two runs whose results had already been reported. What remained was a task
// record saying work was done and nothing at all saying how.
//
// So a finished run is pulled across and kept beside the task, in the data
// directory rather than the repository -- it is produced by running, not by
// writing, and the same reasoning that puts screenshots there puts this there.
// The machine's copy stays where it is; this is a copy, not a move, because
// moving would mean the machine's own record depended on this host being
// reachable at the moment it finished.
//
// REDACTED ON THE WAY IN. This is the boundary the credential rules already name:
// output crossing from a machine is KEPT here, permanently, so a token that
// reached a worker's output is not a moment of exposure but a filing. Cleaned
// here is the only place it can be stopped.

const fs = require('node:fs')
const path = require('node:path')
const data = require('../core/data')
const secret = require('../core/secret')

const ROOT = () => data.sub('task-logs')

// One folder per task, one per run inside it. A flat directory of run ids would
// be sortable and useless: the question is always "what happened to this task",
// and the answer should not require knowing which run ids belonged to it.
const dirFor = (task, run) => path.join(ROOT(), safe(task), safe(run))

// Task and run ids are made here and are already tame, but they arrive through
// an action and an action's arguments are somebody else's text.
const safe = s => String(s || 'unknown').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120)

const has = (task, run) => {
  try { return fs.existsSync(path.join(dirFor(task, run), 'out.log')) } catch { return false }
}

// Kept once and never rewritten.
//
// A finished run does not change, and re-pulling it would mean the kept copy
// silently follows whatever the machine says today -- including saying nothing,
// after a rollback. The first copy taken is the record.
function keep (task, run, { output, session, machine, state, exit } = {}) {
  const dir = dirFor(task, run)
  if (has(task, run)) return { kept: false, why: 'already kept', dir }

  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'out.log'), secret.redact(output || ''))
  if (session) fs.writeFileSync(path.join(dir, 'session.json'), secret.redact(JSON.stringify(session, null, 2)))
  fs.writeFileSync(path.join(dir, 'about.json'), JSON.stringify({
    task, run, machine: machine || null, state: state || null, exit: exit === undefined ? null : exit,
    kept: new Date().toISOString()
  }, null, 2))
  return { kept: true, dir }
}

// Everything kept for one task, oldest first. Read from the directory rather
// than from the task record, so a run whose task was thrown away is still
// findable -- the log outlives the note about it, which is the right way round.
function list (task) {
  const dir = path.join(ROOT(), safe(task))
  let runs = []
  try { runs = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name) } catch { return [] }
  return runs.sort().map(run => {
    let about = {}
    try { about = JSON.parse(fs.readFileSync(path.join(dir, run, 'about.json'), 'utf8')) } catch { /* an interrupted keep */ }
    let bytes = 0
    try { bytes = fs.statSync(path.join(dir, run, 'out.log')).size } catch { /* as above */ }
    return { run, ...about, bytes, dir: path.join(dir, run) }
  })
}

function read (task, run, { lines = 200 } = {}) {
  const file = path.join(dirFor(task, run), 'out.log')
  let text = ''
  try { text = fs.readFileSync(file, 'utf8') } catch {
    return { found: false, why: 'nothing was kept for that run here', file }
  }
  const all = text.split('\n')
  const want = Math.max(1, Number(lines) || 200)
  return {
    found: true,
    file,
    lines: all.length,
    // The tail, because output ends with what happened. The whole file is on
    // disk and its path is returned, so nothing is hidden -- only not carried.
    text: all.slice(-want).join('\n'),
    more: Math.max(0, all.length - want)
  }
}

// Everything kept, for every task there has ever been one for.
//
// THIS IS HOW A LOG STAYS REACHABLE AFTER ITS TASK IS GONE. Removing a task
// deliberately leaves its logs -- the evidence is meant to outlive the note about
// it -- but everything that reads them wanted a task id, and a task id is
// precisely what has just been thrown away. So the record sat on disk, filed
// under a uid nothing could look up, which is indistinguishable from having
// deleted it.
//
// Read from the directory, never from the board, for the same reason `list` is.
function everything () {
  let uids = []
  try {
    uids = fs.readdirSync(ROOT(), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)
  } catch { return [] }

  return uids.map(uid => {
    const runs = list(uid)
    return {
      uid,
      runs: runs.length,
      bytes: runs.reduce((n, r) => n + (r.bytes || 0), 0),
      // Taken from the runs rather than from the folder's own timestamp, which
      // changes when anything inside it is touched.
      first: runs.map(r => r.kept).filter(Boolean).sort()[0] || null,
      last: runs.map(r => r.kept).filter(Boolean).sort().pop() || null,
      // Enough to recognise it by when the task record is gone, which is the
      // case this exists for.
      machines: [...new Set(runs.map(r => r.machine).filter(Boolean))],
      dir: path.join(ROOT(), uid)
    }
  }).sort((a, b) => String(b.last || '').localeCompare(String(a.last || '')))
}

module.exports = { keep, list, read, has, everything, dirFor, ROOT }
