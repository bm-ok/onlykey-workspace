'use strict'

// VirtualBox, and nothing about any project.
//
// This lives outside core/ deliberately. A virtual machine is not a
// project-specific idea; what was wrong before was VM lifecycle welded into the
// work loop so the tool could not be used without one. Here it is a thing you
// manage and the loop does not know it exists.
//
// Two lessons from the previous version are kept because both cost real debugging
// time: powered off is NOT the same as unlocked, and a single VirtualBox call is
// not a real attempt.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFile } = require('node:child_process')
const log = require('../core/log')

const OFF_STATES = new Set(['poweroff', 'aborted', 'saved', 'aborted-saved'])

// Installed but not on PATH is the normal case on Windows, so look where it
// actually is before giving up.
const CANDIDATES = [
  process.env.VBOX_MSI_INSTALL_PATH && path.join(process.env.VBOX_MSI_INSTALL_PATH, 'VBoxManage.exe'),
  process.env.VBOX_INSTALL_PATH && path.join(process.env.VBOX_INSTALL_PATH, 'VBoxManage.exe'),
  'C:\\Program Files\\Oracle\\VirtualBox\\VBoxManage.exe',
  '/usr/bin/VBoxManage',
  '/usr/local/bin/VBoxManage'
].filter(Boolean)

const there = p => { try { return fs.existsSync(p) } catch { return false } }
const exe = () => CANDIDATES.find(there) || 'VBoxManage'
const available = () => CANDIDATES.some(there)

function run (args, { timeout = 120000, quiet = false, tags = [] } = {}) {
  const to = log.on('vm', ...tags)
  if (!quiet) to.info(`VBoxManage ${args.join(' ')}`)
  return new Promise((resolve, reject) => {
    execFile(exe(), args, { timeout, maxBuffer: 1 << 24 }, (err, stdout, stderr) => {
      if (err) {
        const why = (stderr || stdout || err.message).trim()
        if (!quiet) to.bad(why.split('\n').slice(-2).join(' '))
        const e = new Error(why)
        e.stdout = stdout
        e.stderr = stderr
        return reject(e)
      }
      if (!quiet && stdout.trim()) to.out(stdout)
      // Normalised here, once. VBoxManage emits CRLF on Windows, and every parser
      // below splits on \n and anchors patterns with $ -- so a trailing \r made
      // `list vms` match nothing and every machine look as though it did not
      // exist. Fixing it per parser would mean remembering it per parser.
      resolve(stdout.replace(/\r\n/g, '\n'))
    })
  })
}

// VirtualBox loses races against its own session handling often enough that one
// attempt is not a real attempt.
async function retrying (fn, { attempts = 6, delay = 3000, what = 'operation', tags = [] } = {}) {
  let last
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      last = err
      const locked = /locked|INVALID_OBJECT_STATE|is not locked|being locked/i.test(`${err.stderr || ''}${err.message || ''}`)
      if (!locked || i === attempts) throw err
      log.on('vm', ...tags).warn(`${what} attempt ${i} hit a session lock; retrying in ${delay / 1000}s`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw last
}

// ---- reading ----------------------------------------------------------

const names = text => text.split('\n')
  .map(l => (l.match(/^"(.*)"\s+\{(.+)\}$/) || []).slice(1))
  .filter(m => m.length)
  .map(([name, uuid]) => ({ name, uuid }))

const listAll = async () => names(await run(['list', 'vms'], { quiet: true }))
const runningAll = async () => names(await run(['list', 'runningvms'], { quiet: true }))

async function info (name) {
  const out = await run(['showvminfo', name, '--machinereadable'], { quiet: true })
  const map = {}
  for (const line of out.split('\n')) {
    const m = /^"?([^"=]+)"?="?(.*?)"?$/.exec(line.trim())
    if (m) map[m[1]] = m[2]
  }
  return map
}

const exists = async name => (await listAll()).some(v => v.name === name)
const state = async name => { try { return (await info(name)).VMState || 'unknown' } catch { return 'missing' } }
const isOff = async name => OFF_STATES.has(await state(name))

async function waitForState (name, ok, { timeout = 180000, interval = 2000 } = {}) {
  const deadline = Date.now() + timeout
  for (;;) {
    if (ok(await state(name))) return true
    if (Date.now() > deadline) return false
    await new Promise(r => setTimeout(r, interval))
  }
}
const waitUntilOff = (name, opts) => waitForState(name, s => OFF_STATES.has(s) || s === 'missing', opts)

