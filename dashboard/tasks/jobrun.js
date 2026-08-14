'use strict'

// Running a job, and everything it is allowed to do.
//
// A job is a Node script this app owns, so the question is not "can it run" but
// "what is it handed". Everything below is on one object; nothing else is
// provided, and what it is NOT given is as deliberate as what it is.
//
// IT GETS `okc`, WHICH IS THE WHOLE ACTION TABLE. Not the modules underneath --
// the actions, with every refusal a person meets. A job that could reach past
// them would be a second way to drive this tool, and the second set of rules is
// always the one that turns out to be wrong. It is also why everything a job
// does appears in the live log already: it goes through the same doors.
//
// IT GETS A PROMPT, which is the input it was run with. That is the whole shape
// of this: a job is the part that does not change, a prompt is the part that
// does, and the same job pointed at a different prompt is a different piece of
// work with the same machinery.
//
// IT GETS THE HARNESS, so a job can CHECK something rather than do something.
// The drills were that and nothing else, and they were awkward only because
// asserting was the sole thing a definition could do. `assert.refuses` is the
// one that matters: half of what is worth proving here is that the wrong thing
// is stopped, and a guard is not a guard until something has been refused by it.
//
// NOTHING UNAPPROVED RUNS. Checked here as well as at the action, because this
// is the door: a script is bytes on disk that anything could have written, and
// the hash it was approved against is of exactly those bytes.

const path = require('node:path')
const jobs = require('./jobs')
const { assert } = require('./harness')

// Loaded fresh every run.
//
// `require` would cache it, so editing a job and running it again would run the
// version from before the edit -- silently, and only until the dashboard
// restarted, which is the worst possible shape for that bug. The file is small
// and this happens once per run.
function load (file) {
  delete require.cache[require.resolve(file)]
  const fn = require(file)
  if (typeof fn !== 'function') {
    throw new Error('A job has to export a function: module.exports = async ({ okc, prompt, log }) => { ... }')
  }
  return fn
}

// One run of one job.
//
// `call` is the action table, handed in rather than required, so this cannot
// reach a private path to anything -- see server.js.
async function run ({ id, promptId, call, log, prompts }) {
  const job = jobs.get(id)
  if (!job) throw new Error(`There is no job called "${id}".`)
  if (!job.there) throw new Error(`"${job.name}" has no script. Its file is missing from the jobs folder.`)

  // The same refusal the action makes, said again where the bytes are.
  if (!job.approved) {
    throw new Error(job.lapsed
      ? `"${job.name}" has been edited since it was approved. Read it and approve it again before running it.`
      : `"${job.name}" is not approved. Nothing unapproved runs, whoever is asking.`)
  }

  // A JOB MAY RUN WITHOUT A PROMPT, and it is the caller's business rather than
  // this one's: a job that tidies branches needs no instruction, and refusing
  // one for lacking an input it never reads would be this deciding what a job is
  // for. A job that needs a prompt asks for one and says so when it is missing.
  let prompt = null
  if (promptId) {
    prompt = (prompts.all() || []).find(p => p.id === promptId) || null
    if (!prompt) throw new Error(`There is no prompt called "${promptId}".`)
    if (!prompt.approved) {
      throw new Error(`The prompt "${prompt.name}" is not approved. What a worker is told is read before it is sent, the same as the script that sends it.`)
    }
  }

  const said = []
  const say = line => {
    const text = String(line)
    said.push(text)
    log(text)
  }

  const started = Date.now()
  const fn = load(jobs.codePath(id))

  const api = {
    // Every action, with every refusal.
    okc: (action, args = {}) => call(action, args),

    // What it was run with. Frozen, because a job editing its own input would
    // make the record of what ran a guess.
    prompt: prompt
      ? Object.freeze({ id: prompt.id, name: prompt.name, text: prompt.text, hash: prompt.hash })
      : null,

    log: say,
    tags: [...(job.tags || [])],

    // A command on a machine, through the action rather than around it.
    shell: (name, command, opts = {}) => call('vmShellRun', { name, command, ...opts }),

    // Handing something back. A run's artifact is read from the branch, so this
    // is the other kind: a file the job produced that is worth keeping with it.
    artifact: (file, note) => call('capture', { html: null, png: null, file, note }),

    // For a job that CHECKS rather than does. The harness's assertions, without
    // its describe/it: a job is already the unit, and wrapping one in a suite of
    // one was most of what made the drills feel like scaffolding.
    assert,

    // What it is running as, so a job can say so in what it writes.
    job: Object.freeze({ id: job.id, name: job.name, hash: job.hash })
  }

  try {
    const result = await fn(api)
    return {
      ok: true,
      job: job.id,
      prompt: prompt ? prompt.id : null,
      seconds: Math.round((Date.now() - started) / 1000),
      said,
      result: result === undefined ? null : result
    }
  } catch (e) {
    // Reported rather than thrown away. A job that fails halfway has usually
    // done something already, and the lines it wrote before it fell over are
    // the only account of what.
    return {
      ok: false,
      job: job.id,
      prompt: prompt ? prompt.id : null,
      seconds: Math.round((Date.now() - started) / 1000),
      said,
      error: e.message
    }
  }
}

module.exports = { run }
