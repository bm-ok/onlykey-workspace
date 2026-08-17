'use strict'

// WHAT THE PERSON AND THE SUPERVISOR SAY TO EACH OTHER.
//
// Everything else in this app is a record of what was DONE — a task written, a
// branch cut, a run finished. This is the other half: what was asked for and what
// was said about it, in the order it was said.
//
// A FILE, NOT A SOCKET. Both ends are already asking this host things on their
// own rhythm — the window redraws every few seconds, the supervisor asks what is
// new when it has finished thinking — so the thing between them has to survive
// both of them being away. A supervisor is switched off most of the time and a
// window is closed most of the night; a conversation that only exists while both
// are connected is one that loses whichever half arrived first.
//
// APPEND ONLY, AND NUMBERED. Every line gets a number that never repeats, which
// is what makes "what is new since I last looked" answerable without either side
// remembering anything except one integer. That number is the whole protocol.
//
// WHO SAID IT IS RECORDED AND NEVER INFERRED. A line from the supervisor arrives
// over the wire, with the machine's own token; a line from the person arrives
// through the window. Nothing accepts a claim about which — see the actions —
// because the one question this record has to answer six weeks later is who
// asked for a thing.
//
// NOT A TRANSCRIPT. What the supervisor's model said to ITSELF while thinking is
// its session, kept per task and archived — see tasks/sessions.js. This is only
// what it chose to say out loud, which is a much shorter and much more useful
// list.

const fs = require('node:fs')
const path = require('node:path')
const data = require('./data')

const FILE = () => path.join(data.state(), 'chat.jsonl')

// One line per message, so an interrupted write costs one line rather than the
// file — the same reason the event stream is jsonl. A conversation is worth more
// than the newest thing in it.
function read () {
  let text = ''
  try { text = fs.readFileSync(FILE(), 'utf8') } catch { return [] }
  const out = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try { out.push(JSON.parse(line)) } catch { /* a half-written last line */ }
  }
  return out
}

const lastNumber = () => {
  const all = read()
  return all.length ? Number(all[all.length - 1].n) || all.length : 0
}

// WHO MAY SPEAK, and there are exactly two kinds. A third would need a reason
// and a column, and neither exists yet.
const WHO = new Set(['person', 'supervisor'])

function say ({ who, text, from = null, about = null }) {
  if (!WHO.has(who)) throw new Error(`"${who}" is not somebody who talks here. It is a person or a supervisor.`)
  const said = String(text == null ? '' : text).trim()
  if (!said) throw new Error('There is nothing to say.')
  // Long enough for a supervisor to explain itself, short enough that this file
  // stays something a person can read. A model that needs more than this is
  // writing a document, and a document belongs on a branch.
  if (said.length > 20000) throw new Error(`that is ${said.length} characters, and the most a message takes is 20000. Put anything longer where it belongs — a task brief, or a file on a branch.`)

  const line = {
    n: lastNumber() + 1,
    at: new Date().toISOString(),
    who,
    // Which machine, when it was a supervisor. Two supervisors are not supposed
    // to run at once — see vmStart — and this is what would show it if they did.
    from: from || null,
    // What it is about, when it is about something: a task number, a cut, an
    // issue. Free text on purpose; this is a note beside a message, not an index.
    about: about || null,
    text: said
  }

  try { fs.mkdirSync(path.dirname(FILE()), { recursive: true }) } catch { /* it exists */ }
  fs.appendFileSync(FILE(), JSON.stringify(line) + '\n', 'utf8')
  return line
}

// Everything, or everything after a number. `since` is what the other end was
// last told, so it is EXCLUSIVE: asking again with the same number twice must
// not deliver the same message twice.
function since (n = 0, { limit = 200 } = {}) {
  const from = Number(n) || 0
  const all = read().filter(m => Number(m.n) > from)
  // The oldest first, because a conversation read newest-first is not a
  // conversation. Trimmed from the FRONT when there is too much, so what comes
  // back is the most recent — an end that has been away for a week wants what
  // was said last, not what was said first.
  const rows = all.slice(-Math.max(1, Math.min(1000, Number(limit) || 200)))
  return {
    messages: rows,
    // What to ask with next time. The last number SEEN rather than the last
    // delivered, so a trimmed answer does not silently skip the middle.
    bookmark: rows.length ? Number(rows[rows.length - 1].n) : from,
    missed: all.length - rows.length
  }
}

// The whole thing, for the window, which draws it all and has no bookmark.
const all = () => read()

// Thrown away deliberately, and only ever whole: half a conversation reads worse
// than none, and there is nothing here worth keeping selectively.
function clear () {
  try { fs.rmSync(FILE(), { force: true }) } catch { /* it was never there */ }
  return { cleared: true }
}

module.exports = { say, since, all, clear, lastNumber, FILE }
