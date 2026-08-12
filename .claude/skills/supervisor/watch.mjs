// Watching a runner, so the supervisor is not the thing doing the polling.
//
// One line out per thing worth knowing, forever, until stopped. Meant to be
// handed to the Monitor tool with `persistent: true` -- then events arrive as
// notifications the moment they happen, instead of a timer that mostly wakes
// into nothing.
//
// STRICTLY READ-ONLY. Every call it makes is a reading action. It never
// dispatches, never restores, never touches a machine's disk.
//
// It goes through okc.js like everything else. Nothing here talks to VirtualBox
// or to a guest directly, so a machine's state has exactly one source.
//
// SILENCE IS NOT SUCCESS, and that shaped what it emits. A watcher that printed
// only progress would look identical whether the work was running, the machine
// had fallen off the network, or the run had died in its first second. So a lost
// channel, a stopped machine, a finished run with a non-zero status and a
// session that has gone quiet for too long are all events, not absences.

import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OKC = path.resolve(HERE, '..', '..', '..', 'dashboard', 'tools', 'okc.js')

const argv = process.argv.slice(2)
const NAME = argv.find(a => !a.startsWith('--'))
const flag = (k, d) => {
  const i = argv.indexOf(`--${k}`)
  return i === -1 ? d : argv[i + 1]
}

if (!NAME) {
  console.error('usage: node watch.mjs <machine> [--every 30] [--quiet-after 900] [--session <id>]')
  process.exit(2)
}

const EVERY = Number(flag('every', 30)) * 1000
const QUIET_AFTER = Number(flag('quiet-after', 900))
let session = flag('session', null)

const say = line => process.stdout.write(line + '\n')

// A reading action, as json. A failure is returned rather than thrown: the
// dashboard being restarted mid-watch is a normal event on a machine somebody is
// also working on, and it should not end the watch.
function ask (action, args = []) {
  return new Promise(resolve => {
    execFile(process.execPath, [OKC, action, '--json', ...args], { timeout: 120000, maxBuffer: 1 << 24 },
      (err, stdout) => {
        if (err && !stdout) return resolve({ ok: false, error: (err.message || '').split('\n')[0] })
        try { resolve(JSON.parse(stdout)) } catch { resolve({ ok: false, error: 'unreadable answer' }) }
      })
  })
}

const clock = at => {
  // Local, not the transcript's UTC, so a report lines up with what the user
  // watched happen and with `git log`.
  try { return new Date(at).toLocaleTimeString() } catch { return '--:--:--' }
}

// What is worth interrupting somebody for. Everything else a runner does is
// read back on demand with vmSessionTail; this is the subset that means
// something has landed, finished, broken, or stopped.
const LOUD = new Set(['asked', 'wrote', 'edited'])
const VERDICT = /(\bFAIL(ED)?\b|\berror\b|Error:|Traceback|segfault|\bexit=[1-9]|\bpassing\b|\bfailing\b|\bok\b)/i

let bookmark = Number(flag('since', 0))
let connected = null
let runs = new Map()
let quiet = false
let first = true

async function tick () {
  // --- is it even there ---------------------------------------------------
  const list = await ask('vmList')
  if (!list || list.ok === false || !Array.isArray(list.vms)) {
    say(`WATCH  cannot reach the dashboard (${(list && list.error) || 'no answer'})`)
    return
  }
  const vm = list.vms.find(v => v.name === NAME)
  if (!vm) { say(`GONE   "${NAME}" is not a machine this dashboard knows about`); return }

  if (vm.connected !== connected) {
    if (connected !== null || !vm.connected) {
      say(vm.connected ? `UP     ${NAME} is dialled in` : `DOWN   ${NAME} is not dialled in (state: ${vm.state})`)
    }
    connected = vm.connected
  }
  if (!vm.connected) return

  // --- runs that ended ----------------------------------------------------
  const r = await ask('vmRuns', ['--name', NAME])
  for (const run of (r && r.runs) || []) {
    const was = runs.get(run.id)
    runs.set(run.id, run.state)
    if (first) continue
    if (was === undefined && run.state === 'running') { say(`START  run ${run.id}`); continue }
    if (was === run.state || run.state === 'running') continue
    // `exit` is written only when the run ends, so a zero here is a real zero
    // and not a default -- which matters, because a default would read as
    // success for every run that died before it could write anything.
    say(run.exit === 0
      ? `DONE   run ${run.id} finished cleanly`
      : `FAILED run ${run.id} ended with status ${run.exit}`)
  }

  // --- which session ------------------------------------------------------
  if (!session) {
    const s = await ask('vmSessions', ['--name', NAME])
    const newest = ((s && s.sessions) || [])[0]
    if (!newest) return
    session = newest.id
    say(`SESSION ${session.slice(0, 8)}  ${newest.title || '(untitled)'}  in ${newest.cwd}`)
  }

  // --- what it has done since last time -----------------------------------
  const t = await ask('vmSessionTail', ['--name', NAME, '--session', session, '--since', String(bookmark), '--limit', '60'])
  if (!t || t.ok === false) return
  bookmark = t.bookmark

  for (const e of t.entries || []) {
    if (e.kind === 'asked') { say(`ASKED  ${clock(e.at)}  ${e.text}`); continue }
    if (e.kind === 'result' && VERDICT.test(e.text)) { say(`RESULT ${clock(e.at)}  ${e.text}`); continue }
    if (LOUD.has(e.kind)) say(`${e.kind.toUpperCase().padEnd(6)} ${clock(e.at)}  ${e.text}`)
  }
  if (t.more) say(`WATCH  ${t.more} more entries were skipped; read them with vmSessionTail --since ${t.from}`)

  // --- has it stopped saying anything -------------------------------------
  const idle = t.session && t.session.idle
  if (typeof idle === 'number') {
    if (idle > QUIET_AFTER && !quiet) {
      quiet = true
      say(`QUIET  ${NAME} has said nothing for ${Math.round(idle / 60)} minutes -- finished, waiting, or stuck`)
    } else if (idle < QUIET_AFTER && quiet) {
      quiet = false
      say(`WOKE   ${NAME} is talking again`)
    }
  }
  first = false
}

for (;;) {
  try { await tick() } catch (e) { say(`WATCH  ${(e && e.message) || e}`) }
  await new Promise(r => setTimeout(r, EVERY))
}