// Powered off is not unlocked. VirtualBox holds the session for a moment after a
// VM stops, and while it is held `unregistervm` fails with
// VBOX_E_INVALID_OBJECT_STATE. Waiting on the power state alone races it.
// POWERED OFF IS NOT READY, and this is the wait every caller that is about to
// touch a machine's DISK has to do first.
//
// VirtualBox reports a machine as `poweroff` while it is still holding the
// session, and the operations that need the disk to itself -- restoring,
// snapshotting, deleting a snapshot -- are not refused during that window so
// much as raced. A restore issued into it has been observed to leave a machine
// that starts to a black screen and never boots: nothing failed, nothing was
// logged, and the disk was simply not what anybody thought.
//
// The window is a few seconds. Asking is still not enough on its own -- see
// LEARNED -- so callers wait AND retry: this closes most of it, and `retrying`
// covers what is left.
async function waitUntilUnlocked (name, { timeout = 60000, interval = 2000 } = {}) {
  const deadline = Date.now() + timeout
  const to = log.on('vm', name)
  for (;;) {
    let session
    try {
      session = (await info(name)).SessionState || 'Unlocked'
    } catch {
      return // already gone, which is the outcome we wanted
    }
    if (session === 'Unlocked') return
    if (Date.now() > deadline) {
      to.warn(`session still "${session}" after ${Math.round(timeout / 1000)}s; trying anyway`)
      return
    }
    to.info(`waiting for the VirtualBox session to unlock (currently "${session}")`)
    await new Promise(r => setTimeout(r, interval))
  }
}

// ISOs VirtualBox already knows about, so a person picks one instead of typing a
// path.
async function isos () {
  if (!available()) return []
  const out = await run(['list', 'dvds'], { quiet: true })
  return out.split('\n')
    .map(l => (/^Location:\s*(.+)$/.exec(l.trim()) || [])[1])
    .filter(l => l && /\.iso$/i.test(l) && there(l))
    .map(location => ({ location, name: path.basename(location) }))
}

// Which host adapters can be bridged, and what address a guest would reach us
// on. A guest cannot use 127.0.0.1 to reach the host.
async function bridges () {
  if (!available()) return []
  const out = await run(['list', 'bridgedifs'], { quiet: true })
  const found = []
  let current = null
  for (const raw of out.split('\n')) {
    const m = /^([A-Za-z]+):\s*(.*)$/.exec(raw.trim())
    if (!m) continue
    if (m[1] === 'Name') {
      if (current) found.push(current)
      current = { name: m[2].trim() }
    } else if (current) {
      if (m[1] === 'IPAddress') current.ip = m[2].trim()
      if (m[1] === 'Status') current.status = m[2].trim()
    }
  }
  if (current) found.push(current)
  return found
}

// The address a guest must use to reach this dashboard.
async function hostAddress () {
  const up = (await bridges()).filter(b => b.status === 'Up' && b.ip && !b.ip.startsWith('169.254'))
  if (up.length) return up[0].ip
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const e of entries || []) {
      if (e.family === 'IPv4' && !e.internal && !e.address.startsWith('169.254')) return e.address
    }
  }
  throw new Error('Could not work out this machine\'s address on the network, so a guest would have no way to reach it.')
}

// ---- switching on and off --------------------------------------------

// Retried, because starting is the operation most likely to arrive while
// VirtualBox is still holding a session it has not admitted to.
//
// It follows a stop or a restore almost every time -- that is what the queue
// does before every task -- and a lock released "after the command that took it
// has returned" means the very next line is the worst moment to ask. Waiting for
// SessionState is not enough on its own: it has read Unlocked 100ms before a
// start was refused for being locked. So both, which is the same conclusion this
// file already reached once for snapshots.
const start = (name, type = 'gui') =>
  retrying(() => run(['startvm', name, '--type', type], { tags: [name] }),
    { what: 'starting the machine', tags: [name] })

// The button, not the plug. A guest mid-write should be allowed to finish;
// pulling power is a separate, explicit choice.
const stop = (name, force = false) =>
  run(['controlvm', name, force ? 'poweroff' : 'acpipowerbutton'], { tags: [name] })

// What the machine has on screen, right now.
//
// The one thing that answers a question nothing else here can: an install says
// nothing for twenty-five minutes, and until it finishes there is no agent, no
// log line and no way to tell "working" from "stuck on a prompt nobody is
// watching". Before this, the only way to look was to open VirtualBox by hand --
// which is exactly the reaching-around this app exists to remove.
//
// Only while it is running: there is no screen otherwise, and VirtualBox says so
// in its own words, which are worse than these.
async function screenshot (name, file) {
  if (await isOff(name)) {
    throw new Error(`"${name}" is not running, so it has nothing on screen.`)
  }
  await run(['controlvm', name, 'screenshotpng', file], { quiet: true, tags: [name] })
  return file
}

// ---- snapshots -------------------------------------------------------

