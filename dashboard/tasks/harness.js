'use strict'

// A minimal mocha-shaped harness: describe, it, run.
//
// Ported from test-moniker by the operator of this project:
//   https://github.com/bm-ok/test-moniker  --  harness.js
//
// Kept deliberately close to the original. The shape is the value -- registration
// separated from execution, a context injected into every test rather than
// imported by it, and progress reported through callbacks instead of printed --
// and drifting from it would make the two versions diverge for no reason. What
// changed is noted where it changed, and nothing else.
//
// WHY THIS IS HERE AT ALL. The drills in TEST-PLAN.md were prose: a person read
// them and typed the commands. Prose cannot report a status, cannot be listed in
// a window, and quietly rots against the code it describes. Declared with
// describe/it they become things this app can enumerate, offer as a pre-defined
// task, run, and report on one test at a time.
//
// The injected context is what makes that work here. A test is handed the
// actions table, so a drill drives this tool exactly the way a person does --
// through the same surface, with the same refusals -- rather than reaching past
// it into the modules underneath and proving something about code nobody uses.

// THREE LEVELS, NOT TWO, and that is the one structural addition to the ported
// shape. A directory is a SUITE, a file in it is a TEST, and the it()s inside
// that file are the CHECKS that test is made of — so a test is a series of steps
// rather than a single claim, and the order of the steps is part of what is
// being said. See test/suites/index.js for how a folder becomes this.
//
// In the names below: `group` is the suite (the folder), `suite` is the test
// (the file), `test` is one check. The ported words are kept because the ported
// code is kept; the translation happens once, in actions/tests.js.
const suites = []
let currentSuite = null
let currentGroup = null

// The folder, wrapped around the requires of everything in it. Exactly the same
// device as describe/it one level up: set, run, unset in a finally.
function group (name, fn) {
  const before = currentGroup
  currentGroup = name
  try {
    fn()
  } finally {
    currentGroup = before
  }
}

function describe (name, fn) {
  const suite = { name, group: currentGroup, tests: [], cleanups: [] }
  suites.push(suite)
  currentSuite = suite
  try {
    fn()
  } finally {
    currentSuite = null
  }
}

// A check, and how long it is allowed to take.
//
// The default is short on purpose: a check that hangs holds the whole run, and
// most of these are a call and an assertion. But a machine takes minutes to come
// up, and a worker takes longer than that — so a check that waits on one says so
// here, in the file, where somebody reading it can see what it is going to cost.
// `minutes` rather than milliseconds because that is the unit these are in.
// `gate: true` says this check is the DOOR, not a step: if it does not pass —
// failed OR could not be tried — the rest of the series is not attempted.
//
// Needed because an unmet precondition deliberately does NOT stop a series: each
// check states what IT needed, and replacing precise sentences with one borrowed
// from above loses the only useful thing they said. That is right for a file of
// related checks and wrong for a file whose first check is permission to run at
// all. "Building a machine" asks for `slow` and the checks after it build one —
// so with the gate unmet they carried on, made a machine with no installer
// image, and reported a FAILURE about a drill nobody had asked to run.
function it (name, fn, { minutes = 0, gate = false } = {}) {
  if (!currentSuite) throw new Error('it() must be called inside describe()')
  currentSuite.tests.push({ name, fn, gate, timeoutMs: minutes > 0 ? Math.round(minutes * 60000) : 0 })
}

// WHAT TO UNDO WHEN THE SERIES IS OVER, however it ends.
//
// A step that arranges something — a cut made, a credential taken — used to put
// it back in its own `finally`, because a step was the whole test. In a series
// the arranging happens in one step and the using happens in the next, so the
// undoing belongs to the file rather than to any step in it. Registered here,
// run after the last check whatever happened to the ones before it — including
// when a failure stopped the rest, which is exactly when debris gets left.
function cleanup (fn) {
  if (!currentSuite) throw new Error('cleanup() must be called inside describe()')
  currentSuite.cleanups.push(fn)
}

