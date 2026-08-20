'use strict'

// Close the app, wait for it to actually be gone, and start it again.
//
// The node half is loaded once at startup — main.js and everything in
// src/app/<plugin>/main.js — so a change to any of those is invisible until the
// app restarts. The window and the server half reload on save and need none of
// this; this is for the third one, the process around the app.
//
// TWO SCRIPTS, RUN IN ORDER, RATHER THAN ONE THAT DOES BOTH. stop.js already
// has to know how to tell whether the app is up and how to wait for it to go —
// that is its whole job. Copying that here would be a second answer to the same
// question, and the two would disagree the first time either changed.
//
// AND STOP IS NOT ALLOWED TO FAIL QUIETLY. If it cannot get the old one to go,
// starting a new one is the worst outcome available: two apps, one instance
// file, and a port held by whichever won. So a non-zero exit stops this here.

const path = require('node:path')
const { spawnSync } = require('node:child_process')

const TOOLS = __dirname

function run (script, args = []) {
  return spawnSync(process.execPath, [path.join(TOOLS, script), ...args], { stdio: 'inherit' })
}

const stopped = run('stop.js')
if (stopped.status !== 0) {
  console.error('not starting a new one: the old one is still there')
  process.exit(stopped.status === null ? 1 : stopped.status)
}

// everything after `npm run restart --` is handed on, so --attach, --build and
// --package all work the same way they do on `npm start`
const started = run('nw.js', process.argv.slice(2))
process.exit(started.status === null ? 1 : started.status)
