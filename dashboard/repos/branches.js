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
// WHERE IT IS CUT FROM is a decision, not an accident of what was last checked
// out. A branch is cut from a named LINE: one branch per repository, named
// together because they are one point in the work. What it was cut from is
// recorded with the branch and is what the branch is measured against ever
// after -- "what is this against" is the first question asked of any branch, and
// git cannot answer it later.

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
// THERE USED TO BE A SETTING HERE: a per-repository "baseline", separate from
// the default branch, settable for all of them in one click. It is gone, and
// what replaced it is smaller — a branch is measured against the line it was CUT
// FROM, recorded on the branch when it is made.
//
// The difference matters because "3 commits ahead" is a statement about a
// branch, so it should depend on that branch and nothing else. Under a
// workspace-wide pointer it depended on a setting anything could move, and
// moving it reinterpreted every number on the board at once — including for
// branches with nothing to do with the line being pointed at. That happened by
// accident within an hour of the button existing.
//
// What remains is each repository's own default: a fact about git, read from
// the repository, never chosen here, always protected.
//
// The answer is already recorded and has been since a branch had to name the
// line it was cut from: `note.from` is one branch per repository, written when
// the branch was made and never changed afterwards.
//
// NAMES, NOT COMMIT IDS, which is what keeps this behaving like the thing it
// replaces. Measured against the name `master`, a branch still goes to zero once
// its work lands there — and "is it contained", "is it orphaned" and "can this
// be deleted" all rest on that.
//
// Branches cut before any of this have nothing recorded and fall back to the
// repository's own default, which is what they were cut from.
function baseFor (branch, repo) {
  const n = noteFor(branch)
  if (n && n.from && n.from[repo]) return n.from[repo]
  return defaultOf(repo)
}

// `setBaseline` was here, with the file field it wrote. Nothing sets what a
// repository counts from any more -- a branch carries its own answer.

// ---- groups: one baseline per repository, named ------------------------
//
// A CHANGE SPANS REPOSITORIES, so "what is this work against" is one question
// with one answer -- not one answer per repository that somebody has to keep
// consistent by hand. A line names a branch in each, and a branch cut from it
// records that as what it is measured against.
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
      // Proposed for landing: `{ at, by, why }`, or null. See markGroup.
      marked: g.marked || null
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
    : Object.fromEntries(serve.list().map(r => [r.name, defaultOf(r.name)]).filter(([, b]) => b))

  for (const [repo, branch] of Object.entries(chosen)) {
    const dir = serve.gitDirOf(repo)
    if (!dir) throw new Error(`There is no repository called "${repo}" here.`)
    if (!branchesIn(dir).includes(branch)) {
      throw new Error(`"${repo}" has no branch called "${branch}". Every branch in a group has to exist — it is what work will be cut from.`)
    }
  }

  const all = groupsFile()
  // A group being rewritten keeps what it was marked as, because marking is a
  // statement about the LINE and not about the particular branches in it today.
  all[title] = {
    on: chosen,
    why: why ? String(why).trim() : (all[title] || {}).why || null,
    made: (all[title] || {}).made || new Date().toISOString(),
    marked: (all[title] || {}).marked || null
  }
  writeGroups(all)
  return groups().find(g => g.name === title)
}

// ---- a line that is finished, and up to be landed ----------------------
//
// MARKING IS THE DIFFERENCE BETWEEN "work happens here" AND "this is what we
// are proposing". A group's branches are protected the moment they are in a
// group, so marking adds no protection of its own — what it adds is intent, and
// intent is the thing a second person needs in order to know what they are
// looking at. An unmarked group is where work is cut from. A marked one is a
// proposal: it says somebody thinks this line is done, and it is the only kind
// of group that appears on the left of a comparison.
//
// Unmarking is how work continues. Deleting the group is how it stops being a
// line at all, and the two are deliberately separate: taking a proposal back is
// ordinary, and dissolving the line is not.
function markGroup (name, { why = null, by = null } = {}) {
  const all = groupsFile()
  const title = String(name || '').trim()
  if (!(title in all)) throw new Error(`There is no group called "${title}".`)

  const g = groups().find(x => x.name === title)
  if (g.broken.length) {
    throw new Error(`"${title}" cannot be proposed: ${g.broken.join('; ')}. A line with a branch missing from it is not a thing anybody can read.`)
  }

  all[title] = { ...all[title], marked: { at: new Date().toISOString(), by: by || null, why: why ? String(why).trim() : null } }
  writeGroups(all)
  return groups().find(x => x.name === title)
}

