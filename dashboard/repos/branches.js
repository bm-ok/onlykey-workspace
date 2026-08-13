'use strict'

// The branch a piece of work happens on, across every repository at once.
//
// The point of this file is a rule: NOTHING A MACHINE DOES REACHES A DEFAULT
// BRANCH. Work is cut onto a branch before a machine ever sees the repositories,
// so there is no moment at which the obvious thing to do -- commit, push --
// lands on master. That is not a convention anyone has to remember; it is where
// the checkout already is.
//
// ONE NAME ACROSS ALL OF THEM, because a change spans repositories: the fix in
// one, the test that pins it in another. Matching names are what make those one
// unit of work rather than several that have to be remembered together.
//
// What this does NOT do is pin a version. A branch is cut from wherever each
// repository currently is, recorded nowhere, and the name is the only thing they
// share.

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const serve = require('./serve')

// Git, read or write, in one repository. Synchronous on purpose: these are local
// ref operations on a handful of repositories, they take milliseconds, and the
// alternative is threading async through something that is really a lookup.
function git (dir, args) {
  return execFileSync('git', ['--git-dir', dir, ...args], {
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true
  }).trim()
}

const branchesIn = dir =>
  git(dir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'])
    .split('\n').map(s => s.trim()).filter(Boolean)

// Where a repository is right now. Read rather than assumed: `master` and `main`
// are both common, and a repository that uses neither is not unusual.
function headOf (dir) {
  try { return git(dir, ['symbolic-ref', '--short', 'HEAD']) } catch { return null }
}

// ---- the branch nothing may be built on --------------------------------
//
// The default branch is protected: no machine may be set up on it, and none may
// push to it. That is the rule the rest of this rests on, and it was the one
// place it could be chosen around -- the dialog listed every branch, including
// the default, and picking it made the machine allowed to push there.
//
// WHICH branch that is has to be asked, never assumed. It is `master` here and
// `main` in most new repositories, and a repository using neither is ordinary.
//
// It is also REMEMBERED, and that is the part worth explaining. HEAD alone is
// not the default branch, it is whatever is checked out -- so reviewing work by
// checking that branch out on the host would make the review branch "the
// default" and, worse, would leave the real default unprotected exactly while
// somebody is reading code. Recorded the first time a repository is seen, it
// stays protected whatever is checked out later.
const STATE = process.env.OKC_STATE || path.join(__dirname, '..', 'state')
const FILE = path.join(STATE, 'repos.json')

function remembered () {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^﻿/, '')) || {} } catch { return {} }
}

function remember (all) {
  try {
    fs.mkdirSync(STATE, { recursive: true })
    fs.writeFileSync(FILE, JSON.stringify(all, null, 2))
  } catch { /* the answer is still right for this call; it is only not kept */ }
}

// The default branch of one repository, recorded on first sight.
function defaultOf (repo) {
  const all = remembered()
  if (all[repo] && all[repo].default) return all[repo].default

  const dir = serve.gitDirOf(repo)
  const head = dir && headOf(dir)
  if (!head) return null
  all[repo] = { ...(all[repo] || {}), default: head, notedAt: new Date().toISOString() }
  remember(all)
  return head
}

// Only the default branch is protected, and it always is.
//
// A branch that merely happens to be CHECKED OUT is a different thing and is
// deliberately not in here. Git refuses a push to a checked-out branch, so
// reviewing work by checking it out on the host used to break the machine's
// next push -- with a message about a configuration variable, to a person who
// had no idea reading the code was what did it. But that is a door standing in
// the way rather than a rule: if nothing is at stake in that working tree, the
// host can simply step out of it. See `freeIfBusy`.
function protectedBranches () {
  const why = new Map()
  for (const { name } of serve.list()) {
    const branch = defaultOf(name)
    if (!branch) continue
    if (!why.has(branch)) why.set(branch, { branch, repos: [] })
    why.get(branch).repos.push(name)
  }
  return [...why.values()]
}

// Where each protected branch actually IS, as a commit.
//
// "The default branch is protected" is a rule; "master is on 98c160a" is a fact,
// and only the fact can be checked before and after something that was supposed
// to be refused. Without it the only available test was looking at master and
// finding it plausible, which is not a test -- a drill that proves a push was
// rejected has to compare the same number twice.
function defaultHeads () {
  const out = []
  for (const { name } of serve.list()) {
    const branch = defaultOf(name)
    const dir = serve.gitDirOf(name)
    if (!branch || !dir) continue
    let at = null
    // An unborn default is a real state -- a repository with no commits yet --
    // and reporting it as null says so rather than failing the read.
    try { at = git(dir, ['rev-parse', branch]) } catch { /* nothing on it yet */ }
    out.push({ repo: name, branch, at })
  }
  return out
}

const isProtected = branch => protectedBranches().some(p => p.branch === branch)

