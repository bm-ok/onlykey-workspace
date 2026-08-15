'use strict'

// Launches the app in NW.js.
//
// The npm `nw` package extracts to a versioned directory (nwjs-sdk-v0.114.1-...)
// and its own shim looks for a plain `nwjs/` that is not always there. Rather
// than pin a path that changes on every upgrade, find the binary.

const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const NW_ROOT = path.resolve(__dirname, '..', 'node_modules', 'nw')
const APP = path.resolve(__dirname, '..')
const BINARIES = { win32: 'nw.exe', darwin: 'nwjs.app/Contents/MacOS/nwjs', linux: 'nw' }

function findBinary () {
  const name = BINARIES[process.platform] || 'nw'
  if (!fs.existsSync(NW_ROOT)) throw new Error('NW.js is not installed. Run:  npm install')
  for (const dir of ['nwjs', ...fs.readdirSync(NW_ROOT).filter(d => d.startsWith('nwjs'))]) {
    const candidate = path.join(NW_ROOT, dir, name)
    if (fs.existsSync(candidate)) return candidate
  }
  throw new Error(`Could not find ${name} under ${NW_ROOT}`)
}

let binary
try {
  binary = findBinary()
} catch (err) {
  console.error(`\n${err.message}\n`)
  process.exit(1)
}

// TWO PROCESSES, AND ONLY ONE OF THEM WAS AUDIBLE.
//
// NW.js runs a node context (`node-main`, this app's main.js) and a renderer
// (the window, ui/*.js). `stdio: 'inherit'` was already here, so anything the
// node side printed came through — and the renderer's did not, because Chromium
// keeps console output for its devtools unless told otherwise. So a window that
// threw on load looked exactly like a window that had nothing to draw: a blank
// panel and silence, which is the ambiguity that has cost the most time here.
//
// `--enable-logging=stderr` is what routes it out. Every console.* and every
// uncaught error in the page arrives as
//
//     [INFO:CONSOLE(412)] "message", source: file:///.../ui/tasks.js (412)
//
// which is a file and a line number, from outside, with no window open to look
// at. Started in the background, that lands in the log whatever started it is
// writing — so `npm start` and `npm run restart` both keep it.
//
// `--enable-logging` WITHOUT `=stderr` IS THE ONE THAT LOOKS RIGHT AND IS NOT.
// It writes to a chrome_debug.log in the user data directory rather than to the
// pipe, so the stdio inherited above stays empty and the output lands somewhere
// nobody is reading.
//
// AND NOT `--v=1`, which is the next thing anybody reaches for. Measured rather
// than assumed: a clean start goes from 5 lines to 342, of which 278 are
// Chromium's own internals — 72 about Chromecast socket probing, 50 about the
// segmentation platform, 44 about an identity manager this app does not use.
// The line that matters is in there, and finding it is the problem this flag was
// supposed to solve. Add it by hand for one run if something in the browser
// process itself is being chased; it is not worth carrying.
const FLAGS = ['--enable-logging=stderr']

console.log(`launching ${path.relative(APP, binary)}`)
const child = spawn(binary, [APP, ...FLAGS, ...process.argv.slice(2)], { stdio: 'inherit' })
child.on('exit', code => process.exit(code === null ? 1 : code))