function unmarkGroup (name) {
  const all = groupsFile()
  const title = String(name || '').trim()
  if (!(title in all)) throw new Error(`There is no group called "${title}".`)
  all[title] = { ...all[title], marked: null }
  writeGroups(all)
  return groups().find(x => x.name === title)
}

// A finished branch, made into a line of its own.
//
// The branch is already one name across several repositories, which is exactly
// what a group is — so this is less a conversion than saying out loud what the
// branch already was. What it adds is a name that outlives the branch, and
// protection: from here the branch is a link, and nothing is built directly on
// it.
//
// IT MOVES NO BASELINE. `branchAsBaseline` is the act that re-aims the workspace
// at a branch, and it is a much larger one — everything cut afterwards starts
// there. Promoting a branch so it can be compared and landed should not quietly
// do that too.
function groupFromBranch (branch, { name = null, why = null } = {}) {
  const row = all().branches.find(b => b.name === branch)
  if (!row) throw new Error(`There is no branch called "${branch}".`)
  if (!row.in.length) throw new Error(`"${branch}" is not in any repository here, so there is no line to make from it.`)

  const title = String(name || branch).trim()
  return saveGroup(title, {
    on: Object.fromEntries(row.in.map(repo => [repo, branch])),
    why: why || `the "${branch}" line`
  })
}

// `useGroup` was here. It set every repository's baseline at once, which was
// the whole point of a group until a branch started recording what it was cut
// from. A group is now a set of branches with a name; nothing points at one.

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

// Every repository, its default branch, and what branches it has.
//
// The "and whether that was chosen" half is gone with the setting it described.
// What a branch is measured against is a fact about the branch now, not about
// the repository — see baseFor.
const baselines = () => serve.list().map(({ name }) => ({
  repo: name,
  default: defaultOf(name),
  branches: (() => { try { return branchesIn(serve.gitDirOf(name)) } catch { return [] } })()
}))

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
    if (!why.has(branch)) why.set(branch, { branch, repos: [], asDefault: [], asGroup: [] })
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

// ---- landing one branch into another, in one repository -----------------
//
// IN THE WORKING TREE, and not by moving a ref. Every repository here has a
// checkout and it is sitting on the branch work lands into — so `fetch . a:b`,
// the usual way to move a ref in a bare repository, is refused by git with a
// message about a checked-out branch. Forcing the ref instead would leave the
// files on disk describing a commit that is no longer at the head, which is a
// repository that looks fine until somebody runs `git status` and cannot explain
// it. A merge in the tree is what a person would do, and it is the thing whose
// failure modes git already explains well.
//
// --no-ff DELIBERATELY. A line landing is an event: a fast-forward would leave
// the target's history indistinguishable from the work having been done on it
// directly, and the whole point of a line is that it is a thing that happened.
//
// A DRY RUN IS A DIFFERENT FUNCTION, not a flag on this one. A flag means the
// same code path decides, at run time, whether it is pretending — and the way
// that goes wrong is that it stops pretending.
function landPlan (repo, base, head, { push = false } = {}) {
  const dir = serve.gitDirOf(repo)
  if (!dir) throw new Error(`There is no repository called "${repo}" here.`)
  const at = pathOf(repo)
  const bare = dir === at
  const was = headOf(dir)

  let ahead = 0
  try { ahead = Number(git(dir, ['rev-list', '--count', `${base}..${head}`])) || 0 } catch { /* unrelated histories read as nothing to do */ }

  // Would it conflict, asked without merging. `merge-tree --write-tree` performs
  // the merge against the object database and writes the resulting tree,
  // touching no ref and no working tree, then exits non-zero and names the files
  // if it could not. That is the whole answer, and it is a read.
  let conflicts = null
  let unchecked = false
  if (ahead) {
    try {
      git(dir, ['merge-tree', '--write-tree', base, head])
    } catch (e) {
      const said = String((e.stdout || '') + (e.stderr || '') + (e.message || ''))
      if (/unknown option|usage: git merge-tree/i.test(said)) unchecked = true
      else {
        const named = said.split('\n').map(l => l.trim()).filter(l => /^CONFLICT/.test(l)).slice(0, 6)
        conflicts = named.length ? named.join('; ') : 'it would conflict'
      }
    }
  }

  const dirty = ahead && !bare && !isClean(repo)

  return {
    repo,
    base,
    head,
    ahead,
    was,
    bare,
    conflicts,
    unchecked,
    dirty: !!dirty,
    why: conflicts || (dirty ? `${repo} has uncommitted changes here, and landing merges in its working tree` : null),
    // Word for word what landInto will run, in order.
    commands: !ahead
      ? []
      : (was === base ? [] : [`git -C ${at} checkout ${base}`])
          .concat([`git -C ${at} merge --no-ff --no-edit ${head}`])
          .concat(push ? [`git -C ${at} push origin ${base}`] : [])
  }
}

