'use strict'

// What a task delivered that is not a commit.
//
// A branch is the artifact for anything that IS source, and it is the better
// one -- reviewable, diffable, and already the thing a verdict is about. But not
// every task produces source. A firmware build produces a `.bin` that is the
// point of the task and whose source is only how it got made; a packaging task
// produces an archive. The branch holds what went in; nothing held what came out.
//
// The old answer was that these do not survive, and it was stated as a rule
// rather than a gap: only git and the session outlive a machine, because the
// machine goes back to its base snapshot. That is true and it is still true --
// what changes here is that a task can now HAND SOMETHING OVER before that
// happens, instead of leaving it on a disk that is about to be rolled back.
//
// KEYED BY TASK UID, like the run logs beside them, and for the same reason: a
// uid is never reused and never renamed, so throwing away the task does not
// orphan what it produced. `number` moves when a board is rebuilt and `id` is a
// slug that follows the title.
//
// THE GUEST NEVER SUPPLIES A PATH. It supplies a name, and this decides where
// that goes. That is the same rule the rest of the guest-facing surface follows
// -- a machine proves which machine it is and the host decides what it gets --
// and it is the whole of the defence here: there is no directory component to
// traverse out of, because the guest never sends one.

const fs = require('node:fs')
const path = require('node:path')
const data = require('../core/data')

const ROOT = () => data.sub('artifacts')

// Big enough for a firmware image or a packaged build, small enough that a
// runaway `dd` cannot fill this host's disk before anybody notices. A refusal
// says the size, because "too big" without a number is unactionable.
const MOST = 256 * 1024 * 1024

// A name from a guest is never joined to a path until it has been through this.
//
// Not a blocklist of "../" and friends: a name either matches this or it is not
// a name. The same reasoning as the repository names in repos/serve.js, and the
// same shape, because being sure every spelling of "the parent directory" was
// thought of is not a thing anybody manages twice.
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

const dirFor = uid => path.join(ROOT(), safe(uid))

// Task uids are made here and are already tame; this is belt and braces on the
// one that arrives through an action.
const safe = s => String(s || 'unknown').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120)

// Whether a name is one this will accept, said as a sentence rather than a
// boolean, because the caller has to tell a guest why.
function whyNot (name) {
  const n = String(name || '')
  if (!n) return 'an artifact needs a name'
  if (n.length > 120) return 'that name is too long'
  if (!NAME.test(n)) {
    return 'a name may contain letters, numbers, dot, dash and underscore, and must start with a letter or a number — no directories, and no path of any kind'
  }
  return null
}

// Kept, and never silently replaced.
//
// A second file of the same name is a second delivery, not a correction: two
// runs of one task both produce `firmware.bin`, and quietly overwriting means
// the artifact on disk belongs to whichever run finished last with no way to
// tell. Each gets the run it came from in its name.
function keep (uid, name, bytes, { run = null } = {}) {
  const why = whyNot(name)
  if (why) throw new Error(why)
  if (!bytes || !bytes.length) throw new Error('there was nothing in it')
  if (bytes.length > MOST) throw new Error(`that is ${Math.round(bytes.length / 1048576)} MB, and the most this takes is ${MOST / 1048576} MB`)

  const dir = dirFor(uid)
  fs.mkdirSync(dir, { recursive: true })

  // The run it came from, when that is known. It is not always: an artifact can
  // arrive in the first second of a run, before the run's own id has been
  // written to the task -- which is a race worth losing in this direction,
  // because the alternative was refusing the artifact entirely. A timestamp
  // stands in, and does the same job of keeping two deliveries apart.
  let file = path.join(dir, `${run ? safe(run) : data.stamp()}--${name}`)

  // NEVER SILENTLY REPLACED. Two runs of one task both produce `firmware.bin`,
  // and overwriting means the artifact on disk belongs to whichever finished
  // last with nothing saying so. Suffixed rather than refused: the delivery
  // already happened, and losing it to a name clash helps nobody.
  for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${run ? safe(run) : data.stamp()}-${n}--${name}`)

  fs.writeFileSync(file, bytes)
  fs.writeFileSync(`${file}.about.json`, JSON.stringify({
    task: uid, run: run || null, name, bytes: bytes.length, kept: new Date().toISOString()
  }, null, 2))
  return { file, name, bytes: bytes.length, run: run || null }
}

// Everything one task delivered, newest first. Read from the directory rather
// than from the task record, so an artifact whose task was thrown away is still
// findable -- what was produced outlives the note about it, which is the right
// way round and is already how the run logs behave.
function list (uid) {
  const dir = dirFor(uid)
  let names = []
  try { names = fs.readdirSync(dir).filter(n => !n.endsWith('.about.json')) } catch { return [] }
  return names.map(n => {
    const full = path.join(dir, n)
    let about = {}
    try { about = JSON.parse(fs.readFileSync(`${full}.about.json`, 'utf8')) } catch { /* an interrupted keep */ }
    let bytes = 0
    try { bytes = fs.statSync(full).size } catch { /* as above */ }
    return { file: n, path: full, bytes, ...about }
  }).sort((a, b) => String(b.kept || '').localeCompare(String(a.kept || '')))
}

// Every task that delivered anything, including ones the board has forgotten.
function everything () {
  let uids = []
  try { uids = fs.readdirSync(ROOT(), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name) } catch { return [] }
  return uids.map(uid => {
    const files = list(uid)
    return {
      uid,
      files: files.length,
      bytes: files.reduce((n, f) => n + (f.bytes || 0), 0),
      last: files.map(f => f.kept).filter(Boolean).sort().pop() || null,
      dir: dirFor(uid)
    }
  }).sort((a, b) => String(b.last || '').localeCompare(String(a.last || '')))
}

module.exports = { keep, list, everything, whyNot, dirFor, ROOT, MOST }