async function snapshots (name) {
  try {
    const out = await run(['snapshot', name, 'list', '--machinereadable'], { quiet: true })
    const list = []
    for (const line of out.split('\n')) {
      const m = /^SnapshotName[^=]*="(.*)"$/.exec(line.trim())
      if (m) list.push({ name: m[1] })
    }
    const current = (out.match(/^CurrentSnapshotName="(.*)"$/m) || [])[1]
    return { snapshots: list, current: current || null }
  } catch {
    // No snapshots at all is an error from VBoxManage, not a problem here.
    return { snapshots: [], current: null }
  }
}

const takeSnapshot = (name, snapshot, description = '') => run([
  'snapshot', name, 'take', snapshot, ...(description ? ['--description', description] : [])
], { tags: [name], timeout: 300000 })

const restoreSnapshot = (name, snapshot) => run([
  'snapshot', name, 'restore', snapshot
], { tags: [name], timeout: 300000 })

// Remove a snapshot, merging its disk back into the one before it.
//
// Long enough to need its own timeout: the merge is proportional to how much
// changed while that snapshot was the current one, and the default would give up
// part way through a merge -- which is the one moment a disk should not be left
// alone.
const deleteSnapshot = (name, title) =>
  retrying(() => run(['snapshot', name, 'delete', title], { timeout: 900000, tags: [name] }),
    { what: 'deleting a snapshot', tags: [name] })

// ---- removing --------------------------------------------------------

// Everything the VM owns, gone, media included -- otherwise practising
// provisioning leaves a trail of orphaned disks.
async function destroy (name) {
  const to = log.on('vm', name)
  if (!await exists(name)) {
    to.info(`${name} does not exist in VirtualBox; nothing to delete`)
    return { existed: false }
  }
  // Asked before it is unregistered, because afterwards there is nothing left to
  // ask.
  const folder = await machineFolder(name)

  const s = await state(name)
  if (!OFF_STATES.has(s)) {
    to.warn(`powering ${name} off (was "${s}")`)
    await stop(name, true).catch(() => {})
    await waitUntilOff(name, { timeout: 120000 })
  }
  await waitUntilUnlocked(name)
  await retrying(() => run(['unregistervm', name, '--delete'], { timeout: 180000, tags: [name] }),
    { what: 'unregistervm', tags: [name] })

  const left = folder ? sweepUp(folder, to) : []
  to.good(`${name} and its disks are gone.`)
  return { existed: true, folder, left }
}

const machineFolder = async name => {
  try { return path.dirname((await info(name)).CfgFile || '') || null } catch { return null }
}

// What `unregistervm --delete` does not take with it.
//
// It removes the disks and the .vbox file, and leaves the machine's folder
// holding whatever else ended up there -- for an unattended install that is the
// generated seed, the grub config, the aux ISO and `vboxpostinstall.sh`, which
// contains the whole bootstrap command line. So "and its disks are gone" was
// true and the folder stayed behind, accumulating one set per machine ever
// built.
//
// That is worth more than tidiness: the bootstrap command is the one place
// anything can be handed to a machine that has nothing yet, so whatever is put
// there outlives the machine unless something removes it.
//
// DELIBERATELY NARROW. Only files VirtualBox generated for this machine, and
// only then the folder itself if nothing else is in it. Anything unrecognised
// is left alone and named in the log -- deleting a directory is not a thing to
// be approximately right about, and somebody may have put a file in there.
const GENERATED = /^(Unattended-.*|.*\.vbox(-prev)?|.*\.viso)$/i

function sweepUp (folder, to) {
  let names
  try { names = fs.readdirSync(folder) } catch { return [] }

  for (const entry of names) {
    const full = path.join(folder, entry)
    try {
      if (entry === 'Logs' && fs.statSync(full).isDirectory()) { fs.rmSync(full, { recursive: true, force: true }); continue }
      if (GENERATED.test(entry) && fs.statSync(full).isFile()) fs.unlinkSync(full)
    } catch { /* named below if it is still there */ }
  }

  let left = []
  try { left = fs.readdirSync(folder) } catch { return [] }
  if (!left.length) {
    try { fs.rmdirSync(folder); return [] } catch { /* said below */ }
  }
  if (left.length) to.warn(`${folder} still holds ${left.join(', ')} — not this app's to delete, so it was left`)
  return left
}

module.exports = {
  available, exe, run, retrying,
  listAll, runningAll, info, exists, state, isOff,
  waitForState, waitUntilOff, waitUntilUnlocked,
  isos, bridges, hostAddress,
  start, stop, screenshot, snapshots, takeSnapshot, restoreSnapshot, deleteSnapshot, destroy,
  OFF_STATES
}
