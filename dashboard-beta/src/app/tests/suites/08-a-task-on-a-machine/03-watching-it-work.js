'use strict'

// watching it work — a run can be seen while it is happening
//
// A RUN USED TO BE A THING YOU FOUND OUT ABOUT AFTERWARDS. Dispatch asked Claude
// for `--output-format json`, which is one object written when the worker
// finishes, so for the twenty minutes in between there was nothing to look at
// and no way to tell a machine that was thinking from one that had wedged.
//
// It asks for `stream-json` now — one event per line — and the guest half reads
// the last `result` line out of it. Those two changed in the same breath, and
// either of them alone is a silent failure: a stream nobody can read reports
// that the worker said nothing.
//
// ---- what this asks, and what it stopped asking --------------------------
//
// IT USED TO BUILD THE RUN SCRIPT AND READ IT. `dispatch.script({...})` with
// made-up arguments, then regexes over the text: is `claude -p` asked for a
// stream, is the watcher node that parses, does the current run have a stable
// name. A drill runs from `dist/suites` with only the harness beside it and
// cannot reach the app's insides, so this suite read `will not load` — but the
// requires are the smaller half of it. Reading a string this file asked the app
// to build is a unit test, and it is one that already exists:
//
//   test/vms/dispatch-script.js     the stream is asked for, the run is detached
//                                   in its own session so it outlives the
//                                   connection, the current link is moved so a
//                                   watcher can follow the next run too, and
//                                   everything it produces parses as shell
//   test/vms/dispatch-payloads.js   the watcher and the guest API are on disk,
//                                   parse as node, and are delivered byte for
//                                   byte — and the guest reads a stream while
//                                   still reading one whole object
//   test/vms/dispatch-supervisor.js the supervisor takes its turn the same way
//
// THAT LAST ONE WAS ONLY EVER ASKED HERE. Nothing checked that anything could
// READ the stream that dispatch had started asking for; it moved into the
// payloads test while this file was being rewritten.
//
// ---- and what a drill can say that none of them can ----------------------
//
// THAT IT ACTUALLY WORKS ON A MACHINE. A script that parses is not a run that
// can be watched: the watcher has to start, the run has to keep going without
// the connection that began it, and the output has to be readable BEFORE the
// thing is over — which is the entire point and the one thing a string cannot
// demonstrate.
//
// WITH NO CREDENTIAL, WHICH IS WHY THIS IS WORTH DOING. A run does not have to
// be a worker: `vmDispatch --shell` runs a command through the same machinery —
// same watcher, same run folder, same current link, same reading — and a shell
// command needs nobody to be signed in. So the watching can be proven on any
// host with a machine up, and what is left needing a credential is only whether
// Claude itself streams.

const { it, cleanup, requires } = require('../../harness')
const { aConnectedMachine } = require('../../helpers')

requires('the machines are built')

// LONG ENOUGH TO BE CAUGHT IN THE MIDDLE OF, short enough that a failed drill
// does not leave a machine busy. It prints before it waits, so there is
// something to read while it is still going — which is the claim.
const SECONDS = 20
const MARK = 'okc-drill-watching-this-run'
const COMMAND = `echo "${MARK} started"; sleep ${SECONDS}; echo "${MARK} finished"`

it('a machine is up to run something on', async ({ okc, assert, state, log }) => {
  const machine = await aConnectedMachine(okc, assert, 'no machine from the test pool is dialled in to watch a run on')
  state.machine = machine.name

  // NOTHING OF THIS DRILL'S LEFT OVER. A previous run still going would be found
  // by the checks below and read as the one this started.
  const { runs } = await okc('vmRuns', { name: state.machine })
  const mine = (runs || []).filter((r) => r.state === 'running')
  assert.needs(!mine.length,
    `${state.machine} already has ${mine.length} run(s) going, so a run started now could not be told from them — wait for it, or stop it`)

  log(`${state.machine} is up and idle`)
}, { gate: true })

