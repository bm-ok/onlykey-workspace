'use strict'

// watching it work — the run is readable while it runs, not only after
//
// A run used to be invisible until it ended. `claude -p --output-format json`
// writes ONE object when the worker finishes, so the log was zero bytes for
// twenty minutes and then complete — and "working" was equally true of a worker
// reading files and one stuck at a sign-in prompt. The two available answers to
// "is it doing anything" were wait, or stop it and find out.
//
// THREE THINGS HAVE TO HOLD TOGETHER, and each is checked separately here
// because each has failed on its own:
//
//   the run is asked for a STREAM        one event per line, as it happens
//   the reader takes the LAST result     it parsed the whole file as one object,
//                                        and left alone would have reported
//                                        every job as saying nothing
//   the watcher runs where it lands      it is node, written into a guest, and
//                                        `node --check` on this host says
//                                        nothing about the shell that carries it
//
// NO MACHINE IS NEEDED. What reaches a machine is a string, built here, and the
// point of these checks is that the string can be looked at before a guest is
// the one to find out. Both generated scripts are rendered and read.

const { it, requires } = require('../../harness')
const fs = require('node:fs')
const path = require('node:path')
const dispatch = require('../../../machines/dispatch')

// It is about what dispatch generates, which stands on nothing.
requires()

// A run script, as a machine would receive it.
const aRun = () => String(dispatch.script({
  id: 'drill-run', task: 'do the thing', folder: '/home/okc/workspace',
  base: 'https://host:7373', vm: 'kit-1', token: 'TOKEN', contract: 'the rules it was given'
}))

it('a run is asked for a stream, not one object at the end', async ({ assert, log }) => {
  const line = aRun().split('\n').find(l => l.includes('claude -p'))
  assert.ok(line, 'nothing in a dispatched run gives the brief to a worker')

  assert.ok(/--output-format stream-json/.test(line),
    'a run does not ask for stream-json, so its log is empty until it finishes and nothing can be watched')
  // --verbose is REQUIRED alongside stream-json when running with -p. Without
  // it claude refuses to start, which is a run that fails on the machine for a
  // reason nothing here would explain.
  assert.ok(/--verbose/.test(line), 'stream-json was asked for without --verbose, which claude refuses')
  assert.ok(/> \S+out\.log/.test(line), 'the run does not write its log where anything can read it')
  log(line.trim().slice(0, 140))
})

it('and the reader takes the last result line, or a whole-file object', async ({ assert }) => {
  // THE HALF THAT HAD TO CHANGE IN THE SAME BREATH. `claude()` in the job API
  // parsed the whole log as one object; against a stream that throws, and every
  // job would have reported that the worker said nothing — a total, silent
  // failure on what reads like a display preference.
  const api = fs.readFileSync(path.join(__dirname, '../../../machines/job-api.js'), 'utf8')
  assert.ok(/type === 'result'/.test(api), 'the job API does not look for a result line, so a streamed run reads as nothing')
  assert.ok(/JSON\.parse\(out\)/.test(api), 'the job API no longer accepts a whole-file object, so runs from before the change stop reading')
})

it('and the watcher it writes is node that runs', async ({ assert, log }) => {
  const text = aRun()
  const open = "<<'OKC_WATCH_EOF'\n"
  const from = text.indexOf(open)
  assert.ok(from > 0, 'a run writes no watcher, so there is nothing to follow it with')

  const watcher = text.slice(from + open.length, text.indexOf('\nOKC_WATCH_EOF', from))

  // COMPILED AND RUN HERE, IN A CONTEXT OF ITS OWN, rather than written to a
  // file and given to a child process. Two reasons, and the second is the one
  // that caught this out: a child would need `node` on PATH, and the process
  // running these drills is `nw.exe` — the window and the app are one node
  // context, so `process.execPath` is the browser runtime and `--check` means
  // nothing to it.
  //
  // What is proven is the same thing: that what came out the other end of a
  // heredoc, inside a template literal, inside a shell script, is JavaScript
  // that parses and behaves — which is where this project has lost a file to a
  // stray backtick before.
  const vm = require('node:vm')
  let feed = null
  const printed = []
  const stage = {
    process: { stdin: { setEncoding: () => {}, on: (what, fn) => { if (what === 'data') feed = fn } } },
    // One argument, because that is how the watcher calls it — every line it
    // prints is one built string. A rest parameter here also trips the
    // declared-names check, which does not read `...bits` as a declaration.
    console: { log: line => printed.push(String(line)) },
    JSON
  }
  vm.runInNewContext(watcher, stage, { filename: 'watch.js', timeout: 5000 })
  assert.ok(typeof feed === 'function', 'the watcher does not read stdin, so a log piped into it goes nowhere')

  // AND IT DOES THE THING IT EXISTS FOR. A watcher that parses and prints
  // nothing is the same to a person as no watcher at all.
  const events = [
    JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-opus-5' }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Looking at the README first.' }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'git status --porcelain' } }] } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: ' M README.md\n M TODO.md' }] } }),
    'claude: could not sign in',
    JSON.stringify({ type: 'result', subtype: 'success', num_turns: 7, total_cost_usd: 1.2345 })
  ].join('\n') + '\n'

  feed(events)
  const said = printed.join('\n')
  assert.ok(/Looking at the README first/.test(said), 'the watcher drops what the worker SAID, which is most of what is worth watching')
  assert.ok(/Bash/.test(said) && /git status/.test(said), 'the watcher drops what the worker reached for')
  assert.ok(/7 turns/.test(said) && /1\.2345/.test(said), 'the watcher drops the result line, which is where the cost is')
  // Anything that is not an event is printed as it came: a worker that fails to
  // start says so in plain words, and that is the most important line in the
  // file on the day it happens.
  assert.ok(/could not sign in/.test(said), 'the watcher swallows plain text, which is what a failure to start looks like')
  log(`${printed.length} lines out of 6 events`)
})

it('and whichever run is happening now has a name that does not change', async ({ assert }) => {
  const text = aRun()
  // A run's directory is named after the run, which is right for the record and
  // useless for watching: something that wants to SEE the work would have to be
  // told an id that did not exist a moment ago. So the box gets a link, moved at
  // the start of every run, and one watcher beside it that follows through it.
  assert.ok(/ln -sfn \S+drill-run \S+\.okc-runs\/current/.test(text),
    'a run does not relink ~/.okc-runs/current, so nothing can watch "whatever it is doing now"')
  assert.ok(/tail -n \+1 -F "\S+\.okc-runs\/current\/out\.log"/.test(text),
    'the box watcher does not follow the link by name, so it would stop at the end of one run')
})

it('and the supervisor takes its turn the same way', async ({ assert, log }) => {
  // THE OTHER HALF OF THE APP, and the same fault: a turn is a command over the
  // channel, which hands everything back at the end. It writes a stream to a
  // file now, and relinks current.log so a terminal left open sees every wake.
  const turn = String(dispatch.supervisorTurn({
    stamp: '20260101-000000', brief: 'V0FLRQ==', refresh: 'echo okc-skill-stale'
  }))
  assert.ok(/--output-format stream-json --verbose/.test(turn), 'a supervisor turn is not asked for a stream')
  assert.ok(/ln -sfn \S+turns\/20260101-000000\.log \S+current\.log/.test(turn),
    'a turn does not relink current.log, so a terminal watching it sees one wake and then silence')
  assert.ok(/okc-watch/.test(turn), 'a turn writes no watcher')
  log(turn.split('\n').filter(l => l.startsWith('timeout')).join('').slice(0, 120))
})
