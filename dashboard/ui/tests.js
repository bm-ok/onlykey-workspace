'use strict'

// This app run against itself.
//
// Part of the window. See ui/load.js for the order these are read in and why
// the order matters.
//
// THREE THINGS, ONE PER COLUMN. A suite is a folder under test/suites, a test is
// a file in it, and the checks are the it()s inside that file. A test is a
// SERIES: its checks run in the order they are written, they hand things to each
// other, and one that fails stops the rest. So the third column shows the whole
// series in order rather than one assertion at a time — the order is the thing
// being asserted.
//
// THREE OUTCOMES, NOT TWO, and that is most of what this pane is for. A check
// that could not be TRIED is not a check that failed: half these drills need a
// machine that is on, or a credential, or a branch claimed — and the whole
// design of this tool puts machines at rest. A suite reporting "4 failed" on a
// quiet system is the fastest way to teach somebody to ignore a red number.
//
// THE SOURCE IS SHOWN, ALWAYS. A green tick means whatever the check actually
// does, and the only way to know that is to read it — which is why the harness
// carries each check's source, and why the widest column here is the code rather
// than the output. It is the same rule as a job showing its script before it is
// approved: reading is the whole of what a tick is worth.

let pickedSuite = been.get('test-suite', null)
let pickedTest = been.get('test-name', null)
// Set while a run is in flight so the buttons can say so. The action refuses a
// second run itself — this only keeps somebody from having to find that out by
// pressing.
let testsRunning = false
// Whether the drills are switched on for the folder open now. The action refuses
// on its own — this is what stops somebody pressing a button to find that out,
// and what puts the reason on screen instead of in a notice they have to trigger.
let testsAllowed = false
let testsWhy = null

const TEST_LOOK = {
  passed: { className: 'badge ok', textContent: 'passed' },
  failed: { className: 'badge bad', textContent: 'failed' },
  // Amber rather than red, and worded as a fact about the moment rather than
  // about the code. See `needs` in tasks/harness.js.
  unrunnable: { className: 'badge warn', textContent: 'not tried' },
  'not run': { className: 'badge muted', textContent: 'not run' },

  // THE THREE THAT ONLY EXIST BECAUSE RESULTS OUTLIVE THE WINDOW.
  //
  // Before core/testruns.js a result was this process's, so a check was passed,
  // failed, not tried or not run and there was nothing else it could be. Kept
  // across restarts, three more states are true and all of them are honest
  // answers rather than verdicts — which is why none of them is green.
  //
  //   carried      it was not run this time: it passed in the run that was
  //                interrupted, and was taken on trust so the series could go on
  //   changed      it passed once, and the check has been EDITED since, so what
  //                it did then says nothing about what it does now
  //   interrupted  it was running when the dashboard went away
  // NOT AMBER LIKE "not tried", and not red. Something a person has to do, which
  // no amount of running will change — so it is worded as a job rather than as a
  // state of the system, and it stays until somebody does it.
  'asks you': { className: 'badge warn', textContent: 'needs you' },
  carried: { className: 'badge muted', textContent: 'carried' },
  changed: { className: 'badge warn', textContent: 'check changed' },
  interrupted: { className: 'badge warn', textContent: 'interrupted' },
  running: { className: 'badge', textContent: 'running' }
}

// The worst thing in a list, for the badge on a card. Failed beats not-tried
// beats passed: an aggregate that averages away one failure is an aggregate that
// hides the only line worth reading.
// "Needs you" outranks "not tried" and is outranked by a failure. A suite
// waiting on a person is not the same as one that happened to find no free
// machine, and burying it under an amber count is how a fresh host looks merely
// untidy instead of looking like it is waiting for somebody.
const worstOf = states =>
  states.some(s => s === 'failed') ? 'failed'
    : states.some(s => s === 'asks you') ? 'asks you'
      : states.some(s => s === 'unrunnable') ? 'unrunnable'
        : states.length && states.every(s => s === 'passed') ? 'passed'
          : 'not run'

// Only the counts that are not zero. A row of three zeroes is three things to
// read past on every suite that is simply fine.
const countBadges = states => ['passed', 'failed', 'asks you', 'unrunnable'].map(k => {
  const n = states.filter(s => s === k).length
  return n ? el('span', { ...TEST_LOOK[k], textContent: `${n} ${TEST_LOOK[k].textContent}` }) : null
})

function paintTests () {
  if (view !== 'tests') return
  waiting('test-suites', { cards: 3 })
  waiting('test-list', { cards: 4 })
  waiting('test-detail', { lines: 8 })
  paintTestsNow()
}

