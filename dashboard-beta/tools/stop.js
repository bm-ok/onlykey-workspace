'use strict'

// Close the app, and wait until it is actually closed.
//
// WAITING IS THE POINT, which is why this is a script and not one line in
// package.json. Asking a process to go and returning immediately leaves the
// caller believing it is gone while it still holds the port, the instance file
// and the webpack watchers — and `npm run restart` started right then loses a
// race it does not know it is in.
//
// HOW IT KNOWS THERE IS ANYTHING TO CLOSE. main.js writes .nw-instance.json
// with its pid and url while it runs, and takes it away on teardown. A file
// left behind by a hard kill is not trusted on its own: signalling the pid with
// 0 asks the operating system whether anything is actually there, and throws
// when it is not. Same check the launcher makes, for the same reason.
//
// ALREADY GONE IS NOT A FAULT. Somebody typing "stop" wants it stopped, and it
// being stopped already is that. This says so and exits 0.
//
// WHY A KILL RATHER THAN A POLITE ASK. The app has lifecycle.shutdown(), which
// runs every plugin's onDestroy in reverse — but nothing outside the process
// can reach it: there is no route and no socket event for quitting, on purpose,
// since a running app should not offer the network a way to close it. So this
// signals the process instead, and the cost is that teardown does not run: the
// instance file is left behind, which is why it is removed here afterwards.

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const APP = path.resolve(__dirname, '..')
const INSTANCE_FILE = path.join(APP, '.nw-instance.json')

const GONE_BY = 15000
const EVERY = 200

const sleep = ms => new Promise(r => setTimeout(r, ms))

const alive = pid => {
  try { process.kill(pid, 0); return true } catch { return false }
}

function running () {
  try {
    const info = JSON.parse(fs.readFileSync(INSTANCE_FILE, 'utf8'))
    return alive(info.pid) ? info : null
  } catch {
    return null // no file, unreadable, or the pid is gone
  }
}

function forget () {
  try { fs.unlinkSync(INSTANCE_FILE) } catch { /* never written, or already gone */ }
}

// The top of the nw process tree that `pid` sits in.
//
// Walks up while the parent is still the same executable, so it stops at the
// browser process rather than climbing out into whatever launched it — the
// terminal, or an editor, which must not be killed.
//
// FALLS BACK TO THE PID IT WAS GIVEN. On a machine where the process list
// cannot be read this returns the child, which is what this did before and is
// wrong-but-usually-works rather than a hard failure.
function rootOf (pid) {
  if (process.platform !== 'win32') return pid
  try {
    const raw = execFileSync('powershell', ['-NoProfile', '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress'
    ], { encoding: 'utf8', windowsHide: true })

    const rows = JSON.parse(raw)
    const by = new Map(rows.map(r => [r.ProcessId, r]))
    let at = by.get(pid)
    if (!at) return pid

    const name = at.Name
    // guarded against a cycle, which cannot happen and would hang if it did
    for (let i = 0; i < 20; i++) {
      const up = by.get(at.ParentProcessId)
      if (!up || up.Name !== name) break
      at = up
    }
    return at.ProcessId
  } catch {
    return pid
  }
}

async function main () {
  const it = running()
  if (!it) {
    // The file may still be here and stale. Take it away, or the launcher pays
    // a syscall to work that out on every start.
    if (fs.existsSync(INSTANCE_FILE)) {
      forget()
      console.log('not running — cleared a stale .nw-instance.json')
    } else {
      console.log('not running')
    }
    return
  }

  // THE PID IN THE FILE IS NOT THE APP. It is `process.pid` as seen from
  // main.js, and under nw that is the node context — a CHILD of the browser
  // process, alongside a renderer per window and several helpers. Seven
  // processes for this app on a plain start, and the file names the wrong one
  // for the purpose of closing it.
  //
  // Killing that child usually takes the rest down with it, because nw has no
  // reason to live once its node context is gone — which is exactly why this
  // looked as though it worked. It is a race, and losing it leaves the browser
  // process up holding nw's single-instance lock: the next launch is then handed
  // to the OLD app, which is a restart that silently does not restart.
  //
  // So walk up to the root of the nw tree first and kill that.
  const root = rootOf(it.pid)
  console.log(`closing pid ${root}${root !== it.pid ? ` (the app; ${it.pid} is its node context)` : ''}${it.url ? ` at ${it.url}` : ''}...`)

  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(root), '/T', '/F'], { stdio: 'ignore' })
    } else {
      process.kill(root, 'SIGTERM')
    }
  } catch (e) {
    // It may have gone between the check above and here, which is a race this
    // cannot avoid and does not need to: the wait below settles it either way.
  }

  const until = Date.now() + GONE_BY
  while ((alive(it.pid) || alive(root)) && Date.now() < until) await sleep(EVERY)

  if (alive(it.pid)) {
    console.error(`pid ${it.pid} is still there after ${GONE_BY / 1000}s`)
    process.exit(1)
  }

  forget()
  console.log('closed')
}

main().catch(e => {
  console.error(e && e.message || e)
  process.exit(1)
})
