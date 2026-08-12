'use strict'

// The loop, and the only place status lives.
//
// Five actions and no vocabulary: pick, work, offer, review, accept. Everything
// else in this folder exists so those five keep their promises, and none of it
// should have to be understood to use them. State is kept in plain words because
// the person driving reads this, not a run record.

const fs = require('node:fs')
const path = require('node:path')
const git = require('./git')
const eco = require('./ecosystem')
const sandbox = require('./sandbox')

const STATE = process.env.OKC_STATE || path.join(__dirname, '..', 'state')
const FILE = path.join(STATE, 'work.json')

const read = () => fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : []
const write = items => {
  fs.mkdirSync(STATE, { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(items, null, 2))
}

const find = id => {
  const item = read().find(w => w.id === id)
  if (!item) throw new Error(`No work called "${id}"`)
  return item
}

const save = item => {
  const items = read().filter(w => w.id !== item.id)
  items.push(item)
  write(items)
  return item
}

const boxFor = e => sandbox.open(e.sandbox, name => eco.repo(e, name).dir)

// What a person is offered to pick from. Tasks the ecosystem declares, each
// already carrying whether it is in flight, so the list is the whole answer.
function tasks (ecosystemId) {
  const e = eco.load(ecosystemId)
  const items = read()
  return e.tasks.map(t => ({
    id: t.id,
    title: t.title,
    detail: t.detail || '',
    repos: t.repos,
    open: items.filter(w => w.task === t.id && w.status !== 'accepted' && w.status !== 'thrown away')
      .map(w => ({ id: w.id, status: w.status }))
  }))
}

// ---- pick -------------------------------------------------------------

async function start (ecosystemId, taskId) {
  const e = eco.load(ecosystemId)
  const t = eco.task(e, taskId)
  const repos = eco.reposFor(e, t)

  for (const r of repos) {
    if (!await git.isClean(r.dir)) {
      throw new Error(`"${r.name}" has changes that are not committed. Nothing was started, so nothing was lost — commit or undo them first.`)
    }
  }

  const id = `${taskId}-${String(read().length + 1).padStart(3, '0')}`
  const branch = `work/${id}`
  const where = await boxFor(e).prepare(branch, repos)

  return save({
    id,
    task: t.id,
    title: t.title,
    ecosystem: e.id,
    branch,
    repos: repos.map(r => r.name),
    where,
    status: 'working',
    started: new Date().toISOString(),
    checks: [],
    note: ''
  })
}

// ---- offer ------------------------------------------------------------

async function offer (id) {
  const item = find(id)
  const e = eco.load(item.ecosystem)
  const t = eco.task(e, item.task)
  const repos = eco.reposFor(e, t)
  const box = boxFor(e)

  item.checks = await sandbox.check(box, t.checks, repos[0] && repos[0].name)
  await box.offer(item.branch, repos)

  const changed = []
  for (const r of repos) {
    const ahead = await git.hasBranch(r.dir, item.branch)
      ? await git.commitsAhead(r.dir, item.branch, r.base) : 0
    if (ahead > 0) changed.push(r.name)
  }

  if (!changed.length) {
    throw new Error('There is nothing to offer yet — no work has been committed on this task.')
  }

  item.status = 'offered'
  item.offered = new Date().toISOString()
  item.changedRepos = changed
  return save(item)
}

// ---- review -----------------------------------------------------------

// Everything the reviewer needs, gathered rather than cited. The last version
// answered "what did this do" with a record the person had to go find; this
// returns the answer itself.
async function review (id) {
  const item = find(id)
  const e = eco.load(item.ecosystem)
  const repos = eco.reposFor(e, eco.task(e, item.task))

  const parts = []
  for (const r of repos) {
    const has = await git.hasBranch(r.dir, item.branch)
    parts.push({
      repo: r.name,
      ready: has && await git.commitsAhead(r.dir, item.branch, r.base) > 0,
      commits: has ? await git.log(r.dir, item.branch, r.base) : [],
      files: has ? await git.changedFiles(r.dir, item.branch, r.base) : [],
      stat: has ? await git.diffStat(r.dir, item.branch, r.base) : ''
    })
  }

  // A task declares the repos it spans, and it lands as one unit. One repo
  // half-landing is the thing a set exists to prevent, so a partly-ready set is
  // reported as partly ready rather than merged in pieces.
  const missing = parts.filter(p => !p.ready).map(p => p.repo)
  return {
    work: item,
    parts,
    canAccept: parts.length > 0 && missing.length === 0,
    missing,
    checksFailed: (item.checks || []).filter(c => !c.ok)
  }
}

// ---- accept -----------------------------------------------------------

async function accept (id, note) {
  if (!note || note.trim().length < 8) {
    throw new Error('Say in one line what you checked. This is the whole point of the step — a click without it is not a review.')
  }
  const item = find(id)
  const r = await review(id)
  if (!r.canAccept) {
    // Name the repos, so the answer is here rather than somewhere to go look.
    throw new Error(`This task covers ${item.repos.length} repositories and there is no work in ${r.missing.join(' or ')} yet. Nothing was merged.`)
  }

  const e = eco.load(item.ecosystem)
  const repos = eco.reposFor(e, eco.task(e, item.task))

  const message = `${item.title}\n\nReviewed: ${note.trim()}\nWork: ${item.id}\n`
  const landed = []
  for (const x of repos) {
    await git.squashMerge(x.dir, item.branch, x.base, message)
    landed.push(x.name)
  }

  item.status = 'accepted'
  item.note = note.trim()
  item.landed = landed
  item.acceptedAt = new Date().toISOString()
  return save(item)
}

// ---- throw away -------------------------------------------------------

// Not data loss. It is the decision that the attempt did not happen, which is
// what makes trying something cheap.
async function discard (id) {
  const item = find(id)
  const e = eco.load(item.ecosystem)
  for (const r of eco.reposFor(e, eco.task(e, item.task))) {
    if (await git.head(r.dir) === item.branch) await git.checkout(r.dir, r.base)
  }
  item.status = 'thrown away'
  return save(item)
}

module.exports = { tasks, start, offer, review, accept, discard, all: read, find }
