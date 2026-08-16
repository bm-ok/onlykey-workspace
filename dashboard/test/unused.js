'use strict'

// What is here that nothing appears to use.
//
//     node dashboard/test/unused.js            print it
//     node dashboard/test/unused.js --write    write test/unused.md
//
// WHY THIS EXISTS. Most of this app was built without a way to run it end to
// end, so things were tried, replaced, and left. The drills find contradictions
// between what the code does and what something else believed; this finds the
// other kind — code with no caller, and comments that name a caller that is not
// there.
//
// THESE ARE SUSPECTS, NOT VERDICTS, and the file it writes says so. It matches
// names in text, so it is wrong in both directions: an action reached only by
// the command line looks unused (it is not — that is a real way to use this
// app), and a name that happens to appear in a comment looks used (it is not —
// a comment is not a caller). Every line here is something to LOOK at.
//
// It is deliberately not part of `npm test`. A report that fails the build
// teaches people to delete things to make it quiet, and half of what it finds is
// meant to be here.

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const read = f => fs.readFileSync(f, 'utf8')

// Comments are stripped before anything is counted as a use, which is the whole
// point of the second list below: a name mentioned in a comment is not called by
// it, and this app has comments that say otherwise.
const codeOnly = s => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map(l => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
  .join('\n')

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

const rel = f => path.relative(ROOT, f).replace(/\\/g, '/')

// ---- every action in the table -------------------------------------------
const actions = new Map()
for (const f of filesIn('actions')) {
  for (const m of codeOnly(read(f)).matchAll(/^\s{2}([a-zA-Z][\w]*):\s*\{/gm)) actions.set(m[1], rel(f))
}

// ---- everywhere one could be called from ----------------------------------
const everywhere = new Map()
for (const f of [
  ...filesIn('ui'), ...filesIn('tasks'), ...filesIn('machines'), ...filesIn('repos'),
  ...filesIn('core'), ...filesIn('actions'), ...filesIn('test', true), ...filesIn('tools'),
  path.join(ROOT, 'server.js')
]) {
  if (fs.existsSync(f)) everywhere.set(rel(f), { code: codeOnly(read(f)), all: read(f) })
}

const calledIn = (name, where) => new RegExp(`['"\`]${name}['"\`]|\\b${name}\\s*\\(|\\.${name}\\b`).test(where)

const noCaller = []
const onlyInProse = []
const cliOnly = []

for (const [name, definedIn] of actions) {
  const users = []
  const talkedAboutIn = []
  for (const [file, src] of everywhere) {
    // Its own definition is not a use of it.
    const body = file === definedIn ? src.code.replace(new RegExp(`^\\s{2}${name}:\\s*\\{`, 'gm'), '') : src.code
    if (calledIn(name, body)) users.push(file)
    else if (file !== definedIn && calledIn(name, src.all)) talkedAboutIn.push(file)
  }

  // The command line can call anything by name, so it is never evidence that
  // something is wanted — it is the tool that makes every action reachable.
  const real = users.filter(u => u !== 'tools/okc.js')
  if (!real.length && talkedAboutIn.length) onlyInProse.push({ name, definedIn, talkedAboutIn })
  else if (!real.length) noCaller.push({ name, definedIn })
  else if (!real.some(u => u.startsWith('ui/') || u.startsWith('test/'))) cliOnly.push({ name, definedIn, real })
}

// ---- exports nothing outside the file uses --------------------------------
const dead = []
for (const f of [...filesIn('core'), ...filesIn('machines'), ...filesIn('repos'), ...filesIn('tasks')]) {
  const me = rel(f)
  const m = /module\.exports\s*=\s*\{([^}]*)\}/.exec(codeOnly(read(f)))
  if (!m) continue
  for (const n of m[1].split(',').map(s => s.split(':')[0].trim()).filter(n => /^[a-zA-Z][\w]*$/.test(n))) {
    let used = false
    for (const [file, src] of everywhere) {
      if (file === me) continue
      if (new RegExp(`\\.${n}\\b|\\b${n}\\s*\\(`).test(src.code)) { used = true; break }
    }
    if (!used) dead.push(`${me} — ${n}`)
  }
}

const lines = []
const say = s => lines.push(s)

say('<!-- generated: node dashboard/test/unused.js --write -->')
say('')
say('# What nothing appears to use')
say('')
say('**Suspects, not verdicts.** This matches names in text, so it is wrong in both')
say('directions: an action reached only from the command line looks unused when it is')
say('not, and a name appearing in a comment looks used when a comment cannot call')
say('anything. Every line here is something to look at, and some of it is meant to be')
say('here.')
say('')
say(`${actions.size} actions, ${everywhere.size} files searched.`)
say('')

say('## Named only in comments')
say('')
say('The most interesting list. Nothing calls these, and something *says* something')
say('does — so either the code moved and the comment did not, or it is dead surface')
say('with a story attached.')
say('')
for (const { name, definedIn, talkedAboutIn } of onlyInProse) {
  say(`- \`${name}\` — defined in ${definedIn}, spoken about in ${talkedAboutIn.join(', ')}`)
}
if (!onlyInProse.length) say('_None._')
say('')

say('## No caller anywhere')
say('')
say('Reachable only by typing the name at the command line. Some of these are tools')
say('and that is what they are for; the rest is surface nothing asks for.')
say('')
for (const { name, definedIn } of noCaller) say(`- \`${name}\` — ${definedIn}`)
if (!noCaller.length) say('_None._')
say('')

say('## No window button and no drill')
say('')
say('Something calls them, but nothing a person clicks and nothing a test exercises.')
say('')
for (const { name, definedIn, real } of cliOnly) say(`- \`${name}\` — ${definedIn}, called by ${real.join(', ')}`)
if (!cliOnly.length) say('_None._')
say('')

say('## Exported, and nothing outside the file uses it')
say('')
for (const d of dead) say(`- ${d}`)
if (!dead.length) say('_None._')
say('')

const text = lines.join('\n') + '\n'
if (process.argv.includes('--write')) {
  const at = path.join(__dirname, 'unused.md')
  fs.writeFileSync(at, text, 'utf8')
  process.stderr.write(`${rel(at)} — ${onlyInProse.length} named only in comments, ${noCaller.length} with no caller, ${cliOnly.length} with no button or drill, ${dead.length} dead exports\n`)
} else {
  process.stdout.write(text)
}
