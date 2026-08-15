'use strict'

// What a worker remembers, kept here rather than on the machine that made it.
//
// THE MACHINE IS ROLLED BACK, WHICH IS THE WHOLE PROBLEM. A run leaves a Claude
// session in the guest's `~/.claude`, and the queue then restores that machine
// to its base snapshot -- so the record of what a worker actually did, turn by
// turn, existed only for as long as nobody tidied up after it. The log survived
// because it was copied here; this did not, because nothing copied it.
//
// That is worse than losing a log. A log is what the run printed; a session is
// what it was told, what it decided, what it ran and what came back -- the only
// thing that answers "why did it do that", and the only one you cannot
// reconstruct from the branch afterwards.
//
// THE WHOLE FOLDER, NOT THE TRANSCRIPT FILE. `~/.claude` holds the transcript
// and everything around it: which project directory it belongs to, the todos it
// was keeping, its own settings and history. Taking only the `.jsonl` means
// working out where to put it back -- Claude files a session under a slug made
// from the working directory -- and getting that wrong restores a transcript
// that nothing will ever find. An archive of the folder puts itself back.
//
// EXCEPT THE CREDENTIAL, and that exclusion is load-bearing. `~/.claude` also
// holds `.credentials.json`, the worker's own token. This host already holds one
// copy, sealed by core/secret.js; letting it ride along in every session archive
// would make an unsealed copy per task, sitting in a folder whose whole purpose
// is to be kept for a long time. The machine is handed a credential on its way
// up and it is taken back on the way down -- that path already exists and does
// not need a second one that nobody thought of as a credential path at all.
//
// KEYED BY TASK UID, exactly like the files beside them and for the same reason:
// a uid is never reused and never renamed, so throwing the task away does not
// orphan what it produced, and rebuilding the board does not move it.
//
// ONE PER TASK, and the guest does not get a say in that. A worker started for a
// task continues the same conversation every time it is started again, whichever
// machine it lands on -- which is what makes a task given out twice a second
// attempt rather than a stranger starting fresh. "Which conversation is this" is
// a question about the task, not about the run that happens to be executing it,
// so the guest is never asked and cannot answer.

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const data = require('../core/data')
const { parseTar } = require('../vendors/nanotar/nanotar.js')

const ROOT = () => data.sub('sessions')

const safe = s => String(s || 'unknown').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120)
const dirFor = uid => path.join(ROOT(), safe(uid))
// One name, because there is one per task. A second one would be the first one
// plus what happened since, and two files where one is a prefix of the other is
// two files nothing on screen can choose between.
const fileFor = uid => path.join(dirFor(uid), 'claude.tgz')
const aboutFor = uid => path.join(dirFor(uid), 'about.json')

// An hour of work with a lot of file reading in it. Big enough for a real run,
// small enough that a machine cannot fill this host's disk unnoticed.
const MOST = 256 * 1024 * 1024

// The session id a run reported, checked before it is written into a record that
// is later read back and shown. Claude writes uuids.
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/
const okId = id => !id || ID.test(String(id))

// ---- what is inside one, worked out once -------------------------------
//
// READ ON THE WAY IN, NOT ON THE WAY OUT. The archive is the thing that has to
// survive; a summary of it is what anybody actually looks at, and computing that
// on every paint would mean gunzipping ninety kilobytes and parsing fifty turns
// of JSON on a three-second draw loop. So it is done once, when the bytes
// arrive, and what the panel reads afterwards is a small object.
//
// It also means the expensive half only happens when something changed, which
// is the same reason the window keys its panels on a signature.
//
// NOTHING HERE IS TRUSTED. This came off a machine running a script somebody
// wrote. Every field is read defensively and a transcript that does not parse
// produces a summary saying so, rather than a throw that would refuse the
// archive -- losing the transcript because its SUMMARY failed would be the tail
// wagging the dog.
function look (bytes) {
  const out = { turns: 0, tools: [], touched: [], model: null, tokens: null, from: null, to: null, files: 0 }
  let entries = []
  try {
    entries = parseTar(zlib.gunzipSync(bytes))
  } catch (e) {
    return { ...out, unreadable: e.message }
  }
  out.files = entries.filter(e => e.type === 'file').length

  // The biggest transcript in it. A run resumed into an existing project folder
  // can leave more than one, and the one being carried on is the one with
  // something in it.
  const jsonl = entries
    .filter(e => /projects\/.*\.jsonl$/.test(e.name || ''))
    .sort((a, b) => (b.size || 0) - (a.size || 0))[0]
  if (!jsonl) return { ...out, unreadable: 'there is no transcript in it' }

  out.transcript = jsonl.name
  let text = ''
  try { text = new TextDecoder().decode(jsonl.data) } catch { return { ...out, unreadable: 'the transcript is not text' } }

  const tools = new Map()
  const touched = new Set()
  const models = new Set()
  let inTok = 0
  let outTok = 0
  let cache = 0
  let errors = 0

  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let t = null
    // A `.jsonl` whose last line is half-written is an ordinary state: a run
    // that was killed mid-write leaves one, and everything before it still
    // counts.
    try { t = JSON.parse(line) } catch { continue }
    out.turns++
    if (t.timestamp) {
      if (!out.from) out.from = t.timestamp
      out.to = t.timestamp
    }
    if (t.isApiErrorMessage) errors++
    const m = t.message || {}
    // `<synthetic>` is what Claude writes for a turn it made up rather than one
    // a model produced, and reporting it as the model somebody used is a small
    // lie in the one field people read first.
    if (m.model && m.model !== '<synthetic>') models.add(m.model)
    if (m.usage) {
      inTok += m.usage.input_tokens || 0
      outTok += m.usage.output_tokens || 0
      cache += m.usage.cache_read_input_tokens || 0
    }
    if (!Array.isArray(m.content)) continue
    for (const c of m.content) {
      if (!c || c.type !== 'tool_use') continue
      tools.set(c.name, (tools.get(c.name) || 0) + 1)
      const where = c.input && (c.input.file_path || c.input.path || c.input.notebook_path)
      if (where) touched.add(String(where))
    }
  }

  out.model = [...models].join(', ') || null
  out.tools = [...tools].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n)
  // Bounded, because this is written into a record that is read on every draw
  // and a worker that touched four hundred files would otherwise put all four
  // hundred in it.
  out.touched = [...touched].slice(0, 40)
  out.moreTouched = Math.max(0, touched.size - 40)
  out.tokens = { in: inTok, out: outTok, cache }
  out.errors = errors
  return out
}