// STATE THAT SURVIVES A RESTART, for the few files that need it.
//
// `state` is ordinarily this run's: the checks of one file hand things along
// through it, and when the file is done it is finished with. That is right for
// almost everything here, and keeping it would only mean the next run starting
// from the last run's leftovers.
//
// It is wrong for a drill that restarts something. A test proving the queue
// picks work up again after the dashboard is restarted cannot span that restart
// inside one run — this harness runs INSIDE the dashboard, so the run dies with
// it. The only way such a test can exist is to leave itself a note, be run
// again, and find out from the note where it had got to. The same is true of a
// runner restarted underneath a task.
//
// A file says so by calling keep() at the top level. Then its `state` is loaded
// before the first check and written after every one — including after cleanup,
// so what the cleanup left is what the next run finds.
//
// Nothing else pays for it: a file that has not asked gets a fresh {} exactly as
// before, which is what almost every file here wants.
function keep () {
  if (!currentSuite) throw new Error('keep() must be called inside describe()')
  currentSuite.keeps = true
}

// The assertions, deliberately three. A rich assertion library is a language to
// learn before a drill can be read; these three say the whole of what a drill
// needs and the message carries the rest.
function ok (cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed')
}

function equal (a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${a} === ${b}`)
}

function notEqual (a, b, msg) {
  if (a === b) throw new Error(msg || `Expected ${a} !== ${b}`)
}

// ADDED HERE, and the only real addition to the original.
//
// Half of what this project needs to prove passes by being REFUSED: a machine
// holding a credential cannot be snapshotted, a guest cannot push to the default
// branch, a signed-out worker cannot be given work. Written with ok() that reads
// as a try/catch in every drill, and the thing being asserted -- that it threw,
// and threw about the right subject -- gets buried in the plumbing.
//
// A refusal that happens for the wrong reason is not a pass, so the message is
// matched rather than merely the throwing.
async function refuses (fn, expected, msg) {
  let threw = null
  try {
    await fn()
  } catch (e) {
    threw = e
  }
  if (!threw) throw new Error(msg || 'Expected this to be refused, and it was allowed')
  if (expected && !new RegExp(expected, 'i').test(threw.message || '')) {
    throw new Error(`${msg || 'Refused, but for the wrong reason'} — expected something matching /${expected}/, got: ${threw.message}`)
  }
  return threw
}

// COULD NOT RUN IS NOT THE SAME AS FAILED, and reporting them the same way is
// how a suite stops being read.
//
// Half the drills here need a machine that is on, holding a credential, or
// claiming a branch — and the whole design of this tool puts machines at REST:
// off, clean, holding nothing. So running the suite on a quiet system reported
// "4 failed" when nothing whatever was wrong, which is the fastest way to teach
// somebody to ignore a red number.
//
// A precondition is stated with this rather than with ok(). The drill still
// stops — it cannot prove anything without what it asked for — but it stops
// saying "there was nothing to try this on", which is a fact about the moment
// rather than about the code.
const UNMET = 'okc-precondition-unmet: '
function needs (cond, why) {
  if (!cond) throw new Error(UNMET + why)
}

const assert = { ok, equal, notEqual, refuses, needs }

async function run (context = {}) {
  const results = { suites: [], passed: 0, failed: 0, unrunnable: 0 }
  const {
    timeoutMs = 0,
    testFilter,
    onTestStart,
    onTestEnd
  } = context

  const log = (context.log && typeof context.log === 'function')
    ? context.log
    : ((...args) => { try { console.log('[harness]', ...args) } catch { /* nowhere to say it */ } })

  for (const suite of suites) {
    const suiteRes = { name: suite.name, group: suite.group, tests: [] }
    let announced = false
    // What the steps of this one file hand to each other. A series that cannot
    // pass anything along is a series in name only: the cut made in the first
    // step is the cut the second step writes a task on.
    //
    // Loaded from before only if the file asked with keep(), and only if
    // whatever is running this offered somewhere to keep it. The harness stays
    // ignorant of where that is: it is handed two functions, exactly as it is
    // handed `log` and `actions`, so this file remains the ported shape and the
    // storage belongs to the app.
    const keeping = !!(suite.keeps && context.stateLoad && context.stateSave)
    const state = keeping ? (context.stateLoad(suite.group, suite.name) || {}) : {}
    const putItDown = () => {
      if (!keeping) return
      try { context.stateSave(suite.group, suite.name, state) } catch { /* never fails a test */ }
    }
    // AND WHAT A FAILED STEP DOES TO THE ONES AFTER IT. It stops them, because
    // a step that failed leaves the world in a state nobody described, and a
    // check run against that state is not evidence of anything.
    //
    // A failure only. An unmet precondition does NOT stop the series: "no
    // machine is dialled in" is a fact about the moment, every later step says
    // for itself what it needed, and replacing those precise sentences with one
    // borrowed from the step above loses the only useful thing they said.
    let stoppedBy = null

    for (const t of suite.tests) {
      // The folder is passed too, so a run can be asked for by suite, by test,
      // or by one check — which is what the three columns in the window offer.
      if (typeof testFilter === 'function' && !testFilter(t.name, suite.name, suite.group)) continue

      // Moved inside the loop, after the filter. The original announces every
      // suite before filtering, which for a run of one drill prints the name of
      // every suite that is about to be skipped -- and here that output goes to
      // the operator's live log rather than a terminal nobody is reading.
      if (!announced) { log(`suite: ${suite.name}`); announced = true }

      const testRes = { name: t.name, ok: false, error: null }
      const started = Date.now()

      try { if (onTestStart) onTestStart({ groupName: suite.group, suiteName: suite.name, testName: t.name }) } catch { /* a reporter must not fail a test */ }

      // A step after one that failed. Not tried, and said as what it is — the
      // step above is the thing to read, and this one has nothing to add.
      if (stoppedBy) {
        testRes.ok = null
        testRes.unrunnable = `an earlier step did not pass — "${stoppedBy}"`
        testRes.ms = 0
        results.unrunnable++
        log(`  SKIP ${t.name} -> ${testRes.unrunnable}`)
        try { if (context.onTestUpdate) context.onTestUpdate({ groupName: suite.group, suiteName: suite.name, testName: t.name, status: 'unrunnable', error: testRes.unrunnable }) } catch {}
        try { if (onTestEnd) onTestEnd({ groupName: suite.group, suiteName: suite.name, testName: t.name, result: testRes }) } catch {}
        suiteRes.tests.push(testRes)
        continue
      }
      try { if (context.onTestUpdate) context.onTestUpdate({ groupName: suite.group, suiteName: suite.name, testName: t.name, status: 'running' }) } catch { /* as above */ }

      try {
        const testPromise = (async () => {
          await t.fn({ ...context, assert, state })
        })()

        // What this check asked for, or the run's own limit. A check that says
        // it needs ten minutes gets ten minutes; everything else stays on the
        // short clock, so one slow drill does not make the whole suite patient.
        const limit = t.timeoutMs || timeoutMs
        if (limit > 0) {
          const timeoutPromise = new Promise((_, rej) => {
            const id = setTimeout(() => {
              rej(new Error(`This check gave up after ${Math.round(limit / 1000)}s. If it is waiting on a machine, say so with it(..., { minutes })`))
            }, limit)
            testPromise.then(() => clearTimeout(id), () => clearTimeout(id))
          })
          await Promise.race([testPromise, timeoutPromise])
        } else {
          await testPromise
        }

        try { if (context.onTestUpdate) context.onTestUpdate({ groupName: suite.group, suiteName: suite.name, testName: t.name, status: 'passed' }) } catch { /* as above */ }
        testRes.ok = true
        testRes.ms = Date.now() - started
        results.passed++
        log(`  PASS ${t.name} (${Math.round(testRes.ms / 1000)}s)`)
      } catch (e) {
        const why = (e && e.message) || String(e)
        // A precondition that was not met stops the test and is NOT a failure.
        // Counted apart, reported apart, and said in the words the drill used.
        if (why.startsWith(UNMET)) {
          testRes.ok = null
          testRes.unrunnable = why.slice(UNMET.length)
          testRes.ms = Date.now() - started
          results.unrunnable++
          // A DOOR THAT DID NOT OPEN CLOSES THE REST. Only for a check that
          // said it was one: everywhere else an unmet precondition is a fact
          // about the moment and the checks after it speak for themselves.
          if (t.gate) stoppedBy = `${t.name} — ${testRes.unrunnable}`
          try { if (context.onTestUpdate) context.onTestUpdate({ groupName: suite.group, suiteName: suite.name, testName: t.name, status: 'unrunnable', error: testRes.unrunnable }) } catch {}
          log(`  SKIP ${t.name} -> ${testRes.unrunnable}`)
          try { if (onTestEnd) onTestEnd({ groupName: suite.group, suiteName: suite.name, testName: t.name, result: testRes }) } catch { /* a reporter must not fail a test */ }
          suiteRes.tests.push(testRes)
          continue
        }
        testRes.ok = false
        testRes.ms = Date.now() - started
        testRes.error = e && (e.stack || e.message || String(e))
        try { if (context.onTestUpdate) context.onTestUpdate({ groupName: suite.group, suiteName: suite.name, testName: t.name, status: 'failed', error: testRes.error }) } catch { /* as above */ }
        results.failed++
        stoppedBy = t.name
        log(`  FAIL ${t.name} -> ${e && (e.message || e)}`)
      }

      // AFTER EVERY CHECK, not at the end of the file. A drill that keeps its
      // state is a drill expecting something to be restarted underneath it, and
      // a note written only when the series finishes is exactly the note that is
      // missing when it does not.
      putItDown()

      try { if (onTestEnd) onTestEnd({ groupName: suite.group, suiteName: suite.name, testName: t.name, result: testRes }) } catch { /* as above */ }

      suiteRes.tests.push(testRes)
    }

    // Undoing what the series arranged, only if the series ran at all — a suite
    // that was filtered out arranged nothing. A cleanup that throws is logged
    // and does not fail anything: it is the tidy-up after the answer is already
    // known, and turning it into a red line would report the wrong thing.
    if (suiteRes.tests.length) {
      for (const fn of suite.cleanups) {
        try {
          await fn({ ...context, assert, state })
        } catch (e) {
          log(`  cleanup after ${suite.name} did not finish -> ${e && (e.message || e)}`)
        }
      }
      // What the cleanup LEFT is what the next run should find. A drill that
      // finished tidying up says so by emptying its own state here, and one that
      // deliberately left something standing keeps the note about it.
      putItDown()
    }

    // Only suites that actually ran something. A run of one drill should report
    // one suite, not every suite with an empty list beside it.
    if (suiteRes.tests.length) results.suites.push(suiteRes)
  }

  return results
}

// What a definition IS, as a number.
//
// Definitions here are written by a model at the operator's request and then
// approved by the operator. An approval that survived the definition being
// edited afterwards would be worth nothing -- write something modest, get it
// approved, change what it does. So an approval is recorded against this, and
// lapses the moment the source moves.
//
// The source of the function, because that is the whole of what will run. Not
// the name, which is what a person recognises and exactly what an edit would
// keep.
function fingerprint (fn) {
  const src = String(fn)
  let h = 5381
  for (let i = 0; i < src.length; i++) h = ((h * 33) ^ src.charCodeAt(i)) >>> 0
  return `${h.toString(16)}-${src.length}`
}

// What is registered, without running any of it. This is what the window lists
// in the "Pre-defined" half of the write-a-task dialog, and it must not have
// side effects: opening a dialog is not consent to run a drill.
//
// The source travels with it, because approving something you have not read is
// not approval. The dialog shows it.
function getRegisteredSuites () {
  return suites.map(s => ({
    name: s.name,
    group: s.group,
    tests: s.tests.map(t => ({
      name: t.name,
      fingerprint: fingerprint(t.fn),
      source: String(t.fn)
    }))
  }))
}

module.exports = { group, describe, it, cleanup, run, assert, getRegisteredSuites, fingerprint }