async function paintTestsNow () {
  await settle()
  if (view !== 'tests') return

  // LISTING RUNS NOTHING, which is the property that makes it safe to ask for on
  // a draw at all: some of these drills borrow a machine, and opening a tab is
  // not consent to do that. The action reads the register and calls no check.
  api('suites').then(v => {
    if (view !== 'tests') return
    testsRunning = !!v.running
    testsAllowed = !!v.allowed
    testsWhy = v.why || null
    // The reason comes first when there is one: a tab of greyed-out buttons with
    // the explanation underneath the results is a tab that looks broken.
    setText($('tests-note'), testsAllowed ? v.note : v.why)
    setText($('tests-context'), v.suites.length ? `— ${v.suites.length}` : '— none')

    // THE BUTTON IN THE MARKUP, which the rest of this file does not build and
    // so did not disable. Its click handler refused, which means it looked
    // pressable and answered by complaining — and "disable what must not be
    // clicked, in the action AND the button" is the rule. Every other run button
    // here is built in JS and got it for free; this one had to be told.
    const runAll = $('tests-run-all')
    if (runAll) {
      runAll.disabled = testsRunning || !testsAllowed
      runAll.title = !testsAllowed ? testsWhy : testsRunning ? 'A run is already going' : 'Run every check in every suite'
    }

    const everyCheck = v.suites.flatMap(s => s.tests.flatMap(t => t.checks))
    const badge = $('tests-badge')
    const bad = everyCheck.filter(c => c.state === 'failed').length
    if (badge && changed('tests-badge', bad)) {
      badge.textContent = String(bad || '')
      badge.classList.toggle('hidden', !bad)
    }

    // Reconciled against what is registered, like every other selection in this
    // window: a suite renamed between one window and the next is a selection
    // pointing at nothing, which is the same stranded panel as never choosing.
    if (!v.suites.some(s => s.name === pickedSuite)) {
      pickedSuite = v.suites.length ? v.suites[0].name : null
      been.set('test-suite', pickedSuite)
    }
    const suite = v.suites.find(s => s.name === pickedSuite) || null
    if (!suite || !suite.tests.some(t => t.name === pickedTest)) {
      pickedTest = suite && suite.tests.length ? suite.tests[0].name : null
      been.set('test-name', pickedTest)
    }

    if (changed('test-suites', [v.suites, pickedSuite, testsRunning, testsAllowed])) {
      fill($('test-suites'), v.suites.length
        ? v.suites.map(s => {
            const states = s.tests.map(t => t.state)
            const checks = s.tests.reduce((n, t) => n + t.checks.length, 0)
            return el('div', {
              className: `card pick${s.name === pickedSuite ? ' on' : ''}`,
              onclick: () => {
                pickedSuite = s.name
                been.set('test-suite', pickedSuite)
                pickedTest = null
                forget('test-suites'); forget('test-list'); forget('test-detail')
                paintTests()
              }
            },
            el('div', { className: 'card-title' },
              el('span', { className: 'grow', textContent: s.name }),
              // THE SUITE'S OWN STATE, which is not always the worst of its
              // checks. A suite contradicted by somebody else's check reads as
              // failed while every check in it still says passed — that is the
              // point of it, and computing the badge here from the checks alone
              // would hide exactly the case it was added for.
              el('span', TEST_LOOK[s.state || worstOf(states)])),
            el('div', { className: 'badges' },
              el('span', { className: 'muted', textContent: `${s.tests.length} test${s.tests.length === 1 ? '' : 's'}, ${checks} check${checks === 1 ? '' : 's'}` }),
              ...countBadges(states),
              // WHAT IS OWED ON IT, and why. Dirty is a debt rather than a
              // colour: the results inside are current and the claim about the
              // whole suite is not, and the only thing that settles it is
              // running the suite. Contradicted is stronger and says who did it.
              s.disprovedBy
                ? el('span', {
                    className: 'badge bad',
                    textContent: 'contradicted',
                    title: `"${s.disprovedBy.check}" in ${s.disprovedBy.suite} failed, which is evidence against this suite. ${s.disprovedBy.why || ''} Run this suite again to settle it.`
                  })
                : null,
              s.dirty && !s.disprovedBy
                ? el('span', {
                    className: 'badge warn',
                    textContent: 'owes a run',
                    title: s.dirtyBecause
                      ? `Something it stands on was disturbed: ${s.dirtyBecause.join(', ')}. These results were established on top of it.`
                      : 'Part of this suite was run on its own, so the results are current and the claim about the whole suite is not.'
                  })
                : null,
              s.requires && s.requires.length
                ? el('span', { className: 'muted', textContent: `stands on ${s.requires.join(' + ')}` })
                : null,
              el('button', {
                className: 'btn small',
                textContent: 'Run it',
                disabled: testsRunning || !testsAllowed,
                title: !testsAllowed ? testsWhy : testsRunning ? 'A run is already going' : `Run every test in "${s.name}"`,
                onclick: e => { e.stopPropagation(); runTests({ suite: s.name }) }
              })))
          })
        : el('p', { className: 'empty', textContent: 'No suites are registered. A suite is a folder under test/suites, a test is a numbered file in it, and adding one is all there is to it.' }))
    }

    if (changed('test-list', [suite, pickedTest, testsRunning, testsAllowed])) {
      fill($('test-list'), suite && suite.tests.length
        ? suite.tests.map(t => el('div', {
            className: `card pick${t.name === pickedTest ? ' on' : ''}${t.state === 'failed' ? ' warn' : ''}`,
            onclick: () => {
              pickedTest = t.name
              been.set('test-name', pickedTest)
              forget('test-list'); forget('test-detail')
              paintTests()
            }
          },
          el('div', { className: 'card-title' },
            el('span', { className: 'grow', textContent: t.name }),
            el('span', TEST_LOOK[t.state])),
          // The steps it is made of, and how far it got. This is the whole
          // difference from a list of assertions: a test here is a sequence,
          // and "3 checks" is a statement about how much of an order it covers.
          el('div', { className: 'badges' },
            el('span', { className: 'muted', textContent: `${t.checks.length} check${t.checks.length === 1 ? '' : 's'}` }),
            ...countBadges(t.checks.map(c => c.state)),
            t.ms != null ? el('span', { className: 'muted', textContent: `${t.ms}ms` }) : null,
            // WHEN, WHICH ONLY MATTERS ONCE RESULTS OUTLIVE THE WINDOW. A pass
            // from four days ago and one from four minutes ago are both green,
            // and the difference is most of what somebody wants to know.
            t.ranWhole
              ? el('span', { className: 'muted', textContent: `whole ${ago(t.ranWhole)}` })
              : null,
            t.dirty
              ? el('span', { className: 'badge warn', textContent: 'owes a run', title: 'Part of this was run on its own, or a step was carried rather than run. The results are current; the claim about the whole series is not.' })
              : null)))
        : el('p', { className: 'empty', textContent: 'Pick a suite on the left.' }))
    }

    const one = suite && suite.tests.find(t => t.name === pickedTest)
    setText($('test-suite-context'), suite ? `— ${suite.tests.length}` : '')
    setText($('test-context'), one ? `— ${one.state}` : '')
    if (changed('test-detail', [one, testsRunning, testsAllowed])) paintTestDetail(suite, one)
  }).catch(e => { if (changed('tests-bad', String(e.message))) oops(e) })
}

