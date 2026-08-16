'use strict'

// What the code REFUSES, and which of those refusals a drill has ever proved.
//
//     node dashboard/test/claims.js            print it
//     node dashboard/test/claims.js --write    write test/claims.md
//
// WHY THIS IS COMPUTABLE AT ALL. Half of what this app promises is a refusal —
// a task on an uncut branch, a snapshot of a machine holding a credential,
// approving over the wire — and each one is a `throw` carrying the sentence
// somebody actually meets. The drills prove refusals with
// `assert.refuses(fn, pattern)`, which matches that MESSAGE rather than merely
// catching a throw. So the two halves can be crossed: every refusal the code
// makes, against every pattern a check would accept.
//
// What comes out is a draft list. A refusal nothing matches is a rule this app
// enforces and nothing watches — which is a check waiting to be written, in the
// app's own words, at a known file and line.
//
// IT IS A LIST OF CANDIDATES, NOT A SCORE. Some throws are impossible states
// rather than rules ("this should never happen"); some are one rule expressed in
// three places. Reading the list is the point. It is deliberately not part of
// `npm test`: a coverage number that fails a build is a number people learn to
// game, and the useful thing here is which sentences nobody has ever checked.

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const read = f => fs.readFileSync(f, 'utf8')
const rel = f => path.relative(ROOT, f).replace(/\\/g, '/')

const filesIn = (dir, deep = false) => {
  const at = path.join(ROOT, dir)
  if (!fs.existsSync(at)) return []
  const out = []
  for (const e of fs.readdirSync(at, { withFileTypes: true })) {
    if (e.isDirectory() && deep) out.push(...filesIn(path.join(dir, e.name), true))
    else if (e.isFile() && e.name.endsWith('.js')) out.push(path.join(at, e.name))
  }
  return out
}

// ---- every refusal the code makes ----------------------------------------
//
// Template literals and plain strings both, because the interesting ones name
// what was asked for — "there is no branch called X" — and those are always
// templates. The placeholders are replaced with a marker so a pattern can still
// be matched against the fixed words around them.
const claims = []
for (const file of [...filesIn('actions'), ...filesIn('tasks'), ...filesIn('machines'), ...filesIn('repos'), ...filesIn('core')]) {
  const src = read(file)
  const lines = src.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const m = /throw new Error\((`|')([\s\S]*?)\1\s*\)/.exec(lines[i])
    if (!m) continue
    const said = m[2].replace(/\$\{[^}]*\}/g, '…').replace(/\\n/g, ' ').trim()
    // Anything under about twenty characters is a marker rather than a sentence
    // somebody reads — "no name", "missing" — and says nothing worth checking.
    if (said.length < 20) continue
    claims.push({ file: rel(file), line: i + 1, said })
  }
}

// ---- every refusal a drill would accept -----------------------------------
const patterns = []
for (const folder of fs.readdirSync(path.join(__dirname, 'suites'), { withFileTypes: true }).filter(d => d.isDirectory())) {
  for (const file of filesIn(path.join('test', 'suites', folder.name))) {
    const src = read(file)
    // The second argument to refuses(), which is the pattern the message has to
    // match. Written across two lines in every drill here, so the source is read
    // whole rather than line by line.
    for (const m of src.matchAll(/assert\.refuses\(\s*[\s\S]*?,\s*'([^']+)'\s*,/g)) {
      patterns.push({ pattern: m[1], from: rel(file) })
    }
  }
}

// MATCHED ON SOMETHING DISTINCTIVE, or it is not a match at all.
//
// The patterns are alternations — `window|person|may not approve`, `branch` —
// and a bare `branch` matches half the sentences this app can say. The first
// version of this counted 100 of 292 refusals as watched, including "Which
// branch, in which repository?" as proved by a drill about approving jobs over
// the wire. A coverage list that flatters itself is worse than none: it says the
// work is done.
//
// So the WORD THAT MATCHED has to be long enough to be about something. Ten
// characters keeps "is a link in", "nothing to judge", "already been given" and
// drops "window", "branch", "reason". It is a heuristic and it is stated as one
// — the list is for reading, not for scoring.
const watchedBy = said => patterns.filter(p => {
  try {
    const hit = new RegExp(p.pattern, 'i').exec(said)
    return !!hit && hit[0].length >= 10
  } catch { return false }
})

const proved = []
const draft = []
for (const claim of claims) {
  const who = watchedBy(claim.said)
  if (who.length) proved.push({ ...claim, by: [...new Set(who.map(w => w.from))] })
  else draft.push(claim)
}

// Grouped by file, because a file is a subject: everything actions/tasks.js
// refuses is about tasks, and reading them together is how somebody decides
// which are one rule said three ways.
const byFile = new Map()
for (const d of draft) {
  if (!byFile.has(d.file)) byFile.set(d.file, [])
  byFile.get(d.file).push(d)
}

const out = []
out.push('<!-- generated: node dashboard/test/claims.js --write -->')
out.push('')
out.push('# What the code refuses, and what nothing checks')
out.push('')
out.push('Every `throw` in the app is a claim it makes about what it will not do. Every')
out.push('`assert.refuses(fn, pattern)` in a drill is one of those claims being watched —')
out.push('and it matches the MESSAGE, not merely the throwing, so the two can be crossed.')
out.push('')
out.push(`**${proved.length} of ${claims.length} refusals are matched by a check. ${draft.length} are not.**`)
out.push('')
out.push('The list below is drafts: rules this app enforces that no drill has ever asked')
out.push('for. Each is a check waiting to be written, in the app\'s own words, at a known')
out.push('line. Not all of them should be — some are impossible states rather than rules,')
out.push('and some are one rule expressed three times — which is why this is a list to')
out.push('read rather than a number to drive to zero.')
out.push('')

out.push('## Watched already')
out.push('')
for (const p of proved) out.push(`- ${p.file}:${p.line} — matched by ${p.by.join(', ')}\n  > ${p.said}`)
out.push('')

out.push('## Drafts — refused by the code, checked by nothing')
out.push('')
for (const [file, rows] of [...byFile.entries()].sort()) {
  out.push(`### ${file}`)
  out.push('')
  for (const r of rows) out.push(`- **${r.line}** — ${r.said}`)
  out.push('')
}

const text = out.join('\n') + '\n'
if (process.argv.includes('--write')) {
  fs.writeFileSync(path.join(__dirname, 'claims.md'), text, 'utf8')
  process.stderr.write(`test/claims.md — ${claims.length} refusals, ${proved.length} watched, ${draft.length} drafts\n`)
} else {
  process.stdout.write(text)
}
