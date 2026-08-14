'use strict'

// The three lines that start a job. This runs ON THE MACHINE.
//
// Copied into a run's directory beside the job and its API. Separate from both
// because it is the only part that is the same for every job, and because a
// failure here -- a job that exports the wrong thing, a job that throws -- has to
// be reported as a run that failed rather than as a machine that went quiet.

const path = require('path')

const api = require(path.join(__dirname, 'api.js'))
const job = require(path.join(__dirname, 'job.js'))

if (typeof job !== 'function') {
  console.error('okc: a job has to export a function — module.exports = async (api) => { ... }')
  process.exit(2)
}

Promise.resolve()
  .then(() => job(api))
  // Whatever it returns is written where the run's output is read, so a job can
  // answer rather than only act.
  .then(out => { if (out !== undefined) console.log('okc-result ' + JSON.stringify(out)) })
  .catch(e => {
    // The stack, not just the message. A job is code somebody wrote and will
    // have to fix, and the line it failed on is the whole of what they need.
    console.error(e && e.stack ? e.stack : String(e))
    process.exit(1)
  })
