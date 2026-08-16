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

// WHAT A SUITE'S CLAIMS REST ON.
//
// The suites are not independent. "A task goes out to a machine and comes back"
// is only meaningful if machines come up and go away cleanly; if that has been
// disturbed, the task result is standing on something nobody has re-established.
// The other direction is not true — machines work whether or not anything ever
// gives them a task — so this is a one-way relationship and has to be declared
// rather than guessed.
//
// Declared BY the suite that depends, naming what it depends on, because that is
// the direction somebody writing a drill knows: they can see what their own test
// needs, and they cannot see who will come to need them.
// Not `needs`, which is already the assertion a check uses to say a precondition
// was not met. Two different ideas one word apart: `needs` is about this moment,
// `standsOn` is about the suites.
const standsOn = new Map()

function requires (...names) {
  if (!currentGroup) throw new Error('requires() must be called inside a suite')
  const has = standsOn.get(currentGroup) || new Set()
  for (const n of names) has.add(String(n))
  standsOn.set(currentGroup, has)
}

const requirements = () => {
  const out = {}
  for (const [group, has] of standsOn) out[group] = [...has]
  return out
}

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
// `dirties` IS THE OTHER DIRECTION, and it is a different claim from requires().
//
// requires() says what a suite STANDS ON: disturb the machines and every suite
// resting on them is stale, because their results were established on top of
// something nobody has re-established.
//
// This says what a check DISPROVES when it fails. A task returns its machine to
// base when it is done — so the check that watches a machine be put away clean
// is, incidentally, the strongest evidence anybody has that machines go away
// clean at all. If that fails, "the machines" has not gone stale; it has been
// contradicted, by a suite that stands on it.
//
// Which is why it is per CHECK and not per suite. Most of a task drill says
// nothing about machines — a task written on the wrong branch is nobody else's
// business — and only the steps that actually exercise somebody else's ground
// get to say anything about it.
// `invalidates` IS THE SAME IDEA ON THE OTHER OUTCOME. `dirties` fires when a
// check FAILS, because the failure is evidence against another suite. This fires
// when a check PASSES, because the success undid what another suite established:
// a teardown that works has taken the machines away, so "the machines are built
// and ready" is no longer true — not disproved, just no longer the case.
function it (name, fn, { minutes = 0, gate = false, dirties = null, invalidates = null } = {}) {
  if (!currentSuite) throw new Error('it() must be called inside describe()')
  const list = v => v ? (Array.isArray(v) ? v.map(String) : [String(v)]) : null
  currentSuite.tests.push({
    name,
    fn,
    gate,
    dirties: list(dirties),
    invalidates: list(invalidates),
    timeoutMs: minutes > 0 ? Math.round(minutes * 60000) : 0
  })
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

// AND THE ONE THING NO RUN CAN FIX BY WAITING: something a PERSON has to do.
//
// A third answer, and it is not the same as either of the two above it. A
// missing GitHub key is not a failure — nothing is wrong with the code — and it
// is not "no machine happened to be free", which is a fact about the moment that
// will be different in five minutes. It is a job for somebody, and every run
// from now until they do it will say exactly this.
//
// It exists because the suites are becoming the way this app is SET UP, not only
// the way it is checked. A fresh host cannot make its own credentials: it can
// only stop at the right place and say what to do and where. Reported red it
// would make every new host look broken; reported amber alongside the ordinary
// preconditions it would be lost among things that fix themselves.
//
// So it says what is missing and what to do about it, in that order, and the
// board keeps it until it is done.
const ASKS = 'okc-needs-a-person: '
function asksYou (cond, whatToDo) {
  if (!cond) throw new Error(ASKS + whatToDo)
}

const assert = { ok, equal, notEqual, refuses, needs, asksYou }

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

    // PICKING UP WHERE IT STOPPED, which is the point of keeping state at all.
    //
    // A drill that restarts the dashboard is killed by the thing it is testing.
    // Run it again and, without this, it starts from step one — cutting a second
    // branch, building a second machine, and proving nothing about the restart
    // it exists to survive.
    //
    // So for a file that keeps state, a check that ALREADY PASSED during the run
    // that was interrupted is carried over rather than repeated, and the series
    // resumes at the first step that had not finished.
    //
    // THREE CONDITIONS, none of them optional. The file must have asked to keep
    // state; the previous run must have been INTERRUPTED rather than merely
    // finished, or every ordinary re-run would skip everything; and the check
    // must be the same check, which is what the fingerprint answers. Skipping a
    // test is the most dangerous thing a harness can do quietly, so it is
    // reported as carried rather than as passed, and `testsForget` throws the
    // whole lot away for anyone who wants it run from the top.
    const carriedFrom = keeping && context.doneBefore ? context.doneBefore(suite.group, suite.name) : null
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

      // ALREADY DONE, BEFORE THE THING THAT STOPPED IT. Reported and not run.
      // Said out loud in the log every time, because a step that did not happen
      // this run must never be mistaken for one that did.
      const before = carriedFrom ? carriedFrom(t.name, fingerprint(t.fn)) : null
      if (before && !stoppedBy) {
        testRes.ok = true
        testRes.carried = true
        testRes.ms = before.ms || 0
        testRes.at = before.at
        results.passed++
        results.carried = (results.carried || 0) + 1
        log(`  KEPT ${t.name} -> passed at ${before.at}, before the run was interrupted`)
        try { if (context.onTestUpdate) context.onTestUpdate({ groupName: suite.group, suiteName: suite.name, testName: t.name, status: 'carried' }) } catch {}
        try { if (onTestEnd) onTestEnd({ groupName: suite.group, suiteName: suite.name, testName: t.name, result: testRes }) } catch {}
        suiteRes.tests.push(testRes)
        continue
      }

      try { if (onTestStart) onTestStart({ groupName: suite.group, suiteName: suite.name, testName: t.name }) } catch { /* a reporter must not fail a test */ }

      // CALLED OFF. Asked between checks, because a check already waiting on a
      // machine is inside a promise nothing here can reach into — see suiteStop
      // in actions/tests.js, which says so rather than implying otherwise.
      //
      // Reported as not tried, and the reason says who stopped it. A step that
      // did not run must never be mistaken for one that passed, and "the run was
      // stopped" is a different thing from "an earlier step failed".
      if (!stoppedBy && typeof context.shouldStop === 'function' && context.shouldStop()) {
        stoppedBy = `the run was stopped — "${t.name}" and the steps after it were not tried`
      }

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
        // WHAT THIS SUCCESS UNDOES, which is the opposite trigger to `dirties`.
        //
        // A teardown check that PASSES has taken the machines away — so "two
        // machines are built and ready" has stopped being true, by this check
        // having worked rather than by anything going wrong. Same machinery as a
        // contradiction, fired on the other outcome.
        if (t.invalidates) testRes.invalidates = t.invalidates
        results.passed++
        log(`  PASS ${t.name} (${Math.round(testRes.ms / 1000)}s)`)
      } catch (e) {
        const why = (e && e.message) || String(e)

        // SOMETHING A PERSON HAS TO DO. Not a failure, not a fact about the
        // moment: a job for somebody, which every run will report until it is
        // done. It closes the rest of the series when the check is a gate, for
        // the same reason an unmet gate does — everything below it was going to
        // ask for the same missing thing.
        if (why.startsWith(ASKS)) {
          testRes.ok = null
          testRes.asksYou = why.slice(ASKS.length)
          testRes.ms = Date.now() - started
          results.asking = (results.asking || 0) + 1
          if (t.gate) stoppedBy = `${t.name} — ${testRes.asksYou}`
          try { if (context.onTestUpdate) context.onTestUpdate({ groupName: suite.group, suiteName: suite.name, testName: t.name, status: 'asks', error: testRes.asksYou }) } catch {}
          log(`  YOU  ${t.name} -> ${testRes.asksYou}`)
          try { if (onTestEnd) onTestEnd({ groupName: suite.group, suiteName: suite.name, testName: t.name, result: testRes }) } catch { /* a reporter must not fail a test */ }
          suiteRes.tests.push(testRes)
          continue
        }
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
        // WHAT THIS FAILURE CONTRADICTS, carried on the result so whatever is
        // keeping score can act on it. See `dirties` on it().
        if (t.dirties) testRes.dirties = t.dirties
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

module.exports = { group, describe, it, cleanup, keep, requires, requirements, run, assert, getRegisteredSuites, fingerprint }
