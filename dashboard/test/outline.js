'use strict'

// Every suite, test and check there is — printed, not asserted.
//
//     node dashboard/test/outline.js > dashboard/test/outline.md
//
// WHAT IT IS FOR. The titles are the claims this app makes about itself, and
// read in order they are a description of the tool: cut a branch, write a task
// on it, give it to a machine, judge what comes back. That list is worth having
// in one place somebody can read without opening fifteen files or starting
// anything — including somebody deciding whether a claim is missing.
//
// READ FROM THE REGISTRY, NOT FROM THE FILES. It loads the suites exactly as the
// app does and asks the harness what registered, so this cannot drift from what
// would actually run. A version that scanned for `it(` would list a check inside
// a comment and miss one built in a loop, and it would keep printing a file that
// had stopped loading — which is the failure the whole three-level structure
// exists to make impossible.
//
// NOTHING RUNS. Requiring a suite file registers its checks; it does not execute
// them. So this is safe with machines at rest, mid-install, or with no dashboard
// running at all — it never opens a port or asks the app anything.
//
// The output goes to stdout so the redirect above is the whole update. It is a
// generated file: edit the titles in the suites, not the markdown.
//
// OR `--write`, WHICH PUTS THE FILE DOWN ITSELF:
//
//     node dashboard/test/outline.js --write
//
// Same output, written as UTF-8 with LF. Worth having because the redirect is
// not the same command everywhere: PowerShell writes UTF-8 WITH A BOM, and
// several of these titles carry an em-dash, so the shell decides the encoding of
// a file full of punctuation this project cares about. `--write` takes that
// decision away from the shell.

const fs = require('node:fs')
const path = require('node:path')
const { load } = require('./suites')
const harness = require('../tasks/harness')

load()

const suites = harness.getRegisteredSuites()

// A folder is a suite, a file is a test, an it() is a check — and the harness
// speaks in its ported words, where `group` is the folder and `name` is the
// file. Regrouped here so the printed shape is the shape on disk.
//
// Insertion order is the numeric order the loader walked, which is the order the
// suites are meant to be read in. A Map keeps it; sorting by name would throw it
// away and put "the guards" before "the order".
const byGroup = new Map()
for (const suite of suites) {
  const group = suite.group || '(no suite)'
  if (!byGroup.has(group)) byGroup.set(group, [])
  byGroup.get(group).push(suite)
}

// THE NUMBERS, WHICH THE LOADER STRIPS ON PURPOSE.
//
// `00-the-order/00-a-cut-comes-first.js` registers as "the order" / "a cut comes
// first" — the prefixes order the walk and are not part of any title, so nothing
// in the registry remembers them. They are read back off disk here, because on a
// list this long "which one is third" is a real question and counting is not an
// answer.
//
// The two orders cannot drift: the loader sorts the same names this does. If
// they ever disagree the pairing below would attach one file's number to another
// file's checks, so it is checked rather than trusted — a wrong number is worse
// than none, being wrong in a way that looks authoritative.
const SUITES_AT = path.join(__dirname, 'suites')
const numberOf = name => (name.match(/^([0-9]+)/) || [])[1] || ''
const sorted = names => names.slice().sort()

const folders = sorted(fs.readdirSync(SUITES_AT, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name))

const out = []
let tests = 0
let checks = 0

const groups = [...byGroup.keys()]
if (folders.length !== groups.length) {
  throw new Error(`${folders.length} folder(s) in test/suites and ${groups.length} suite(s) registered — the numbers below would be attached to the wrong titles`)
}

folders.forEach((folder, i) => {
  const group = groups[i]
  const files = byGroup.get(group)
  const onDisk = sorted(fs.readdirSync(path.join(SUITES_AT, folder)).filter(f => f.endsWith('.js')))
  if (onDisk.length !== files.length) {
    throw new Error(`test/suites/${folder} holds ${onDisk.length} file(s) and registered ${files.length} test(s)`)
  }

  // A SUITE IS THE TOP LEVEL, so it gets the biggest header. The first version
  // had this the wrong way round — `##` for the folder and an indented `#` for
  // the file — which renders as a suite subordinate to the tests inside it, and
  // an indented `#` is barely a header at all.
  out.push(`# ${numberOf(folder)} — ${group}`, '')
  files.forEach((file, j) => {
    tests++
    out.push(`## ${numberOf(folder)}.${numberOf(onDisk[j])} — ${file.name}`, '')
    file.tests.forEach((check, k) => {
      checks++
      // AN ORDERED LIST, so the numbers are markdown's rather than painted on.
      // A check has no name on disk — its number is its position in the file,
      // which is also the order it runs in, and that is exactly what an ordered
      // list means.
      out.push(`${k + 1}. ${check.name}`)
    })
    out.push('')
  })
})

// The counts first, because the useful question about this list is usually "is
// it bigger than last time". Said as a comment rather than a heading so the
// shape below is exactly what it was before this line existed.
const text = [
  '<!-- generated: node dashboard/test/outline.js --write -->',
  `<!-- ${byGroup.size} suites, ${tests} tests, ${checks} checks -->`,
  '',
  // The blank line each block ends with is what separates it from the next
  // header; the last one has nothing to separate from, so it goes, and the file
  // ends with a single newline like every other text file here.
  out.join('\n').trimEnd(),
  ''
].join('\n')

const at = path.join(__dirname, 'outline.md')

// AND `--check`, WHICH IS HOW IT STAYS TRUE.
//
// Run by `npm test`. A generated file that nobody regenerates is worse than no
// file: it is a list of claims about this app that used to be right, read by
// somebody who has no reason to doubt it. This makes a stale outline a failing
// test rather than a thing to remember, and the fix it prints is the whole fix.
//
// Compared with line endings normalised, because this repository is checked out
// on Windows and the file is written with LF — a CRLF checkout must not read as
// a stale outline, which would be a failing test that no edit can fix.
const flat = s => String(s).replace(/\r\n/g, '\n').trim()

if (process.argv.includes('--check')) {
  const there = fs.existsSync(at) ? fs.readFileSync(at, 'utf8') : ''
  if (flat(there) !== flat(text)) {
    console.log('\nFAIL — test/outline.md no longer matches the suites that register.')
    console.log('       Update it:  node dashboard/test/outline.js --write')
    process.exit(1)
  }
  console.log(`PASS — the outline matches: ${byGroup.size} suites, ${tests} tests, ${checks} checks.`)
} else if (process.argv.includes('--write')) {
  fs.writeFileSync(at, text, 'utf8')
  // To stderr, so `--write` can still be piped somewhere without this landing in
  // the middle of it.
  process.stderr.write(`${path.relative(process.cwd(), at)} — ${byGroup.size} suites, ${tests} tests, ${checks} checks\n`)
} else {
  process.stdout.write(text)
}
