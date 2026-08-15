'use strict'

// What happened, kept across restarts.
//
// THE LIVE LOG DELIBERATELY DOES NOT DO THIS, and core/log.js says why at
// length: command output goes through it, command output carries sign-in URLs
// and tokens being placed, and a file of that is a credential store nothing
// treats as one. That decision stands. This is the other half it asks for —
// redaction at the boundary, and a decision about where it lives.
//
// WHAT IT IS FOR. A dashboard restarts every few minutes while it is being
// worked on, and everything that happened before the restart went with it. So
// "I restarted it, then wrote a task" left no trace of either, and anybody
// reading afterwards — a person coming back, or a model that was not watching —
// filled the gap with whatever they expected. That is not a small failure: it is
// how a restart from the keyboard gets reported as a process detaching.
//
// WHAT GOES IN, AND THE RULE IS DELIBERATELY NARROW. Only lines this app wrote
// about its own acts, on a named allowlist of tags. Not `out`, which is raw
// command output. Not anything tagged `guest`, which is a machine talking and
// includes whatever a worker chose to print. The test is not "does this line
// look safe" — it is "did this app compose this sentence about something it
// did", which is a question with an answer rather than a judgement call made
// per line by whoever adds the next logger.
//
// It is a RECORD, not a stream. The live log is what is happening now and is
// still the thing to watch; this answers "what happened while nobody was", and
// it is small enough to read in one go.

const fs = require('node:fs')
const path = require('node:path')
const data = require('./data')

const FILE = () => path.join(data.state(), 'events.jsonl')

// The acts worth keeping, by tag. Anything not named here is not kept, so
// adding a logger somewhere new does not silently start writing to disk --
// somebody has to decide it belongs.
// Taken from the tags the code actually writes under, counted rather than
// imagined -- `log.on('...')` across the whole app. The rule is: anything that
// makes, destroys, starts or stops something.
const KEEP = new Set([
  'app', // started, closing
  'task', // written, queued, judged, thrown away — and prompts, jobs, contracts
  'job', // a job sent to a machine
  'queue', // picked up, dispatched, adopted, put away
  'vm', // made, installed, started, stopped, deleted, snapshotted, credentialed
  'machines', // the registry behind those
  'git', // branches cut, deleted, pushed to
  'workspace', // opened, closed, added, forgotten
  'keys', // this host's own identity changing
  'github', // the token being set or thrown away
  'server' // certificates, ports, startup
])

// NOT KEPT, and each for a reason rather than by omission:
//
//   window     which tab somebody is looking at. Not an act.
//   capture    a screenshot was taken. Noise, and it is usually me taking it.
//   ipc        a client connected. Says nothing about what it then did.
//   channel    a machine's socket coming and going, and every command sent down
//              it. Weather, and it is the transcript rather than the act.
//   provision  the long install, which is `out` from a guest anyway.
//   editor     opening VS Code, which changes nothing.
//
// THIS LIST WAS WRITTEN AND NEVER ENFORCED, which is worse than not having
// written it: it reads as a rule that is being applied. `worthKeeping` asked
// only whether any tag was in KEEP, and a channel entry is tagged
// `['vm', <name>, 'channel']` — so `vm` let every one of them through.
//
// The cost was the whole point of the record. `taskProgress` polls a machine for
// its runs every thirteen seconds while somebody watches a task, at three lines
// each, and those are `vm`-tagged. 89 of the last 400 entries were one poll
// saying "reading its runs" — so the answer to "what happened to runner1 while I
// was away" had already scrolled out of a two-thousand-line file. A record that
// keeps a heartbeat and drops the acts is worse than none, because it is trusted.
const NEVER = new Set(['window', 'capture', 'ipc', 'channel', 'provision', 'editor'])

// Enough to answer "what happened while I was away" without becoming an archive
// nobody reads. At roughly 150 bytes a line this is a few hundred kilobytes.
const MOST = 2000

