'use strict'

// Which set of repositories this is about, and how to change it without the
// answer to one becoming the answer to another.
//
// A WORKSPACE IS A FOLDER OF REPOSITORIES. It was one folder, fixed at
// `../workspace` with an environment variable as the only way out -- which is
// fine for a tool with one subject and useless for a tool meant to serve any
// ecosystem. Pointing it somewhere else is the whole of what stands between this
// and being used on real work.
//
// THE PART THAT IS NOT OBVIOUS IS CONTAMINATION. Some of what this app knows is
// about the HOST and some is about the WORKSPACE, and they were in one drawer:
//
//   about the host       the machines it made, machines reachable over ssh, the
//                        approvals it has recorded for its own drills. True
//                        whatever repositories are being worked on
//   about the workspace  every task, because a task delivers to a branch in one
//                        of these repositories. Every branch's reason. Every
//                        repository's default branch and chosen baseline
//
// Kept together, switching workspace would leave the second kind describing
// somewhere else: tasks pointing at branches that do not exist here, a baseline
// remembered for a repository of the same name in a different folder, a branch's
// reason attached to a name that means something else now. None of it would
// error. All of it would be wrong, quietly, which is the worst way for a tool
// whose job is oversight to be wrong.
//
// So the second kind lives under the workspace it belongs to, and switching is
// REFUSED while anything ties a machine to the current one -- see `inTheWay`.
// A machine set up on a branch cannot be reasoned about from a workspace that
// has no such branch.

const fs = require('node:fs')
const path = require('node:path')

const data = require('./data')

const FILE = () => path.join(data.DIR, 'workspaces.json')

// The one that was hard-coded, kept as the fallback so an app that has never
// been told anything still works exactly as it did.
const ORIGINAL = process.env.OKC_REPOS_DIR || path.join(__dirname, '..', '..', 'workspace')

// A folder name derived from the path, for the directory its state lives in.
// Readable rather than a hash, because somebody will look at this directory and
// want to know which workspace they are looking at.
function slugFor (dir) {
  const base = path.basename(path.resolve(dir)).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, '') || 'workspace'
  // The tail of the path as well, so two folders both called `workspace` in
  // different places do not share a drawer -- which is precisely the
  // contamination this file exists to prevent, in its most likely form.
  let sum = 0
  const full = path.resolve(dir).toLowerCase()
  for (let i = 0; i < full.length; i++) sum = (sum * 31 + full.charCodeAt(i)) >>> 0
  return `${base}-${sum.toString(36)}`
}

function read () {
  try {
    const kept = JSON.parse(fs.readFileSync(FILE(), 'utf8').replace(/^﻿/, ''))
    if (kept && Array.isArray(kept.known)) return kept
  } catch { /* first run, or unreadable: the fallback below is still right */ }
  return { current: null, known: [] }
}

function write (all) {
  try {
    fs.mkdirSync(data.DIR, { recursive: true })
    fs.writeFileSync(FILE(), JSON.stringify(all, null, 2))
  } catch { /* the answer is still right for this call; it is only not kept */ }
  return all
}

const isDir = p => { try { return fs.statSync(p).isDirectory() } catch { return false } }

// Where the repositories are, right now.
//
// Falls back to the original path when nothing has been chosen, so this is a
// change in what is POSSIBLE rather than a change in what happens by default.
function dir () {
  const all = read()
  if (all.current && isDir(all.current)) return all.current
  return ORIGINAL
}

// The current one as a record, whether or not it has ever been named.
function current () {
  const all = read()
  const at = dir()
  const known = all.known.find(w => path.resolve(w.dir) === path.resolve(at))
  return known || { name: path.basename(at), dir: at, slug: slugFor(at), added: null, implicit: true }
}

// Everything it has been pointed at, with the current one marked. A folder that
// has gone is still listed, and said to be missing rather than dropped -- a
// removed drive is a thing to notice, not a thing to silently forget.
function known () {
  const all = read()
  const at = path.resolve(dir())
  const list = all.known.map(w => ({
    ...w,
    slug: w.slug || slugFor(w.dir),
    current: path.resolve(w.dir) === at,
    there: isDir(w.dir),
    repos: isDir(w.dir) ? countRepos(w.dir) : 0
  }))
  // The implicit one appears too, or a fresh install would show an empty list
  // while plainly serving repositories from somewhere.
  if (!list.some(w => w.current)) {
    const c = current()
    list.unshift({ ...c, current: true, there: isDir(c.dir), repos: countRepos(c.dir) })
  }
  return list
}