function landInto (repo, base, head) {
  const plan = landPlan(repo, base, head)
  if (plan.why) throw new Error(`${repo}: ${plan.why}`)
  if (!plan.ahead) return { ...plan, moved: false }

  const at = pathOf(repo)
  if (plan.was !== base) gitIn(at, ['checkout', '--quiet', base])
  gitIn(at, ['merge', '--no-ff', '--no-edit', head])
  return { ...plan, moved: true, now: gitIn(at, ['rev-parse', base]) }
}

function pushLanded (repo, base) {
  return gitIn(pathOf(repo), ['push', 'origin', base])
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
        // WHAT IT IS MISSING FROM is asked of the repositories it is ABOUT, not
        // of the whole workspace. A branch cut from a group that names two of
        // three repositories is complete at two; calling the third "missing"
        // reads as damage and, worse, is acted on -- vmWorkspace refuses to set
        // a machine up on a branch with anything missing, so a correctly scoped
        // branch would be permanently unusable and the fix on offer would be to
        // extend it into a repository the work has nothing to do with.
        const scope = scopeOf(b.name)

        return {
          ...b,
          group: scope.group,
          // Only the repositories in scope, so a branch that also exists
          // elsewhere for unrelated reasons does not drag them into this task.
          in: b.in.filter(n => scope.repos.includes(n)),
          about: scope.repos,
          missing: scope.repos.filter(n => !b.in.includes(n)),
          // Named by the group and not here any more. A different problem from
          // "missing": nothing can extend the branch into a repository that has
          // been removed from the workspace.
          gone: scope.gone || [],
          protected: !!p,
          reclaimable: !stuck.length,
          blocked: stuck.length ? stuck.map(s => s.why) : null,
          why: p ? whyProtected(b.name) : (stuck.length ? stuck[0].why : null)
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }
}

