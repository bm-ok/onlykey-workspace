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

// Where a repository is when nobody has said otherwise. Read rather than
// assumed: `master` and `main` are both common, and a repository that uses
// neither is not unusual.
function headOf (dir) {
  try { return git(dir, ['symbolic-ref', '--short', 'HEAD']) } catch { return null }
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
  return {
    repos: names,
    branches: [...seen.values()]
      .map(b => ({ ...b, missing: names.filter(n => !b.in.includes(n)) }))
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

  return serve.list().map(({ name: repo }) => {
    const dir = serve.gitDirOf(repo)
    const had = branchesIn(dir).includes(name)
    if (!had) git(dir, ['branch', name])
    return { repo, branch: name, created: !had, from: had ? null : headOf(dir) }
  })
}

module.exports = { all, ensure, nameIsOk, branchesIn, headOf }
