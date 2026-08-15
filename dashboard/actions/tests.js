'use strict'

// Running this app against itself.
//
// The drills in TEST-PLAN.md are prose: a person reads them and types the
// commands. Prose cannot report a status, cannot be listed in a window, and rots
// against the code it describes without anybody noticing. Declared with
// describe/it they become things this app can enumerate, run, and report on one
// test at a time — and half of them pass by being REFUSED, which is the half
// worth having a machine check, because a capability that stops working is
// noticed within the hour and a refusal that stops refusing is noticed when it
// costs something.
//
// EVERY TEST DRIVES THE ACTIONS TABLE, the same surface a person and the command
// line use. That is the whole reason the harness injects a context rather than
// letting a test import what it likes: a test reaching past the table into the
// modules underneath would prove something about code nobody calls.

const actions = require('./table')
const s = require('./shared')
const { log, harness, suites, settings, workspaces } = s

// WHETHER THE DRILLS MAY RUN AT ALL, asked in one place.
//
// They drive this app for real: one writes a task and removes it again, one
// takes a credential off a machine and puts it back. Against three scaffolding
// repositories that is what they are for; against somebody's actual work it is a
// stranger typing into their repository, and nothing here can tell the two
// apart. So it is off until somebody says which folder they do not mind.
//
// See core/settings.js — enabled is enabled FOR a folder, so switching workspace
// switches it off without anything having to notice.
const mayRun = () => settings.testsAllowed(workspaces.dir() || null)

// WHAT WAS FOUND LAST TIME, so the window can show a result without running
// anything. In memory only: a test result is a statement about this process and
// this workspace at one moment, and one kept across a restart would be a claim
// about code that has since changed.
let lastRun = { at: null, results: null, running: false }

// Registration is a side effect of requiring a suite file, so this is the one
// place that loads them and it does so on demand. Loading at startup would mean
// every headless run and every test of this file pays for it.
const ready = () => { suites.load(); return harness.getRegisteredSuites() }

module.exports = {
  // LISTING MUST NOT RUN ANYTHING. Opening a tab is not consent to drive the
  // machines, and some of these drills borrow one — so this reads the register
  // and never calls a test function.
  //
  // The SOURCE travels with each test, because reading what a check actually
  // does is the only way to know what a green tick means. It is the same reason
  // a job shows its script before it is approved.
  suites: {
    about: 'Every test suite registered, what each one asserts, and how it went last time',
    run: () => {
      const registered = ready()
      const was = lastRun.results
      const found = (suite, test) => {
        if (!was) return null
        const s2 = (was.suites || []).find(x => x.name === suite)
        return (s2 && s2.tests.find(t => t.name === test)) || null
      }
      return {
        suites: registered.map(su => ({
          ...su,
          tests: su.tests.map(t => {
            const r = found(su.name, t.name)
            return {
              ...t,
              // Three outcomes, not two. A precondition that was not met is not
              // a failure — see `needs` in the harness — and reporting them the
              // same way is the fastest route to a red number nobody reads.
              state: !r ? 'not run' : r.ok === true ? 'passed' : r.ok === null ? 'unrunnable' : 'failed',
              ms: r ? r.ms : null,
              why: r ? (r.unrunnable || r.error || null) : null
            }
          })
        })),
        // Said while LISTING, so the tab can explain why its buttons are off
        // without anybody pressing one to find out.
        ...mayRun(),
        ran: lastRun.at,
        running: lastRun.running,
        counts: was ? { passed: was.passed, failed: was.failed, unrunnable: was.unrunnable } : null,
        note: was
          ? `${was.passed} passed, ${was.failed} failed, ${was.unrunnable} could not be tried — as of ${lastRun.at}.`
          : 'Nothing has been run in this window yet. Listing a suite runs none of it.'
      }
    }
  },

  suiteRun: {
    about: 'Run every test, one suite, or one test. Reports per test as it goes',
    takes: ['suite', 'test'],
    run: async ({ suite, test }) => {
      // REFUSED HERE, at the only door that runs a test. The window disables the
      // buttons too, and that is a courtesy — this is the boundary, and it is
      // the one a drill reached from the command line meets as well.
      const may = mayRun()
      if (!may.allowed) throw new Error(may.why)

      if (lastRun.running) throw new Error('A run is already going. Wait for it, or it will report two answers about the same moment.')
      ready()

      const want = String(suite || '').trim()
      const one = String(test || '').trim()
      lastRun.running = true
      const to = log.on('test')
      to.info(want || one ? `running ${one || want}` : 'running every suite')

      try {
        const results = await harness.run({
          // THE TABLE ITSELF, which is what makes these drills rather than unit
          // tests: a test asks this app for something exactly the way anything
          // else does, and meets the same refusals.
          actions,
          // AND THE SAME HANDLE A JOB IS GIVEN, by the same name. The drills
          // that used to live in tasks/planned.js were written against `okc`,
          // and they are worth porting back rather than rewriting — the value
          // in them is the reasoning, and rewriting is how that gets dropped.
          okc: (name, args = {}) => {
            const found = actions[name]
            if (!found) throw new Error(`No action called "${name}"`)
            return found.run(args)
          },
          log: line => to.info(String(line).trim()),
          testFilter: (testName, suiteName) => {
            if (want && suiteName !== want) return false
            if (one && testName !== one) return false
            return true
          },
          // A test that hangs holds the whole run, and half of these touch
          // machines. Long enough for a real refusal to be reached and short
          // enough that a wedged one is a failure rather than an afternoon.
          timeoutMs: 60000,
          onTestUpdate: ({ suiteName, testName, status, error }) => {
            if (status === 'running') return
            const said = `${suiteName} — ${testName}`
            if (status === 'passed') to.good(said)
            else if (status === 'unrunnable') to.warn(`${said}: ${error}`)
            else to.bad(`${said}: ${String(error || '').split('\n')[0]}`)
          }
        })

        lastRun = { at: new Date().toISOString(), results, running: false }
        const note = `${results.passed} passed, ${results.failed} failed, ${results.unrunnable} could not be tried.`
        if (results.failed) to.bad(note)
        else to.good(note)
        return { ...results, note }
      } finally {
        lastRun.running = false
      }
    }
  }
}