// Only enough to say whether a folder looks like a workspace at all. Not a
// substitute for what repos/serve.js reports -- this is for a picker, so that
// somebody choosing between two folders can see which one has anything in it.
function countRepos (at) {
  try {
    return fs.readdirSync(at, { withFileTypes: true })
      .filter(e => e.isDirectory() && (isDir(path.join(at, e.name, '.git')) || isDir(path.join(at, e.name, 'refs'))))
      .length
  } catch { return 0 }
}

// Added, and remembered, without becoming the current one. Choosing is a
// separate act because it is the one with consequences.
function add (at, name) {
  const full = path.resolve(String(at || '').trim())
  if (!full) throw new Error('Say which folder.')
  if (!isDir(full)) throw new Error(`There is no folder at ${full}.`)

  const all = read()
  const already = all.known.find(w => path.resolve(w.dir) === full)
  if (already) {
    if (name) { already.name = String(name).trim(); write(all) }
    return { ...already, slug: already.slug || slugFor(full), already: true }
  }

  const entry = {
    name: String(name || path.basename(full)).trim(),
    dir: full,
    slug: slugFor(full),
    added: new Date().toISOString()
  }
  all.known.push(entry)
  write(all)
  return { ...entry, already: false }
}

function use (at) {
  const full = path.resolve(String(at || '').trim())
  if (!isDir(full)) throw new Error(`There is no folder at ${full}.`)
  const all = read()
  if (!all.known.some(w => path.resolve(w.dir) === full)) add(full)
  const now = read()
  now.current = full
  write(now)
  return current()
}

function forget (at) {
  const full = path.resolve(String(at || '').trim())
  const all = read()
  if (path.resolve(dir()) === full) {
    throw new Error('That is the workspace in use. Switch to another one before forgetting this one.')
  }
  const before = all.known.length
  all.known = all.known.filter(w => path.resolve(w.dir) !== full)
  write(all)
  // The state kept for it is deliberately NOT deleted. Forgetting a workspace is
  // saying "stop offering me this", not "throw away what I know about it" -- and
  // pointing at the same folder again should find its tasks where it left them.
  return { forgotten: before !== all.known.length, dir: full, stateKept: true }
}

// Where the state that is ABOUT a workspace lives.
//
// Under the app's own directory rather than inside the workspace, because a
// workspace is a folder of repositories somebody else may own, may clone, may
// clean -- and a registry inside it would be one `git clean` from gone, which is
// the exact argument that moved this state out of the repository in the first
// place.
// What belongs to a workspace rather than to this host. Everything else -- the
// machines, the ssh hosts, the approvals recorded for this tool's own drills --
// stays where it was, because it is true whatever is being worked on.
const SCOPED = ['tasks.json', 'tasks-highest.json', 'repos.json', 'branches.json']

let carried = false

function stateDir (at) {
  const slug = at ? slugFor(at) : current().slug
  const dir = data.sub(path.join('workspaces', slug))

  // MOVED ONCE, INTO THE WORKSPACE THAT WAS ALREADY IN USE.
  //
  // These files were written before there was more than one workspace, so they
  // describe the one that was being served then -- which is the current one, by
  // definition, since there was no way to change it. Left where they were they
  // would read as belonging to every workspace, which is the contamination this
  // whole file exists to prevent, arriving on the first switch.
  //
  // Only for the current workspace, and only once per process: a second one has
  // no claim on them.
  if (!carried && !at) {
    carried = true
    const from = data.state()
    for (const name of SCOPED) {
      const src = path.join(from, name)
      const dst = path.join(dir, name)
      if (!fs.existsSync(src) || fs.existsSync(dst)) continue
      try { fs.renameSync(src, dst) } catch {
        try { fs.copyFileSync(src, dst); fs.unlinkSync(src) } catch { /* still readable where it was */ }
      }
    }
  }

  return dir
}

module.exports = { dir, current, known, add, use, forget, stateDir, slugFor, ORIGINAL, FILE }
