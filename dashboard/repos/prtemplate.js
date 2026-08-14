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

const FILE = () => path.join(workspaces.stateDir(), 'pr-template.json')

const git = (dir, args) => {
  try {
    return execFileSync('git', ['--git-dir', dir, ...args], { encoding: 'utf8', timeout: 30000, windowsHide: true }).trim()
  } catch { return null }
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
    about: 'The line the branch started at, per repository — which is what its "commits ahead" is measured against.',
    write: c => {
      const note = branches.noteFor(c.branch)
      if (!note || !note.from) return null
      const from = Object.entries(note.from).map(([r, b]) => `- ${r} — \`${b}\``)
      return [`**Cut from${note.group ? ` the "${note.group}" line` : ''}:**`, ...from].join('\n')
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
    about: 'The exact commit this pull request is proposing, per repository. What a reviewer checked, written down.',
    manyOnly: false,
    write: c => {
      const rows = (c.repos || []).map(r => `- ${r.repo} — \`${r.tip || 'unknown'}\`${r.ahead ? ` (${r.ahead} commit${r.ahead === 1 ? '' : 's'})` : ''}`)
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
    repos.push({ repo: part.repo, branch: part.branch, base, ahead, tip: git(dir, ['rev-parse', part.branch]) })
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
