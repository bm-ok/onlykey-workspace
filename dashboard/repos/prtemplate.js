'use strict'

// What a pull request says, beyond what somebody typed.
//
// A description is written once and read by everybody afterwards, and the things
// worth having in it are all things THIS APP ALREADY KNOWS and a person would
// have to look up: why the branch was cut, what the task asked for, which commit
// each repository ended at, and — the one nothing else can do — where the other
// pull requests in the same change are.
//
// CROSS-LINKS CANNOT BE WRITTEN WHEN THE FIRST ONE IS OPENED. They are numbers
// that do not exist yet: opening three pull requests produces three numbers, and
// only then can any of them name the others. So a cut opens them all and then
// goes back and appends. That second pass is the whole reason this is worth
// having here rather than in a text file somebody pastes from.
//
// EVERY BLOCK IS OFF UNTIL IT IS TURNED ON. A template that adds things nobody
// asked for is a template people stop reading, and a description nobody reads is
// worse than a short one.

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const serve = require('./serve')
const branches = require('./branches')
const workspaces = require('../core/workspaces')
const remotes = require('./remotes')

const FILE = () => path.join(workspaces.stateDir(), 'pr-template.json')

const git = (dir, args) => {
  try {
    return execFileSync('git', ['--git-dir', dir, ...args], { encoding: 'utf8', timeout: 30000, windowsHide: true }).trim()
  } catch { return null }
}

// A commit, short enough to read and long enough to find, as a link when there
// is somewhere to point it. Forty characters of hexadecimal in a description is
// something a reader copies out and pastes into a search box; eight of them
// underlined is something they click.
//
// Plain when there is no url — a repository with no remote still deserves the
// hash, and a link to nowhere is worse than none.
const link = (sha, at) => {
  if (!sha) return '`unknown`'
  const short = String(sha).slice(0, 8)
  return at ? `[\`${short}\`](${at}/commit/${sha})` : `\`${short}\``
}

// ---- the blocks --------------------------------------------------------
//
// Each one is a name, a sentence saying what it adds, whether it needs more than
// one repository to mean anything, and how to write it from what is known.
const BLOCKS = [
  {
    id: 'crosslinks',
    label: 'Links to the other pull requests in this change',
    about: 'Each pull request names the others by number and link. Written after all of them exist, because the numbers do not exist before that.',
    manyOnly: true,
    write: (c, me) => {
      const others = (c.pulls || []).filter(p => p.number && p.repo !== me)
      if (!others.length) return null
      return ['**This change is also in:**', ...others.map(p => `- ${p.repo} — ${p.url}`)].join('\n')
    }
  },
  {
    id: 'reason',
    label: 'Why the branch was cut',
    about: 'The reason recorded when the branch was made, which this app refuses to create one without.',
    write: c => {
      const note = branches.noteFor(c.branch)
      if (!note || !note.reason) return null
      return `**Why this branch exists:** ${note.reason}`
    }
  },
  {
    id: 'cutfrom',
    label: 'What it was cut from',
    about: 'The branch and the exact commit each repository started at, linked to the repository that commit came from.',
    write: c => {
      const note = branches.noteFor(c.branch)
      const rows = (c.repos || []).map(r => `- ${r.repo} — \`${r.base}\` at ${link(r.startedAt, r.from)}`)
      if (!rows.length) return null
      return [`**Cut from${note && note.group ? ` the "${note.group}" line` : ''}:**`, ...rows].join('\n')
    }
  },
  {
    id: 'briefs',
    label: 'What the task asked for',
    about: 'The brief of every task that delivered on this branch, as the worker was given it.',
    write: c => {
      const mine = (c.tasks || []).filter(t => t.branch === c.branch && t.brief)
      if (!mine.length) return null
      return mine.map(t => `**Task #${t.number} — ${t.title}**\n\n${String(t.brief).trim()}`).join('\n\n')
    }
  },
  {
    id: 'commits',
    label: 'The commit each repository ends at',
    about: 'The branch and the exact commit this pull request proposes, linked to the repository the branch lives in.',
    manyOnly: false,
    // THE SAME SHAPE AS "cut from", deliberately. They are the two ends of one
    // range and a reader compares them line by line — written differently, that
    // comparison becomes a translation exercise. Same order, same punctuation,
    // same thing linked: repository, branch, commit.
    write: c => {
      const rows = (c.repos || []).map(r =>
        `- ${r.repo} — \`${r.branch}\` at ${link(r.tip, r.at)}${r.ahead ? ` — ${r.ahead} commit${r.ahead === 1 ? '' : 's'}` : ''}`)
      if (!rows.length) return null
      return ['**Ends at:**', ...rows].join('\n')
    }
  },
  {
    id: 'origin',
    label: 'That it came from here',
    about: 'One line saying this was opened by the dashboard, and that the change is one act across several repositories.',
    write: c => (c.repos || []).length > 1
      ? `_Opened from the dashboard as one change across ${c.repos.length} repositories. It has landed when every one of them has._`
      : '_Opened from the dashboard._'
  }
]

