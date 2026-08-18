'use strict'

// WHAT HAS BEEN SPENT, AND ON WHOSE SIGN-IN.
//
// Every model run this app causes happens under a named identity — a guest, in
// core/guests.js — and until now nothing wrote down that it happened. A turn
// logged "it thought for 38s" and a job logged an exit code; what it COST went
// into the transcript on a machine and, for a worker, was rolled back with the
// machine a minute later.
//
// PER KEY, BECAUSE THAT IS THE QUESTION. "How much has this app spent" is mildly
// interesting; "which account is this being billed to, and how much" is a
// question with a person's name on it — the same reason the supervisor's sign-in
// is picked deliberately rather than taken as whichever is free. A host with
// three sign-ins and one number cannot answer it.
//
// A ROW PER RUN, NEVER A RUNNING TOTAL. Totals are computed on the way out, so a
// row that was recorded wrongly can be removed and the totals are simply right
// afterwards. A stored total is a number nothing can check.
//
// WHAT IS NOT HERE: any attempt to price anything. `cost` is what the model's own
// result line said it cost, carried through unchanged and null when it did not
// say. This app does not know anybody's rates and a number it invented would be
// indistinguishable from one it was told.

const fs = require('node:fs')
const path = require('node:path')
const data = require('./data')

// Beside the settings and the triage notebook, not per workspace: a sign-in
// spans whatever it was pointed at, and so does what it spent.
const FILE = () => path.join(data.state(), 'meter.json')

// Enough to see a month of ordinary use. Trimmed from the front, so what is lost
// is the oldest — and the totals say how many rows they are computed from, so a
// trim is visible rather than silent.
const MOST_ROWS = 5000

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

const num = v => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// WHAT A `result` LINE SAYS, in this app's words rather than the CLI's.
//
// One place that knows those field names, because they are somebody else's and
// will change. Everything downstream reads `turns`, `cost`, `input`, `output` —
// so the day the CLI renames one, this is the only file that is wrong.
//
// USAGE IS FOUR NUMBERS, NOT ONE. Cached reads are the bulk of a long brief and
// are charged differently from fresh input; adding them together would produce a
// number that looks like context size and is not comparable to anything.
function fromResult (e) {
  if (!e || typeof e !== 'object') return null
  const u = e.usage || {}
  return {
    turns: num(e.num_turns),
    cost: num(e.total_cost_usd),
    ms: num(e.duration_ms),
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cacheRead: num(u.cache_read_input_tokens),
    cacheWrite: num(u.cache_creation_input_tokens),
    // Whether the run itself said it went wrong. A turn that errored still spent
    // what it spent, so it is recorded and marked rather than dropped.
    trouble: e.is_error === true || String(e.subtype || '') === 'error_during_execution'
  }
}

// One run. `key` is the sign-in it was spent on, and it is the field this whole
// file exists for — a row without one is still recorded, because losing the
// spend is worse than losing the attribution, and it shows as "not attributed"
// rather than being quietly folded into somebody's total.
function record ({ key = null, machine = null, kind, about = null, ref = null, ...rest }) {
  const row = {
    at: new Date().toISOString(),
    key: key ? String(key) : null,
    machine: machine ? String(machine) : null,
    // 'supervisor' for a waking, 'job' for a worker's run. Kept as a plain
    // string rather than an enum: a third kind will arrive and a list here
    // would be one more thing to remember to extend.
    kind: String(kind || 'run'),
    about: about ? String(about).slice(0, 200) : null,
    ref: ref ? String(ref) : null,
    turns: null,
    cost: null,
    ms: null,
    input: null,
    output: null,
    cacheRead: null,
    cacheWrite: null,
    trouble: false,
    ...rest
  }
  write([...read(), row].slice(-MOST_ROWS))
  return row
}

const add = (a, b) => (a == null && b == null ? null : Number(a || 0) + Number(b || 0))

function tallyOf (rows) {
  return rows.reduce((t, r) => ({
    runs: t.runs + 1,
    turns: add(t.turns, r.turns),
    cost: add(t.cost, r.cost),
    ms: add(t.ms, r.ms),
    input: add(t.input, r.input),
    output: add(t.output, r.output),
    cacheRead: add(t.cacheRead, r.cacheRead),
    cacheWrite: add(t.cacheWrite, r.cacheWrite),
    trouble: t.trouble + (r.trouble ? 1 : 0),
    first: t.first && t.first < r.at ? t.first : r.at,
    last: t.last && t.last > r.at ? t.last : r.at
  }), { runs: 0, turns: null, cost: null, ms: null, input: null, output: null, cacheRead: null, cacheWrite: null, trouble: 0, first: null, last: null })
}

// BY KEY, AND A TOTAL. Both from the same rows in one pass over the same
// function, so the columns cannot disagree with the line at the top — which is
// the one bug a summary screen always has.
function byKey (rows = read()) {
  const names = [...new Set(rows.map(r => r.key || null))]
  return names
    .map(name => ({ key: name, ...tallyOf(rows.filter(r => (r.key || null) === name)) }))
    .sort((a, b) => Number(b.cost || 0) - Number(a.cost || 0) || b.runs - a.runs)
}

const all = () => read().slice().sort((a, b) => String(b.at).localeCompare(String(a.at)))
const total = (rows = read()) => tallyOf(rows)
const clear = () => write([])

module.exports = { record, fromResult, all, byKey, total, tallyOf, read, clear, FILE, MOST_ROWS }