// ---- which repositories a branch is ABOUT ------------------------------
//
// A group names a branch in some repositories and says nothing about the rest,
// and that silence is a decision: a line of work that never reached the fourth
// repository is not work "against" that repository at all. So the group a branch
// was cut from is also the list of repositories the branch exists in, is checked
// out in, is measured across, and is judged on.
//
// WHAT THIS PREVENTS is a machine holding repositories the work has nothing to
// do with. Every checkout on a machine is something a worker can read, change
// and push; handing over all of them for a change that concerns two is a wider
// grant than anybody asked for, and the extra ones are exactly the ones nobody
// is reviewing afterwards.
//
// Branches cut before this existed have no group and are about everything, which
// is what they were made as. The fallback is not a default anybody chooses --
// `ensure` requires a group — it is how the branches already on the board keep
// meaning what they meant.
function scopeOf (branch) {
  const here = serve.list().map(r => r.name)
  const note = noteFor(branch)
  if (!note || !note.group) return { group: null, repos: here, whole: true }

  const found = groups().find(g => g.name === note.group)
  // A group deleted since is not a reason to widen a branch's reach. What it
  // named is recorded on the branch itself, and that record outlives the group
  // precisely so this question stays answerable.
  const named = found
    ? found.on.map(p => p.repo)
    : Object.keys(note.from || {})

  const scoped = here.filter(n => named.includes(n))
  return {
    group: note.group,
    repos: scoped.length ? scoped : here,
    whole: !scoped.length || scoped.length === here.length,
    // Repositories the group named that are not in this workspace any more.
    // Reported rather than dropped: a task that spanned three repositories and
    // can now only reach two is a different task.
    gone: named.filter(n => !here.includes(n))
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
function ensure (branch, { reason = null, by = null, group = null } = {}) {
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

  // FROM A NAMED GROUP, AND THERE IS NO OTHER WAY.
  //
  // A group is one branch per repository, named together because they are one
  // point in the work — and "which version line is this against" is one question
  // with one answer, not one answer per repository that somebody has to have got
  // consistent earlier and by hand.
  //
  // REQUIRED, rather than defaulting to the per-repository baselines. The
  // default was the quiet path: it always worked, it never asked anything, and
  // what it produced depended on three settings nobody was looking at when they
  // typed the name. Naming the point is the whole act — a branch you cannot say
  // the starting point of is a branch whose "3 commits ahead" means nothing in
  // particular. Refusing when none are named is the same rule as refusing a
  // branch with no reason, one level up: a workspace with no named lines has not
  // yet decided what work is measured against, and cutting work in it produces
  // branches that cannot be accounted for.
  //
  // It does not MOVE any baseline. Saying "cut this from the version2 line" is a
  // statement about ONE branch, and a workspace where every such request also
  // re-aimed everything else would make the safe act and the sweeping one the
  // same click. Moving the baselines is `useGroup`, which says so.
  const known = groups()
  if (!group || !String(group).trim()) {
    throw new Error(known.length
      ? `Say what "${name}" is cut from. It is one of: ${known.map(g => g.name).join(', ')}. Every branch starts somewhere, and a branch nobody can name the start of cannot be measured against anything later.`
      : `There are no baseline groups yet, so there is nowhere to cut "${name}" from. Name one on the Baselines tab first — it is one branch per repository, saying what this workspace's work is against.`)
  }
  const found = known.find(g => g.name === String(group).trim())
  if (!found) {
    throw new Error(`There is no baseline group called "${group}".${known.length ? ` There is: ${known.map(g => g.name).join(', ')}.` : ' None have been named yet — name one on the Baselines tab.'}`)
  }
  if (found.broken.length) {
    throw new Error(`"${found.name}" cannot be cut from: ${found.broken.join('; ')}. A group is only a place to start from while every branch in it still exists.`)
  }
  const fromGroup = Object.fromEntries(found.on.map(p => [p.repo, p.branch]))

  // CUT FROM THE BASELINE, not from wherever the repository happens to be.
  //
  // `git branch x` cuts from HEAD, which is whatever was last checked out here --
  // and a review left on another branch would have silently decided where the
  // next task started. The baseline is the answer to "what is work measured
  // against", so it is also the answer to "what does work start from"; anything
  // else means a task is judged against a branch it was not cut from.
  //
  // AND IT IS CUT ONLY WHERE THE GROUP REACHES.
  //
  // A group naming three of four repositories is not an incomplete group; it is
  // a line of work that never reached the fourth. Cutting there anyway -- which
  // is what falling back to that repository's own baseline did -- invents a
  // branch in a repository the work has nothing to do with, and then a machine
  // checks it out, a worker can push it, and a reviewer has a fourth repository
  // to account for that was never part of the change.
  //
  // So the group is the scope. A task on this branch reaches these repositories
  // and no others.
  const cut = serve.list()
    .filter(({ name: repo }) => repo in fromGroup)
    .map(({ name: repo }) => {
      const dir = serve.gitDirOf(repo)
      const had = branchesIn(dir).includes(name)
      const from = fromGroup[repo]
      if (!had) git(dir, ['branch', name, from])
      return { repo, branch: name, created: !had, from: had ? null : from }
    })

  if (!cut.length) {
    throw new Error(`"${found.name}" names no repository that is in this workspace, so there is nowhere to cut "${name}". It names ${found.on.map(p => p.repo).join(', ')}.`)
  }

  // Recorded once, when it is first cut, and never overwritten afterwards. A
  // branch reused for a second task keeps the reason it was made for -- that is
  // what reusing a name means, and replacing it would erase the only account of
  // why the name exists at all.
  if (!noteFor(name)) {
    note(name, {
      reason: String(reason).trim(),
      by: by || null,
      made: new Date().toISOString(),
      cutIn: cut.filter(c => c.created).map(c => c.repo),
      // WHAT IT WAS CUT FROM, kept because git stops being able to say once the
      // branches move on. A merge base is a good guess and it is only a guess:
      // it answers "where do these two diverge now", not "what was this started
      // against", and the two stop agreeing the moment the baseline advances.
      // The group name is the useful half -- it is the thing somebody chose.
      group: String(group).trim(),
      from: Object.fromEntries(cut.filter(c => c.created).map(c => [c.repo, c.from]))
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
  all, ensure, remove, nameIsOk, branchesIn, headOf, defaultHeads, noteFor, notes, scopeOf,
  defaultOf, baseFor, baselines, groups, saveGroup, deleteGroup, inAnyGroup,
  markGroup, unmarkGroup, groupFromBranch,
  protectedBranches, isProtected, whyProtected,
  isClean, freeIfBusy, freeEverywhere, blocking,
  landPlan, landInto, pushLanded
}