let kept = null

function load () {
  if (kept) return kept
  kept = []
  try {
    const text = fs.readFileSync(FILE(), 'utf8')
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try { kept.push(JSON.parse(line)) } catch { /* a half-written last line */ }
    }
  } catch { /* nothing kept yet */ }
  return kept
}

// Rewritten whole rather than appended to, because the cap has to hold and a
// file that only grows is the thing that makes somebody delete the lot. At two
// thousand lines this is cheap and it happens on an act, not on a timer.
function write () {
  try {
    fs.mkdirSync(data.state(), { recursive: true })
    fs.writeFileSync(FILE(), kept.map(e => JSON.stringify(e)).join('\n') + '\n')
  } catch { /* the act still happened; only the note is lost */ }
}

// Whether a live-log entry is one of ours to keep. Exported so the rule can be
// read and tested rather than inferred from behaviour.
function worthKeeping (entry) {
  if (!entry || entry.level === 'out') return false
  const tags = entry.tags || []
  if (tags.includes('guest')) return false
  // REFUSED BEFORE THE ALLOWLIST IS ASKED. Every one of these entries also
  // carries a tag that IS kept — a channel line is tagged `vm` — so checking
  // KEEP first means the deny list can never fire.
  if (tags.some(t => NEVER.has(t))) return false
  return tags.some(t => KEEP.has(t))
}

// REDACTION AT THE BOUNDARY, which is the condition core/log.js set on any
// durable record existing at all. The allowlist above says which ACTS are kept;
// this says what may not survive inside one of them, whatever act it was.
//
// It is not decoration. `credentialsBegin` writes
//
//     runner1 is waiting to be signed in — open https://claude.ai/oauth/...
//
// under the `vm` tag, which is kept — so without this, starting a sign-in would
// put an authorize URL on disk. That is the exact thing the live log stays in
// memory to avoid, arriving through the door the allowlist opened.
//
// Whole URLs go, not just their query. The secret in a sign-in link is in the
// path as often as the parameters, and a rule that keeps "the safe half" of a
// URL is a rule somebody has to be right about every time. The host survives,
// because "it is talking to claude.ai" is the useful part and is not the secret.
//
// Anything long and random goes too, wherever it appears: tokens are pasted into
// sentences, and the next line that carries one will not be one of the two
// checked today.
const REDACT = [
  // user:pass@host, which is how a git remote carries a machine's token.
  [/\/\/[^\s/@]*:[^\s/@]*@/g, '//<credential>@'],
  // Any URL: keep the scheme and host, drop everything after it.
  [/\b(https?:\/\/[^\s/]+)\/\S*/gi, '$1/<redacted>'],
  // A long run of token-shaped characters standing on its own.
  [/\b[A-Za-z0-9_-]{24,}\b/g, '<redacted>'],
  // Anything that names itself.
  [/\b(token|secret|password|api[-_ ]?key|code)\b(\s*[=:]\s*)\S+/gi, '$1$2<redacted>']
]

function scrub (text) {
  let out = String(text == null ? '' : text)
  for (const [re, with_] of REDACT) out = out.replace(re, with_)
  return out
}

function keep (entry) {
  if (!worthKeeping(entry)) return null
  load()
  kept.push({ at: entry.at, level: entry.level, tags: entry.tags, text: scrub(entry.text) })
  if (kept.length > MOST) kept.splice(0, kept.length - MOST)
  write()
  return entry
}

// Newest last, like the live log reads. `since` is a timestamp rather than an
// id, because ids restart with the process and a timestamp does not -- which is
// the whole point of this file.
function all ({ since = null, limit = 200 } = {}) {
  const rows = load().filter(e => !since || e.at > since)
  return rows.slice(-Math.max(1, Math.min(2000, limit)))
}

const clear = () => { kept = []; write() }

module.exports = { keep, all, clear, worthKeeping, scrub, FILE, KEEP, MOST }
