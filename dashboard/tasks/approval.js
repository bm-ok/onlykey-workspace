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
  // What the model said when it changed this, if it said anything. Carried into
  // every answer, because "changed" on its own tells a reader that something is
  // different and nothing about what or why -- which leaves them diffing source
  // in their head to find out whether they care.
  const asked = rec && rec.request && rec.request.fingerprint === fingerprint ? rec.request : null

  if (!rec) return { approved: false, lapsed: false, why: 'has never been approved', request: asked }
  if (rec.fingerprint !== fingerprint) {
    return {
      approved: false,
      lapsed: true,
      at: rec.at,
      request: asked,
      why: asked
        ? `was approved on ${new Date(rec.at).toLocaleDateString()} and has been changed since. The reason given: ${asked.why}`
        : `was approved on ${new Date(rec.at).toLocaleDateString()} and has been changed since, with no reason given. Read it again.`
    }
  }
  return { approved: true, lapsed: false, at: rec.at, note: rec.note || null, why: null, request: null }
}

// A model asking to have a change looked at.
//
// THIS IS THE HALF A MODEL IS ALLOWED. It may edit a definition and it may ask
// for the edit to be read; it may not decide that the edit is alright. Recorded
// against the NEW fingerprint, so a reason cannot outlive the change it explains
// -- edit again and the reason goes stale with it.
//
// Kept beside the old approval rather than replacing it, because the reader
// wants both: what they approved before, and what is being asked now.
function request (suite, name, fingerprint, why) {
  if (!String(why || '').trim()) throw new Error('Say why it changed. A request to re-read something, with no reason, is just the change arriving quietly.')
  const all = read()
  const key = keyOf(suite, name)
  all[key] = {
    ...(all[key] || { suite, name }),
    request: { fingerprint, why: String(why).trim(), at: new Date().toISOString() }
  }
  write(all)
  log.on('drill').warn(`ASKED-TO-READ ${name} — ${String(why).trim().split('\n')[0]}`)
  return all[key].request
}

function approve (suite, name, fingerprint, note) {
  const all = read()
  // The request is cleared, not kept. It was a question, and this is the answer;
  // leaving it would make the next reader think something is still outstanding.
  all[keyOf(suite, name)] = {
    suite,
    name,
    fingerprint,
    note: note || null,
    at: new Date().toISOString()
  }
  write(all)
  // Said in a shape something can WATCH for.
  //
  // A model asks for a definition to be read and then has no way of learning
  // that it was — it cannot poll politely for ever, and asking again is how a
  // supervisor becomes noise. The live log already carries every event in this
  // app, so the answer goes there in a form a filter can match: one marker word,
  // always at the front, whatever else the line says.
  log.on('drill').good(`APPROVED ${name}${note ? ` — ${note}` : ''}`)
  return all[keyOf(suite, name)]
}

function withdraw (suite, name) {
  const all = read()
  const key = keyOf(suite, name)
  if (!all[key]) return { withdrawn: false, why: 'it was not approved' }
  delete all[key]
  write(all)
  log.on('drill').warn(`WITHDRAWN ${name}`)
  return { withdrawn: true }
}

module.exports = { read, stateOf, approve, request, withdraw, keyOf, FILE }
