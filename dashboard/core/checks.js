'use strict'

// Runs what an ecosystem declared, in the repo it is about, and reports pass or
// fail.
//
// This is the whole seam where a project's own knowledge lives. The ecosystem
// says what to run and what it means; the core learns only whether it passed. It
// does not know what is being checked and must never branch on it -- an ecosystem
// with nothing to check declares nothing, and the concept disappears instead of
// needing an answer that does not apply.

const { execFile } = require('node:child_process')

const shell = (script, cwd) => new Promise((resolve, reject) => {
  const win = process.platform === 'win32'
  execFile(win ? 'cmd' : 'sh', win ? ['/c', script] : ['-c', script],
    { cwd, maxBuffer: 1 << 22 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || stdout || err.message).trim()))
      resolve(stdout.trim())
    })
})

// A failing check is reported, never thrown. It is information for the reviewer,
// not an error in the tool -- deciding what a red check means is the reviewer's
// job and the whole reason a person is in this loop.
async function run (list, cwd) {
  const out = []
  for (const c of list || []) {
    try {
      out.push({ name: c.name, ok: true, output: (await shell(c.run, cwd)).slice(0, 4000) })
    } catch (e) {
      out.push({ name: c.name, ok: false, output: String(e.message).slice(0, 4000), why: c.why || '' })
    }
  }
  return out
}

module.exports = { run }
