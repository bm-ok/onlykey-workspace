'use strict'

// WHAT THE TESTS REMEMBER, and it outlives the window.
//
// This used to be a variable: `lastRun`, in actions/tests.js, holding the one
// run this process had done. A restart wiped it, and the whole board went back
// to reporting "not run" — which is indistinguishable from a suite nobody has
// ever run, and this app is restarted every time a line of it changes.
//
// It cost the most where it hurt most. A drill that builds a machine from an ISO
// is half an hour of evidence, and it lived in one process's memory: restart
// before reading it and the machine was still built, while the account of HOW
// was gone.
//
// THE ARGUMENT AGAINST KEEPING IT WAS RIGHT, AND IS ANSWERED HERE. The old
// comment said a result kept across a restart would be "a claim about code that
// has since changed" — true, and the reason this stores a FINGERPRINT of each
// check beside its result. The harness already computes one, because a job's
// approval lapses the moment its script is edited; the same idea applies to a
// verdict. A remembered result whose check has been edited is not shown as a
// result. It says the check changed, which is a different and more useful thing
// than a stale green tick.
//
// AND A RESULT BELONGS TO A WORKSPACE. The drills run against the folder of
// repositories that is open; the same check against another folder is another
// question. So the workspace is recorded, and results from a different one are
// not somebody else's evidence to read.

const fs = require('node:fs')
const path = require('node:path')
const data = require('./data')

const FILE = () => path.join(data.state(), 'tests.json')

// A check is identified by all THREE of suite, test and check. A file's title is
// only unique inside its folder, so a key made of two of them would quietly
// merge two different checks that happen to share a name.
const keyOf = (group, test, check) => [group, test, check].join(' / ')
const wholeOf = (group, test) => (test ? `${group} / ${test}` : group)

const EMPTY = { workspace: null, checks: {}, wholes: {}, states: {}, run: null }

let memo = null

function read () {
  if (memo) return memo
  try {
    const raw = JSON.parse(fs.readFileSync(FILE(), 'utf8'))
    memo = {
      workspace: raw.workspace || null,
      checks: raw.checks && typeof raw.checks === 'object' ? raw.checks : {},
      wholes: raw.wholes && typeof raw.wholes === 'object' ? raw.wholes : {},
      states: raw.states && typeof raw.states === 'object' ? raw.states : {},
      run: raw.run || null
    }
  } catch {
    memo = { ...EMPTY, checks: {}, wholes: {}, states: {} }
  }
  return memo
}

function write () {
  const at = FILE()
  try { fs.mkdirSync(path.dirname(at), { recursive: true }) } catch { /* it exists */ }
  // Written whole each time. This is kilobytes and is rewritten a few times a
  // minute at most, and a partial write of a results file is a file that reads
  // as a run that never happened.
  fs.writeFileSync(at, JSON.stringify(read(), null, 2), 'utf8')
}

// THE RUN THAT WAS INTERRUPTED, and how it is told apart from one still going.
//
// A run in flight is written down as running. If this process finds that on
// startup, the run it describes belonged to a process that is gone — the app was
// restarted or killed mid-drill — and saying so is the honest answer. A machine
// may well still be doing what that drill asked it to, which is exactly the
// state somebody needs to be told about rather than left to infer from a board
// that says nothing.
function tookOver () {
  const held = read()
  if (held.run && held.run.running) {
    held.run = { ...held.run, running: false, interrupted: true }
    for (const key of Object.keys(held.checks)) {
      if (held.checks[key].state === 'running') {
        held.checks[key] = { ...held.checks[key], state: 'interrupted', why: 'the dashboard was restarted while this was running' }
      }
    }
    write()
    return true
  }
  return false
}

// Whose evidence this is. Switching workspace does not delete anything — the
// results are still true about the folder they were made in — but they are not
// shown as though they were about this one.
function forWorkspace (dir) {
  const held = read()
  if (held.workspace && dir && held.workspace !== dir) return false
  return true
}

function claim (dir) {
  const held = read()
  if (!dir) return
  const was = held.workspace
  if (was === dir) return
  held.workspace = dir
  // A DIFFERENT FOLDER IS A DIFFERENT QUESTION, so nothing carries over — the
  // same check against another set of repositories is not the same check having
  // been run. Only when there WAS one: the first run of all simply claims an
  // empty board rather than clearing it.
  if (was) { held.checks = {}; held.wholes = {}; held.run = null }
  write()
}

// ---- what one check did ---------------------------------------------------

function remember (group, test, check, result) {
  const held = read()
  held.checks[keyOf(group, test, check)] = {
    state: result.state,
    at: result.at || new Date().toISOString(),
    ms: result.ms == null ? null : result.ms,
    why: result.why || null,
    log: Array.isArray(result.log) ? result.log : [],
    // WHAT THE CHECK WAS when it produced this, so a result cannot outlive the
    // code it is about. See the header.
    fingerprint: result.fingerprint || null
  }
  write()
}

