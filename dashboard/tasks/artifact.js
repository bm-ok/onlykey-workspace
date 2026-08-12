'use strict'

// What came back, read the way a pull request is read.
//
// A task delivers a BRANCH, and this is the only place that says what is on it.
// Everything here is read from the repositories on this host -- never from the
// machine, and never from the worker's account of itself. That is the whole
// point: a run says what it believes it did, and the branch says what actually
// arrived. Where those differ, the branch is right.
//
// STRICTLY READ-ONLY, and not incidentally. Reviewing by checking a branch out
// would move HEAD in a repository something else may be serving, and would make
// the review branch look like the default one. Every command below is a read
// against the object database with an explicit `--git-dir`; nothing has a
// working tree involved and no ref is touched.

const { execFileSync } = require('node:child_process')
const serve = require('../repos/serve')
const branches = require('../repos/branches')

// Bounded on purpose. This is a summary that a person reads and a window draws,
// not an export -- a task that touched two hundred files should say so in one
// line rather than arriving as two hundred.
const SHOW = 20

function git (dir, args) {
  return execFileSync('git', ['--git-dir', dir, ...args], {
    encoding: 'utf8', timeout: 30000, windowsHide: true, maxBuffer: 1 << 24
  }).trim()
}

const lines = s => String(s || '').split('\n').map(l => l.trim()).filter(Boolean)

// One repository's half of the answer.
//
// `missing` and `empty` are different and both are reported, because they mean
// different things about the work: nothing was ever pushed here, versus the
// branch exists and carries nothing beyond the default. Reporting either as
// "no changes" loses which one it was.
function inRepo (repo, branch) {
  const dir = serve.gitDirOf(repo)
  if (!dir) return { repo, missing: true }

  const base = branches.defaultOf(repo)
  const has = branches.branchesIn(dir).includes(branch)
  if (!has) return { repo, branch, base, missing: true, commits: [], files: [], ahead: 0 }

  // `base..branch` is what this branch adds, which is the reviewer's question --
  // not what it differs from, which would also count anything the default gained
  // meanwhile and read as though the worker had reverted it.
  const range = `${base}..${branch}`

  let commits = []
  try {
    commits = lines(git(dir, ['log', range, `--max-count=${SHOW}`, '--format=%h%x1f%an%x1f%aI%x1f%s']))
      // Split on a unit separator rather than on anything that can appear in a
      // commit subject. A subject carrying the delimiter is not unusual, and it
      // would otherwise silently shift every field after it.
      .map(l => l.split(String.fromCharCode(31)))
      .map(([sha, who, at, subject]) => ({ sha, who, at, subject }))
  } catch { /* an unborn default, or an unrelated history: reported as nothing added */ }

  let ahead = 0
  try { ahead = Number(git(dir, ['rev-list', '--count', range])) || 0 } catch { /* as above */ }

  let files = []
  try {
    files = lines(git(dir, ['diff', '--numstat', `${base}...${branch}`]))
      .map(l => l.split('\t'))
      .map(([added, removed, file]) => ({
        file,
        // A binary file reports `-` for both, which is not zero and must not be
        // added up as though it were.
        added: added === '-' ? null : Number(added),
        removed: removed === '-' ? null : Number(removed),
        binary: added === '-'
      }))
      .filter(f => f.file)
  } catch { /* as above */ }

  return {
    repo,
    branch,
    base,
    missing: false,
    empty: ahead === 0,
    ahead,
    commits,
    more: Math.max(0, ahead - commits.length),
    files: files.slice(0, SHOW),
    moreFiles: Math.max(0, files.length - SHOW),
    added: files.reduce((n, f) => n + (f.added || 0), 0),
    removed: files.reduce((n, f) => n + (f.removed || 0), 0)
  }
}

// The artifact, across every repository the branch could have landed in.
//
// Delivered means SOMETHING ARRIVED. A worker that exited cleanly having pushed
// nothing has produced nothing to judge, and that is the reading that matters --
// the run's exit code says the program ended, not that work exists.
function read (branch) {
  const repos = serve.list().map(r => r.name)
  const parts = repos.map(r => inRepo(r, branch))
  const carrying = parts.filter(p => !p.missing && !p.empty)

  return {
    branch,
    delivered: carrying.length > 0,
    repos: parts,
    // The one-line version, which is what a list of tasks shows.
    summary: carrying.length
      ? `${carrying.reduce((n, p) => n + p.ahead, 0)} commit(s) in ${carrying.map(p => p.repo).join(', ')}`
      : 'nothing has arrived on this branch yet',
    commits: carrying.reduce((n, p) => n + p.ahead, 0),
    files: carrying.reduce((n, p) => n + p.files.length + p.moreFiles, 0)
  }
}

// One file's change, in full, for when the summary is not enough. Still a read:
// `git diff` against the object database, no checkout.
function diff (repo, branch, file) {
  const dir = serve.gitDirOf(repo)
  if (!dir) throw new Error(`There is no repository called "${repo}" here.`)
  const base = branches.defaultOf(repo)
  const args = ['diff', `${base}...${branch}`]
  if (file) args.push('--', file)
  return git(dir, args)
}

module.exports = { read, inRepo, diff, SHOW }
