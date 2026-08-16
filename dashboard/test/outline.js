'use strict'

// Every suite, test and check there is — printed, not asserted.
//
//     node dashboard/test/outline.js            print it
//     node dashboard/test/outline.js --write    write test/outline.md
//     node dashboard/test/outline.js --check    what npm test runs
//
// AND THE APP WRITES IT ON STARTUP while testing mode is on, so the file cannot
// drift from the suites during a session where somebody is changing them. See
// `outline` in server.js — this exports what it needs for that, and running it
// as a script is the same code with a command line around it.
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
// `--write` rather than a redirect, because the redirect is not the same command
// everywhere: PowerShell writes UTF-8 WITH A BOM, and several of these titles
// carry an em-dash, so the shell would decide the encoding of a file full of
// punctuation this project cares about.

const fs = require('node:fs')
const path = require('node:path')
const { load } = require('./suites')
const harness = require('../tasks/harness')

const SUITES_AT = path.join(__dirname, 'suites')
const FILE = path.join(__dirname, 'outline.md')

// The first line of a suite's README, which by convention says what the suite
// is. Absent rather than invented when there is no README: a made-up summary of
// somebody else's suite is worse than none, because it reads as theirs.
function purposeOf (folder) {
  try {
    const lines = fs.readFileSync(path.join(SUITES_AT, folder, 'README.md'), 'utf8').split(/\r?\n/)
    // Past the `# heading` and the blank line under it.
    for (const line of lines.slice(1)) {
      const said = line.trim()
      if (said) return said
    }
  } catch { /* a suite without a README says nothing here */ }
  return null
}

const numberOf = name => (name.match(/^([0-9]+)/) || [])[1] || ''
const sorted = names => names.slice().sort()

// Everything, as text — and what is wrong with the graph, which is a different
// answer from the text and is why this hands back both.
function build () {
  load()

  const suites = harness.getRegisteredSuites()
  const declared = harness.requirements()

  // A folder is a suite, a file is a test, an it() is a check — and the harness
  // speaks in its ported words, where `group` is the folder and `name` is the
  // file. Regrouped here so the printed shape is the shape on disk.
  //
  // Insertion order is the numeric order the loader walked, which is the order
  // the suites are meant to be read in. A Map keeps it; sorting by name would
  // throw it away and put "the guards" before "the order".
  const byGroup = new Map()
  for (const suite of suites) {
    const group = suite.group || '(no suite)'
    if (!byGroup.has(group)) byGroup.set(group, [])
    byGroup.get(group).push(suite)
  }

  const folders = sorted(fs.readdirSync(SUITES_AT, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name))

  const out = []
  let tests = 0
  let checks = 0

  // THE NUMBERS, WHICH THE LOADER STRIPS ON PURPOSE.
  //
  // `00-the-order/00-a-cut-comes-first.js` registers as "the order" / "a cut
  // comes first" — the prefixes order the walk and are not part of any title, so
  // nothing in the registry remembers them. They are read back off disk here,
  // because on a list this long "which one is third" is a real question and
  // counting is not an answer.
  //
  // The two orders cannot drift: the loader sorts the same names this does. If
  // they ever disagree the pairing below would attach one file's number to
  // another file's checks, so it is checked rather than trusted — a wrong number
  // is worse than none, being wrong in a way that looks authoritative.
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

    // A SUITE IS THE TOP LEVEL, so it gets the biggest header. This was the
    // wrong way round once — `##` for the folder and an indented `#` for the
    // file — which renders as a suite subordinate to the tests inside it.
    out.push(`# ${numberOf(folder)} — ${group}`, '')

    // WHAT THE SUITE IS, in its own words. The titles below are the claims; this
    // is the context they are claims about, and without it the file reads as a
    // list of assertions rather than as the app describing itself in the order
    // somebody uses it.
    const said = purposeOf(folder)
    if (said) out.push(said, '')

    // WHAT IT STANDS ON, if anything. Here as well as in the window because a
    // requires() lives in one file of a suite and could be lost in a rename
    // without anything complaining — and a dependency that quietly disappears
    // stops dirt spreading to the suites that were relying on it, silently.
    const standsOn = declared[group] || []
    if (standsOn.length) out.push(`*stands on ${standsOn.join(' and ')}*`, '')

    files.forEach((file, j) => {
      tests++
      // ITS OWN NUMBER, NOT THE PATH TO IT. This was `00.02`, which repeats the
      // suite number sitting three lines above and reads as a version.
      out.push(`## ${numberOf(onDisk[j])} — ${file.name}`, '')
      file.tests.forEach((check, k) => {
        checks++
        // AN ORDERED LIST, so the numbers are markdown's rather than painted on.
        // Indented by two, which shows the nesting and is still a list — FOUR
        // would be a code block.
        //
        // A DRAFT MUST NOT READ AS A CHECK. This file is the closest thing to a
        // specification here, and a line that has never been written looking
        // exactly like one that runs is how a spec starts lying.
        out.push(`  ${k + 1}. ${check.name}${check.draft ? ' — **draft, not written yet**' : ''}`)
      })
      out.push('')
    })
  })

  // A REQUIREMENT THAT NAMES NOTHING IS A BROKEN EDGE, and it breaks silently.
  //
  // requires() is matched by name against the other suites. Rename a folder and
  // every requires() pointing at the old name simply stops finding anything — no
  // error, no warning, and dirt quietly stops spreading. Which happened within
  // an hour of the mechanism existing.
  const known = new Set(byGroup.keys())
  const broken = []
  for (const [group, needs] of Object.entries(declared)) {
    for (const name of needs) if (!known.has(name)) broken.push(`${group} requires "${name}", and there is no such suite`)
  }

  const text = [
    '<!-- generated: node dashboard/test/outline.js --write -->',
    `<!-- ${byGroup.size} suites, ${tests} tests, ${checks} checks -->`,
    '',
    // The blank line each block ends with separates it from the next header; the
    // last one has nothing to separate from, so the file ends with a single
    // newline like every other text file here.
    out.join('\n').trimEnd(),
    ''
  ].join('\n')

  return { text, broken, suites: byGroup.size, tests, checks }
}

