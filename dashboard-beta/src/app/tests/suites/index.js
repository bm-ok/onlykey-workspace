'use strict'

// Every suite there is, loaded once.
//
// THE TREE IS THE STRUCTURE, and there is nothing else to keep in step:
//
//     00-the-order/                  a SUITE — the folder, and its number is where it comes
//       00-a-cut-comes-first.js      a TEST  — the file, and its number is where it comes
//         it('...')                  a CHECK — one step of that test, in the order written
//
// A test is a SERIES. Its checks run in the order they are written, they hand
// things to each other through `state`, a check that fails stops the ones after
// it, and `cleanup()` undoes what the series arranged however it ended. That is
// the whole reason for the third level: what this app does is an ORDER — cut a
// branch, write a task on it, give it out, judge it, cut a PR — and an order
// cannot be stated as a bag of independent assertions.
//
// THE NUMBERS ARE THE ORDER AND NOTHING ELSE. They are stripped from what is
// shown, so `00-the-order` is "the order" in the window. Renumbering is how the
// order changes; nothing anywhere lists these files.
//
// A CHECK SAYS WHAT IT SAW, AND THE FILE KEEPS A TRANSCRIPT.
//
// Every check is handed `log` along with `okc` and `assert`, and what it logs is
// kept against that check — the window shows it beside the source, and
// `suiteRun --json` returns it as `log`. Checks use it for the concrete thing
// they met: a branch name, a task number, how many seconds a machine took, and
// above all THE WORDING OF A REFUSAL.
//
// At the bottom of each file is a "WHAT IT SAW" block: those lines from a real
// run, quoted, with the date. It is not decoration. Half of what this app
// promises is a refusal, a refusal is only as good as the sentence it hands
// back, and that sentence is the part that gets edited without anybody noticing.
// A reader comparing the block against a fresh run sees drift immediately; a
// reader who will never run the half-hour drills gets to read what one run
// actually said.
//
// Written from a run rather than from memory. An invented transcript is worse
// than none — it reads exactly like evidence and is not.
//
// Registration is a SIDE EFFECT OF REQUIRING a file: each file calls it() as it
// loads, into the test this loader has opened around it. So this module exists
// to require them in a fixed order and to be required exactly once — the
// registry in the harness is a module-level array, and loading a file twice
// would register every check in it twice.

const fs = require('node:fs')
const path = require('node:path')

// REQUIRE THE HARNESS BY A RELATIVE PATH — never by an absolute one.
//
// The registry is a module-level array, and Node keys its module cache on the
// RESOLVED path. An absolute require that differs in any way the resolver does
// not normalise — on Windows, a drive letter in the other case is enough —
// loads a SECOND copy of the harness with its own empty array. A file then
// registers into a registry nothing reads: no error, no warning, and it simply
// does not appear.
//
// Found by writing a probe suite that way. It ran, it registered, and
// `suiteRun --suite probe` answered "0 passed, 0 failed" about a suite sitting
// in the directory.
const { group, describe } = require('../harness')

let loaded = false

// `00-the-order` is "the order", `01-a-cut-comes-first.js` is "a cut comes
// first". The prefix orders, the rest names, and neither has to be repeated
// inside the file.
const titleOf = name => name
  .replace(/\.js$/i, '')
  .replace(/^[0-9]+[-_. ]*/, '')
  .replace(/[-_.]+/g, ' ')
  .trim()

const ordered = names => names.slice().sort()

function load () {
  if (loaded) return
  loaded = true
  const here = __dirname

  for (const entry of ordered(fs.readdirSync(here))) {
    const full = path.join(here, entry)
    if (!fs.statSync(full).isDirectory()) {
      // A check written at this level has no test to belong to and no suite to
      // sit in, and would silently be none of the three. Said plainly rather
      // than skipped: a file quietly not running is the failure this whole
      // structure exists to make impossible.
      if (entry.endsWith('.js') && entry !== 'index.js') {
        throw new Error(`test/suites/${entry} is a loose file — a test belongs in a suite folder, as test/suites/00-something/00-${entry}`)
      }
      continue
    }

    group(titleOf(entry), () => {
      for (const file of ordered(fs.readdirSync(full))) {
        if (!file.endsWith('.js')) continue
        describe(titleOf(file), () => { require(path.join(full, file)) })
      }
    })
  }
}

module.exports = { load, titleOf }
