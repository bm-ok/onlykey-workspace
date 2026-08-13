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
const data = require('../core/data')

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
// PER WORKSPACE. Both files here are keyed by NAME -- a repository's name, a
// branch's name -- and a name means something different in a different folder.
// Shared, `local-repo-a`'s remembered default branch would be applied to an
// unrelated repository that happens to share the name, and a branch's recorded
// reason would attach itself to a branch somebody else cut. Neither would error.
const workspaces = require('../core/workspaces')

const STATE = () => workspaces.stateDir()
const FILE = () => path.join(STATE(), 'repos.json')

function remembered () {
  try { return JSON.parse(fs.readFileSync(FILE(), 'utf8').replace(/^﻿/, '')) || {} } catch { return {} }
}

function remember (all) {
  try {
    fs.mkdirSync(STATE(), { recursive: true })
    fs.writeFileSync(FILE(), JSON.stringify(all, null, 2))
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

// ---- what work is measured against ------------------------------------
//
// THE BASELINE AND THE DEFAULT BRANCH ARE NOT THE SAME QUESTION, and treating
// them as one word was fine only while every repository answered both the same
// way.
//
//   the default    what the repository itself says HEAD is. A fact about git,
//                  read from the repository, never chosen here. Always
//                  protected, because it is where everything lands eventually.
//   the baseline   what "ahead" is counted from. A choice: a repository whose
//                  default is `master` may have its current work measured
//                  against `version2`, and then every task branch is judged
//                  against that instead.
//
// Defaults to the default, so a workspace nobody has configured behaves exactly
// as it did. Choosing one does NOT unprotect the other -- the repository's own
// default stays protected whatever is chosen, which is the whole point of it
// being a fact rather than a preference.
function baselineOf (repo) {
  const all = remembered()
  const chosen = all[repo] && all[repo].baseline
  if (chosen) return chosen
  return defaultOf(repo)
}

// Chosen, or cleared back to the repository's own default with an empty value.
function setBaseline (repo, branch) {
  const all = remembered()
  const dir = serve.gitDirOf(repo)
  if (!dir) throw new Error(`There is no repository called "${repo}" here.`)

  const name = String(branch || '').trim()
  if (name) {
    if (!branchesIn(dir).includes(name)) {
      throw new Error(`"${repo}" has no branch called "${name}". A baseline has to be a branch that exists there — it is what everything else in that repository is counted from.`)
    }
    all[repo] = { ...(all[repo] || {}), baseline: name }
  } else {
    all[repo] = { ...(all[repo] || {}) }
    delete all[repo].baseline
  }
  remember(all)
  return { repo, baseline: baselineOf(repo), default: defaultOf(repo), chosen: !!name }
}

// ---- groups: one baseline per repository, named ------------------------
//
// A CHANGE SPANS REPOSITORIES, so "what is this work counted from" is one
// question with one answer -- not one answer per repository that somebody has to
// keep consistent by hand. A group names a branch in each, and using it sets all
// of them at once.
//
// BEING IN A GROUP PROTECTS EVERY BRANCH IN IT, and that is the point rather
// than a side effect. It is what makes chaining safe: work is cut FROM a link,
// merges back INTO it, and the link itself is never built on directly. Without
// that, a chain is just a branch somebody agreed not to touch -- and an
// agreement is the thing this tool exists to replace with a refusal.
//
// Protected while it is IN a group, and not afterwards. Unlike a repository's
// own default -- which is a fact about git and cannot be unmade from here -- a
// group is a decision, and taking a branch out of one gives it back.
const GROUPS = () => path.join(STATE(), 'baseline-groups.json')

function groupsFile () {
  try { return JSON.parse(fs.readFileSync(GROUPS(), 'utf8').replace(/^﻿/, '')) || {} } catch { return {} }
}

function writeGroups (all) {
  try {
    fs.mkdirSync(STATE(), { recursive: true })
    fs.writeFileSync(GROUPS(), JSON.stringify(all, null, 2))
  } catch { /* the answer is still right for this call; it is only not kept */ }
  return all
}

// Every group, with each one's branches checked against what is actually there.
// A group naming a branch that has been deleted is reported as such rather than
// quietly dropped -- it is the difference between "this line is finished" and
// "somebody deleted a link in a chain".
function groups () {
  const all = groupsFile()
  const here = serve.list().map(r => r.name)
  return Object.entries(all).map(([name, g]) => {
    const on = g.on || {}
    const parts = Object.entries(on).map(([repo, branch]) => {
      const dir = serve.gitDirOf(repo)
      return {
        repo,
        branch,
        there: !!dir && (() => { try { return branchesIn(dir).includes(branch) } catch { return false } })(),
        stillHere: here.includes(repo)
      }
    })
    return {
      name,
      why: g.why || null,
      made: g.made || null,
      on: parts,
      // Missing repositories are not a fault: a group made when there were three
      // repositories still describes those three when a fourth arrives.
      missing: here.filter(r => !(r in on)),
      broken: parts.filter(p => p.stillHere && !p.there).map(p => `${p.branch} is gone from ${p.repo}`),
      inUse: parts.length > 0 && parts.every(p => !p.stillHere || baselineOf(p.repo) === p.branch)
    }
  }).sort((a, b) => a.name.localeCompare(b.name))
}

// Named from what each repository counts from right now, or from a stated set.
//
// Taking the current state as the default is deliberate: a group is usually
// something somebody has just finished arranging one repository at a time, and
// asking them to type it all again is how the two drift apart.
function saveGroup (name, { on = null, why = null } = {}) {
  const title = String(name || '').trim()
  if (!title) throw new Error('Give the group a name — it is what a task will be based on.')

  const chosen = on && Object.keys(on).length
    ? on
    : Object.fromEntries(serve.list().map(r => [r.name, baselineOf(r.name)]).filter(([, b]) => b))

  for (const [repo, branch] of Object.entries(chosen)) {
    const dir = serve.gitDirOf(repo)
    if (!dir) throw new Error(`There is no repository called "${repo}" here.`)
    if (!branchesIn(dir).includes(branch)) {
      throw new Error(`"${repo}" has no branch called "${branch}". Every branch in a group has to exist — it is what work will be cut from.`)
    }
  }

  const all = groupsFile()
  all[title] = { on: chosen, why: why ? String(why).trim() : (all[title] || {}).why || null, made: (all[title] || {}).made || new Date().toISOString() }
  writeGroups(all)
  return groups().find(g => g.name === title)
}

// Every repository's baseline set at once, which is what a group is for.
function useGroup (name) {
  const g = groups().find(x => x.name === String(name || '').trim())
  if (!g) throw new Error(`There is no group called "${name}".`)
  if (g.broken.length) throw new Error(`"${g.name}" cannot be used: ${g.broken.join('; ')}.`)

  const changed = []
  for (const part of g.on) {
    if (!part.stillHere) continue
    if (baselineOf(part.repo) === part.branch) continue
    setBaseline(part.repo, part.branch)
    changed.push(`${part.repo} → ${part.branch}`)
  }
  return { group: g.name, changed, on: g.on }
}

function deleteGroup (name) {
  const all = groupsFile()
  const title = String(name || '').trim()
  if (!(title in all)) throw new Error(`There is no group called "${title}".`)
  delete all[title]
  writeGroups(all)
  // The branches are untouched. Deleting a group unprotects them, which is the
  // whole of what it does -- a group is a decision about branches, not a thing
  // the branches belong to.
  return { deleted: title, branchesTouched: false }
}

// Every branch named in any group, and which groups name it. This is what makes
// a group protect its links.
function inAnyGroup () {
  const out = new Map()
  for (const g of groups()) {
    for (const part of g.on) {
      if (!out.has(part.branch)) out.set(part.branch, [])
      out.get(part.branch).push(g.name)
    }
  }
  return out
}

// Every repository, what it counts from, and whether that was chosen.
const baselines = () => serve.list().map(({ name }) => {
  const all = remembered()
  const chosen = (all[name] || {}).baseline || null
  return {
    repo: name,
    baseline: baselineOf(name),
    default: defaultOf(name),
    chosen: !!chosen,
    // Named because it is the surprising case: the branch this repository is
    // measured against is not the branch it would land on.
    differs: !!chosen && chosen !== defaultOf(name),
    branches: (() => { try { return branchesIn(serve.gitDirOf(name)) } catch { return [] } })()
  }
})

// Only the default branch is protected, and it always is.
//
// A branch that merely happens to be CHECKED OUT is a different thing and is
// deliberately not in here. Git refuses a push to a checked-out branch, so
// reviewing work by checking it out on the host used to break the machine's
// next push -- with a message about a configuration variable, to a person who
// had no idea reading the code was what did it. But that is a door standing in
// the way rather than a rule: if nothing is at stake in that working tree, the
// host can simply step out of it. See `freeIfBusy`.
// TWO REASONS A BRANCH IS PROTECTED, and they are kept apart because they are
// answered differently. Its repository's own default is a fact about git and
// cannot be changed from here. A chosen baseline is a decision, and unchoosing it
// unprotects it -- but while it IS the baseline nothing may be built on it, for
// the same reason: a branch that a machine can push to is not something the same
// machine's work can be measured against.
function protectedBranches () {
  const why = new Map()
  const at = branch => {
    if (!why.has(branch)) why.set(branch, { branch, repos: [], asDefault: [], asBaseline: [], asGroup: [] })
    return why.get(branch)
  }
  const add = (branch, repo, how) => {
    if (!branch) return
    const e = at(branch)
    if (!e.repos.includes(repo)) e.repos.push(repo)
    e[how].push(repo)
  }
  for (const { name } of serve.list()) {
    add(defaultOf(name), name, 'asDefault')
    const base = baselineOf(name)
    if (base !== defaultOf(name)) add(base, name, 'asBaseline')
  }
  // THE THIRD REASON, and the one that makes chaining work. A branch named in a
  // group is a link somebody builds FROM and merges back INTO, so nothing may be
  // built on it directly -- and that has to be a refusal rather than an
  // understanding, or it is exactly the kind of rule this tool exists to stop
  // relying on people to remember.
  // Deduped: a group naming the same branch in three repositories names it once
  // as a reason, not three times.
  for (const [branch, named] of inAnyGroup()) at(branch).asGroup.push(...new Set(named))
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
  const parts = [
    p.asDefault.length ? `the default branch of ${p.asDefault.join(', ')}` : null,
    p.asBaseline.length ? `the chosen baseline for ${p.asBaseline.join(', ')}` : null,
    p.asGroup && p.asGroup.length ? `a link in ${[...new Set(p.asGroup)].map(n => `"${n}"`).join(', ')}` : null
  ].filter(Boolean)
  return `"${branch}" is ${parts.join(' and ')}. Work goes onto its own branch and is merged here afterwards, so nothing is built directly on it.`
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

// ---- why a branch exists ------------------------------------------------
//
// Nothing recorded this, and the cost showed up as a branch nobody could
// account for: `drill/cable-pull`, pointing at exactly the same commit as
// master in both repositories, left behind by a drill about the NETWORK that
// never committed anything. It looked identical to a branch somebody cut on
// purpose and abandoned, and telling those apart mattered before deleting it.
//
// A reason is cheap to write once and impossible to reconstruct later.
const NOTES = () => path.join(STATE(), 'branches.json')

function notes () {
  try { return JSON.parse(fs.readFileSync(NOTES(), 'utf8').replace(/^﻿/, '')) || {} } catch { return {} }
}

function noteFor (branch) {
  return notes()[branch] || null
}

function note (branch, entry) {
  const all = notes()
  all[branch] = { ...(all[branch] || {}), ...entry }
  try {
    fs.mkdirSync(STATE(), { recursive: true })
    fs.writeFileSync(NOTES(), JSON.stringify(all, null, 2))
  } catch { /* the branch is still cut; only the note is not kept */ }
  return all[branch]
}

const forget = branch => {
  const all = notes()
  if (!(branch in all)) return false
  delete all[branch]
  try { fs.writeFileSync(NOTES(), JSON.stringify(all, null, 2)) } catch { /* as above */ }
  return true
}

// Cut the branch in every repository that does not have it yet, from wherever
// that repository currently is.
//
// It does not touch the default branch, and cannot: creating a ref neither moves
// another one nor disturbs a working tree. A repository that already has the
// branch is left exactly as it is -- that is what picking an existing name means,
// and rewinding it to today's HEAD would silently discard the work that made the
// name worth reusing.
//
// A REASON IS REQUIRED, and that is the hardening. Branches were only ever
// created as a SIDE EFFECT of setting a machine up, from whatever string a task
// happened to carry -- so a typo did not fail, it made a branch, and the
// workspace was then built on a name nobody meant. Every branch on the board
// arrived that way, which is why none of them could say what they were for.
function ensure (branch, { reason = null, by = null } = {}) {
  const why = nameIsOk(branch)
  if (why) throw new Error(why)
  const name = branch.trim()

  if (!reason || !String(reason).trim()) {
    throw new Error(`Say what "${name}" is for. A branch with no reason is one nobody can account for later — which is how a workspace ends up with names that cannot be told apart from mistakes.`)
  }

  // Refused here as well as at the dialog and at the push, because this is the
  // function that would otherwise CREATE the situation -- recording a machine
  // against the default branch. A rule that only exists where it is offered is
  // not a rule.
  const guarded = whyProtected(name)
  if (guarded) throw new Error(guarded)

  // CUT FROM THE BASELINE, not from wherever the repository happens to be.
  //
  // `git branch x` cuts from HEAD, which is whatever was last checked out here --
  // and a review left on another branch would have silently decided where the
  // next task started. The baseline is the answer to "what is work measured
  // against", so it is also the answer to "what does work start from"; anything
  // else means a task is judged against a branch it was not cut from.
  const cut = serve.list().map(({ name: repo }) => {
    const dir = serve.gitDirOf(repo)
    const had = branchesIn(dir).includes(name)
    const from = baselineOf(repo)
    if (!had) git(dir, from ? ['branch', name, from] : ['branch', name])
    return { repo, branch: name, created: !had, from: had ? null : (from || headOf(dir)) }
  })

  // Recorded once, when it is first cut, and never overwritten afterwards. A
  // branch reused for a second task keeps the reason it was made for -- that is
  // what reusing a name means, and replacing it would erase the only account of
  // why the name exists at all.
  if (!noteFor(name)) {
    note(name, {
      reason: String(reason).trim(),
      by: by || null,
      made: new Date().toISOString(),
      cutIn: cut.filter(c => c.created).map(c => c.repo)
    })
  }

  return cut
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
  // The note goes with it, or a branch cut again under the same name later would
  // inherit an account of something else entirely.
  const had = noteFor(name)
  forget(name)
  return { branch: name, deletedFrom: done, steppedOff: stepped.filter(s => s.freed), was: had }
}

module.exports = {
  all, ensure, remove, nameIsOk, branchesIn, headOf, defaultHeads, noteFor, notes,
  defaultOf, baselineOf, setBaseline, baselines, groups, saveGroup, useGroup, deleteGroup, inAnyGroup,
  protectedBranches, isProtected, whyProtected,
  isClean, freeIfBusy, freeEverywhere, blocking
}