// Compared with line endings normalised, because this repository is checked out
// on Windows and the file is written with LF — a CRLF checkout must not read as
// a stale outline, which would be a failing test that no edit can fix.
const flat = s => String(s).replace(/\r\n/g, '\n').trim()

// Written only when it would CHANGE, so the app can do this on every startup
// without touching a file — and without a git status that says something was
// edited when nothing was.
function write () {
  const made = build()
  const there = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : ''
  const same = flat(there) === flat(made.text)
  if (!same) fs.writeFileSync(FILE, made.text, 'utf8')
  return { ...made, wrote: !same, file: FILE }
}

module.exports = { build, write, flat, FILE }

// ---- as a command ---------------------------------------------------------
//
// Only when run directly. Requiring this from the app must not print anything or
// exit anything.
if (require.main === module) {
  const made = build()

  if (made.broken.length && !process.argv.includes('--write')) {
    console.log('\nFAIL — a suite stands on something that does not exist:')
    for (const b of made.broken) console.log(`       ${b}`)
    console.log('       Nothing enforces these names, so a renamed folder leaves the edge pointing at nothing.')
    process.exit(1)
  }

  // A GENERATED FILE THAT NOBODY REGENERATES IS WORSE THAN NO FILE: it is a list
  // of claims about this app that used to be right, read by somebody who has no
  // reason to doubt it. This makes a stale outline a failing test rather than a
  // thing to remember, and the fix it prints is the whole fix.
  if (process.argv.includes('--check')) {
    const there = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : ''
    if (flat(there) !== flat(made.text)) {
      console.log('\nFAIL — test/outline.md no longer matches the suites that register.')
      console.log('       Update it:  node dashboard/test/outline.js --write')
      process.exit(1)
    }
    console.log(`PASS — the outline matches: ${made.suites} suites, ${made.tests} tests, ${made.checks} checks.`)
  } else if (process.argv.includes('--write')) {
    const done = write()
    process.stderr.write(`${path.relative(process.cwd(), done.file)} — ${done.suites} suites, ${done.tests} tests, ${done.checks} checks${done.wrote ? '' : ' (unchanged)'}\n`)
  } else {
    process.stdout.write(made.text)
  }
}
