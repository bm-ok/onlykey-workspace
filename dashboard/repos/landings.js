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

// What was ASKED FOR, kept because it is ours. A title and a description are
// this app's statement of the change; whether a pull request is open is
// GitHub's, and is re-read every time rather than written down here.
function describe (source, target, fields) {
  const data = all()
  const k = key(source, target)
  if (!data[k]) return null
  data[k] = { ...data[k], said: { ...(data[k].said || {}), ...fields, at: new Date().toISOString() } }
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
// WHAT THE LAST READING SAID, WHICH IS NOT THE SAME AS REMEMBERING IT.
//
// The rule at the top of this file holds: the RECORD is what was done, and
// whether a pull request is open or merged is a fact about GitHub that is
// re-read rather than stored. This does not store it -- it remembers the
// last ANSWER, with the time it was given, which is a different kind of
// thing and is labelled as one everywhere it is used.
//
// It exists because a badge cannot ask GitHub. The window redraws every few
// seconds and reaching the network on a timer is the fault this codebase has
// paid for three times -- so "how many changes are still out" is answered
// from the last time somebody looked, and says so.
//
// A pair never read is ABSENT rather than zero. Unknown and none are
// different answers, and a badge that reports "nothing outstanding" because
// nobody has asked is the quiet kind of wrong.
const lastRead = new Map()
const readings = () => [...lastRead.entries()].map(([id, v]) => ({ id, ...v }))

async function state (source, target) {
  const rec = all()[key(source, target)]
  if (!rec) return null

  const now = []
  for (const p of rec.pulls) {
    if (!p.number) { now.push({ ...p, state: 'never opened' }); continue }
    try {
      // WHERE IT WENT, WHICH THE RECORD ALREADY KNOWS. `pullsOn` answers about
      // the repository this workspace targets TODAY, and a cut is history: one
      // opened against a fork somebody has since stopped pointing at is not
      // missing, it is where it always was.
      //
      // Asking the wrong repository and reporting "gone from GitHub" put six
      // merged pull requests on a list of things a drill had left behind.
      let found = p.into ? await remotes.pullAt(p.into, p.number) : null

      // Still the list where there is no `into` -- every cut made before this
      // was recorded -- so nothing that used to work stops working.
      if (!found) {
        const open = await remotes.pullsOn(p.repo)
        found = open.find(x => x.number === p.number) || null
      }

      // AND "NOT FOUND" IS NOT "GONE". GitHub answering nothing for a pull
      // request means this host could not see it, which is a sentence about the
      // asking rather than about the pull request.
      now.push(found ? { ...p, ...found } : { ...p, state: 'could not be found', why: `${p.into || p.repo} did not answer for #${p.number}` })
    } catch (e) {
      now.push({ ...p, state: 'could not be read', why: e.message })
    }
  }

  const opened = now.filter(p => p.number)
  // Kept as a READING, with its time, for anything that cannot ask GitHub
  // itself -- see lastRead above.
  lastRead.set(key(source, target), {
    source,
    target,
    at: new Date().toISOString(),
    landed: opened.length > 0 && opened.every(p => p.merged),
    pulls: now.map(p => ({ repo: p.repo, number: p.number, state: p.merged ? 'merged' : p.state }))
  })

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

// ---- THE ONE BRANCH THAT IS MEANT TO CHANGE -------------------------------
//
// A branch becomes protected the moment `branchAsLine` makes a line of it, and
// that rule is right for a landing target: a line is something work is built
// FROM and merged back INTO, so nothing is built on it directly.
//
// IT IS EXACTLY WRONG FOR THE SOURCE OF AN OPEN PULL REQUEST, which is the one
// branch in the world that exists to be revised. Cutting a change requires
// `branchAsLine`, so cutting it is what locks it: a reviewer asks for an
// adjustment, a worker is set up on that branch to make it, and the push is
// refused by a rule meant for somewhere else. The whole "adjust what is out"
// loop was impossible, and the run that found it lost the commit -- refused at
// the push, then rolled back with the machine.
//
// READ FROM THE CUT RECORD, WHICH IS LOCAL. This is consulted on a push, so it
// may not ask GitHub: the answer has to be here, and the record already carries
// each pull request's head as "owner:branch".
//
// NOT ONE THAT HAS MERGED. Once it lands, the branch is history again and the
// ordinary rule applies.
function underRevision (branch) {
  if (!branch) return false
  for (const cut of Object.values(all())) {
    for (const p of cut.pulls || []) {
      if (p.merged === true) continue
      const head = String(p.head || '')
      const named = head.includes(':') ? head.slice(head.indexOf(':') + 1) : head
      if (named && named === branch) return true
    }
  }
  return false
}

module.exports = { record, describe, forget, state, readings, all, key, underRevision }
