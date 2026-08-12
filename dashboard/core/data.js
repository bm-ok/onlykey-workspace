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
function sub (name) {
  const dir = path.join(DIR, name)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

// Safe as a filename on every platform this runs on, and still readable as a
// time. Colons are legal on Linux and not on Windows, which is the sort of
// difference that only shows up on somebody else's machine.
const stamp = when => new Date(when || Date.now()).toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)

module.exports = { DIR, sub, stamp }
