'use strict'

// One live log, tagged, that everything writes into.
//
// Tags rather than levels or separate files, because the question a person
// actually asks is "what happened with the VM" or "what did git do", and that is
// a filter, not a place to go looking. Every line carries where it came from, so
// the log is one stream you narrow rather than several you correlate.
//
// IT IS IN MEMORY ON PURPOSE, AND THE REAL REASON IS CREDENTIALS.
//
// The stated reason used to be that this is what is happening NOW, and that the
// durable record of a change is the commit it became. True, and not the load-
// bearing half. Command output goes through here — `out()` exists for exactly
// that — and command output during ordinary use carries sign-in URLs, tokens
// being placed, and whatever a worker printed. Writing this stream to a file
// would put all of it on disk, in cleartext, in a file nothing else in this app
// treats as a secret. `core/secret.js` exists because that was already decided
// once for the credential itself.
//
// So the cost is accepted, and it is a real cost: a restart loses the record of
// what somebody did, and this app's own development restarts it every few
// minutes. "Who unmarked that group?" was unanswerable for exactly this reason.
// The answer to that is to WATCH the log while it exists, not to write it down.
//
// If a durable record is ever wanted, it needs redaction at the boundary and a
// decision about where it lives — not an append call added here.

const MAX = 2000
const entries = []
const listeners = new Set()
let seq = 0

function add (tags, text, level = 'info') {
  const entry = {
    id: ++seq,
    at: new Date().toISOString(),
    tags: [...new Set(tags.filter(Boolean))],
    level,
    text: String(text).replace(/\s+$/, '')
  }
  entries.push(entry)
  if (entries.length > MAX) entries.splice(0, entries.length - MAX)
  for (const fn of listeners) {
    try { fn(entry) } catch { listeners.delete(fn) }
  }
  return entry
}

// A logger with its tags already on it, so callers never have to remember to tag
// consistently -- untagged lines are the ones that make a filter useless.
const on = (...tags) => ({
  info: (text, ...more) => add([...tags, ...more], text, 'info'),
  good: (text, ...more) => add([...tags, ...more], text, 'good'),
  warn: (text, ...more) => add([...tags, ...more], text, 'warn'),
  bad: (text, ...more) => add([...tags, ...more], text, 'bad'),
  // Multi-line command output, split so each line is filterable on its own.
  out: (text, ...more) => String(text).split('\n').filter(l => l.trim())
    .forEach(l => add([...tags, ...more], l, 'out')),
  on: (...more) => on(...tags, ...more)
})

// Everything after an id -- unless that id is from a LOG THAT NO LONGER EXISTS.
//
// Ids count from 1 and reset when this process does, because the log is in
// memory and is what is happening NOW. So a watcher that reconnects after a
// restart asks for "everything after 412" of a log whose newest line is 3, and
// is answered with nothing, for ever: it is connected, it is healthy, and it
// will never print another line. That is a worse failure than dropping out,
// because it looks exactly like a quiet system.
//
// An id higher than anything here cannot be one of ours, and the only way to
// hold one is to have been watching a previous life of this process. So it is
// read as "start again" rather than as a filter, and the reconnect shows the new
// instance from its first line -- which is the honest answer: this log did just
// begin.
const since = id => {
  const from = Number(id || 0)
  const newest = entries.length ? entries[entries.length - 1].id : 0
  return from > newest ? entries.slice() : entries.filter(e => e.id > from)
}

// Every tag currently in the log, with how many lines carry it. The UI builds
// its filters from this rather than from a hardcoded list, so a new tag anywhere
// shows up as a filter without anything being registered.
function tags () {
  const count = new Map()
  for (const e of entries) for (const t of e.tags) count.set(t, (count.get(t) || 0) + 1)
  return [...count.entries()].map(([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n)
}

function subscribe (fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const clear = () => { entries.length = 0 }

module.exports = { add, on, since, tags, subscribe, clear, all: () => entries }