// REPLACED, not added to, which is the opposite of how the artifacts beside
// these behave and is right for the same underlying reason. An artifact is a
// delivery: two runs producing `firmware.bin` are two results and losing either
// loses work. A session is a conversation, and the newer copy is the older one
// plus what happened since.
function keep (uid, bytes, { id = null, run = null, machine = null, taskId = null, number = null, folder = null } = {}) {
  if (!okId(id)) throw new Error('that is not a session id')
  if (!bytes || !bytes.length) throw new Error('there was nothing in it')
  if (bytes.length > MOST) throw new Error(`that is ${Math.round(bytes.length / 1048576)} MB, and the most this takes is ${MOST / 1048576} MB`)

  const dir = dirFor(uid)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(fileFor(uid), bytes)

  // The turn count is not known here and is not worth unpacking an archive to
  // find out. What is worth keeping is which conversation, from which run, on
  // which machine -- the three things somebody asks when they come back to it.
  const was = get(uid)
  fs.writeFileSync(aboutFor(uid), JSON.stringify({
    // What is in it, read here once. See `look`.
    inside: look(bytes),
    task: uid,
    taskId: taskId || (was && was.taskId) || null,
    number: number || (was && was.number) || null,
    id: id || (was && was.id) || null,
    run: run || null,
    machine: machine || null,
    folder: folder || null,
    bytes: bytes.length,
    kept: new Date().toISOString(),
    // How many times this task has picked the conversation back up, which is
    // the one number that says "this was resumed" rather than "this ran once".
    runs: ((was && was.runs) || 0) + 1,
    first: (was && was.first) || new Date().toISOString()
  }, null, 2))
  return get(uid)
}

// What is kept for one task, or null. Read from disk rather than from the task
// record, so a transcript whose task was thrown away is still findable -- what
// was produced outlives the note about it, which is the right way round and is
// already how the run logs behave.
function get (uid) {
  const file = fileFor(uid)
  let bytes = 0
  try { bytes = fs.statSync(file).size } catch { return null }
  let about = {}
  try { about = JSON.parse(fs.readFileSync(aboutFor(uid), 'utf8')) } catch { /* an interrupted keep */ }
  return { uid, path: file, bytes, ...about }
}

const has = uid => !!get(uid)

function forget (uid) {
  const found = get(uid)
  if (!found) throw new Error('there is no session kept for that task')
  try { fs.unlinkSync(fileFor(uid)) } catch { /* already gone */ }
  try { fs.unlinkSync(aboutFor(uid)) } catch { /* it may never have been written */ }
  try { fs.rmdirSync(dirFor(uid)) } catch { /* something else is in there */ }
  return { forgotten: uid, bytes: found.bytes }
}

// Every task that has one, including ones the board has forgotten.
function everything () {
  let uids = []
  try { uids = fs.readdirSync(ROOT(), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name) } catch { return [] }
  return uids.map(get).filter(Boolean)
    .sort((a, b) => String(b.kept || '').localeCompare(String(a.kept || '')))
}

module.exports = { keep, get, has, forget, everything, okId, dirFor, fileFor, ROOT, MOST }
