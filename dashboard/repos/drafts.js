'use strict'

// What somebody has written and not sent yet.
//
// TWO THINGS ARE CALLED A DRAFT and they are not the same, so both are named
// here rather than left to collide:
//
//   a draft HERE     a title and a description written for a pair of lines and
//                    not cut yet. It exists only in this workspace, nothing is
//                    pushed, and nobody else can see it. This file.
//   a draft on GITHUB a pull request that HAS been opened, marked not-ready-for-
//                    review. It is public, it has a number, and it is a state of
//                    a real pull request rather than the absence of one. That is
//                    a flag on `prCutMake`, not this.
//
// WHY IT EXISTS: the editor fills its fields once and then leaves them alone, so
// what somebody typed lived only in a DOM node — one click on another tab and a
// paragraph was gone. Writing a description is the slowest part of cutting a
// pull request, and it was the only part nothing kept.
//
// Kept per PAIR OF LINES rather than globally, because that is what the writing
// is about: a description of "testing2 line into default" is not a description
// of anything else, and coming back to somebody else's half-sentence under a
// different pair would be worse than an empty box.

const fs = require('node:fs')
const path = require('node:path')
const workspaces = require('../core/workspaces')

const FILE = () => path.join(workspaces.stateDir(), 'pr-drafts.json')
const key = (source, target) => `${source} -> ${target}`

const all = () => {
  try { return JSON.parse(fs.readFileSync(FILE(), 'utf8')) || {} } catch { return {} }
}

const keep = data => {
  try { fs.mkdirSync(workspaces.stateDir(), { recursive: true }) } catch { /* it exists */ }
  try { fs.writeFileSync(FILE(), JSON.stringify(data, null, 2)) } catch { /* the answer still stands for this call */ }
}

const read = (source, target) => all()[key(source, target)] || null

// An empty draft is deleted rather than stored. "There is a draft" should mean
// something is in it — otherwise every pair anybody ever looked at reports one,
// and the word stops carrying information.
function save (source, target, { title, body }) {
  const data = all()
  const k = key(source, target)
  const has = String(title || '').trim() || String(body || '').trim()

  if (!has) {
    delete data[k]
    keep(data)
    return null
  }

  data[k] = {
    source,
    target,
    title: String(title || ''),
    body: String(body || ''),
    at: new Date().toISOString()
  }
  keep(data)
  return data[k]
}

function forget (source, target) {
  const data = all()
  const k = key(source, target)
  const had = !!data[k]
  delete data[k]
  keep(data)
  return { forgotten: had ? k : null }
}

module.exports = { read, save, forget, all, key }
