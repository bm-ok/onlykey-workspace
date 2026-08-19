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
const landings = require('./landings')

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

// ---- which of them were this host's own, and have gone --------------------
//
// SEPARATED FROM THE ASKING SO IT CAN BE CHECKED WITHOUT A NETWORK. Deciding
// which watched things have ended is arithmetic over two records; finding out
// what became of one is a trip to GitHub. Folded together the rule could only be
// tested by merging something, and "merge a real pull request" is not a thing a
// drill may do.
//
// `into` IS WHAT THE RECORD STORES. `on` is the name the same field carries in
// `landings.state()`, which is a live projection rather than what is kept --
// reading for `on` here matched nothing at all, silently, and the whole set came
// out empty. Both are accepted so either record can be handed in.
function endedAmong (seen, now, cuts) {
  const ours = new Set()
  for (const cut of Object.values(cuts || {})) {
    for (const p of cut.pulls || []) {
      const on = p.into || p.on
      if (on && p.number) ours.add(idOf(on, 'pull', p.number))
    }
  }

  // STILL IN `now` MEANS IT HAS NOT GONE, and that covers two different cases on
  // purpose: it is still open, or its repository could not be read this look and
  // was carried forward. A repository that did not answer has not told us
  // anything has gone from it.
  return Object.entries(seen || {})
    .filter(([id, had]) => !(now || {})[id] && had && had.kind === 'pull' && ours.has(id))
    .map(([, had]) => had)
}

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

  // ---- AND A CUT OF THIS HOST'S OWN, REACHING ITS END ----------------------
  //
  // "What is gone is not reported" is right above, and it stays right for an
  // issue: somebody else closed it, and it was never this host's loop to close.
  // It was wrong for ONE case. A pull request this host cut is the far end of
  // something that started here -- a draft written, a line made, a branch pushed
  // -- and its disappearance is that loop finishing. Nothing said so. A change
  // merged three minutes after the supervisor recommended it, and the supervisor
  // closed the item about WAITING for the press and then sat with the item about
  // the actual work still marked as being done, because the only thing that
  // could have told it had been deliberately silent.
  //
  // NARROW ON PURPOSE. Only a pull request, only one that belongs to a cut in
  // the landings record, and only from a repository that ANSWERED this look --
  // the same condition as the carry-forward above, because a repository that
  // could not be read has not told us anything has gone from it. Every waking
  // costs a turn of somebody's money; this is the smallest set that closes the
  // loop.
  //
  // AND IT ASKS WHAT BECAME OF IT rather than assuming. Gone from the open list
  // means closed, and closed is not merged -- a cut somebody rejected is news
  // too, and it is different news. One call, only for the few that vanished.
  const ended = []
  for (const had of endedAmong(seen, now, landings.all())) {
    let became = null
    try { became = await remotes.pullAt(had.on, had.number) } catch { /* it is gone from the open list either way */ }
    ended.push({ ...had, merged: !!(became && became.merged), asked: !!became })
  }

  write(now)

  return { at, open: found, fresh, moved, ended, trouble, watched: Object.keys(now).length }
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

module.exports = { look, lastLook, endedAmong, read, FILE }
