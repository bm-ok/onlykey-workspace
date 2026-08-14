'use strict'

// Running a job, which happens ON A MACHINE.
//
// This ran the script in the dashboard's own process once, and that was wrong in
// a way worth writing down: `require` gives a Node module everything Node has, so
// the API handed to a job was a convenience and never a sandbox. An approved job
// was arbitrary code running as the operator, on the operator's computer. It was
// demonstrated rather than argued -- a three-line job reported the host's name
// and the user it was running as.
//
// So a job goes where every other kind of work in this tool goes: to a machine
// that is disposable, rolled back to a snapshot when the work ends, and cannot
// reach the dashboard's actions at all.
//
// IT IS THE SAME MACHINERY AS A TASK, not a parallel one. `machines/dispatch.js`
// already writes a run directory, detaches the work, records a pid and a status,
// and keeps the log here afterwards. A job is a third mode beside `claude -p` and
// `bash`: `node`, with a small API written beside the script.
//
// NOTHING UNAPPROVED IS SENT. Checked here as well as at the action, because this
// is the door: the script is bytes on disk that anything could have written, and
// the hash it was approved against is of exactly those bytes.

const jobs = require('./jobs')

// One run of one job, on one machine.
//
// Everything it needs to reach a machine is handed in rather than required, so
// this file cannot find a private path to any of it -- the same reason a job
// gets a command on its PATH instead of an action table.
async function run ({ id, promptId, machine, token, prompts, dispatch, channel, base, folder, log }) {
  const job = jobs.get(id)
  if (!job) throw new Error(`There is no job called "${id}".`)
  if (!job.there) throw new Error(`"${job.name}" has no script. Its file is missing from the jobs folder.`)

  if (!job.approved) {
    throw new Error(job.lapsed
      ? `"${job.name}" has been edited since it was approved. Read it and approve it again before running it.`
      : `"${job.name}" is not approved. Nothing unapproved runs, whoever is asking.`)
  }

  // A JOB MAY RUN WITHOUT A PROMPT, and that is the caller's business rather than
  // this one's: a job that tidies branches needs no instruction, and refusing one
  // for lacking an input it never reads would be this deciding what a job is for.
  let prompt = null
  if (promptId) {
    prompt = (prompts.all() || []).find(p => p.id === promptId) || null
    if (!prompt) throw new Error(`There is no prompt called "${promptId}".`)
    if (!prompt.approved) {
      throw new Error(`The prompt "${prompt.name}" is not approved. What a worker is told is read before it is sent, the same as the script that sends it.`)
    }
  }

  // The run id says what kind it is, so a job is legible in `vmRuns` and in the
  // directory it leaves behind rather than looking like a task somebody named
  // oddly.
  const runId = `job-${id}-${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`

  log(`sending "${job.name}" to ${machine}${prompt ? ` with the prompt "${prompt.name}"` : ''}`)

  const out = await channel.run(machine, dispatch.script({
    id: runId,
    task: job.code,
    job: job.code,
    vm: machine,
    token,
    prompt: prompt ? { id: prompt.id, name: prompt.name, text: prompt.text } : null,
    folder,
    base
  }), { what: `dispatching the job ${id}`, timeout: 60000 })

  if (!/okc-dispatched/.test(out.output || '')) {
    throw new Error(`"${machine}" did not start it: ${String(out.output || '').trim().split('\n').pop() || 'it said nothing'}`)
  }

  return {
    run: runId,
    job: job.id,
    machine,
    prompt: prompt ? prompt.id : null,
    // FIRE AND FORGET, like every other run here. A job can take as long as it
    // takes, and holding the channel open for it would make starting one
    // indistinguishable from waiting for it. What it said is read afterwards
    // with `vmRunOutput`, which is where a task's output is read too.
    note: `Started. Read what it says with: okc.js vmRunOutput --name ${machine} --run ${runId}`
  }
}

module.exports = { run }
