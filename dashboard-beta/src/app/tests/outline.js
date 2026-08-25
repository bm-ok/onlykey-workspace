'use strict'

// Every suite, test and check there is — printed, not asserted.
//
//     node src/app/tests/outline.js            print it
//     node src/app/tests/outline.js --write    write src/app/tests/outline.md
//     node src/app/tests/outline.js --check    what npm test runs
//
// WHAT IT IS FOR. The titles are the claims this app makes about itself, and
// read in order they are a description of the tool: cut a branch, write a task
// on it, give it to a machine, judge what comes back. That list is worth having
// in one place somebody can read without opening fifteen files or starting
// anything — including somebody deciding whether a claim is missing.
//
// TWO USES, AND THE SECOND IS THE ONE THAT GETS FORGOTTEN. It is a net, and it
// is a CATALOGUE. The app being ported from wrote that down after very nearly
// building one mechanism twice: the concern was "a supervisor writing work
// unattended might reach a machine somebody is using", and the answer was going
// to be a new setting for where its work may go. The app already had the
// answer — "keep it back from tasks", one lever, honoured by every caller. It
// was not found because nothing said out loud what the app could already do.
//
// THAT HAS ALREADY HAPPENED HERE, in the port, more than once in a day: a rule
// enforced only in a React filter, a field a pane read that no action sent, a
// comment describing a check the code did not have. Each was found by reading
// something that named what exists. This is that file.
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
// ---- what is different from the app this is ported from -------------------
//
// THE SUITES ARE INSIDE THE PLUGIN, at ./suites, rather than in a top-level
// `test/` — the drills belong to the Test tab the way every other pane's server
// half belongs to its pane. The loader is ./suites/index.js and the harness is
// ./harness.js, both siblings, so this file survives the folder moving.
//
// AND THE APP WRITES IT, the same as over there — but on every KIT RELOAD rather
// than only at startup, which is better and is a property of this app rather
// than a choice. The server half rebuilds on every save and `theKit` drops the
// drills from node's cache and loads them again, so editing a drill rewrites
// this file within about five seconds. Over there it takes a restart.
//
// `npm test` CHECKS IT AS WELL, because the app only writes while the drills are
// switched on for the open folder — so a change made with them off, or by
// somebody who never opened the window, would otherwise land stale. A generated
// file nobody regenerates is worse than no file: a list of claims that used to
// be right, read by somebody with no reason to doubt it.
//
// `--write` rather than a redirect, because the redirect is not the same command
// everywhere: PowerShell writes UTF-8 WITH A BOM, and several of these titles
// carry an em-dash, so the shell would decide the encoding of a file full of
// punctuation this project cares about.

const fs = require('node:fs')
const path = require('node:path')

// ---- the suites are required INSIDE `build`, and that is load-bearing -----
//
// ./server.js requires this file to write the outline when it reloads the kit,
// and its half is BUNDLED. A top-level `require('./suites')` would pull the
// loader — and through it every drill — into that bundle, which is the one thing
// the payload arrangement exists to prevent: the drills are copied beside the
// bundle and required at run time so the board can show the source somebody
// wrote rather than babel's output, and so a fingerprint does not change the day
// a preset does. See `theKit` in ./server.js.
//
// So `render` is pure and reaches for nothing, and `build` — which only the
// command line calls — pays for the loading.

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

