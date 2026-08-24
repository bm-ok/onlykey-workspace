'use strict'

// one permission, many gates — and what it costs when they disagree
//
// A push from a machine passes three checks, and they are three on purpose:
//
//   the http route      accepts the push at all, knowing WHO is pushing from the
//                       token on the request
//   the guest's sign    a pre-push hook written into the checkout, so a worker
//                       finds out where it is standing rather than at the end of
//                       an hour's work
//   the hook's fact     OKC_READ_ONLY, handed to the pre-receive hook that
//                       actually refuses, in a directory no guest can reach
//
// The first cannot be edited by a guest, the second can, and removing the second
// does not get a push through. That redundancy is the design and is worth
// keeping.
//
// WHAT IS NOT ALLOWED IS FOR THEM TO BE THREE OPINIONS. On 19 August 2026 an
// exception was added — a branch that is out as a pull request and not merged
// may be pushed to, because it is the one branch in the world that exists to be
// revised — and it was taught to them ONE AT A TIME. The route granted the push
// and the sign refused it. The sign was taught and the hook refused it. Each
// discovery cost a worker run, its commit destroyed by the rollback that follows
// every run, and each looked exactly like the last one: a task that finished
// exit 0 with nothing on the branch.
//
// The worker said it better than anybody on this host did, in the log of the
// third attempt:
//
//   each run resets the disk, the push cannot succeed by design, and the same
//   task has now been issued three times
//
// So the rule is written once, in `mayRevise`, and the check here is the one
// that matters: every gate asks IT. A fourth gate that decides for itself is the
// same fault again, and this is what notices.
//
// ---- what this asks, and what it stopped asking --------------------------
//
// IT USED TO `require` THE RULE AND EXERCISE IT DIRECTLY — handing `underRevision`
// made-up records and checking the answers. Two things were wrong with that here.
//
// A DRILL CANNOT REACH THE APP'S INSIDES. These files are COPIED into
// `dist/suites` and run from there with only the harness beside them, so
// `require('../../../repos/landings')` was not merely renamed by the port, it
// was unreachable from where a drill runs. That is why this suite read `will not
// load`.
//
// AND IT WAS A UNIT TEST WEARING A DRILL'S CLOTHES. Whether `underRevision`
// answers correctly about a list of cuts has no host, no machine and no push in
// it — `test/repositories/pr-revising.test.js` asks exactly that, against the
// same function, and is the right place for it.
//
// WHAT IS LEFT IS THE PART NO UNIT TEST CAN DO: reading the app's own source and
// asking whether the places that DECIDE this permission all defer to the one
// rule. That is a claim about the shape of the codebase, and it is the claim
// that was false three times in one afternoon.

const { it, requires } = require('../../harness')
const fs = require('node:fs')
const path = require('node:path')

requires('what this host has')

// FROM `dist/suites/<suite>/`, THREE UP IS THE APP ITSELF. The drills are copied
// there beside the harness — see PAYLOADS in webpack.config.js — so the source
// they are about is reachable, and reading it is the whole of this check.
const root = path.join(__dirname, '..', '..', '..')
const read = (f) => fs.readFileSync(path.join(root, 'src', 'app', f), 'utf8')

it('every gate in the push path asks the one rule rather than deciding for itself', async ({ assert, log }) => {
  // NAMED, WITH WHAT EACH ONE IS, so a failure says which gate stopped asking
  // rather than that a string is missing from a file.
  const gates = [
    ['repositories/gitserve/gitapi.js', 'the http route that accepts the push, and the fact handed to the pre-receive hook'],
    ['repositories/repos/setting-up.js', 'the sign written into the guest checkout'],
    ['repositories/repos/server.js', 'where the rule is put together, once, for everybody else to ask']
  ]

  for (const [file, what] of gates) {
    assert.ok(/mayRevise/.test(read(file)),
      `${file} decides a push permission without asking mayRevise — ${what}`)
  }
  log(`${gates.length} gates, and each asks mayRevise`)
})

it('and nobody new decides it alone', async ({ assert, log }) => {
  // EVERY PLACE THAT ASKS WHETHER A BRANCH IS PROTECTED is a place this could be
  // got wrong again. A third appearing is not necessarily wrong — it may be a
  // different act, like refusing to DELETE a protected branch, which has no
  // revision exception — but it is worth a person looking, which is what a
  // failure here asks for.
  //
  // WITHIN A FEW LINES, NOT ON THE SAME ONE. The app being ported from could ask
  // for both on one line because `isProtected` returned a boolean; here
  // `whyProtected` returns the SENTENCE, so it is read into a variable and the
  // exception is asked a few lines further down. The window is an approximation
  // and is stated as one: it is wide enough for the shape the code actually has
  // and narrow enough that an unrelated mention elsewhere in the file does not
  // satisfy it.
  const WINDOW = 14

  // ../branches OWNS THE RULE, so it is not a caller of it.
  const files = [
    'repositories/gitserve/gitapi.js',
    'repositories/repos/setting-up.js',
    'repositories/repos/server.js',
    'queue/server.js',
    'runners/machines/server.js'
  ]

  const asking = []
  for (const f of files) {
    const lines = read(f).split('\n')
    lines.forEach((line, i) => {
      if (!/whyProtected\s*\(/.test(line)) return
      // WHAT IT IS FOR decides whether the exception applies, and only a push
      // path has one. A board drawing the reason on a row is not deciding
      // anything, so it is not asked to.
      const near = lines.slice(i, i + WINDOW).join('\n')
      asking.push({ f, at: i + 1, line: line.trim(), defers: /mayRevise/.test(near) })
    })
  }

  const alone = asking.filter((c) => !c.defers)
  assert.equal(alone.length, 0,
    alone.map((c) => `${c.f}:${c.at} asks whyProtected and nothing near it asks mayRevise, which is a fourth `
      + `opinion about one permission: ${c.line.slice(0, 80)}`).join('\n'))

  // A SCAN THAT FOUND NOTHING PASSES EVERYTHING, and this one would: if the
  // files move again, every loop above runs zero times and every assertion
  // holds. The floor is what stops that reading as agreement.
  assert.ok(asking.length > 0,
    'no place outside ../branches asks whether a branch is protected, which cannot be true while a push path exists — the files this reads have moved')

  log(`${asking.length} place(s) ask whether a branch is protected, and each defers to mayRevise`)
})
