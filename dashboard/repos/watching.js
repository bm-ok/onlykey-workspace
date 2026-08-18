'use strict'

// WHAT ARRIVED ON GITHUB WHILE NOBODY WAS LOOKING.
//
// Everything else in this app begins with somebody writing a task. An issue and
// a pull request are the two things that turn up on their own, from outside,
// and until now nothing here noticed one: the supervisor could ASK about them —
// `issues` and `pulls` are on its list — but nothing ever told it there was
// anything to ask about. So it woke, saw nothing new, and went back to sleep
// with an open issue sitting there.
//
// THIS IS THE ONE PLACE THAT ASKS GITHUB ON A CADENCE, and it is deliberate
// rather than an exception being smuggled in. The rule in repos/remotes.js is
// that network calls are never on a TIMER driven by the window's draw loop —
// three seconds, forever, whether or not anybody is there. This is a different
// thing: a slow, opt-in look, at a cadence measured in minutes, run by the
// queue rather than by a paint function, and off until somebody switches it on.
//
// WHAT IS KEPT IS WHAT WAS SEEN, not what is true now. Two numbers per
// repository — the issues and pull requests that were open at the last look —
// so "what is new" can be answered by comparing rather than by remembering to
// notice. The moment anything reads this it is already history; that is why
// every answer carries the time it was taken.

const fs = require('node:fs')
const path = require('node:path')
const workspaces = require('../core/workspaces')
const remotes = require('./remotes')

const FILE = () => path.join(workspaces.stateDir(), 'watching.json')

const read = () => {
  try { return JSON.parse(fs.readFileSync(FILE(), 'utf8')) || {} } catch { return {} }
}

const write = seen => {
  try { fs.mkdirSync(workspaces.stateDir(), { recursive: true }) } catch { /* it exists */ }
  try { fs.writeFileSync(FILE(), JSON.stringify(seen, null, 2)) } catch { /* the answer still stands for this call */ }
}

// `owner/name#number`, the same spelling used everywhere else a pull request or
// an issue is named.
const idOf = (on, kind, number) => `${on} ${kind}#${number}`

// ---- looking --------------------------------------------------------------
//
// One trip per repository, for issues and for pull requests. Every repository
// in the workspace, because "which repositories does this project have" is the
// workspace's answer and not something a watcher should be told separately.
//
// FAILURES ARE PER REPOSITORY. A workspace where one remote is unreachable
// still learns about the other two, and the one that failed says why rather
// than taking the whole look down with it.
async function look () {
  const at = new Date().toISOString()
  const before = read()
  const seen = { ...before }
  const found = []
  const trouble = []

  for (const row of remotes.read()) {
    const on = row.issuesOn || (row.remote && row.remote.owner ? `${row.remote.owner}/${row.remote.repo}` : null)
    if (!on) continue

    for (const kind of ['issue', 'pull']) {
      try {
        const said = kind === 'issue'
          ? await remotes.issuePage(on, { state: 'open', perPage: 100 })
          : await remotes.pullPage(on, { state: 'open', perPage: 100 })
        const rows = (kind === 'issue' ? said.issues : said.pulls) || []
        for (const one of rows) {
          found.push({
            id: idOf(on, kind, one.number),
            kind,
            on,
            repo: row.repo,
            number: one.number,
            title: one.title,
            url: one.url,
            by: one.by || null,
            // A pull request moves; an issue does not. Kept for both because
            // "is this the same thing I saw before" is the whole question, and
            // for a pull request the answer is the commit rather than the
            // number.
            head: kind === 'pull' ? (one.headSha || null) : null,
            at: one.at || null
          })
        }
      } catch (e) {
        trouble.push({ on, kind, why: e.message })
      }
    }
  }

  // ---- what is new, and what MOVED -----------------------------------------
  //
  // New is the obvious half. The other half is a pull request that was already
  // here and has been pushed to since: the same number, a different commit, and
  // anything decided about the old one no longer describes it. That is the same
  // rule the judging allowance follows, and it is worth waking for.
  const fresh = []
  const moved = []
  for (const one of found) {
    const had = seen[one.id]
    if (!had) { fresh.push(one); continue }
    if (one.kind === 'pull' && one.head && had.head && one.head !== had.head) moved.push({ ...one, was: had.head })
  }

  // What is gone is not reported as an event — a closed issue is not news to
  // act on — but it stops being remembered, or this file grows for ever.
  const now = {}
  for (const one of found) now[one.id] = { ...one, first: (seen[one.id] && seen[one.id].first) || at, seen: at }

  // A REPOSITORY THAT COULD NOT BE READ IS NOT A REPOSITORY WHOSE WORK IS GONE,
  // and rebuilding the record from `found` alone said it was.
  //
  // GitHub was unreachable for ten minutes overnight — ENOTFOUND, three looks in
  // a row — and every issue and pull request on all three repositories dropped
  // out of this file, because none of them was in `found`. The next look that
  // succeeded therefore saw all of them as NEW: it reported a four-hour-old pull
  // request as "arrived", woke the supervisor, and cost a turn to establish that
  // nothing had happened. The supervisor worked that out itself and said so,
  // which is the only reason it was noticed at all.
  //
  // On a repository with fifty open pull requests, one dropped connection is
  // fifty arrivals.
  //
  // So what was seen on a repository this look could not read is carried forward
  // exactly as it was, `seen` date included — because it was NOT seen. Only a
  // repository that answered gets to say what has gone from it.
  for (const [id, had] of Object.entries(seen)) {
    if (now[id]) continue
    if (trouble.some(t => t.on === had.on && t.kind === had.kind)) now[id] = had
  }

  write(now)

  return { at, open: found, fresh, moved, trouble, watched: Object.keys(now).length }
}

// What the last look saw, without asking GitHub. This is what anything on a
// draw loop or in a wake reads: it is history, and it says when it was taken.
function lastLook () {
  const seen = read()
  const rows = Object.values(seen)
  return {
    at: rows.length ? rows.map(r => r.seen).sort().pop() : null,
    open: rows,
    issues: rows.filter(r => r.kind === 'issue'),
    pulls: rows.filter(r => r.kind === 'pull')
  }
}

module.exports = { look, lastLook, read, FILE }