// Said the same way wherever it is refused, so the reason does not get a
// different wording depending on which door it was met at.
function whyProtected (branch) {
  const p = protectedBranches().find(x => x.branch === branch)
  if (!p) return null
  return `"${branch}" is the default branch of ${p.repos.join(', ')}. Work goes onto its own branch and is merged here afterwards, so nothing is built directly on it.`
}

// ---- getting out of the way --------------------------------------------

// Some operations need a working tree, so they cannot go through --git-dir.
const gitIn = (repoPath, args) => execFileSync('git', ['-C', repoPath, ...args], {
  encoding: 'utf8',
  timeout: 30000,
  windowsHide: true
}).trim()

const pathOf = repo => path.join(serve.DIR, repo)

// Whether a repository has anything uncommitted -- tracked or not.
function isClean (repo) {
  try { return gitIn(pathOf(repo), ['status', '--porcelain']) === '' } catch { return false }
}

// If a repository is sitting on `branch`, step it back onto its default so the
// branch can be used.
//
// Only when the working tree is CLEAN. A checkout that has been read is worth
// nothing and is free to move; one that has been edited is somebody's work, and
// moving off it to unblock a machine would be this app deciding whose work
// matters more. So that case is reported instead, naming what is in the way.
//
// Bare repositories are skipped: they have no working tree, nothing is checked
// out in the sense that matters, and git accepts the push regardless.
function freeIfBusy (repo, branch) {
  const dir = serve.gitDirOf(repo)
  if (!dir || dir === pathOf(repo)) return { repo, freed: false, busy: false }
  if (headOf(dir) !== branch) return { repo, freed: false, busy: false }

  const home = defaultOf(repo)
  if (!home || home === branch) return { repo, freed: false, busy: false }

  if (!isClean(repo)) {
    return {
      repo,
      freed: false,
      busy: true,
      why: `${repo} has "${branch}" checked out here with uncommitted changes, so it cannot be moved off it. Commit or discard them, or switch ${repo} back to ${home}.`
    }
  }

  gitIn(pathOf(repo), ['checkout', '--quiet', home])
  return { repo, freed: true, busy: false, from: branch, to: home }
}

// The same, for every repository at once. Used before a machine is set up on a
// branch and before it pushes one, because both are moments where a checkout
// left open on the host would otherwise fail something that has nothing to do
// with it.
function freeEverywhere (branch) {
  return serve.list().map(r => freeIfBusy(r.name, branch)).filter(r => r.freed || r.busy)
}

// Repositories sitting away from their default branch, and whether that can be
// undone on its own.
//
// Asked on every draw, so it is written to cost nothing in the ordinary case:
// reading HEAD is a ref lookup, and only a repository that is actually somewhere
// else gets a status. Almost always that is none of them.
//
// A DIRTY one is worth putting in front of the operator rather than leaving for
// whoever meets it next. It will refuse a push from the machine that needs that
// branch, and the machine's own error cannot say why -- it does not know this
// working tree exists. Reported here, it is a sentence about a file somebody
// left open; met there, it is a message about a configuration variable.
function blocking () {
  const out = []
  for (const { name } of serve.list()) {
    const dir = serve.gitDirOf(name)
    if (!dir || dir === pathOf(name)) continue
    const head = headOf(dir)
    const home = defaultOf(name)
    if (!head || !home || head === home) continue
    out.push({ repo: name, on: head, home, clean: isClean(name) })
  }
  return out
}

