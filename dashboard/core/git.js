'use strict'

// Git, and nothing about any particular project.
//
// The test for anything here: would it still make sense if the repos held a
// recipe collection? If not, it belongs in an ecosystem file instead.
//
// Nothing in this file rewrites history. There is no reset --hard on a tip we did
// not just move, no revert, no amend, no force push. The one exception is
// rollback(), which exists so that accepting a set of repos either commits all of
// them or none, and which is only ever handed a commit this process made seconds
// earlier.

const { execFile } = require('node:child_process')

function git (cwd, args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 1 << 24 }, (err, stdout, stderr) => {
      if (err) {
        // Only the subcommand, never the full args: a commit message is an
        // argument, and splicing it into the error made the reason unreadable.
        const why = (stderr || stdout || err.message).trim()
        return reject(new Error(`git ${args[0]} failed\n${why}`))
      }
      resolve(stdout.trim())
    })
  })
}

const head = cwd => git(cwd, ['rev-parse', 'HEAD'])
const branch = cwd => git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
const isClean = async cwd => (await git(cwd, ['status', '--porcelain'])) === ''

// The tool owns the index: an attempt is everything above HEAD, and a partly
// staged tree would make that ambiguous. Staging is not history, so this costs
// nothing that cannot be redone.
const stageAll = cwd => git(cwd, ['add', '-A'])

// What the attempt actually is. Staged first so files that did not exist before
// are included -- a diff that silently omits new files would make both the review
// and the saved patch lie.
async function attempt (cwd) {
  await stageAll(cwd)
  const [files, stat, patch] = await Promise.all([
    git(cwd, ['diff', '--cached', '--name-status', 'HEAD']),
    git(cwd, ['diff', '--cached', '--stat', 'HEAD']),
    git(cwd, ['diff', '--cached', '--binary', 'HEAD'])
  ])
  return {
    files: files.split('\n').filter(Boolean).map(l => {
      const [how, ...rest] = l.split('\t')
      return { how, path: rest.join(' → ') }
    }),
    stat,
    patch
  }
}

const commit = async (cwd, message) => {
  await stageAll(cwd)
  await git(cwd, ['commit', '-m', message])
  return head(cwd)
}

// Undo a commit this action just made, keeping the work staged exactly as it was.
// Permitted by the HEAD rule only for a commit created moments ago by the same
// action, which is verified by the caller before this is reached.
const rollback = cwd => git(cwd, ['reset', '--soft', 'HEAD~1']).then(() => head(cwd))

// Back to HEAD. Untracked files go; ignored files stay, which is why there is no
// -x -- clearing those would delete build output and local state nobody asked
// about.
async function restore (cwd) {
  await git(cwd, ['reset', '--hard', 'HEAD'])
  await git(cwd, ['clean', '-fd'])
}

const apply = (cwd, patchFile) => git(cwd, ['apply', '--index', patchFile])

module.exports = { git, head, branch, isClean, stageAll, attempt, commit, rollback, restore, apply }
