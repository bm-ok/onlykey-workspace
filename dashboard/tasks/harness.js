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

const suites = []
let currentSuite = null

function describe (name, fn) {
  const suite = { name, tests: [] }
  suites.push(suite)
  currentSuite = suite
  try {
    fn()
  } finally {
    currentSuite = null
  }
}

function it (name, fn) {
  if (!currentSuite) throw new Error('it() must be called inside describe()')
  currentSuite.tests.push({ name, fn })
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

const assert = { ok, equal, notEqual, refuses }

async function run (context = {}) {
  const results = { suites: [], passed: 0, failed: 0 }
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
    const suiteRes = { name: suite.name, tests: [] }
    let announced = false

    for (const t of suite.tests) {
      if (typeof testFilter === 'function' && !testFilter(t.name, suite.name)) continue

      // Moved inside the loop, after the filter. The original announces every
      // suite before filtering, which for a run of one drill prints the name of
      // every suite that is about to be skipped -- and here that output goes to
      // the operator's live log rather than a terminal nobody is reading.
      if (!announced) { log(`suite: ${suite.name}`); announced = true }

      const testRes = { name: t.name, ok: false, error: null }
      const started = Date.now()

      try { if (onTestStart) onTestStart({ suiteName: suite.name, testName: t.name }) } catch { /* a reporter must not fail a test */ }
      try { if (context.onTestUpdate) context.onTestUpdate({ suiteName: suite.name, testName: t.name, status: 'running' }) } catch { /* as above */ }

      try {
        const testPromise = (async () => {
          await t.fn({ ...context, assert })
        })()

        if (timeoutMs > 0) {
          const timeoutPromise = new Promise((_, rej) => {
            const id = setTimeout(() => {
              rej(new Error(`Test timeout after ${timeoutMs}ms`))
            }, timeoutMs)
            testPromise.then(() => clearTimeout(id), () => clearTimeout(id))
          })
          await Promise.race([testPromise, timeoutPromise])
        } else {
          await testPromise
        }

        try { if (context.onTestUpdate) context.onTestUpdate({ suiteName: suite.name, testName: t.name, status: 'passed' }) } catch { /* as above */ }
        testRes.ok = true
        testRes.ms = Date.now() - started
        results.passed++
        log(`  PASS ${t.name} (${Math.round(testRes.ms / 1000)}s)`)
      } catch (e) {
        testRes.ok = false
        testRes.ms = Date.now() - started
        testRes.error = e && (e.stack || e.message || String(e))
        try { if (context.onTestUpdate) context.onTestUpdate({ suiteName: suite.name, testName: t.name, status: 'failed', error: testRes.error }) } catch { /* as above */ }
        results.failed++
        log(`  FAIL ${t.name} -> ${e && (e.message || e)}`)
      }

      try { if (onTestEnd) onTestEnd({ suiteName: suite.name, testName: t.name, result: testRes }) } catch { /* as above */ }

      suiteRes.tests.push(testRes)
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
    tests: s.tests.map(t => ({
      name: t.name,
      fingerprint: fingerprint(t.fn),
      source: String(t.fn)
    }))
  }))
}

module.exports = { describe, it, run, assert, getRegisteredSuites, fingerprint }
