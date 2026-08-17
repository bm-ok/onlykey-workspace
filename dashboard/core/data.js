'use strict'

// Where this app keeps things that are neither code nor a record worth
// committing: the certificate it serves with, pictures of machines' screens,
// anything else produced by running rather than by writing.
//
// OUTSIDE THE REPOSITORY, in the operating system's per-user data directory.
// `state/` is ignored by git, and ignored is a rule -- one that can be changed,
// or overridden by a `-f`, or simply not apply to whoever clones this next.
// Outside the working tree there is nothing for git to decide about, which is a
// stronger statement than "we asked it not to".
//
// COMPUTED rather than taken from `nw.App.dataPath`, which exists only inside
// NW.js. The command line is a plain node process and so is the test, and a
// certificate nothing outside the window can find is one nothing outside the
// window can hand to a machine. One location, whatever started the process --
// two would be two sets of everything and no way to tell which was in use.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const DIR = process.env.OKC_DATA || (process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'okc-dashboard')
  : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'okc-dashboard'))

// A folder inside it, made if it is not there. Returning the path rather than a
// boolean, so a caller writes `path.join(sub('screenshots'), name)` and never
// has to remember to create anything.
//
// MADE ONCE PER RUN, NOT ONCE PER CALL. `mkdirSync` on a directory that already
// exists is cheap and is still a filesystem syscall, and this is on the read
// path of things the window asks every few seconds -- it showed up as the
// fourth most sampled function in an idle trace, for directories that had
// existed since the app started.
//
// Remembered in memory rather than checked with `existsSync`, which would be
// the same syscall wearing a different name. If somebody deletes a state
// directory while the app is running, the next write there fails and says so --
// which is the honest outcome, and better than this quietly re-making a folder
// underneath a problem somebody should know about.
const made = new Set()

function sub (name) {
  const dir = path.join(DIR, name)
  if (!made.has(dir)) {
    fs.mkdirSync(dir, { recursive: true })
    made.add(dir)
  }
  return dir
}

// Safe as a filename on every platform this runs on, and still readable as a
// time. Colons are legal on Linux and not on Windows, which is the sort of
// difference that only shows up on somebody else's machine.
const stamp = when => new Date(when || Date.now()).toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)

// ---- the registries -----------------------------------------------------
//
// What the app KNOWS: which machines it made, which tasks exist, which branch
// each repository treats as default, what has been approved. Produced by
// running rather than by writing, exactly like everything else here.
//
// IT LIVED IN THE REPOSITORY, in `dashboard/state/`, which is the thing the
// comment at the top of this file argues against -- written before this file
// existed and never moved. `.gitignore` covered it, and ignored is a rule: one
// that can be changed, overridden with a `-f`, or simply not apply to whoever
// clones this next. A machine registry inside a working tree is also one `git
// clean -xdf` away from every machine this app made becoming unmanageable, with
// the machines themselves still sitting there.
//
// MOVED ONCE, AUTOMATICALLY, because the alternative is an app that starts up
// having forgotten its machines. The move happens the first time anything asks
// for the directory, before any of it is read.
const LEGACY = path.join(__dirname, '..', 'state')

let stateDir = null
let migration = null

function state () {
  if (stateDir) return stateDir
  // An explicit override means somebody has chosen where this goes -- a test,
  // usually -- and moving their files somewhere else would be the opposite of
  // honouring it.
  if (process.env.OKC_STATE) return (stateDir = process.env.OKC_STATE)

  stateDir = sub('state')
  migration = carryOver(LEGACY, stateDir)
  return stateDir
}

// Never overwrites. A file already at the destination is the live one, and the
// leftover beside it is from before the move -- taking the older copy because it
// happens to be in the older place is how a registry goes backwards in time.
function carryOver (from, to) {
  if (path.resolve(from) === path.resolve(to)) return null
  let names = []
  try { names = fs.readdirSync(from) } catch { return null }
  if (!names.length) { try { fs.rmdirSync(from) } catch { /* not empty after all */ } return null }

  const moved = []
  const left = []
  for (const name of names) {
    const src = path.join(from, name)
    const dst = path.join(to, name)
    if (fs.existsSync(dst)) { left.push(name); continue }
    try {
      fs.renameSync(src, dst)
      moved.push(name)
    } catch {
      // A rename across volumes fails, and so does one on a file something else
      // still holds open. Copy first and only unlink once the copy is there --
      // the failure to avoid is the one that removes the original and does not
      // arrive.
      try {
        fs.copyFileSync(src, dst)
        fs.unlinkSync(src)
        moved.push(name)
      } catch { left.push(name) }
    }
  }
  try { if (!fs.readdirSync(from).length) fs.rmdirSync(from) } catch { /* something is left; it is reported */ }
  return { from, to, moved, left }
}

// What the move did, for whoever gets to a log first. Read once and cleared, so
// it is announced by one thing rather than by everything that starts up.
function tookOver () {
  const was = migration
  migration = null
  return was
}

module.exports = { DIR, sub, stamp, state, tookOver, LEGACY }
