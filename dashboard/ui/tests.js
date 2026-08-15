'use strict'

// This app run against itself.
//
// Part of the window. See ui/load.js for the order these are read in and why
// the order matters.
//
// THREE OUTCOMES, NOT TWO, and that is most of what this pane is for. A test
// that could not be TRIED is not a test that failed: half these drills need a
// machine that is on, or a credential, or a branch claimed — and the whole
// design of this tool puts machines at rest. A suite reporting "4 failed" on a
// quiet system is the fastest way to teach somebody to ignore a red number.
//
// THE THIRD COLUMN IS THE SOURCE. A green tick means whatever the check actually
// does, and the only way to know that is to read it — which is why the harness
// carries each test's source, and why the widest column here is the code rather
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
  'not run': { className: 'badge muted', textContent: 'not run' }
}

// The worst thing in a suite, for the badge on its card. Failed beats not-tried
// beats passed: an aggregate that averages away one failure is an aggregate that
// hides the only line worth reading.
const worstOf = tests =>
  tests.some(t => t.state === 'failed') ? 'failed'
    : tests.some(t => t.state === 'unrunnable') ? 'unrunnable'
      : tests.every(t => t.state === 'passed') ? 'passed'
        : 'not run'

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
  // not consent to do that. The action reads the register and calls no test.
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
      runAll.title = !testsAllowed ? testsWhy : testsRunning ? 'A run is already going' : 'Run every test in every suite'
    }

    const all = v.suites.flatMap(s => s.tests)
    const badge = $('tests-badge')
    const bad = all.filter(t => t.state === 'failed').length
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
        ? v.suites.map(s => el('div', {
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
            el('span', TEST_LOOK[worstOf(s.tests)])),
          el('div', { className: 'badges' },
            el('span', { className: 'muted', textContent: `${s.tests.length} check${s.tests.length === 1 ? '' : 's'}` }),
            // Only the counts that are not zero. A row of three zeroes is three
            // things to read past on every suite that is simply fine.
            ...['passed', 'failed', 'unrunnable'].map(k => {
              const n = s.tests.filter(t => t.state === k).length
              return n ? el('span', { ...TEST_LOOK[k], textContent: `${n} ${TEST_LOOK[k].textContent}` }) : null
            }),
            el('button', {
              className: 'btn small',
              textContent: 'Run it',
              disabled: testsRunning || !testsAllowed,
              title: !testsAllowed ? testsWhy : testsRunning ? 'A run is already going' : `Run only "${s.name}"`,
              onclick: e => { e.stopPropagation(); runTests({ suite: s.name }) }
            }))))
        : el('p', { className: 'empty', textContent: 'No suites are registered. They live in test/suites — a file that calls describe/it is a suite, and adding one is all there is to it.' }))
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
          el('div', { className: 'badges' },
            t.ms != null ? el('span', { className: 'muted', textContent: `${t.ms}ms` }) : null,
            // The fingerprint of the SOURCE, not the name — an edited check with
            // the same name is a different check, and this is what says so.
            el('span', { className: 'mono muted', textContent: t.fingerprint }))))
        : el('p', { className: 'empty', textContent: 'Pick a suite on the left.' }))
    }

    const one = suite && suite.tests.find(t => t.name === pickedTest)
    setText($('test-suite-context'), suite ? `— ${suite.tests.length}` : '')
    setText($('test-context'), one ? `— ${one.state}` : '')
    if (changed('test-detail', [one, testsRunning, testsAllowed])) paintTestDetail(suite, one)
  }).catch(e => { if (changed('tests-bad', String(e.message))) oops(e) })
}

function paintTestDetail (suite, t) {
  if (!t) return fill($('test-detail'), el('p', { className: 'empty', textContent: 'Pick a check.' }))

  fill($('test-detail'),
    el('div', { className: 'card-title' },
      el('span', { className: 'grow', textContent: t.name }),
      el('span', TEST_LOOK[t.state])),

    el('table', { className: 'kv', style: 'margin-top:8px' },
      el('tr', {}, el('th', { textContent: 'suite' }), el('td', { textContent: suite.name })),
      el('tr', {}, el('th', { textContent: 'took' }),
        el('td', { className: 'muted', textContent: t.ms != null ? `${t.ms}ms` : 'it has not been run in this window' })),
      el('tr', {}, el('th', { textContent: 'fingerprint' }),
        el('td', { className: 'mono', style: 'user-select:text', textContent: t.fingerprint }))),

    // WHAT IT SAID, and the wording follows what kind of answer it is. A
    // precondition that was not met is a fact about the moment — nothing is
    // wrong — and it must not be dressed as a failure.
    t.state === 'unrunnable'
      ? el('p', { className: 'note warn' },
          el('strong', { textContent: 'Could not be tried. ' }),
          el('span', { textContent: `${t.why} Nothing is wrong with the check or with the code — it asked for something this system does not have right now, which is the ordinary resting state here.` }))
      : null,

    t.state === 'failed'
      ? el('div', { style: 'margin-top:10px' },
          el('div', { className: 'dlg-heading', textContent: 'What went wrong' }),
          codeBlock(String(t.why || 'no message'), 'text'))
      : null,

    t.state === 'passed'
      ? el('p', { className: 'note' }, el('strong', { className: 'ok', textContent: 'Passed. ' }),
          el('span', { textContent: 'Which means what the code below does, and nothing more — read it before trusting the tick.' }))
      : null,

    t.state === 'not run'
      ? el('p', { className: 'note muted', textContent: 'Not run in this window. A result is a statement about this process and this workspace at one moment, so none is kept across a restart.' })
      : null,

    // THE CHECK ITSELF, which is the whole reason this column is the wide one.
    el('div', { className: 'dlg-heading', style: 'margin-top:12px', textContent: 'What it does' }),
    codeBlock(String(t.source || ''), 'javascript'),

    // AND WHAT IT SAID WHILE IT RAN.
    //
    // The live log is the whole run interleaved, which is right while it is
    // happening and useless afterwards for one check. Half these drills log what
    // they ARRANGED — "taking runner1's credential for the duration, and putting
    // it back afterwards" — and that is most of what a result means: the same
    // green tick is worth different things depending on what the drill had to
    // set up to earn it.
    //
    // From the last run only, and absent rather than empty when there has not
    // been one. An empty box under a heading reads as "it said nothing", which
    // is a different claim from "it has not run".
    (t.log || []).length
      ? [
          el('div', { className: 'dlg-heading', style: 'margin-top:12px', textContent: 'The log' }),
          codeBlock((t.log || []).join('\n'), 'text')
        ]
      : null,

    el('div', { className: 'row', style: 'margin-top:10px' },
      el('button', {
        className: 'btn ok',
        textContent: 'Run this one',
        disabled: testsRunning || !testsAllowed,
        title: !testsAllowed ? testsWhy : testsRunning ? 'A run is already going' : 'Runs only this check',
        onclick: () => runTests({ suite: suite.name, test: t.name })
      }),
      el('button', {
        className: 'btn',
        textContent: 'Run the suite',
        disabled: testsRunning || !testsAllowed,
        title: !testsAllowed ? testsWhy : '',
        onclick: () => runTests({ suite: suite.name })
      })))
}

// One way in for all three buttons. Every one of them reports through the live
// log as it goes — the harness calls back per test — so a long run is legible
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