function recall (group, test, check, fingerprint) {
  const held = read()
  const was = held.checks[keyOf(group, test, check)]
  if (!was) return null
  if (fingerprint && was.fingerprint && was.fingerprint !== fingerprint) {
    return { ...was, state: 'changed', why: 'this check has been edited since it last ran, so what it did then says nothing about what it does now', stale: true }
  }
  return was
}

// ---- what ran AS A WHOLE, and what has been dirtied since -----------------
//
// A suite that passes is a claim about the suite, and it can only be made by
// running the suite. Run one test inside it and that test's result is current
// while the SUITE's is not — the rest of it has not been tried since. Which is
// exactly when somebody is most likely to believe it: they just watched the part
// they were working on go green.
//
// So a whole is recorded when everything under it ran, and dirtied when anything
// under it is run on its own.

function ranWhole (what) {
  const held = read()
  held.wholes[what] = { at: new Date().toISOString(), dirty: false }
  write()
}

function dirty (what) {
  const held = read()
  const was = held.wholes[what]
  // Only a whole that HAS run can be dirtied. Marking one that has never run
  // would turn "never tried" into "tried and then disturbed", which is a
  // stronger claim than anything that happened.
  if (!was) return
  held.wholes[what] = { ...was, dirty: true }
  write()
}

const wholeState = what => read().wholes[what] || null

// ---- WHAT A DRILL ITSELF REMEMBERS, for the few that need it --------------
//
// Separate from results, and OPT-IN. Most drills want none of this: a series
// hands things between its own checks through `state`, and when the run ends
// that state is finished with — keeping it would only make the next run start
// from somebody else's leftovers.
//
// The ones that need it are the ones that RESTART SOMETHING. A drill proving the
// queue picks up in-flight work after the dashboard is restarted cannot span
// that restart inside one run: the harness runs inside the dashboard, so the run
// dies with it. The only way to write that test is for the drill to leave itself
// a note, be run again, and find out where it had got to. Same for a runner that
// is restarted underneath a task.
//
// A file asks for this with keep() — see tasks/harness.js. Nothing else pays for
// it, and a file that has not asked gets a fresh {} exactly as before.
function saveState (group, test, value) {
  const held = read()
  held.states[wholeOf(group, test)] = {
    at: new Date().toISOString(),
    // Only what survives JSON. A drill that puts a function or a machine handle
    // in here would find it gone after the restart it is testing, and the
    // failure would look like the app's rather than its own.
    value: JSON.parse(JSON.stringify(value == null ? {} : value))
  }
  write()
}

function loadState (group, test) {
  const held = read()
  const was = held.states[wholeOf(group, test)]
  return was ? was.value : null
}

function forgetState (group, test) {
  const held = read()
  delete held.states[wholeOf(group, test)]
  write()
}

// ---- the run itself -------------------------------------------------------

function began (asked) {
  const held = read()
  held.run = { at: new Date().toISOString(), asked: asked || null, running: true, interrupted: false }
  write()
}

function ended (counts) {
  const held = read()
  held.run = { ...(held.run || {}), running: false, finished: new Date().toISOString(), counts: counts || null }
  write()
}

const lastRun = () => read().run

// ---- forgetting -----------------------------------------------------------
//
// A result that is wrong is worse than none, and the ways to get one are
// ordinary: a check was changed, a machine was in a state it will never be in
// again, somebody wants a clean board before a demonstration. So this can be
// thrown away by suite, by test, by check, or entirely.

function forget ({ group, test, check } = {}) {
  const held = read()
  const before = Object.keys(held.checks).length + Object.keys(held.wholes).length + Object.keys(held.states).length

  const wanted = key => {
    const [g, t, c] = key.split(' / ')
    if (group && g !== group) return false
    if (test && t !== test) return false
    if (check && c !== check) return false
    return true
  }

  if (!group && !test && !check) {
    held.checks = {}
    held.wholes = {}
    held.states = {}
    held.run = null
  } else {
    for (const key of Object.keys(held.checks)) if (wanted(key)) delete held.checks[key]
    for (const key of Object.keys(held.wholes)) if (wanted(key)) delete held.wholes[key]
    // A drill's own note goes with it. Clearing a suite and leaving the thing it
    // was in the middle of would be the worst of both: a clean board and a drill
    // that still thinks it is half way through something.
    for (const key of Object.keys(held.states)) if (wanted(key)) delete held.states[key]

    // AND THE SUITE ABOVE IT IS NO LONGER WHOLE. Forgetting one test inside a
    // suite that had been run entire leaves a suite-level pass covering a result
    // that is now gone — which is the same lie as running one test and leaving
    // the suite green, and is dealt with the same way.
    if (group && held.wholes[group]) held.wholes[group] = { ...held.wholes[group], dirty: true }
  }
  write()
  return before - (Object.keys(held.checks).length + Object.keys(held.wholes).length + Object.keys(held.states).length)
}

module.exports = {
  FILE, keyOf, wholeOf, tookOver, forWorkspace, claim,
  remember, recall, ranWhole, dirty, wholeState,
  saveState, loadState, forgetState,
  began, ended, lastRun, forget
}
