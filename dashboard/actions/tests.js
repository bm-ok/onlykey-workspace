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
const { log, harness, suites, settings, workspaces, repos } = s

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
              why: r ? (r.unrunnable || r.error || null) : null,
              log: (r && r.log) || []
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

  // WHAT THE DRILLS LEFT BEHIND, and a way to take it away.
  //
  // This is the thing tasks/planned.js did not have, and it is why that file
  // became "a loaded thing in a drawer". A drill that writes cleans up in a
  // `finally` — and a `finally` does not run when the process is killed, the
  // dashboard is restarted mid-run, or a machine stops answering. Fifty writing
  // drills without a sweeper is a workspace filling with debris nobody can tell
  // apart from real work.
  //
  // WHICH IS WHY EVERY WRITING DRILL USES A RESERVED NAME. `drill/` on a branch,
  // `drill:` on a task title. Not a convention to be polite about: it is what
  // makes cleaning up possible without a judgement call, because anything
  // matching was made by a drill and nothing else here ever writes those names.
  //
  // IT LISTS BEFORE IT REMOVES. `--remove` is the second call, on purpose: this
  // deletes branches, and the whole point of a sweeper is to be run when
  // something has already gone wrong, which is exactly when a tool should say
  // what it is about to do first.
  drillSweep: {
    about: 'What the drills left behind — drill/ branches and drill: tasks. Pass remove to take them away',
    needs: 'workspace',
    takes: ['remove'],
    run: async ({ remove }) => {
      const doIt = remove === true || remove === 'true'
      const here = repos.list().map(r => r.name)

      const branches = (await actions.gitBranches.run({})).branches
        .filter(b => String(b.name).startsWith('drill/'))
      const tasks = (await actions.tasks.run({})).tasks
        .filter(t => /^drill:/i.test(String(t.title || '')))

      // Remote branches too, because a drill that pushed left one on the fork —
      // and a remote branch is the half somebody cannot see from here.
      const remote = []
      for (const repo of here) {
        try {
          const rows = await actions.repoBranches.run({ repo })
          for (const b of rows.branches) {
            if (String(b.branch).startsWith('drill/') && b.remote) remote.push({ repo, branch: b.branch })
          }
        } catch { /* a repository that cannot be read is reported by its own panel */ }
      }

      const found = { branches: branches.map(b => b.name), tasks: tasks.map(t => `#${t.number} ${t.title}`), remote }
      const total = branches.length + tasks.length + remote.length

      if (!doIt) {
        return {
          ...found,
          total,
          removed: false,
          note: total
            ? `${total} thing(s) left by drills. Nothing has been touched — pass remove to take them away.`
            : 'Nothing left behind. Every drill that writes removes what it wrote.'
        }
      }

      const gone = { tasks: [], branches: [], failed: [] }
      // Tasks first: a task naming a branch is the thing that makes the branch
      // look claimed, and deleting the branch under it would leave a task
      // pointing at nothing.
      for (const t of tasks) {
        try { await actions.taskRemove.run({ id: t.id }); gone.tasks.push(t.id) } catch (e) { gone.failed.push(`${t.id}: ${e.message}`) }
      }
      for (const b of branches) {
        // Forced, because a drill branch is ours by construction: nothing else
        // in this app ever writes that name, and refusing to remove one because
        // it carries a commit is refusing to clean up after a test that failed
        // halfway — which is the only time this is ever run.
        try { await actions.branchDelete.run({ branch: b.name, force: true }); gone.branches.push(b.name) } catch (e) { gone.failed.push(`${b.name}: ${e.message}`) }
      }

      log.on('test').warn(`swept ${gone.tasks.length} task(s) and ${gone.branches.length} branch(es) left by drills`)
      return {
        ...found,
        removed: true,
        gone,
        // Said rather than done. Deleting a branch on the fork is a push, and a
        // pull request open against it is somebody else's repository — neither
        // is something a tidy-up button should decide.
        note: remote.length
          ? `${gone.tasks.length} task(s) and ${gone.branches.length} branch(es) removed here. ${remote.length} branch(es) are also on origin and are NOT touched — deleting those is a push, and any pull request open from one is on somebody else's repository.`
          : `${gone.tasks.length} task(s) and ${gone.branches.length} branch(es) removed.`
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

      // WHAT EACH TEST SAID, kept per test rather than only in the live log.
      //
      // The live log is the whole run interleaved, which is right while it is
      // happening and useless afterwards for one check — half these drills log
      // what they ARRANGED ("taking runner1's credential for the duration"), and
      // that is most of what a result means. The window shows it beside the
      // source of the check it belongs to.
      //
      // Routed by whichever test is running when the line arrives. The harness
      // hands every test the same log function, so this is the only way to know
      // which one is talking.
      const said = new Map()
      const key = (a, b) => `${a} ${b}`
      let current = null
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

            // THE THREE REPOSITORIES IN THE OPEN WORKSPACE, AND NOTHING ELSE.
            //
            // The drills may push to the forks and open pull requests on their
            // parents, which means a drill naming the wrong repository writes to
            // somebody's actual work on a live account. The workspace already
            // scopes this — it holds exactly the three — so the guard is to
            // check what a drill NAMES against what is open, rather than to
            // trust that no drill will ever name anything else.
            //
            // A promise would do for today and not for the fiftieth suite
            // written six weeks from now. This is the same reason `needs:
            // workspace` is enforced in call() rather than remembered.
            if (args && args.repo) {
              const here = repos.list().map(r => r.name)
              if (!here.includes(String(args.repo))) {
                throw new Error(`"${args.repo}" is not a repository in the open workspace. The drills reach ${here.join(', ')} and nothing else — a drill that names another repository is writing to somebody's work on a live account.`)
              }
            }
            // ALWAYS A PROMISE. Half these actions are sync and half are not,
            // and a handle that returns a bare value for some of them means
            // `okc(...).catch(...)` — the ordinary way to write a cleanup that
            // must not itself fail — throws a TypeError naming the wrong thing.
            // A suite author should not have to know which half they are on.
            return Promise.resolve(found.run(args))
          },
          log: line => {
            const text = String(line).trim()
            to.info(text)
            if (current && said.has(current)) said.get(current).push(text)
          },
          onTestStart: ({ suiteName, testName }) => {
            current = key(suiteName, testName)
            said.set(current, [])
          },
          // Cleared AFTER the harness has written its own PASS/SKIP/FAIL line,
          // so that line lands with the test it is about rather than with
          // whatever runs next.
          onTestEnd: () => { current = null },
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

        // Folded onto each result, so what a test SAID travels with how it went
        // rather than being a second thing to look up by name.
        for (const su of results.suites || []) {
          for (const t of su.tests || []) t.log = said.get(key(su.name, t.name)) || []
        }
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
