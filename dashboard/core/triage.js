'use strict'

// WHAT THE SUPERVISOR IS IN THE MIDDLE OF.
//
// A supervisor is woken, reads, decides, acts and stops. Between wakings it
// remembers one number — the bookmark that says how far it has read — and
// nothing else. That is enough while every decision is finished inside one
// waking, and it stops being enough the moment work has stages:
//
//     issue #42 -> a judgement to check whether it is real -> a line -> a task
//     to fix it -> another judgement -> a change sent out
//
// Six wakings, minimum, usually more. Without somewhere to put it, each waking
// re-derives where it had got to by reading the whole board and guessing — and a
// guess about "did I already ask for that" is how the same judgement gets queued
// twice, or a task sits waiting for a re-judgement nobody asked for.
//
// SO: A LINE OF STATE PER THING IT IS CARRYING. Keyed by what it is ABOUT — a
// task, a judgement, an issue, a line — because that is what it is thinking in.
//
// THIS IS A NOTEBOOK, NOT A SECOND BOARD. Nothing here decides anything and
// nothing reads it to act: the tasks are in the task store, the judgements in
// theirs, and what is true about them is read from those. What is kept here is
// only what a supervisor believes it is doing, which exists nowhere else because
// nothing else has an opinion about it.
//
// WHICH MEANS IT CAN BE WRONG, and that is survivable by design: throw it away
// and the supervisor is exactly where it was on day one — reading the board and
// working it out. Anything that could not survive that does not belong here.
//
// FOR THE PERSON TOO. The window can show what the supervisor thinks it is in
// the middle of, which is the one question a chat transcript answers badly.

const fs = require('node:fs')
const path = require('node:path')
const data = require('./data')

// KEPT FOR THIS COMPUTER, beside the keys and the approvals, rather than per
// workspace: a supervisor's train of thought spans whatever it was looking at,
// and the ordinary case is one workspace anyway.
const FILE = () => path.join(data.state(), 'triage.json')

// Long enough for a sentence somebody will read at a glance, short enough that
// this cannot become the place a model writes its reasoning. Reasoning belongs
// in what it says to the person; this is a label and a line.
const MOST_STATE = 40
const MOST_NOTE = 500
const MOST_ROWS = 200

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

// The states this app suggests. NOT enforced: triage is somebody's working
// vocabulary and a fixed list would be wrong for the third project that uses
// this. Suggested because a vocabulary that drifts every waking is not a
// vocabulary, and these are the five states this flow actually has.
const USUAL = ['waiting on a judge', 'waiting on a worker', 'needs a person', 'ready to send', 'done']

const clean = (s, most) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, most)

function all () {
  return read().map(r => ({ ...r, usual: USUAL.includes(r.state) }))
}

// One entry per thing. Writing about the same thing again REPLACES it — this is
// where something IS, not a history of where it has been, and the history is in
// the record of what actually happened rather than in what somebody thought.
function set ({ about, state, note, by = null }) {
  const what = clean(about, 80)
  if (!what) throw new Error('Say what this is about — a task like "#131", a judgement like "J5", an issue, or a line. It is the name you will look it up by.')

  const now = clean(state, MOST_STATE)
  if (!now) throw new Error(`Say what state it is in. Short: ${USUAL.join(', ')} — or your own words, as long as you keep using the same ones.`)

  const list = read().filter(r => r.about !== what)
  const row = {
    about: what,
    state: now,
    note: clean(note, MOST_NOTE) || null,
    at: new Date().toISOString(),
    by: by ? clean(by, 40) : null
  }
  list.push(row)

  // Oldest first, capped. A notebook that grows for ever becomes a thing nobody
  // reads, and the entries that matter are the ones touched recently.
  const sorted = list.sort((a, b) => String(a.at).localeCompare(String(b.at)))
  write(sorted.slice(-MOST_ROWS))
  return row
}

function forget (about) {
  const what = clean(about, 80)
  const list = read()
  const found = list.find(r => r.about === what)
  if (!found) throw new Error(`Nothing is being carried about "${about}".`)
  write(list.filter(r => r.about !== what))
  return { forgotten: found.about, was: found.state }
}

const clear = () => write([])

module.exports = { all, set, forget, clear, read, USUAL, FILE }