const on = () => {
  try { return JSON.parse(fs.readFileSync(FILE(), 'utf8')) || {} } catch { return {} }
}

const set = next => {
  try { fs.mkdirSync(workspaces.stateDir(), { recursive: true }) } catch { /* it exists */ }
  const now = { ...on(), ...next }
  try { fs.writeFileSync(FILE(), JSON.stringify(now, null, 2)) } catch { /* the answer still stands for this call */ }
  return now
}

const blocks = () => {
  const chosen = on()
  return BLOCKS.map(b => ({ id: b.id, label: b.label, about: b.about, manyOnly: !!b.manyOnly, on: !!chosen[b.id] }))
}

// What is known about a change, gathered once so every block reads the same
// facts rather than each going and asking again.
function about (source, target, pulls = []) {
  const all = branches.groups()
  const from = all.find(g => g.name === source)
  const into = all.find(g => g.name === target)
  if (!from || !into) return null

  const bases = new Map(into.on.map(p => [p.repo, p.branch]))
  const where = new Map(remotes.read().map(r => [r.repo, r]))
  const repos = []
  let branch = null

  for (const part of from.on) {
    if (!bases.has(part.repo)) continue
    branch = branch || part.branch
    const dir = serve.gitDirOf(part.repo)
    const base = bases.get(part.repo)
    let ahead = 0
    try { ahead = Number(git(dir, ['rev-list', '--count', `${base}..${part.branch}`])) || 0 } catch { /* unrelated histories */ }
    if (!ahead) continue

    // WHERE EACH END ACTUALLY LIVES, so a hash can be a link somebody can
    // follow rather than forty characters to copy out.
    //
    // The two ends live in DIFFERENT repositories, which is the whole reason
    // this is worth being careful about: the branch is in the fork it was pushed
    // to, and the point it was cut from belongs to the repository it came from —
    // the parent for a fork, and the parent's parent for a fork of a fork, which
    // is what `parent` already walks one step of. A commit is reachable from any
    // repository in a fork network that contains it, so both links resolve; what
    // differs is which one a reader lands in, and landing in the wrong one is how
    // somebody ends up reading a fork's copy of somebody else's history.
    const here = where.get(part.repo) || {}
    const origin = here.remote && here.remote.host
      ? `https://${here.remote.host}/${here.remote.owner}/${here.remote.repo}`
      : null
    const came = here.parent && here.remote ? `https://${here.remote.host}/${here.parent}` : origin

    repos.push({
      repo: part.repo,
      branch: part.branch,
      base,
      ahead,
      tip: git(dir, ['rev-parse', part.branch]),
      // THE COMMIT IT STARTED AT, which is the merge base rather than wherever
      // the base branch is now. "Cut from master" is a name; this is the commit
      // that name meant at the time, and it stays true after master moves on.
      startedAt: git(dir, ['merge-base', base, part.branch]),
      at: origin,
      from: came
    })
  }

  return { source, target, branch, repos, pulls }
}

// The blocks that are on, written out and joined — with what somebody typed
// first, because their sentence is the point and everything else is support.
function compose (said, context) {
  if (!context) return said || ''
  const chosen = on()
  const parts = [String(said || '').trim()]

  for (const b of BLOCKS) {
    if (!chosen[b.id]) continue
    if (b.manyOnly && (context.repos || []).length < 2) continue
    let text = null
    try { text = b.write(context, context.me || null) } catch { text = null }
    if (text) parts.push(text)
  }

  return parts.filter(Boolean).join('\n\n---\n\n')
}

// One repository's version, which differs only where a block is about the
// others — the cross-links.
const composeFor = (said, context, repo) => compose(said, { ...context, me: repo })

module.exports = { BLOCKS, blocks, on, set, about, compose, composeFor }