// ---- rendering is separated from loading, and that is not tidiness --------
//
// THE APP CANNOT REQUIRE THE SUITES THE WAY THIS SCRIPT DOES. Its server half is
// bundled, and the drills are a PAYLOAD copied beside that bundle and required
// at run time through a require webpack cannot see — see `theKit` in ./server.js
// and the note there about why. A version of this that only worked by calling
// `load()` itself could therefore never be the thing the app calls, and the app
// writing this file is the whole reason it stays current.
//
// SO `render` TAKES A REGISTRY THAT IS ALREADY LOADED. ./server.js hands it the
// one it just loaded, which also means the outline describes exactly the kit the
// board is showing rather than a second reading of the same folder that could
// disagree with it.
function render (suites, declared, suitesAt) {
  const at = suitesAt || SUITES_AT

  // The first line of a suite's README, read from wherever the suites actually
  // are — which is `dist/suites` inside the app and this folder from the
  // command line.
  const purpose = folder => {
    try {
      const lines = fs.readFileSync(path.join(at, folder, 'README.md'), 'utf8').split(/\r?\n/)
      for (const line of lines.slice(1)) {
        const said = line.trim()
        if (said) return said
      }
    } catch { /* a suite without a README says nothing here */ }
    return null
  }

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

  const folders = sorted(fs.readdirSync(at, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name))

  const out = []
  let tests = 0
  let checks = 0
  // The ones nobody has written yet, gathered as they are met. Listed once at
  // the top as well as in place, because this file is a to-do list as much as a
  // description: what is outstanding should be answerable without reading
  // eighty lines to find the three that are marked.
  const drafts = []

  // THE NUMBERS, WHICH THE LOADER STRIPS ON PURPOSE.
  //
  // `01-the-order/00-a-cut-comes-first.js` registers as "the order" / "a cut
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
    throw new Error(`${folders.length} folder(s) in tests/suites and ${groups.length} suite(s) registered — the numbers below would be attached to the wrong titles`)
  }

  folders.forEach((folder, i) => {
    const group = groups[i]
    const files = byGroup.get(group)
    // `index.js` IS THE LOADER, NOT A TEST, and it lives beside the folders
    // rather than inside one — but a suite folder holding a helper would count
    // here and throw. Filtered the way the loader filters.
    const onDisk = sorted(fs.readdirSync(path.join(at, folder))
      .filter(f => f.endsWith('.js') && f !== 'index.js'))
    if (onDisk.length !== files.length) {
      throw new Error(`tests/suites/${folder} holds ${onDisk.length} file(s) and registered ${files.length} test(s)`)
    }

    // A SUITE IS THE TOP LEVEL, so it gets the biggest header. This was the
    // wrong way round once — `##` for the folder and an indented `#` for the
    // file — which renders as a suite subordinate to the tests inside it.
    out.push(`# ${numberOf(folder)} — ${group}`, '')

    // WHAT THE SUITE IS, in its own words. The titles below are the claims; this
    // is the context they are claims about, and without it the file reads as a
    // list of assertions rather than as the app describing itself in the order
    // somebody uses it.
    const said = purpose(folder)
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
        // A DRAFT MUST NOT READ AS A CHECK. This file is the closest thing to a
        // specification here, and a line that has never been written looking
        // exactly like one that runs is how a spec starts lying.
        if (check.draft) drafts.push({ group, file: file.name, name: check.name, note: check.note })
        // A PREFIX RATHER THAN A SUFFIX, because a list is READ DOWN THE LEFT.
        // Marked at the end, "draft" arrives after the eye has already taken the
        // line as a claim the app makes — and on a long line it wraps out of
        // sight entirely.
        out.push(`  ${k + 1}. ${check.draft ? '**DRAFT** — ' : ''}${check.name}`)
      })
      out.push('')
    })
  })

  // A REQUIREMENT THAT NAMES NOTHING IS A BROKEN EDGE, and it breaks silently.
  //
  // requires() is matched by name against the other suites. Rename a folder and
  // every requires() pointing at the old name simply stops finding anything — no
  // error, no warning, and dirt quietly stops spreading.
  const known = new Set(byGroup.keys())
  const broken = []
  for (const [group, needs] of Object.entries(declared)) {
    for (const name of needs) if (!known.has(name)) broken.push(`${group} requires "${name}", and there is no such suite`)
  }

  // WHAT IS OUTSTANDING, FIRST. A draft is a check somebody meant to write and
  // has not, so it belongs at the top of the file that says what this app
  // claims — not only in place, where it is one marked line among eighty.
  const todo = drafts.length
    ? [
        `## ${drafts.length} draft${drafts.length === 1 ? '' : 's'}, not written yet`,
        '',
        ...drafts.flatMap(d => [
          `- **${d.group} / ${d.file}** — ${d.name}`,
          ...(d.note ? [`  ${d.note}`] : [])
        ]),
        ''
      ]
    : []

  const preamble = [
    '<!-- What this app can do, in the order a person does it. Generated; do not edit. -->',
    '<!--',
    '  TWO USES, AND THE SECOND IS THE ONE THAT GETS FORGOTTEN:',
    '',
    '    a net       these run against this app for real, and half of them pass by',
    '                being REFUSED.',
    '    a catalogue every capability there is, named, in one place. Read it before',
    '                building a mechanism, and before deciding something is missing.',
    '',
    '  A capability with no check here is one somebody will build again — and in',
    '  this port, one somebody will conclude is not ported.',
    '-->'
  ]

  const text = [
    '<!-- generated: node src/app/tests/outline.js --write -->',
    `<!-- ${byGroup.size} suites, ${tests} tests, ${checks} checks${drafts.length ? `, ${drafts.length} of them ${drafts.length === 1 ? 'a draft' : 'drafts'}` : ''} -->`,
    ...preamble,
    '',
    ...todo,
    // The blank line each block ends with separates it from the next header; the
    // last one has nothing to separate from, so the file ends with a single
    // newline like every other text file here.
    out.join('\n').trimEnd(),
    ''
  ].join('\n')

  return { text, broken, suites: byGroup.size, tests, checks, drafts: drafts.length }
}

