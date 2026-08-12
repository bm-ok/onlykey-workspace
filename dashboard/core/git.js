'use strict'

// Git, and nothing about any particular project.
//
// The test for anything in this file: would it still make sense if the repos
// held a recipe collection? If not, it belongs in an ecosystem file instead.

const { execFile } = require('node:child_process')

function git (cwd, args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 1 << 24 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`git ${args.join(' ')}\n${(stderr || err.message).trim()}`))
      resolve(stdout.trim())
    })
  })
}

const head = cwd => git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])

const branches = async cwd =>
  (await git(cwd, ['branch', '--format=%(refname:short)'])).split('\n').filter(Boolean)

const hasBranch = async (cwd, name) => (await branches(cwd)).includes(name)

const isClean = async cwd => (await git(cwd, ['status', '--porcelain'])) === ''

// -B, not -b: re-entering a task that already has its branch is normal, not an
// error. The operator never types a branch name, so they can never resolve one
// that collides.
const cut = (cwd, name, base) => git(cwd, ['checkout', '-B', name, base])

const checkout = (cwd, name) => git(cwd, ['checkout', name])

const commitsAhead = async (cwd, name, base) =>
  Number(await git(cwd, ['rev-list', '--count', `${base}..${name}`]))

const diffStat = (cwd, name, base) => git(cwd, ['diff', '--stat', `${base}...${name}`])

const changedFiles = async (cwd, name, base) =>
  (await git(cwd, ['diff', '--name-only', `${base}...${name}`])).split('\n').filter(Boolean)

const log = async (cwd, name, base) =>
  (await git(cwd, ['log', '--format=%h %s', `${base}..${name}`])).split('\n').filter(Boolean)

// One squashed commit on base carrying the change note and the reviewer note.
// The branch itself is left alone, so the working history stays readable where
// it is useful and out of the log where it is not.
async function squashMerge (cwd, name, base, message) {
  await git(cwd, ['checkout', base])
  await git(cwd, ['merge', '--squash', name])
  return git(cwd, ['commit', '-m', message])
}

const clone = (parent, from, name) => git(parent, ['clone', from, name])

const fetchBranch = (cwd, from, name) => git(cwd, ['fetch', from, `${name}:${name}`, '--force'])

module.exports = {
  git, head, branches, hasBranch, isClean, cut, checkout,
  commitsAhead, diffStat, changedFiles, log, squashMerge, clone, fetchBranch
}
