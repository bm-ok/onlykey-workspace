'use strict'

// Which pre-defined tasks a person has actually approved.
//
// THE LOOP THIS EXISTS FOR. The operator asks the supervising model to write a
// definition; the model writes it; the operator reads it and approves it; only
// then can it be picked and run. The model does the writing, which is the point
// of having one -- and it cannot ratify its own work, which is the point of
// this file.
//
// That is the same rule the supervisor already works under, applied one level
// up. A supervisor sends a bad document back rather than fixing it, because the
// supervisor's own edits are the one path nothing reviews. A definition it wrote
// and approved itself would be exactly that path, reopened.
//
// AN APPROVAL IS OF A DEFINITION, NOT OF A NAME. It is recorded against a
// fingerprint of the function that will run, and lapses the moment that source
// moves. Otherwise the way around it is obvious and quiet: get something modest
// approved, then change what it does. A lapsed approval is reported as lapsed
// rather than as missing, because those are different situations -- one has
// never been read, the other has been read and then edited.

const fs = require('node:fs')
const path = require('node:path')
const log = require('../core/log')

const STATE = process.env.OKC_STATE || path.join(__dirname, '..', 'state')
const FILE = path.join(STATE, 'approvals.json')

// Suite and name together. A test name is only unique inside its suite, and two
// suites with a test called "it is refused" is not a strange thing to expect.
const keyOf = (suite, name) => `${suite}::${name}`

function read () {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^﻿/, '')) || {} } catch { return {} }
}

function write (all) {
  fs.mkdirSync(STATE, { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2))
}

// What an approval says about one test, right now.
//
// Three answers rather than two, because "never approved" and "approved, then
// edited" want different things from the reader: one is work waiting to be read,
// the other is a change waiting to be read. Collapsing them into `false` hides
// which.
function stateOf (suite, name, fingerprint) {
  const all = read()
  const rec = all[keyOf(suite, name)]
  if (!rec) return { approved: false, lapsed: false, why: 'has never been approved' }
  if (rec.fingerprint !== fingerprint) {
    return {
      approved: false,
      lapsed: true,
      at: rec.at,
      why: `was approved on ${new Date(rec.at).toLocaleDateString()} and has been changed since. Read it again.`
    }
  }
  return { approved: true, lapsed: false, at: rec.at, note: rec.note || null, why: null }
}

function approve (suite, name, fingerprint, note) {
  const all = read()
  all[keyOf(suite, name)] = {
    suite,
    name,
    fingerprint,
    note: note || null,
    at: new Date().toISOString()
  }
  write(all)
  log.on('drill').good(`approved: ${name}`)
  return all[keyOf(suite, name)]
}

function withdraw (suite, name) {
  const all = read()
  const key = keyOf(suite, name)
  if (!all[key]) return { withdrawn: false, why: 'it was not approved' }
  delete all[key]
  write(all)
  log.on('drill').warn(`approval withdrawn: ${name}`)
  return { withdrawn: true }
}

module.exports = { read, stateOf, approve, withdraw, keyOf, FILE }