// Every branch across the workspace, and which repositories have each.
//
// The union rather than the intersection, and each one says which repositories
// it is missing from. A name present in three of four repositories is the normal
// state of a change that only touched three -- reporting it as absent would hide
// the work, and reporting it as present everywhere would claim repositories that
// have nothing on it.
function all () {
  const repos = serve.list()
  const seen = new Map()

  for (const { name } of repos) {
    const dir = serve.gitDirOf(name)
    if (!dir) continue
    const head = headOf(dir)
    for (const branch of branchesIn(dir)) {
      if (!seen.has(branch)) seen.set(branch, { name: branch, in: [], head: [] })
      seen.get(branch).in.push(name)
      if (branch === head) seen.get(branch).head.push(name)
    }
  }

  const names = repos.map(r => r.name)
  const guarded = protectedBranches()

  return {
    repos: names,
    protected: guarded,
    branches: [...seen.values()]
      .map(b => {
        const p = guarded.find(g => g.branch === b.name)
        // Checked out somewhere with uncommitted work in it. NOT the same as
        // being checked out: a clean checkout is stepped out of when the branch
        // is needed, so it stays available and nobody has to think about it.
        // Only work in the way makes a branch unusable, and then it is the work
        // that is named rather than the branch.
        const stuck = p ? [] : serve.list()
          .map(r => freeIfBusy(r.name, b.name))
          .filter(r => r.busy)

        // TWO questions, kept apart, because they have different answers and
        // different ways out.
        //
        //   protected   -- may this branch be worked on at all? No amount of
        //                  tidying changes it. Pick another one.
        //   reclaimable -- can the host get out of the way? It usually can, by
        //                  stepping off a clean review checkout. When it cannot,
        //                  the fix is to that working tree, not to this choice.
        //
        // Collapsing them into one "available" was tempting and wrong: it would
        // answer "no" to both with the same sentence, and send somebody looking
        // for another branch when what they actually had was two minutes of
        // uncommitted work in a checkout they had forgotten about.
        return {
          ...b,
          missing: names.filter(n => !b.in.includes(n)),
          protected: !!p,
          reclaimable: !stuck.length,
          blocked: stuck.length ? stuck.map(s => s.why) : null,
          why: p ? whyProtected(b.name) : (stuck.length ? stuck[0].why : null)
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }
}

// A branch name git will actually accept, checked before anything is created.
//
// Asked of git rather than matched against a pattern here: git's rules are more
// particular than they look (no `..`, no trailing `.lock`, no `@{`, no leading
// or trailing slash) and a second implementation of them would be wrong in a way
// that only shows up on an unusual name.
function nameIsOk (branch) {
  if (!branch || !branch.trim()) return 'A branch needs a name.'
  try {
    execFileSync('git', ['check-ref-format', '--branch', branch.trim()], { timeout: 10000, windowsHide: true, stdio: 'ignore' })
    return null
  } catch {
    return `Git will not accept "${branch}" as a branch name.`
  }
}

// Cut the branch in every repository that does not have it yet, from wherever
// that repository currently is.
//
// It does not touch the default branch, and cannot: creating a ref neither moves
// another one nor disturbs a working tree. A repository that already has the
// branch is left exactly as it is -- that is what picking an existing name means,
// and rewinding it to today's HEAD would silently discard the work that made the
// name worth reusing.
function ensure (branch) {
  const why = nameIsOk(branch)
  if (why) throw new Error(why)
  const name = branch.trim()

  // Refused here as well as at the dialog and at the push, because this is the
  // function that would otherwise CREATE the situation -- recording a machine
  // against the default branch. A rule that only exists where it is offered is
  // not a rule.
  const guarded = whyProtected(name)
  if (guarded) throw new Error(guarded)

  return serve.list().map(({ name: repo }) => {
    const dir = serve.gitDirOf(repo)
    const had = branchesIn(dir).includes(name)
    if (!had) git(dir, ['branch', name])
    return { repo, branch: name, created: !had, from: had ? null : headOf(dir) }
  })
}

// Take a branch out of every repository that has it.
//
// THE ONE DESTRUCTIVE THING IN THIS FILE, and the only way work made here is
// ever unmade -- so what it refuses matters more than what it does.
//
// It will not touch a protected branch, for the same reason nothing else will.
// And it uses `-d` rather than `-D` unless told otherwise: git's own check is
// that the branch is contained in the current HEAD, which is not the question we
// care about, so containment in the DEFAULT is checked here first and `-D` is
// what actually runs. The caller is the one that decides whether losing commits
// is acceptable; this only makes sure that decision was made.
//
// A branch checked out on this host is stepped off first where that is safe --
// git refuses to delete a branch that is checked out, and the message says
// nothing about which working tree is holding it.
function remove (branch, { force = false } = {}) {
  const why = whyProtected(branch)
  if (why) throw new Error(why)

  const name = String(branch || '').trim()
  if (!name) throw new Error('There is no branch to delete.')

  const stepped = freeEverywhere(name)
  const stuck = stepped.filter(s => s.busy)
  if (stuck.length) throw new Error(stuck[0].why)

  const done = []
  for (const { name: repo } of serve.list()) {
    const dir = serve.gitDirOf(repo)
    if (!dir || !branchesIn(dir).includes(name)) continue
    // Where it was, before it is not anywhere. A deleted branch is recoverable
    // from its commit for as long as git keeps the object, and the number is the
    // only thing that makes that possible -- so it is reported even though
    // nothing here uses it.
    let at = null
    try { at = git(dir, ['rev-parse', name]) } catch { /* unborn; nothing to record */ }
    git(dir, ['branch', force ? '-D' : '-d', name])
    done.push({ repo, was: at })
  }

  if (!done.length) throw new Error(`No repository here has a branch called "${name}".`)
  return { branch: name, deletedFrom: done, steppedOff: stepped.filter(s => s.freed) }
}

module.exports = {
  all, ensure, remove, nameIsOk, branchesIn, headOf, defaultHeads,
  defaultOf, protectedBranches, isProtected, whyProtected,
  isClean, freeIfBusy, freeEverywhere, blocking
}