// One check of the series: what step it is, how it went, what it does, and what
// it said. Everything about a step is in one block, because the alternative is
// reading a result in one place and the code for it in another.
function checkBlock (suite, test, c, n) {
  return el('div', { className: 'card', style: 'margin-top:10px' },
    el('div', { className: 'card-title' },
      // The number is the ORDER, which is the thing this whole level exists to
      // state. Written 1, 2, 3 rather than the file's 00 — the file numbers
      // order the tests, and these order the steps.
      el('span', { className: 'mono muted', textContent: `${n}.` }),
      el('span', { className: 'grow', textContent: c.name }),
      c.ms != null ? el('span', { className: 'muted', textContent: `${c.ms}ms` }) : null,
      el('span', TEST_LOOK[c.state])),

    // WHAT IT SAID, and the wording follows what kind of answer it is. A
    // precondition that was not met is a fact about the moment — nothing is
    // wrong — and it must not be dressed as a failure.
    c.state === 'unrunnable'
      ? el('p', { className: 'note warn' },
          el('strong', { textContent: 'Could not be tried. ' }),
          el('span', { textContent: `${c.why} Nothing is wrong with the check or with the code — it asked for something this system does not have right now, which is the ordinary resting state here.` }))
      : null,

    c.state === 'failed'
      ? el('div', { style: 'margin-top:8px' },
          el('div', { className: 'dlg-heading', textContent: 'What went wrong' }),
          codeBlock(String(c.why || 'no message'), 'text'))
      : null,

    el('div', { className: 'dlg-heading', style: 'margin-top:8px', textContent: 'What it does' }),
    codeBlock(String(c.source || ''), 'javascript'),

    // AND WHAT IT SAID WHILE IT RAN.
    //
    // The live log is the whole run interleaved, which is right while it is
    // happening and useless afterwards for one step. Half these drills log what
    // they ARRANGED — "taking runner1's credential for the duration, and putting
    // it back afterwards" — and that is most of what a result means: the same
    // green tick is worth different things depending on what the step had to set
    // up to earn it.
    //
    // From the last run only, and absent rather than empty when there has not
    // been one. An empty box under a heading reads as "it said nothing", which
    // is a different claim from "it has not run".
    (c.log || []).length
      ? [
          el('div', { className: 'dlg-heading', style: 'margin-top:8px', textContent: 'The log' }),
          codeBlock((c.log || []).join('\n'), 'text')
        ]
      : null,

    el('div', { className: 'row', style: 'margin-top:8px' },
      el('span', { className: 'mono muted grow', textContent: c.fingerprint }),
      el('button', {
        className: 'btn small',
        textContent: 'Run this check',
        disabled: testsRunning || !testsAllowed,
        // Worth saying: a step lifted out of its series is not the series. It
        // runs alone, with nothing arranged by the steps above it, which is
        // exactly what makes it useful for working on one and exactly what makes
        // its answer weaker than the test's.
        title: !testsAllowed ? testsWhy : 'Runs this step on its own, without the steps before it',
        onclick: () => runTests({ suite: suite.name, test: test.name, check: c.name })
      })))
}

