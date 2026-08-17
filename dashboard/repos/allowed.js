'use strict'

// WHICH PULL REQUESTS A JUDGE MAY BE POINTED AT, and at which commit.
//
// Everything else this app judges is its own: a branch cut here, or a PR cut
// this host made. A pull request that ARRIVES is different in kind — it is
// somebody else's code, and judging it means fetching that code onto a machine
// which is holding a Claude credential, a token that can push, and this app's
// own ssh key. Rolling the machine back afterwards does not help: anything sent
// out during the run has already gone.
//
// So a person says which ones may be read, one at a time, and nothing else can:
// the action that writes this is refused over the wire like every other
// approval here.
//
// KEYED TO THE COMMIT, NOT TO THE PULL REQUEST. This is the whole of why the
// file exists rather than a boolean on a row. A pull request is a moving
// target: its author can push again a second after it is allowed, and an
// approval that named only the number would carry silently onto code nobody
// read. So the head sha is recorded, and an allowance stops applying the moment
// the head moves — the same rule a judgement's `tips` already follow, for the
// same reason.
//
// WHAT IT DOES NOT DO. It says a judge may READ this commit. It is not a
// statement that the code is safe to RUN, and nothing here should ever be read
// as one — see the contract a judging job carries.

const fs = require('node:fs')
const path = require('node:path')
const data = require('../core/data')

const FILE = () => path.join(data.state(), 'pr-allowed.json')

// `owner/name#number`, which is how a pull request is named everywhere else and
// is unique across the repositories a workspace holds.
const key = (on, number) => `${String(on || '').trim()}#${Number(number)}`

function read () {
  try {
    return JSON.parse(fs.readFileSync(FILE(), 'utf8').replace(/^﻿/, '')) || {}
  } catch {
    return {}
  }
}

function write (all) {
  try { fs.mkdirSync(data.state(), { recursive: true }) } catch { /* it exists */ }
  fs.writeFileSync(FILE(), JSON.stringify(all, null, 2))
}

// Everything recorded, as rows, for a panel that wants to list them.
const all = () => Object.entries(read()).map(([id, v]) => ({ id, ...v }))

// SAID BY A PERSON, ABOUT ONE COMMIT. `by` is recorded because "who allowed a
// stranger's code to be read here" is exactly the question somebody will ask
// afterwards, and the answer must not be reconstructed from memory.
function allow (on, number, sha, { by = 'the window', note = null } = {}) {
  const at = String(sha || '').trim()
  if (!at) throw new Error('An allowance names the commit it is about. Without one it would carry onto whatever the author pushes next.')
  const list = read()
  list[key(on, number)] = { on: String(on), number: Number(number), sha: at, by, note: note || null, at: new Date().toISOString() }
  write(list)
  return list[key(on, number)]
}

function forget (on, number) {
  const list = read()
  const id = key(on, number)
  const had = list[id] || null
  delete list[id]
  write(list)
  return had
}

// MAY A JUDGE READ THIS, AS IT IS NOW? Three answers, because they need three
// different things done about them.
//
//   allowed   somebody read this commit and said yes
//   stale     somebody said yes to an EARLIER commit; the author has pushed
//             since, and what was approved is not what is there
//   no        nobody has said anything
//
// The stale case is the one worth having a word for. It is not "no" — a person
// has looked and formed a view — and it is emphatically not "yes", because the
// thing they looked at is gone.
function check (on, number, sha) {
  const said = read()[key(on, number)] || null
  const now = String(sha || '').trim()
  if (!said) return { allowed: false, stale: false, said: null, why: 'nobody has allowed this pull request to be judged' }
  if (!now) return { allowed: false, stale: false, said, why: 'this host does not know which commit the pull request is at, so an allowance cannot be matched to it' }
  if (said.sha !== now) {
    return {
      allowed: false,
      stale: true,
      said,
      why: `it was allowed at ${said.sha.slice(0, 7)} and is now at ${now.slice(0, 7)} — the author has pushed since, so what was read is not what is there`
    }
  }
  return { allowed: true, stale: false, said, why: null }
}

module.exports = { read, all, allow, forget, check, key, FILE }
