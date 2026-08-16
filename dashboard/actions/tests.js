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
const { log, harness, suites, settings, workspaces, repos, branches } = s

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
// anything.
//
// THIS USED TO BE IN MEMORY ONLY, and the reasoning was sound: a result kept
// across a restart would be "a claim about code that has since changed". What
// was wrong with it was the remedy — throwing every result away on every
// restart, in an app that is restarted every time a line of it changes, so the
// board spent most of its life saying "not run" about suites that had just been
// run. A half-hour drill's evidence lived in one process's memory.
//
// core/testruns.js keeps it instead, and answers the objection directly: each
// result is stored with a FINGERPRINT of the check that produced it, so one
// whose check has since been edited reports as changed rather than as a verdict.
// The result also belongs to a workspace, and results made against another
// folder are not shown as though they were about this one.
const remembered = require('../core/testruns')

// Still here, and still the truth about THIS process: what is running right now
// can only be known by the process running it. Everything durable is in the
// store; this is the live half.
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
    about: 'Every suite, the tests in it, the checks each test is made of, and how they went last time',
    run: () => {
      const registered = ready()
      const was = lastRun.results
      const where = workspaces.dir() || null
      // Results made against another folder are kept — they are still true about
      // that folder — and simply not read here.
      const mine = remembered.forWorkspace(where)

      // THE HARNESS SAYS SUITE AND TEST; THIS SAYS SUITE, TEST AND CHECK.
      //
      // A folder is a suite, a file in it is a test, and the it()s in that file
      // are the checks that test is made of — because what this app does is an
      // ORDER, and an order cannot be stated as a bag of independent assertions.
      // The harness keeps the ported two-level words and carries the folder as
      // `group`; the translation happens here, once, so nothing above this line
      // has to know that history.
      const found = (group, test, check) => {
        if (!was) return null
        const file = (was.suites || []).find(x => x.name === test && x.group === group)
        return (file && file.tests.find(t => t.name === check)) || null
      }
      const worst = list =>
        list.some(c => c.state === 'failed') ? 'failed'
          : list.some(c => c.state === 'unrunnable') ? 'unrunnable'
            : list.every(c => c.state === 'passed') ? 'passed'
              : 'not run'

      const byGroup = []
      for (const file of registered) {
        const checks = file.tests.map(t => {
          const r = found(file.group, file.name, t.name)
          // THIS PROCESS FIRST, THEN WHAT WAS REMEMBERED. A result from the run
          // that just happened is the live one; anything older comes from the
          // store, carrying the date it was made and checked against the source
          // of the check as it is now.
          const kept = (!r && mine) ? remembered.recall(file.group, file.name, t.name, t.fingerprint) : null
          return {
            ...t,
            // Three outcomes, not two. A precondition that was not met is not
            // a failure — see `needs` in the harness — and reporting them the
            // same way is the fastest route to a red number nobody reads.
            //
            // Two more arrive from the store, and both are honest answers rather
            // than verdicts: `changed` is a result whose check has been edited
            // since, and `interrupted` is a check that was running when the
            // dashboard went away.
            state: r
              ? (r.ok === true ? 'passed' : r.ok === null ? 'unrunnable' : 'failed')
              : kept ? kept.state : 'not run',
            ms: r ? r.ms : (kept ? kept.ms : null),
            why: r ? (r.unrunnable || r.error || null) : (kept ? kept.why : null),
            log: (r && r.log) || (kept && kept.log) || [],
            // WHEN, which only matters once results outlive the window. A pass
            // from four days ago and one from four minutes ago are both green.
            at: r ? lastRun.at : (kept ? kept.at : null),
            fromBefore: !r && !!kept
          }
        })
        let group = byGroup.find(g => g.name === file.group)
        if (!group) byGroup.push(group = { name: file.group, tests: [] })
        const whole = mine ? remembered.wholeState(remembered.wholeOf(file.group, file.name)) : null
        group.tests.push({
          name: file.name,
          checks,
          // The test's own state is the worst thing in it: a series with one
          // failed step is a failed test, and an average would hide the only
          // line worth reading.
          state: worst(checks),
          ms: checks.some(c => c.ms != null) ? checks.reduce((n, c) => n + (c.ms || 0), 0) : null,
          // WHEN IT LAST RAN AS A WHOLE, and whether something has been run
          // inside it since. See below: a test is a SERIES, and one check of it
          // run on its own does not re-establish the series.
          ranWhole: whole ? whole.at : null,
          dirty: !!(whole && whole.dirty)
        })
      }

      // A SUITE'S VERDICT IS ABOUT THE SUITE, and can only be made by running
      // it. Running one test inside it leaves that test current and the suite
      // not — the rest has not been tried since — and that is exactly the moment
      // somebody is most likely to believe the green: they just watched the part
      // they were working on pass.
      for (const group of byGroup) {
        const whole = mine ? remembered.wholeState(remembered.wholeOf(group.name)) : null
        group.ranWhole = whole ? whole.at : null
        group.dirty = !!(whole && whole.dirty) || group.tests.some(t => t.dirty)
        group.state = worst(group.tests.flatMap(t => t.checks))
      }

      return {
        suites: byGroup,
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

      // AND MACHINES, which are the expensive ones. A drill that dies half-way
      // through an install leaves a virtual machine and a forty-gigabyte disk
      // image, and nothing else in this app will ever tidy that up — the queue
      // only knows about machines it is meant to use.
      //
      // `drill-` on a machine, the same idea as `drill/` on a branch: a name
      // nothing else here ever writes, so removing one needs no judgement call.
      const madeUp = (await actions.vmList.run({})).vms
        .filter(v => /^drill-/.test(String(v.name || '')))

      const found = {
        branches: branches.map(b => b.name),
        tasks: tasks.map(t => `#${t.number} ${t.title}`),
        remote,
        machines: madeUp.map(v => `${v.name} (${v.state}${v.stage ? ', ' + v.stage : ''})`)
      }
      const total = branches.length + tasks.length + remote.length + madeUp.length

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

      const gone = { tasks: [], branches: [], machines: [], failed: [] }

      // Machines first, and on their own. Removing one deletes its disks, which
      // is the slowest and least reversible thing here — and a machine that is
      // still running is stopped by vmRemove itself, so nothing else needs to
      // know about that.
      for (const v of madeUp) {
        try { await actions.vmRemove.run({ name: v.name }); gone.machines.push(v.name) } catch (e) { gone.failed.push(`${v.name}: ${e.message}`) }
      }
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

      log.on('test').warn(`swept ${gone.tasks.length} task(s), ${gone.branches.length} branch(es) and ${gone.machines.length} machine(s) left by drills`)
      return {
        ...found,
        removed: true,
        gone,
        // Said rather than done. Deleting a branch on the fork is a push, and a
        // pull request open against it is somebody else's repository — neither
        // is something a tidy-up button should decide.
        note: remote.length
          ? `${gone.tasks.length} task(s), ${gone.branches.length} branch(es) and ${gone.machines.length} machine(s) removed here. ${remote.length} branch(es) are also on origin and are NOT touched — deleting those is a push, and any pull request open from one is on somebody else's repository.`
          : `${gone.tasks.length} task(s), ${gone.branches.length} branch(es) and ${gone.machines.length} machine(s) removed.`
      }
    }
  },

  // A CHANGE TO SEND OUT, because the last stage of the order needs one.
  //
  // Cut a branch, do the work, open a pull request: the middle step is a worker
  // on a machine, and that is ten minutes and a runner switched on. A drill that
  // needs one is a drill nobody runs — which is how tasks/planned.js ended up
  // being deleted rather than fixed. So the drills make their own commit, and
  // what they prove is the half either side of the worker: that a branch with
  // something on it pushes, opens, lands and comes back.
  //
  // FENCED THREE WAYS, because this writes a commit into somebody's repository.
  //
  //   - testing has to be on FOR THIS WORKSPACE, the same gate as running a
  //     drill at all;
  //   - the branch must be a `drill/` one, which nothing else in this app ever
  //     creates and `drillSweep` already knows how to remove;
  //   - the file must be a `drill-` one, so even on the right branch it cannot
  //     land on top of somebody's work.
  //
  // None of that is a promise about how the drills are written. It is what the
  // action refuses, which is the only kind of rule that holds when the fiftieth
  // suite is written six weeks from now.
  drillCommit: {
    about: 'Put a commit on a drill branch, so a drill has a change to send out. Refused off a drill branch',
    needs: 'workspace',
    takes: ['branch', 'repo', 'file', 'text', 'message'],
    run: ({ branch, repo, file, text, message }) => {
      const may = mayRun()
      if (!may.allowed) throw new Error(may.why)

      const on = String(branch || '').trim()
      if (!on.startsWith('drill/')) {
        throw new Error(`"${on}" is not a drill branch. This only ever commits on drill/ branches — a drill that could commit anywhere is a drill that can write into somebody's work.`)
      }
      const name = String(file || 'drill-note.md').trim()
      if (!/^drill-/.test(name)) {
        throw new Error(`"${name}" is not a drill file. The name has to start with "drill-" so it cannot land on top of something somebody wrote.`)
      }

      const here = repos.list().map(r => r.name)
      const want = repo ? [String(repo)] : here
      for (const r of want) {
        if (!here.includes(r)) throw new Error(`There is no repository called "${r}" here. There is: ${here.join(', ')}.`)
      }

      // Where the branch actually is. A cut spans every repository, but a change
      // usually does not, and a drill naming one repository is making a point
      // about a change that spans one.
      const cut = (branches.all().branches || []).find(b => b.name === on)
      if (!cut) throw new Error(`There is no branch called "${on}" here. Cut it first.`)

      const done = []
      for (const r of want) {
        if (!cut.in.includes(r)) continue
        done.push(branches.commitOn(r, {
          branch: on,
          file: name,
          text: String(text == null ? `Written by a drill at ${new Date().toISOString()}.\n` : text),
          message: String(message || 'drill: a change to send out')
        }))
      }
      if (!done.length) throw new Error(`No repository here has a branch called "${on}". Cut it first.`)

      log.on('test').info(`committed ${name} on ${on} in ${done.map(d => d.repo).join(', ')}`)
      return { branch: on, commits: done, note: `${done.length} commit(s) on ${on}: ${done.map(d => `${d.repo} ${d.commit.slice(0, 7)}`).join(', ')}.` }
    }
  },

  // THROWING AWAY WHAT IS REMEMBERED, all of it or one part.
  //
  // Needed the moment results outlive the window. A remembered verdict can be
  // wrong in ways nothing detects: a machine was in a state it will never be in
  // again, a check passed against a workspace that has since been rearranged,
  // or somebody simply wants a board that says only what happened today.
  //
  // A check whose SOURCE changed already reports itself as changed rather than
  // as a verdict — that is handled where results are read, and needs no help
  // from here. This is for the rest.
  //
  // IT ALSO FORGETS WHAT A DRILL WAS IN THE MIDDLE OF. Clearing a suite's
  // results and leaving its kept state behind would be the worst of both: a
  // clean board and a drill that still believes it is half way through
  // something.
  testsForget: {
    about: 'Forget remembered test results — everything, or one suite, test or check',
    takes: ['suite', 'test', 'check'],
    run: ({ suite, test, check }) => {
      const group = String(suite || '').trim() || null
      const file = String(test || '').trim() || null
      const step = String(check || '').trim() || null
      const gone = remembered.forget({ group, test: file, check: step })

      // AND THE RUN THIS PROCESS IS STILL HOLDING, or the clear does nothing
      // visible. The board reads the live run first and the store second, so
      // forgetting only the stored half left the result on screen until the next
      // restart — a clear that appears not to work, which is worse than no clear
      // at all. Found by using it.
      if (lastRun.results) {
        if (!group && !file && !step) {
          lastRun = { at: null, results: null, running: lastRun.running }
        } else {
          for (const su of lastRun.results.suites || []) {
            if (group && su.group !== group) continue
            if (file && su.name !== file) continue
            su.tests = (su.tests || []).filter(t => step ? t.name !== step : false)
          }
          lastRun.results.suites = (lastRun.results.suites || []).filter(su => (su.tests || []).length)
        }
      }

      const what = step || file || group
      log.on('test')[gone ? 'info' : 'warn'](what ? `forgot what was remembered about "${what}"` : 'forgot every remembered test result')
      return {
        forgot: gone,
        of: what || 'everything',
        note: gone
          ? `${gone} remembered result(s) thrown away${what ? ` for "${what}"` : ''}. Nothing was run, and nothing about the checks themselves changed.`
          : `Nothing was remembered${what ? ` about "${what}"` : ''}, so nothing was thrown away.`
      }
    }
  },

  suiteRun: {
    about: 'Run everything, one suite, one test in it, or one check of that test. Pass slow for the drills that build a machine',
    takes: ['suite', 'test', 'check', 'slow'],
    run: async ({ suite, test, check, slow }) => {
      // REFUSED HERE, at the only door that runs a test. The window disables the
      // buttons too, and that is a courtesy — this is the boundary, and it is
      // the one a drill reached from the command line meets as well.
      const may = mayRun()
      if (!may.allowed) throw new Error(may.why)

      if (lastRun.running) throw new Error('A run is already going. Wait for it, or it will report two answers about the same moment.')
      ready()

      const want = String(suite || '').trim()
      const one = String(test || '').trim()
      const step = String(check || '').trim()
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
      // Keyed by all THREE, because a file's title is only unique inside its
      // folder: two suites may each have a test called the same thing, and a
      // key made of two of the three would quietly merge their logs.
      const said = new Map()
      const key = (g, a, b) => [g, a, b].join(' / ')
      let current = null
      to.info(want || one ? `running ${one || want}` : 'running every suite')

      // WHAT A CHECK IS, as a number, so a remembered result cannot outlive the
      // code it is about. Built before the run from what registered, because the
      // callbacks below are handed names and nothing else.
      const prints = new Map()
      for (const file of harness.getRegisteredSuites()) {
        for (const t of file.tests) prints.set(key(file.group, file.name, t.name), t.fingerprint)
      }

      // WRITTEN DOWN AS IT HAPPENS, not at the end.
      //
      // The point of keeping any of this is somebody watching a long run across a
      // restart — and a record written only when the run finishes is exactly the
      // record that is missing when it does not. So each check lands as it ends,
      // and the one in flight is marked running: restart in the middle of a
      // half-hour drill and the board still says which step it had reached.
      remembered.claim(workspaces.dir() || null)
      remembered.began({ suite: want || null, test: one || null, check: step || null, slow: slow === true || slow === 'true' })

      try {
        const results = await harness.run({
          // THE TABLE ITSELF, which is what makes these drills rather than unit
          // tests: a test asks this app for something exactly the way anything
          // else does, and meets the same refusals.
          actions,
          // WHETHER THE HALF-HOUR ONES MAY RUN, and it is off unless somebody
          // says so. Building a machine from nothing is twenty-five minutes and
          // holds the whole host while it happens — a thing to decide to do, not
          // something "Run all" does to you because you wanted to see the tests
          // go green. A drill that needs it asks with assert.needs, so it
          // reports "could not be tried" and says how to try it.
          slow: slow === true || slow === 'true',
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
          onTestStart: ({ groupName, suiteName, testName }) => {
            current = key(groupName, suiteName, testName)
            said.set(current, [])
            // The step it is ON, written down before it is known how it goes. If
            // the app goes away here, this is what says where it had reached.
            remembered.remember(groupName, suiteName, testName, {
              state: 'running',
              ms: null,
              why: null,
              log: [],
              fingerprint: prints.get(current) || null
            })
          },
          // Cleared AFTER the harness has written its own PASS/SKIP/FAIL line,
          // so that line lands with the test it is about rather than with
          // whatever runs next.
          onTestEnd: ({ groupName, suiteName, testName, result }) => {
            remembered.remember(groupName, suiteName, testName, {
              state: result.ok === true ? 'passed' : result.ok === null ? 'unrunnable' : 'failed',
              ms: result.ms,
              why: result.unrunnable || (result.error ? String(result.error).split('\n')[0] : null),
              log: said.get(key(groupName, suiteName, testName)) || [],
              fingerprint: prints.get(key(groupName, suiteName, testName)) || null
            })
            current = null
          },
          // Suite, then test, then check — the three columns in the window, and
          // the three things the command line can be given. Each narrows the one
          // above it, and none of them is a pattern: a filter that half-matches
          // runs something nobody asked for.
          testFilter: (checkName, testName, groupName) => {
            if (want && groupName !== want) return false
            if (one && testName !== one) return false
            if (step && checkName !== step) return false
            return true
          },
          // A test that hangs holds the whole run, and half of these touch
          // machines. Long enough for a real refusal to be reached and short
          // enough that a wedged one is a failure rather than an afternoon.
          timeoutMs: 60000,
          onTestUpdate: ({ groupName, suiteName, testName, status, error }) => {
            if (status === 'running') return
            const said = `${groupName} / ${suiteName} — ${testName}`
            if (status === 'passed') to.good(said)
            else if (status === 'unrunnable') to.warn(`${said}: ${error}`)
            else to.bad(`${said}: ${String(error || '').split('\n')[0]}`)
          }
        })

        // Folded onto each result, so what a test SAID travels with how it went
        // rather than being a second thing to look up by name.
        for (const su of results.suites || []) {
          for (const t of su.tests || []) t.log = said.get(key(su.group, su.name, t.name)) || []
        }
        lastRun = { at: new Date().toISOString(), results, running: false }

        // WHAT RAN AS A WHOLE, AND WHAT WAS ONLY DISTURBED.
        //
        // Worked out from what actually ran rather than from what was asked for,
        // because those are not the same thing — a filter can name a suite whose
        // checks are half unrunnable, and "ran the whole suite" has to mean every
        // check in it was attempted.
        //
        // A test is a SERIES, so one check of it run alone does not re-establish
        // the series: the steps around it did not happen, and the state they hand
        // each other was never built. The same one level up. So a partial run
        // marks its parents DIRTY — the results inside are current, the claim
        // about the whole is not.
        const registered = harness.getRegisteredSuites()
        const groups = new Map()
        for (const file of registered) {
          if (!groups.has(file.group)) groups.set(file.group, [])
          groups.get(file.group).push(file)
        }
        for (const [group, files] of groups) {
          let everyFileWhole = true
          for (const file of files) {
            const ran = (results.suites || []).find(s => s.group === group && s.name === file.name)
            const attempted = ran ? ran.tests.length : 0
            if (attempted === file.tests.length) {
              remembered.ranWhole(remembered.wholeOf(group, file.name))
            } else {
              everyFileWhole = false
              // Only if something in it ran. A file nobody asked for is
              // untouched, not disturbed.
              if (attempted) remembered.dirty(remembered.wholeOf(group, file.name))
            }
          }
          if (everyFileWhole) remembered.ranWhole(remembered.wholeOf(group))
          else if ((results.suites || []).some(s => s.group === group)) remembered.dirty(remembered.wholeOf(group))
        }
        remembered.ended({ passed: results.passed, failed: results.failed, unrunnable: results.unrunnable })

        const note = `${results.passed} passed, ${results.failed} failed, ${results.unrunnable} could not be tried.`
        if (results.failed) to.bad(note)
        else to.good(note)
        return { ...results, note }
      } finally {
        lastRun.running = false
        if (remembered.lastRun() && remembered.lastRun().running) remembered.ended(null)
      }
    }
  }
}
