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
// THE THREE FORMS, MEASURED ON ONE CLEAN START RATHER THAN ASSUMED:
//
//   --enable-logging=stderr           5 lines here, including the console line
//   --enable-logging                  0 lines here. Same content, written to
//                                     %LOCALAPPDATA%\okc-dashboard\User Data\
//                                     chrome_debug.log instead
//   --enable-logging=stderr --v=1     342 lines here, 278 of them Chromium's own
//                                     internals: 72 about Chromecast socket
//                                     probing, 50 about the segmentation
//                                     platform, 44 about an identity manager
//                                     this app does not use
//
// So `=stderr` is not decoration. Without it the output is identical and lands
// in a file nobody is watching, which for a backgrounded process is silence.
// And `--v=1` is the next flag anybody reaches for: it does not add anything
// about THIS app, it adds Chromium talking about itself, and the line that
// matters is then somewhere in three hundred. Add it by hand for one run if the
// browser process itself is what is being chased.
// --remote-debugging-port=0 is what makes "Inspect main.js" on the tray work.
// main.js runs in a background page, which nw's own window API cannot reach, so
// the only way in is chromium's debugger. 0 means chromium picks a free port and
// writes it to DevToolsActivePort in the user data dir, so nothing is pinned and
// nothing collides; it listens on loopback only. Pass your own
// --remote-debugging-port to override it.
const FLAGS = ['--enable-logging=stderr']

// LETTING GO OF THE TERMINAL.
//
// This used to hold the shell for as long as the app ran, which is wrong for
// something you leave open all day -- and doubly so now that closing the window
// only hides it. So the child is detached and this process exits immediately.
//
// The output still matters (see above), so it goes to nw.log rather than
// nowhere. `--attach` keeps the old behaviour when you want to watch a run
// happen: the app stays in the foreground and its output on your screen.
//
// KNOWING IT IS ALREADY UP.
//
// NW.js is single instance: a second launch is handed to the running app,
// which brings its window back (main.js listens for App.on('open')). But that
// handoff happens inside the nw binary, where this script cannot see it -- the
// only sign is a line in the log of the process that is exiting. So main.js
// writes .nw-instance.json with its pid and url, and this reads it. A stale
// file from a hard kill is caught by signalling the pid, which throws when
// nothing is there.
const INSTANCE_FILE = path.join(APP, '.nw-instance.json')
const LOG_FILE = path.join(APP, 'nw.log')

function runningInstance () {
  try {
    const info = JSON.parse(fs.readFileSync(INSTANCE_FILE, 'utf8'))
    process.kill(info.pid, 0) // does not kill, just asks whether it is there
    return info
  } catch (err) {
    return null // no file, unreadable, or the pid is gone
  }
}

const attach = process.argv.includes('--attach')

// THREE WAYS TO START THE SAME APP.
//
//   (nothing)   the source tree. webpack builds in memory, both halves reload
//   --build     build/app: the compiled main.bin, run by the sdk runtime. no
//               executable yet, so its console is still audible and the
//               devtools are still there. what `npm run build` leaves behind.
//   --package   build/out: the executable nw-builder produced. the normal
//               flavour, so no devtools — this is what a user would run.
//
// Each one runs strictly later output than the one above it, so a thing that
// works in the first and not the third narrows to the step between them.
const mode = process.argv.includes('--package') ? 'package'
  : process.argv.includes('--build') ? 'build'
    : 'source'

const STAGE = path.join(APP, 'build', 'app')
const OUT = path.join(APP, 'build', 'out')

// the packaged app is its own executable, so it is launched instead of the
// runtime rather than handed to it
function packagedBinary () {
  if (!fs.existsSync(OUT)) return null
  if (process.platform === 'darwin') {
    const app = fs.readdirSync(OUT).find(f => f.endsWith('.app'))
    return app ? path.join(OUT, app, 'Contents', 'MacOS', path.basename(app, '.app')) : null
  }
  const exe = fs.readdirSync(OUT).find(f =>
    process.platform === 'win32'
      ? f.endsWith('.exe') && !f.startsWith('notification_helper')
      : !f.includes('.') && fs.statSync(path.join(OUT, f)).isFile())
  return exe ? path.join(OUT, exe) : null
}

if (mode === 'build' && !fs.existsSync(path.join(STAGE, 'main.bin'))) {
  console.error('build/app is not staged. run:  npm run build')
  process.exit(1)
}
if (mode === 'package' && !packagedBinary()) {
  console.error('build/out has no application in it. run:  npm run dist')
  process.exit(1)
}

const launcher = mode === 'package' ? packagedBinary() : binary
const target = mode === 'build' ? STAGE : mode === 'source' ? APP : null

const passthrough = process.argv.slice(2)
  .filter(a => a !== '--attach' && a !== '--build' && a !== '--package')
const debugging = passthrough.some(a => a.startsWith('--remote-debugging-port'))
const args = [
  ...(target ? [target] : []),
  ...FLAGS,
  ...(debugging ? [] : ['--remote-debugging-port=0']),
  ...passthrough
]

const running = runningInstance()
if (running) {
  console.log(`already running (pid ${running.pid}) at ${running.url}`)
  console.log('bringing its window to the front')
} else {
  console.log(`launching ${path.relative(APP, launcher)}  (${mode})`)
}

if (attach) {
  const child = spawn(launcher, args, { stdio: 'inherit' })
  child.on('exit', code => process.exit(code === null ? 1 : code))
} else {
  const log = fs.openSync(LOG_FILE, 'a')
  const child = spawn(launcher, args, { detached: true, stdio: ['ignore', log, log] })
  child.unref()
  if (!running) console.log(`logging to ${path.relative(APP, LOG_FILE)}  (--attach to watch it live)`)
}
