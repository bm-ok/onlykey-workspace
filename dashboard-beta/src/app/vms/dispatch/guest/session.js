// READING THE CLAUDE SESSION INSIDE A RUNNER. THIS FILE RUNS IN A GUEST.
//
// Claude Code appends everything it does to a transcript on that machine's disk.
// This is the reader for it, fed to the guest's node through stdin so nothing
// has to be installed and nothing is left behind.
//
// STRICTLY READ-ONLY, and that is a rule rather than an accident of how this is
// written. A supervisor that writes into the tree a worker is editing is how one
// session's notes end up inside another's commit -- a real thing that happened
// here. Everything below opens files and prints.
//
// IT PRINTS ONE JSON OBJECT AND NOTHING ELSE, so a half-written line or a
// warning from the login shell cannot be mistaken for the answer. The caller
// takes the last line that parses.
//
// DELTAS, NOT DUMPS. The bookmark is a line number and the caller passes back
// the one it was given. A watcher that re-reads from the top spends its context
// re-deriving what it already reported -- which for an agent is the whole cost.
//
// It was a template string in the host's own source until the port; as a real
// file it can be linted, `node --check`ed and read like the code it is.
const fs = require('fs'), os = require('os'), path = require('path')
const MODE = process.argv[2] || 'list'
const WANT = process.argv[3] || ''
const SINCE = Number(process.argv[4] || 0)
const LIMIT = Number(process.argv[5] || 40)
const ROOT = path.join(os.homedir(), '.claude', 'projects')
// HOW MUCH OF ANY ONE LINE COMES BACK. Passed in rather than agreed twice: the
// host states it, and the default here is only what a hand-run of this file gets.
const CLIP = Number(process.argv[6] || 200)

const clip = s => { const f = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return f.length > CLIP ? f.slice(0, CLIP) + '\u2026' : f }
const readLines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(l => l.trim()) } catch { return [] } }
const parse = l => { try { return JSON.parse(l) } catch { return null } }

function sessions () {
  const out = []
  let projects = []
  try { projects = fs.readdirSync(ROOT, { withFileTypes: true }).filter(e => e.isDirectory()) } catch { return out }
  for (const p of projects) {
    const dir = path.join(ROOT, p.name)
    let files = []
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')) } catch { continue }
    for (const f of files) {
      const full = path.join(dir, f)
      const lines = readLines(full)
      let title = null, last = null, cwd = null
      for (const l of lines) {
        const e = parse(l)
        if (!e) continue
        if (e.aiTitle) title = e.aiTitle
        if (e.timestamp) last = e.timestamp
        if (e.cwd) cwd = e.cwd
      }
      out.push({
        id: f.replace(/\.jsonl$/, ''),
        project: p.name,
        cwd,
        title,
        lines: lines.length,
        last,
        idle: last ? Math.max(0, Math.round((Date.now() - Date.parse(last)) / 1000)) : null
      })
    }
  }
  return out.sort((a, b) => Date.parse(b.last || 0) - Date.parse(a.last || 0))
}

const all = sessions()

if (MODE === 'list') {
  console.log(JSON.stringify({ ok: true, sessions: all }))
  process.exit(0)
}

// A prefix matching two sessions is an error, never a guess. Silently watching
// the wrong one produces confident wrong reports, which is the failure this is
// meant to prevent rather than commit.
const hits = WANT ? all.filter(s => s.id.startsWith(WANT)) : all
if (!hits.length) { console.log(JSON.stringify({ ok: false, error: WANT ? 'no session here matching "' + WANT + '"' : 'no claude sessions on this machine' })); process.exit(0) }
if (hits.length > 1) { console.log(JSON.stringify({ ok: false, error: 'that matches ' + hits.length + ' sessions', sessions: hits })); process.exit(0) }

const s = hits[0]
const file = path.join(ROOT, s.project, s.id + '.jsonl')
const lines = readLines(file)
const from = Math.max(0, Math.min(SINCE, lines.length))
const entries = []

// What is worth a supervisor's attention, and nothing else. A tool result is
// tens of kilobytes; a read of a file it already had is not news.
const QUIET = new Set(['Read', 'Grep', 'Glob', 'TodoWrite', 'ToolSearch'])
const VERDICT = /(\bFAIL(ED)?\b|\berror:|\w*Error:|Traceback|segfault|\bexit=[1-9]|\bok\b|passing|failing)/
const names = new Map()

for (let i = from; i < lines.length; i++) {
  const e = parse(lines[i])
  if (!e || (e.type !== 'user' && e.type !== 'assistant')) continue
  const at = e.timestamp || null
  const c = e.message && e.message.content
  if (typeof c === 'string') {
    if (c.trim()) entries.push({ line: i + 1, at, kind: 'said-to-it', text: clip(c) })
    continue
  }
  if (!Array.isArray(c)) continue
  for (const b of c) {
    if (b.type === 'text' && b.text && b.text.trim()) entries.push({ line: i + 1, at, kind: 'text', text: clip(b.text) })
    else if (b.type === 'tool_use') {
      if (b.id) names.set(b.id, b.name)
      if (b.name === 'AskUserQuestion') {
        entries.push({ line: i + 1, at, kind: 'asked', text: clip((b.input && b.input.questions || []).map(q => q.question).join(' | ')) })
      } else if (b.name === 'Bash') entries.push({ line: i + 1, at, kind: 'ran', text: clip(b.input && b.input.command) })
      else if (b.name === 'Edit' || b.name === 'Write' || b.name === 'NotebookEdit') {
        entries.push({ line: i + 1, at, kind: b.name === 'Write' ? 'wrote' : 'edited', text: clip(b.input && b.input.file_path) })
      } else if (!QUIET.has(b.name)) entries.push({ line: i + 1, at, kind: b.name.toLowerCase(), text: clip((b.input && (b.input.command || b.input.file_path || b.input.prompt)) || '') })
    } else if (b.type === 'tool_result') {
      const from2 = names.get(b.tool_use_id)
      if (from2 && QUIET.has(from2)) continue
      const body = typeof b.content === 'string' ? b.content : JSON.stringify(b.content == null ? '' : b.content)
      // Only the lines that carry a verdict. The rest is bulk, and carrying it
      // across is what makes a watcher expensive.
      const hot = body.split('\n').filter(l => l.trim() && VERDICT.test(l)).slice(0, 4)
      for (const h of hot) entries.push({ line: i + 1, at, kind: 'result', text: clip(h) })
    }
  }
}

console.log(JSON.stringify({
  ok: true,
  session: { id: s.id, title: s.title, cwd: s.cwd, idle: s.idle, last: s.last, lines: lines.length },
  from,
  bookmark: lines.length,
  entries: entries.slice(-LIMIT),
  more: Math.max(0, entries.length - LIMIT)
}))