it('a run started here keeps going without the connection that started it', async ({ okc, assert, state, log }) => {
  // DETACHED IS THE WHOLE ARRANGEMENT. `vmDispatch` returns immediately — it
  // says so in its own description — and the run carries on in its own session,
  // which is what lets the dashboard be restarted, or the machine's channel
  // dropped, without killing somebody's work.
  const said = await okc('vmDispatch', {
    name: state.machine,
    task: COMMAND,
    shell: true
  })

  state.run = said.run || said.id || null
  assert.ok(state.run, `dispatching returned without naming the run it started: ${JSON.stringify(said).slice(0, 200)}`)

  // AND IT IS GOING, asked of the machine rather than believed from the answer
  // above. "It was started" and "it is running" are different claims and only
  // the second one means the watcher came up.
  const { runs } = await okc('vmRuns', { name: state.machine })
  const it2 = (runs || []).filter((r) => r.id === state.run)[0]

  assert.ok(it2, `${state.machine} does not list the run it was just given (${state.run})`)
  assert.equal(it2.state, 'running',
    `the run reads as "${it2.state}" immediately after being dispatched — a run that is over before this line either never started or was not detached`)

  // AN EXIT CODE OF NOTHING IS NOT AN EXIT CODE OF ZERO, and a run still going
  // has none. This is the one place that distinction can be seen from outside.
  assert.equal(it2.exit, null, `a run that is still going reported exit ${it2.exit}`)

  log(`${state.run} is going on ${state.machine}, with no exit code yet`)
}, { minutes: 4, gate: true })

it('and what it has said so far can be read before it is over', async ({ okc, assert, state, log }) => {
  // THE POINT OF ASKING FOR A STREAM. Reading a run's output while it is still
  // going is the difference between watching a worker think and waiting twenty
  // minutes to find out it wedged in the first thirty seconds.
  const said = await okc('vmRunOutput', { name: state.machine, run: state.run, lines: 40 })
  const out = String(said.output || '')

  assert.ok(out.includes(`${MARK} started`),
    `the run has printed a line and reading its output does not show it — what came back was ${out.length} characters: ${out.slice(-200)}`)
  assert.ok(!out.includes(`${MARK} finished`),
    'the run is already over, so this read nothing that was in flight — the command was too short to be caught in the middle of')

  // AND IT IS STILL GOING WHILE THAT IS TRUE, which is what makes the two lines
  // above mean "watched" rather than "read afterwards".
  const { runs } = await okc('vmRuns', { name: state.machine })
  const still = (runs || []).filter((r) => r.id === state.run)[0]
  assert.equal(still && still.state, 'running',
    'the run finished between reading its output and asking about it, so nothing here was read in flight')

  log(`read ${out.length} characters of a run that is still going`)
}, { minutes: 4 })

it('and it finishes, with an exit code that says how', async ({ okc, assert, state, log }) => {
  // WAITED FOR BY ASKING THE MACHINE, which is the only thing that knows. The
  // command sleeps for a known time, so this is bounded by the run itself rather
  // than by a guess about how long things take.
  const until = Date.now() + (SECONDS + 40) * 1000
  let last = null

  while (Date.now() < until) {
    const { runs } = await okc('vmRuns', { name: state.machine })
    last = (runs || []).filter((r) => r.id === state.run)[0] || last
    if (last && last.state !== 'running') break
    await new Promise((r) => setTimeout(r, 3000))
  }

  assert.ok(last && last.state !== 'running',
    `${state.run} was still going ${SECONDS + 40}s after a command that sleeps for ${SECONDS}s`)
  assert.equal(last.exit, 0, `the run ended with exit ${last.exit}, and it was a command that cannot fail`)

  const said = await okc('vmRunOutput', { name: state.machine, run: state.run, lines: 40 })
  assert.ok(String(said.output || '').includes(`${MARK} finished`),
    'the run ended without its last line being readable, so what a finished run said is not kept')

  state.run = null
  log(`${state.machine} finished the run, exit 0, and both lines are in its output`)
}, { minutes: 4 })

cleanup(async ({ okc, state }) => {
  // A RUN LEFT GOING holds the machine as far as anything asking is concerned,
  // and the next drill to want one would find it busy for a reason that is not
  // about it.
  if (state.run && state.machine) {
    try { await okc('vmRunStop', { name: state.machine, run: state.run }) } catch (e) { /* it may be over, or the machine gone */ }
    state.run = null
  }
})