// EVERYTHING, FROM THE COMMAND LINE, where loading the suites is this file's own
// job. The app takes the other door.
function build () {
  const { load } = require('./suites')
  const harness = require('./harness')
  load()
  return render(harness.getRegisteredSuites(), harness.requirements(), SUITES_AT)
}

// Compared with line endings normalised, because this repository is checked out
// on Windows and the file is written with LF — a CRLF checkout must not read as
// a stale outline, which would be a failing test that no edit can fix.
const flat = s => String(s).replace(/\r\n/g, '\n').trim()

// Written only when it would CHANGE, so nothing shows as edited when nothing is
// — and so the app can do this on every kit reload without touching a file, or a
// git status that says something was edited when nothing was.
function put (made, at) {
  const file = at || FILE
  const there = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  const same = flat(there) === flat(made.text)
  if (!same) fs.writeFileSync(file, made.text, 'utf8')
  return Object.assign({}, made, { wrote: !same, file: file })
}

function write () { return put(build(), FILE) }

// ---- WHERE THE SOURCE COPY IS, FROM INSIDE THE RUNNING APP ---------------
//
// `__dirname` IS THE BUNDLE'S FOLDER AT RUN TIME, not this one, so `FILE` points
// into `dist` — where a generated description of the app would be written beside
// a build nobody reads and never reach the repository.
//
// AND A PACKAGED APP HAS NO SOURCE TREE AT ALL, which is the case this has to
// answer rather than assume. So it is looked for, and absent is an answer: the
// outline is a thing for whoever is CHANGING the drills, and inside a package
// there is nobody to change them.
function sourceFile (root) {
  const where = path.join(root || process.cwd(), 'src', 'app', 'tests');
  try {
    if (fs.existsSync(path.join(where, 'suites'))) return path.join(where, 'outline.md');
  } catch { /* no source tree here */ }
  return null;
}

module.exports = { build, render, write, put, sourceFile, flat, FILE }

// ---- as a command ---------------------------------------------------------
//
// Only when run directly. Requiring this from a test must not print anything or
// exit anything.
if (require.main === module) {
  const made = build()

  if (made.broken.length && !process.argv.includes('--write')) {
    console.log('\nFAIL — a suite stands on something that does not exist:')
    for (const b of made.broken) console.log(`       ${b}`)
    console.log('       Nothing enforces these names, so a renamed folder leaves the edge pointing at nothing.')
    process.exit(1)
  }

  if (process.argv.includes('--check')) {
    const there = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : ''
    if (flat(there) !== flat(made.text)) {
      console.log('\nFAIL — src/app/tests/outline.md no longer matches the suites that register.')
      console.log('       Update it:  node src/app/tests/outline.js --write')
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