function paintTestDetail (suite, t) {
  if (!t) return fill($('test-detail'), el('p', { className: 'empty', textContent: 'Pick a test.' }))

  const states = t.checks.map(c => c.state)
  const stopped = t.checks.find(c => c.state === 'unrunnable' && /^an earlier step/.test(String(c.why || '')))

  fill($('test-detail'),
    el('div', { className: 'card-title' },
      el('span', { className: 'grow', textContent: t.name }),
      el('span', TEST_LOOK[t.state])),

    el('table', { className: 'kv', style: 'margin-top:8px' },
      el('tr', {}, el('th', { textContent: 'suite' }), el('td', { textContent: suite.name })),
      el('tr', {}, el('th', { textContent: 'checks' }),
        el('td', { className: 'muted', textContent: `${t.checks.length}, in the order below` })),
      el('tr', {}, el('th', { textContent: 'took' }),
        el('td', { className: 'muted', textContent: t.ms != null ? `${t.ms}ms` : 'it has not been run in this window' }))),

    // A series that stopped. Said once at the top, because the steps below it
    // each say "an earlier step did not pass" and that is not the sentence
    // somebody needs to read three times.
    stopped
      ? el('p', { className: 'note warn' },
          el('strong', { textContent: 'The series stopped. ' }),
          el('span', { textContent: 'A check that fails stops the ones after it — the world is in a state nobody described, and a step run against that proves nothing. Read the failure, not the ones below it.' }))
      : null,

    t.state === 'passed'
      ? el('p', { className: 'note' }, el('strong', { className: 'ok', textContent: 'Every check passed. ' }),
          el('span', { textContent: 'Which means what the code below does, in this order, and nothing more — read it before trusting the tick.' }))
      : null,

    t.state === 'not run'
      ? el('p', { className: 'note muted', textContent: 'Not run in this window. A result is a statement about this process and this workspace at one moment, so none is kept across a restart.' })
      : null,

    el('div', { className: 'row', style: 'margin-top:10px' },
      el('button', {
        className: 'btn ok',
        textContent: 'Run this test',
        disabled: testsRunning || !testsAllowed,
        title: !testsAllowed ? testsWhy : testsRunning ? 'A run is already going' : 'Runs every check in this test, in order',
        onclick: () => runTests({ suite: suite.name, test: t.name })
      }),
      el('button', {
        className: 'btn',
        textContent: 'Run the suite',
        disabled: testsRunning || !testsAllowed,
        title: !testsAllowed ? testsWhy : '',
        onclick: () => runTests({ suite: suite.name })
      }),
      el('span', { className: 'grow' }),
      ...countBadges(states)),

    ...t.checks.map((c, i) => checkBlock(suite, t, c, i + 1)))
}

// One way in for all four buttons. Every one of them reports through the live
// log as it goes — the harness calls back per check — so a long run is legible
// while it happens rather than only in the answer at the end.
function runTests (what) {
  testsRunning = true
  forget('test-suites'); forget('test-list'); forget('test-detail')
  paintTests()
  return api('suiteRun', what)
    .then(r => { say(r.note, r.failed ? 'bad' : r.unrunnable ? 'warn' : 'ok'); return draw() })
    .catch(oops)
    .finally(() => {
      testsRunning = false
      forget('test-suites'); forget('test-list'); forget('test-detail')
      paintTests()
    })
}

$('tests-run-all').onclick = () => {
  if (!testsAllowed) return say(testsWhy, 'warn')
  runTests({})
}
