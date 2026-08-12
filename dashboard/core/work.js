'use strict'

// The loop, and the only place status lives.
//
// One branch. An attempt is whatever is above HEAD in the working tree, and
// accept is the act that turns it into a commit -- so unreviewed work is never in
// history, which is how "nothing reaches your branch unread" survives having no
// branch to hide behind. See CONTRACT.md, "Isolation".
//
// Status is kept in plain words because the person driving reads this.

const fs = require('node:fs')
const path = require('node:path')
const git = require('./git')
const eco = require('./ecosystem')
const checks = require('./checks')
const log = require('./log')

const STATE = process.env.OKC_STATE || path.join(__dirname, '..', 'state')
const FILE = path.join(STATE, 'work.json')
const BIN = path.join(STATE, 'thrown-away')

const read = () => fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : []

const write = items => {
  fs.mkdirSync(STATE, { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(items, null, 2))
}

const find = id => {
  const item = read().find(w => w.id === id)
  if (!item) throw new Error(`No attempt called "${id}"`)
  return item
}

const save = item => {
  write([...read().filter(w => w.id !== item.id), item])
  return item
}

const reposOf = item => eco.reposFor(eco.load(item.ecosystem), eco.task(eco.load(item.ecosystem), item.task))

// The check that stops the tool from destroying anything it did not cause. An
// attempt remembers the commit it started from; if the branch has moved since,
// something outside this attempt happened and the tool declines to act on it.
async function stillOurs (item, repos) {
  const moved = []
  for (const r of repos) {
    if (await git.head(r.dir) !== item.startHead[r.name]) moved.push(r.name)
  }
  return moved
}

const movedError = moved => new Error(
  `${moved.join(' and ')} ${moved.length === 1 ? 'has' : 'have'} a new commit that this attempt did not make — someone committed by hand, or pulled. Nothing was changed. Deal with that commit first.`)

// ---- pick -------------------------------------------------------------

function tasks (ecosystemId) {
  const e = eco.load(ecosystemId)
  const items = read()
  return e.tasks.map(t => ({
    id: t.id,
    title: t.title,
    detail: t.detail || '',
    repos: t.repos,
    open: items
      .filter(w => w.task === t.id && (w.status === 'working' || w.status === 'offered'))
      .map(w => ({ id: w.id, status: w.status }))
  }))
}

async function start (ecosystemId, taskId) {
  const e = eco.load(ecosystemId)
  const t = eco.task(e, taskId)
  const repos = eco.reposFor(e, t)

  // A working tree holds exactly one attempt, so anything already in it would be
  // absorbed into this one and then destroyed by throwing it away.
  for (const r of repos) {
    if (!await git.isClean(r.dir)) {
      throw new Error(`"${r.name}" has changes that are not committed yet. Nothing was started, so nothing was lost — finish or throw those away first.`)
    }
  }

  const busy = read().find(w =>
    (w.status === 'working' || w.status === 'offered') && w.repos.some(n => t.repos.includes(n)))
  if (busy) {
    throw new Error(`"${busy.title}" is still open in the same ${busy.repos.length === 1 ? 'repository' : 'repositories'}. One thing at a time — finish or throw that away first.`)
  }

  const startHead = {}
  for (const r of repos) {
    startHead[r.name] = await git.head(r.dir)
    log.on('git', r.name).info(`${r.name} is on ${r.branch} at ${startHead[r.name].slice(0, 8)}`)
  }
  log.on('work').good(`Started "${t.title}" in ${repos.map(r => r.name).join(', ')}. No branch was cut and nothing was committed.`)

  return save({
    id: `${taskId}-${String(read().length + 1).padStart(3, '0')}`,
    task: t.id,
    title: t.title,
    ecosystem: e.id,
    repos: repos.map(r => r.name),
    where: repos.map(r => ({ repo: r.name, at: r.dir, branch: r.branch })),
    startHead,
    status: 'working',
    started: new Date().toISOString(),
    checks: [],
    note: ''
  })
}

// ---- offer ------------------------------------------------------------

async function offer (id) {
  const item = find(id)
  const repos = reposOf(item)

  const moved = await stillOurs(item, repos)
  if (moved.length) throw movedError(moved)

  let any = false
  for (const r of repos) if ((await git.attempt(r.dir)).files.length) any = true
  if (!any) throw new Error('There is nothing to offer yet — no files have been changed.')

  const t = eco.task(eco.load(item.ecosystem), item.task)
  item.checks = []
  for (const r of repos) {
    for (const c of await checks.run(t.checks, r.dir)) {
      item.checks.push({ repo: r.name, ...c })
      log.on('check', r.name)[c.ok ? 'good' : 'bad'](`${c.name}${c.ok ? '' : ` — ${c.output.split('\n')[0]}`}`)
    }
  }
  log.on('work').info(`"${item.title}" is offered for review.`)

  item.status = 'offered'
  item.offered = new Date().toISOString()
  return save(item)
}

// ---- review -----------------------------------------------------------

// The change itself, gathered rather than pointed at.
async function review (id) {
  const item = find(id)
  const repos = reposOf(item)

  const parts = []
  for (const r of repos) {
    const a = await git.attempt(r.dir)
    parts.push({ repo: r.name, branch: r.branch, ready: a.files.length > 0, files: a.files, stat: a.stat })
  }

  const missing = parts.filter(p => !p.ready).map(p => p.repo)
  return {
    work: item,
    parts,
    canAccept: parts.length > 0 && missing.length === 0,
    missing,
    moved: await stillOurs(item, repos),
    checksFailed: (item.checks || []).filter(c => !c.ok)
  }
}

// ---- accept -----------------------------------------------------------

// Commits to every repo in the task or to none of them.
//
// Proving each repo is *ready* is not the same as proving each will *succeed*, so
// there are two phases: a pre-flight that can refuse while nothing has happened,
// and a commit phase that undoes its own work if a later repo fails.
async function accept (id, note) {
  if (!note || note.trim().length < 8) {
    throw new Error('Say in one line what you checked. That is the whole point of this step — a click without it is not a review.')
  }

  const item = find(id)
  const repos = reposOf(item)

  // --- pre-flight: refuse while nothing has been touched ---------------
  const moved = await stillOurs(item, repos)
  if (moved.length) throw movedError(moved)

  const empty = []
  for (const r of repos) if (!(await git.attempt(r.dir)).files.length) empty.push(r.name)
  if (empty.length) {
    throw new Error(`This task covers ${item.repos.length} repositories and nothing has changed in ${empty.join(' or ')}. Nothing was committed.`)
  }

  // --- commit: all of them, or none -----------------------------------
  const message = `${item.title}\n\nReviewed: ${note.trim()}\nAttempt: ${item.id}\n`
  const made = []
  let failed = null
  try {
    for (const r of repos) {
      failed = r.name
      const sha = await git.commit(r.dir, message)
      made.push({ repo: r, sha })
      log.on('git', r.name).good(`Committed ${sha.slice(0, 8)} on ${r.branch}`)
    }
    failed = null
  } catch (e) {
    const undone = []
    const stuck = []
    for (const m of made.reverse()) {
      // Only ever undo a commit this action just made, and only if the tip is
      // still exactly that commit. Anything else is left alone and reported.
      if (await git.head(m.repo.dir) === m.sha) {
        await git.rollback(m.repo.dir)
        undone.push(m.repo.name)
        log.on('git', m.repo.name).warn(`Undid ${m.sha.slice(0, 8)} — the set could not complete, so nothing lands. Your work is still here.`)
      } else {
        stuck.push(`${m.repo.name} (${m.sha.slice(0, 8)})`)
      }
    }
    // The first line is the git command we ran, which tells the person nothing.
    // What follows is git's own reason, which is the part worth showing.
    const why = e.message.split('\n').slice(1).join(' ').trim() || 'git gave no reason'
    throw new Error([
      `Could not commit to "${failed}": ${why}.`,
      undone.length ? `Undone, and your work is back exactly as it was, in: ${undone.join(', ')}.` : '',
      stuck.length
        ? `LEFT IN PLACE, because the branch moved underneath: ${stuck.join(', ')}. Nothing was rewritten.`
        : 'No repository was left changed.'
    ].filter(Boolean).join(' '))
  }

  item.status = 'accepted'
  item.note = note.trim()
  item.landed = made.map(m => ({ repo: m.repo.name, sha: m.sha }))
  item.acceptedAt = new Date().toISOString()
  return save(item)
}

// ---- throw away -------------------------------------------------------

// No history operation at all: the branch tip does not move. The attempt is
// written out first, because this destroys real work even when it touches no
// commit, and "safe" has to mean recoverable rather than merely reversible.
async function discard (id) {
  const item = find(id)
  const repos = reposOf(item)

  const moved = await stillOurs(item, repos)
  if (moved.length) throw movedError(moved)

  const dir = path.join(BIN, item.id)
  fs.mkdirSync(dir, { recursive: true })

  const saved = []
  for (const r of repos) {
    const a = await git.attempt(r.dir)
    if (!a.patch) continue
    const file = path.join(dir, `${r.name}.patch`)
    fs.writeFileSync(file, a.patch + '\n')
    saved.push({ repo: r.name, file, files: a.files.length })
  }

  for (const r of repos) {
    await git.restore(r.dir)
    log.on('git', r.name).info(`${r.name} is back at ${item.startHead[r.name].slice(0, 8)}. The branch did not move.`)
  }
  log.on('work').warn(`Threw away "${item.title}". Saved to ${dir} first — it can be put back.`)

  item.status = 'thrown away'
  item.saved = saved
  item.discardedAt = new Date().toISOString()
  return save(item)
}

// The other half of making that safe. Without this, the patch is a file nobody
// knows how to use, which is not a recovery path.
async function putBack (id) {
  const item = find(id)
  if (item.status !== 'thrown away') throw new Error('That attempt was not thrown away.')
  const repos = reposOf(item)

  for (const r of repos) {
    if (!await git.isClean(r.dir)) {
      throw new Error(`"${r.name}" has changes in it now. Putting this back would collide with them, so nothing was touched.`)
    }
  }

  const back = []
  for (const s of item.saved || []) {
    const r = repos.find(x => x.name === s.repo)
    if (!r || !fs.existsSync(s.file)) continue
    await git.apply(r.dir, s.file)
    back.push(s.repo)
  }
  if (!back.length) throw new Error('There is no saved copy of that attempt to put back.')

  item.status = 'working'
  item.putBackAt = new Date().toISOString()
  return save(item)
}

module.exports = { tasks, start, offer, review, accept, discard, putBack, all: read, find }
