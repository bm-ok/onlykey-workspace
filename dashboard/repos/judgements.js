'use strict'

// What somebody thought of a change, and when they thought it.
//
// A judgement is a reading OF work rather than work: short, with something
// waiting on it, and it goes stale on its own the moment what it read moves. It
// is kept here rather than on the landing it belongs to because a landing is a
// record of an ACT -- these pull requests were opened -- and a judgement is a
// record of an OPINION, of which there may be several, disagreeing.
//
// A LIST, NEVER A FIELD. A cut carries as many judgements as anybody cares to
// make: Claude reads it, then a person reads it themselves, and both are worth
// having precisely because the second says something the first cannot. Written
// as one field the second would overwrite the first, and the most useful thing
// this record can show -- that two readings disagree -- would be unrepresentable.
//
// APPENDED TO, NEVER REPLACED, for the same reason. Re-judging after a change
// keeps the old one: "judged, then changed, then judged again" is the history
// that makes the second reading mean anything, and overwriting throws away the
// only thing that made it worth doing twice.
//
// WHAT IT WAS READ AGAINST IS PART OF IT. Every judgement records the commit each
// repository's branch ended at, so it can say for itself whether it still
// describes what is there -- see `staleAgainst`. Nothing here decides that; it
// only keeps what is needed to decide it, because the tips it is compared with
// are read from git and are somebody else's truth.

const fs = require('node:fs')
const path = require('node:path')
const workspaces = require('../core/workspaces')

const FILE = () => {
  const at = workspaces.stateDir()
  return at ? path.join(at, 'judgements.json') : null
}

const key = (source, target) => `${source} -> ${target}`

const all = () => {
  const file = FILE()
  if (!file) return {}
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {} } catch { return {} }
}

// Every judgement on one cut, oldest first, because they are a sequence: a
// person's pass AFTER a model's is the case this exists for, and the order is
// what says which came second.
const on = (source, target) => (all()[key(source, target)] || []).slice()

// Whether a judgement still describes what is there.
//
// Compared on the tips alone. Editing a title or a description does NOT make a
// judgement stale: the judgement is of the change, and the description is the
// claim about the change -- invalidating a reading of code because a sentence was
// rewritten would teach people to stop believing the word.
//
// A repository that has since left the cut counts as a change, and so does one
// that has joined it. Either way what was read is no longer what is there.
function staleAgainst (judgement, tips) {
  const was = judgement.tips || {}
  const now = tips || {}
  const names = new Set([...Object.keys(was), ...Object.keys(now)])
  for (const repo of names) if (was[repo] !== now[repo]) return true
  return false
}

// ---- writing one down ------------------------------------------------------
//
// APPENDED, NEVER REPLACED — the rule at the top of this file, made into the
// only way in. There was no way in at all until judging became work: this file
// could read and compare opinions that nothing could write, which is why
// `judgements` sat in test/unused.md.
//
// WHAT IT WAS READ AGAINST IS NOT OPTIONAL. A judgement with no tips can never
// say whether it still describes what is there, so it would read as current for
// ever — the one thing this file exists to prevent. Refused rather than filed
// with an empty object, which is the shape that lies.
function add (source, target, judgement) {
  const from = String(source || '').trim()
  const to = String(target || '').trim()
  if (!from || !to) throw new Error('A judgement is filed against a cut, which is a source line and a target. Both are needed, or it is filed under a name nobody will find.')

  const tips = judgement && judgement.tips
  if (!tips || typeof tips !== 'object' || !Object.keys(tips).length) {
    throw new Error('A judgement has to record what each repository was at when it was made. Without that it can never say whether it still describes what is there, and it would read as current for ever.')
  }

  const now = all()
  const k = key(from, to)
  const one = {
    ...judgement,
    at: judgement.at || new Date().toISOString()
  }
  now[k] = [...(now[k] || []), one]

  const file = FILE()
  if (!file) throw new Error('No workspace is open, so there is nowhere to keep a judgement.')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(now, null, 2))
  return one
}

module.exports = { all, on, key, add, staleAgainst, FILE }
