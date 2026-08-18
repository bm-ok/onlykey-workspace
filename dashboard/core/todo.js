'use strict'

// A LIST OF THINGS TO DO, kept by this host for the supervisor and the person
// together.
//
// NOT THE TASK BOARD. A task is an occasion on which a machine runs a job on a
// branch — it costs a boot, it has a contract, and it is refused unless a
// judgement stands behind it. Most of what needs doing is not that: "ask about
// the coercion in #13 before recommending anything else", "the fork is behind
// its parent again", "check whether local-repo-b needs the same change". Those
// have nowhere to live, so they live in a conversation and are lost the moment
// the conversation is long.
//
// NOT TRIAGE EITHER, and the difference is the reason this file exists rather
// than a sixth column in that one. Triage says where something ALREADY IS —
// keyed by a task, a judgement, an issue, all of which exist elsewhere and can
// be read from their own stores. A todo is a thing that exists NOWHERE ELSE: if
// this file is thrown away, the tasks and judgements are all still there and the
// intention is simply gone.
//
// WHICH IS WHY THE TWO ENDS ARE DIFFERENT. A supervisor may add to it, change it
// and mark something done; only a person may DELETE. That is not distrust about
// deleting — it is that "done" and "gone" are different claims, and a list where
// the thing doing the work can also make the work disappear is a list that
// cannot be used to check up on it. Done is kept and shown; gone is a person's
// decision.
//
// KEPT FOR THIS COMPUTER, beside the triage notebook and the approvals, rather
// than per workspace — the same reasoning as core/triage.js: what somebody is
// carrying spans whatever they were looking at.

const fs = require('node:fs')
const path = require('node:path')
const data = require('./data')

const FILE = () => path.join(data.state(), 'todo.json')

// Long enough for a sentence somebody reads at a glance; long enough in the why
// for the paragraph that stops it being reopened in a week and misunderstood.
// Not long enough to become the place a model writes its reasoning, which
// belongs in what it says to the person.
const MOST_WHAT = 200
const MOST_WHY = 2000
const MOST_ROWS = 500

// THREE STATES AND THEY ARE FIXED, unlike triage's vocabulary. Triage is
// somebody's own working language about work this app does not own; this list is
// this app's own, one thing is either waiting, being done, or finished, and a
// free-text state here would only ever be a worse version of `why`.
const STATES = ['open', 'doing', 'done']

const read = () => {
  try {
    const kept = JSON.parse(fs.readFileSync(FILE(), 'utf8').replace(/^﻿/, ''))
    return Array.isArray(kept) ? kept : []
  } catch { return [] }
}

const write = list => {
  try { fs.mkdirSync(data.state(), { recursive: true }) } catch { /* it exists */ }
  try { fs.writeFileSync(FILE(), JSON.stringify(list, null, 2)) } catch { /* the answer still stands for this call */ }
  return list
}

const clean = (s, most) => String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim().slice(0, most)

// COUNTED, NOT RANDOM. A number a person can say out loud is the whole point of
// a reference — "do T4 next" works in a sentence and a uuid does not. Taken from
// the highest that has ever been used rather than from the length, so deleting
// one does not hand its number to the next thing written.
function nextNumber (list) {
  return list.reduce((n, r) => Math.max(n, Number(r.number) || 0), 0) + 1
}

const withRef = r => ({ ...r, ref: `T${r.number}` })

function all () {
  return read()
    .slice()
    .sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0))
    .map(withRef)
}

// FOUND BY WHATEVER SOMEBODY HAS TO HAND: T4, 4, or the id. A model that read
// the list has the ref in front of it and a person types the short thing.
function get (which) {
  const want = String(which == null ? '' : which).trim().toLowerCase()
  if (!want) return null
  const list = read()
  const found = list.find(r =>
    String(r.id).toLowerCase() === want ||
    `t${r.number}` === want ||
    String(r.number) === want)
  return found ? withRef(found) : null
}

function add ({ what, why = null, state = 'open', by = null }) {
  const said = clean(what, MOST_WHAT)
  if (!said) throw new Error('Say what is to be done, in a line. That line is what somebody reads in a list of twenty, so it has to make sense without the rest of it.')

  const now = String(state || 'open').trim().toLowerCase()
  if (!STATES.includes(now)) throw new Error(`"${state}" is not a state. One of: ${STATES.join(', ')}.`)

  const list = read()
  const number = nextNumber(list)
  const at = new Date().toISOString()
  const row = {
    id: `todo-${number}-${at.slice(0, 10)}`,
    number,
    what: said,
    why: clean(why, MOST_WHY) || null,
    state: now,
    // WHOSE IDEA IT WAS, which is the question somebody asks first about a list
    // two things write to. Never inferred here: whoever calls this knows, and a
    // guess would be wrong in exactly the interesting case.
    by: by ? clean(by, 40) : null,
    at,
    touched: at,
    done: now === 'done' ? at : null
  }
  list.push(row)
  write(list.slice(-MOST_ROWS))
  return withRef(row)
}

// WHAT IS CHANGED IS WHAT IS PASSED. Everything else is left alone, so marking
// something done does not quietly drop the reason it was written.
function edit (which, { what, why, state, by = null } = {}) {
  const list = read()
  const found = list.find(r => withRef(r).ref.toLowerCase() === String(which).trim().toLowerCase() ||
    String(r.id) === String(which) || String(r.number) === String(which).trim())
  if (!found) throw new Error(`There is no todo "${which}". Ask for the list to see what there is.`)

  if (what !== undefined) {
    const said = clean(what, MOST_WHAT)
    if (!said) throw new Error('A todo with nothing in it is not a todo. To take it off the list, mark it done or remove it.')
    found.what = said
  }
  if (why !== undefined) found.why = clean(why, MOST_WHY) || null
  if (state !== undefined) {
    const now = String(state || '').trim().toLowerCase()
    if (!STATES.includes(now)) throw new Error(`"${state}" is not a state. One of: ${STATES.join(', ')}.`)
    // WHEN IT WAS FINISHED, kept the first time it was. Something reopened and
    // finished again keeps the newer one, because that is when it was actually
    // done; something edited while already done does not have its date moved.
    if (now === 'done' && found.state !== 'done') found.done = new Date().toISOString()
    if (now !== 'done') found.done = null
    found.state = now
  }
  found.touched = new Date().toISOString()
  if (by) found.touchedBy = clean(by, 40)

  write(list)
  return withRef(found)
}

// A PERSON'S, and the action layer is where that is enforced — see actions/todo.js.
// Kept here as an ordinary function because this file is a store and a store that
// decides who may call it is a store with two jobs.
function remove (which) {
  const list = read()
  const found = list.find(r => withRef(r).ref.toLowerCase() === String(which).trim().toLowerCase() ||
    String(r.id) === String(which) || String(r.number) === String(which).trim())
  if (!found) throw new Error(`There is no todo "${which}".`)
  write(list.filter(r => r !== found))
  return withRef(found)
}

const clear = () => write([])

module.exports = { all, get, add, edit, remove, clear, read, STATES, FILE }
