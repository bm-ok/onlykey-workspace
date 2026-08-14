'use strict'

// A change, once it has left: one line going into another, as N pull requests.
//
// THIS IS THE PART GITHUB CANNOT DO. It has no idea the three pull requests are
// one change — each repository sees its own, each gets approved or not on its
// own, and "is it in" is a question nobody can answer by looking at any single
// one of them. That is the whole reason this record exists: it is landed when
// all of them are, and until then it says which are not.
//
// WHAT IS WRITTEN DOWN IS WHAT WAS DONE, NOT WHAT IS TRUE NOW. The numbers and
// the urls are facts about an act that happened; whether a pull request is open,
// merged or closed is a fact about GitHub, and it is re-read rather than
// remembered. Anything else would be this app's copy of somebody else's truth,
// going stale in a file.

const fs = require('node:fs')
const path = require('node:path')
const workspaces = require('../core/workspaces')
const remotes = require('./remotes')

const FILE = () => path.join(workspaces.stateDir(), 'landings.json')
const key = (source, target) => `${source} -> ${target}`

const all = () => {
  try { return JSON.parse(fs.readFileSync(FILE(), 'utf8')) || {} } catch { return {} }
}

const keep = data => {
  try { fs.mkdirSync(workspaces.stateDir(), { recursive: true }) } catch { /* it exists */ }
  try { fs.writeFileSync(FILE(), JSON.stringify(data, null, 2)) } catch { /* the answer still stands for this call */ }
}

// Recorded when it is opened, added to when a repository is opened later — a
// change that could not open everything on the first attempt is one somebody
// comes back to, and it must not lose the ones that did open.
function record (source, target, pulls, by = null) {
  const data = all()
  const k = key(source, target)
  const was = data[k] || { source, target, opened: new Date().toISOString(), by, pulls: [] }

  const merged = [...was.pulls]
  for (const p of pulls) {
    const at = merged.findIndex(x => x.repo === p.repo)
    if (at === -1) merged.push(p)
    else merged[at] = { ...merged[at], ...p }
  }

  data[k] = { ...was, pulls: merged, touched: new Date().toISOString() }
  keep(data)
  return data[k]
}

function forget (source, target) {
  const data = all()
  delete data[key(source, target)]
  keep(data)
  return { forgotten: key(source, target) }
}

// One landing, with each pull request's state read from GitHub rather than from
// the file. `landed` is the whole point: every repository that carries work has
// a pull request, and every one of them is merged.
async function state (source, target) {
  const rec = all()[key(source, target)]
  if (!rec) return null

  const now = []
  for (const p of rec.pulls) {
    if (!p.number) { now.push({ ...p, state: 'never opened' }); continue }
    try {
      const open = await remotes.pullsOn(p.repo)
      const found = open.find(x => x.number === p.number)
      now.push(found ? { ...p, ...found } : { ...p, state: 'gone from GitHub' })
    } catch (e) {
      now.push({ ...p, state: 'could not be read', why: e.message })
    }
  }

  const opened = now.filter(p => p.number)
  return {
    ...rec,
    pulls: now,
    landed: opened.length > 0 && opened.every(p => p.merged),
    mergedCount: opened.filter(p => p.merged).length,
    count: opened.length,
    summary: opened.length
      ? `${opened.filter(p => p.merged).length} of ${opened.length} merged`
      : 'nothing was opened'
  }
}

module.exports = { record, forget, state, all, key }
