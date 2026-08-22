'use strict'

// WHAT A MODEL IS DOING, WHILE IT IS DOING IT.
//
// THIS FILE RUNS IN A GUEST, NOT HERE. It is read as text and written into a
// machine — the same arrangement as job-api.js and job-runner.js beside it, and
// for the same reason: it can be linted, syntax-checked and read like the code
// it is, instead of living as an escaped string inside another file. It was one
// of those for an afternoon and that was long enough.
//
// A claude log in `stream-json` is one event per line, each a complete JSON
// object carrying far more than anybody watching wants. This turns it into the
// four things a person is actually looking for -- what it said, what it reached
// for, what came back, and what it cost -- and drops the rest.
//
// It reads stdin and nothing else, so it is a filter: `tail -f | this`. Nothing
// here decides what to follow, which is why it works the same on a worker's run,
// on a supervisor's turn, and on a log that finished yesterday.

const DIM = '\x1b[38;5;244m'
const OFF = '\x1b[0m'
const LIT = '\x1b[38;5;39m'
const BAD = '\x1b[31m'

let rest = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', d => {
  rest += d
  const lines = rest.split('\n')
  // The last piece is whatever arrived without its newline yet. Held rather
  // than parsed: tail hands over what the writer has flushed, and half an event
  // is the ordinary case rather than a broken one.
  rest = lines.pop()
  for (const line of lines) show(line)
})

// One line, and short enough to sit in a terminal beside a name.
function brief (s) {
  const one = String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
  return one.length > 140 ? one.slice(0, 137) + '...' : one
}

function show (line) {
  const text = line.trim()
  if (!text) return
  // Anything that is not an event is printed as it came. A model that fails to
  // start says so in plain words, and that is the most important line in the
  // file when it happens.
  if (text.charAt(0) !== '{') { console.log(DIM + text + OFF); return }

  let e = null
  try { e = JSON.parse(text) } catch (err) { console.log(DIM + brief(text) + OFF); return }

  if (e.type === 'system') {
    console.log(DIM + '[' + (e.subtype || 'system') + (e.model ? ' ' + e.model : '') + ']' + OFF)
    return
  }

  if (e.type === 'assistant' && e.message) {
    for (const part of e.message.content || []) {
      if (part.type === 'text' && String(part.text).trim()) console.log(String(part.text).trim())
      if (part.type === 'tool_use') {
        const put = part.input || {}
        const what = put.command || put.file_path || put.path || put.pattern || put.url || put.prompt || ''
        console.log(LIT + '-> ' + part.name + OFF + (what ? ' ' + DIM + brief(what) + OFF : ''))
      }
    }
    return
  }

  if (e.type === 'user' && e.message) {
    for (const part of e.message.content || []) {
      if (part.type !== 'tool_result') continue
      const body = part.content
      const said = typeof body === 'string'
        ? body
        : (Array.isArray(body) ? body.map(x => (x && x.text) || '').join(' ') : '')
      const lines = String(said).split('\n').length
      console.log((part.is_error ? BAD : DIM) + '   ' + brief(said) +
        (lines > 1 ? ' (' + lines + ' lines)' : '') + OFF)
    }
    return
  }

  if (e.type === 'result') {
    console.log(LIT + '[' + (e.subtype || 'result') + ' -- ' + (e.num_turns || 0) + ' turns' +
      (e.total_cost_usd ? ', ' + Number(e.total_cost_usd).toFixed(4) + ' USD' : '') + ']' + OFF)
  }
}
