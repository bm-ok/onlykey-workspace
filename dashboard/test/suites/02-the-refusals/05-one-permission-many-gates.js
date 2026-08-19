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
// exception was added -- a branch that is out as a pull request and not merged
// may be pushed to, because it is the one branch in the world that exists to be
// revised -- and it was taught to them ONE AT A TIME. The route granted the push
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
// So the rule is written once, in `landings.mayRevise`, and the last check here
// is the one that matters: every gate asks IT. A fourth gate that decides for
// itself is the same fault again, and this is what notices.

const { it, requires } = require('../../../tasks/harness')
const landings = require('../../../repos/landings')
const branches = require('../../../repos/branches')
const fs = require('node:fs')
const path = require('node:path')

requires('what this host has')

const root = path.join(__dirname, '..', '..', '..')
const read = f => fs.readFileSync(path.join(root, f), 'utf8')

// Records handed in rather than read off this host, so the merged case and the
// open case can both be asked about without either existing here. `head` is
// spelled the way GitHub spells it and the way the record keeps it.
const cutWith = head => ({ 'a line -> default': { source: 'a line', target: 'default', pulls: [{ repo: 'r', number: 1, head }] } })
const merged = head => ({ 'a line -> default': { source: 'a line', target: 'default', pulls: [{ repo: 'r', number: 1, head, merged: true }] } })

it('a branch that is out as a pull request and not merged is under revision', async ({ assert, log }) => {
  assert.equal(landings.underRevision('fix/thing', cutWith('somebody:fix/thing')), true,
    'the branch of an open cut was not recognised as one being revised')

  // THE OWNER IS PART OF THE SPELLING AND NOT PART OF THE NAME. The record keeps
  // a head as "owner:branch" because that is what GitHub is told; reading the
  // whole string as a branch name matches nothing.
  assert.equal(landings.underRevision('somebody:fix/thing', cutWith('somebody:fix/thing')), false,
    'the owner prefix was taken as part of the branch name')
  log('a cut naming somebody:fix/thing puts fix/thing under revision, and not somebody:fix/thing')
})

it('and one that has merged is not', async ({ assert }) => {
  // Once it lands the branch is history again and the ordinary rule applies.
  // This is why the record had to learn `merged` at all: frozen at "open", a
  // branch would have qualified for ever.
  assert.equal(landings.underRevision('fix/thing', merged('somebody:fix/thing')), false,
    'a branch whose pull request had merged was still treated as under revision')
})

it('and a branch no cut names is not', async ({ assert }) => {
  assert.equal(landings.underRevision('fix/other', cutWith('somebody:fix/thing')), false,
    'a branch nothing was cut from read as being out as a pull request')
  assert.equal(landings.underRevision('', cutWith('somebody:fix/thing')), false,
    'an empty branch name matched something')
})

it('and a default branch is refused whatever any cut says about it', async ({ assert, log }) => {
  // THE ONE THAT MUST NOT BEND. `asDefault` is checked before anything else, so
  // no pull request anywhere makes a repository's default branch pushable by a
  // machine. Asked with a fabricated record that claims master is out as an
  // unmerged cut -- the strongest thing the exception could ever be handed --
  // and it still says no.
  const def = branches.protectedBranches().find(x => x.asDefault.length)
  assert.ok(def, 'this host has no repository with a default branch, so this check proves nothing')

  assert.equal(landings.mayRevise(def.branch, cutWith(`somebody:${def.branch}`)), false,
    `"${def.branch}" is the default branch of ${def.asDefault.join(', ')} and a cut record talked the rule into allowing a push to it`)
  log(`${def.branch} is the default branch of ${def.asDefault.join(', ')} and stays shut`)
})

it('and every gate in the push path asks the same question', async ({ assert, log }) => {
  // THE STRUCTURAL CHECK, AND THE REASON THIS FILE EXISTS. The three above are
  // about the rule; this is about there being ONE of it.
  //
  // Source is read rather than behaviour exercised, because the fault being
  // guarded against is a gate that decides for itself -- which by definition
  // does not call the thing a behavioural test would stub. `test/claims.js`
  // reads the source for the same kind of reason.
  const gates = [
    ['server.js', 'the http route that accepts the push'],
    ['server.js', 'the fact handed to the pre-receive hook'],
    ['actions/machines.js', 'the sign written into the guest checkout']
  ]
  for (const [file, what] of new Map(gates.map(g => [g[0], g[1]]))) {
    assert.ok(/mayRevise/.test(read(file)), `${file} decides a push permission without asking mayRevise — ${what}`)
  }

  // AND NOBODY NEW DECIDES IT ALONE. Every caller of `isProtected` outside the
  // module that defines it is a place this could be got wrong again; the two
  // that are in the push path both ask `mayRevise` on the same line. A third
  // appearing is not necessarily wrong -- it may be a different act, like
  // refusing to DELETE a protected branch -- but it is worth a person looking,
  // which is what a failure here asks for.
  const callers = []
  for (const f of ['server.js', 'actions/machines.js', 'actions/branches.js', 'tasks/queue.js', 'repos/workspace.js']) {
    for (const line of read(f).split('\n')) {
      if (/branches\.isProtected\s*\(/.test(line)) callers.push({ f, line: line.trim() })
    }
  }
  for (const c of callers) {
    assert.ok(/mayRevise/.test(c.line),
      `${c.f} asks isProtected without mayRevise on the same line, which is a fourth opinion about one permission: ${c.line.slice(0, 90)}`)
  }
  log(`${callers.length} place(s) outside repos/branches.js decide this, and each asks mayRevise`)
})
