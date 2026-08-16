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

// ---- one at a time ------------------------------------------------------
//
// EVERY VBoxManage CALL IN THIS APP GOES THROUGH `run`, AND THEY GO ONE AT A
// TIME. VBoxSVC is a single service with a session model, and asking it several
// things at once is not a way of getting several answers faster -- it is a way
// of getting a locked-up service. That has now happened: `list vms` stopped
// answering at all, `startvm` failed, and it took closing every VirtualBox
// process and restarting the service to get it back.
//
// What got it there was ordinary use, not abuse. The window polls `vmList`,
// which is four processes with two machines -- `list vms`, `list runningvms`
// and a `showvminfo` each -- and the command line calls the same action into
// the same process with none of the window's pacing. Two callers, no coordination
// between them, and a service that is slow precisely when it is unwell: every
// caller that arrives while it is struggling adds another process, for up to the
// two minutes of the default timeout, which is how a slow service becomes a
// stuck one.
//
// A STRICTLY SERIAL QUEUE IS THE WHOLE FIX, and the cost is stated plainly: a
// read can wait behind a write, and a write here can be five minutes
// (`closemedium --delete` on a large disk, `unattended install`). The machines
// panel goes stale for that long. That is the correct price -- it is one caller
// waiting rather than twenty asking -- and it is bounded, because the window's
// draw loop already refuses to overlap itself, so at most one read queues behind
// a write rather than one per tick.
//
// IDENTICAL READS IN FLIGHT ARE ONE READ. Without this a serial queue would just
// convert "four at once" into "four in a row", which is the same work spread
// thinner. `list vms` asked by the window and by the terminal in the same second
// is one question, and the second caller gets the first one's answer.
let chain = Promise.resolve()
let waiting = 0
let lastSlow = 0

// Commands that only ASK. Everything else is assumed to change something, and
// changing something makes every remembered answer stale -- so the memo below is
// dropped after any of them, in the same shape as `forgetRefs` in
// repos/branches.js, and for the same reason.
const asks = args =>
  args[0] === 'list' ||
  args[0] === 'showvminfo' ||
  args[0] === 'getextradata' ||
  args[0] === 'guestproperty' ||
  (args[0] === 'snapshot' && args[2] === 'list')

// Long enough to collapse a burst of callers arriving together, short enough
// that nothing observes a state it could have acted on. `waitForState` polls at
// two seconds, so it never sees an answer older than its own interval.
const ASKED_MS = 1200
const asked = new Map()

function run (args, opts = {}) {
  if (asks(args)) {
    const key = args.join(' ')
    const hit = asked.get(key)
    if (hit && Date.now() - hit.at < ASKED_MS) return hit.answer
    const answer = queued(args, opts)
    // Dropped on failure so the next caller asks again rather than being handed
    // a remembered error for the next second and a bit.
    asked.set(key, { at: Date.now(), answer })
    answer.catch(() => asked.delete(key))
    return answer
  }

  return queued(args, opts).finally(() => asked.clear())
}

function queued (args, opts) {
  const started = Date.now()
  waiting++

  // Run whatever the one before did, so a failure does not stop the queue.
  const mine = chain.then(() => {
    // SAID WHEN IT IS SLOW, because a serial queue turns "VirtualBox is unwell"
    // into "the window has gone quiet", and those look identical from outside.
    // At most one line a minute: a stall produces hundreds of waits and one of
    // them is the whole message.
    const held = Date.now() - started
    if (held > 10000 && Date.now() - lastSlow > 60000) {
      lastSlow = Date.now()
      log.on('vm', ...(opts.tags || [])).warn(`VirtualBox is answering slowly — "${args.slice(0, 2).join(' ')}" waited ${Math.round(held / 1000)}s behind ${waiting - 1} other call(s)`)
    }
    return spawn(args, opts)
  })

  chain = mine.then(() => {}, () => {})
  return mine.finally(() => { waiting-- })
}

function spawn (args, { timeout = 120000, quiet = false, tags = [] } = {}) {
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

// ---- the host-only network, and the leases on it -------------------------
//
// The one network VirtualBox itself serves DHCP on, which makes it the only one
// it can be asked questions about. Everything else here is bridged: those leases
// come from the router and VirtualBox never sees them.

async function hostOnlyIfs () {
  if (!available()) return []
  const out = await run(['list', 'hostonlyifs'], { quiet: true })
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

// Making one, for a host that has never had a machine on it. On Windows this
// installs a virtual adapter, which is the one operation here that can ask for
// elevation — so the failure is passed back plainly rather than swallowed.
async function makeHostOnlyIf () {
  const out = await run(['hostonlyif', 'create'])
  const named = /Interface '([^']+)' was successfully created/.exec(out)
  if (!named) throw new Error(`VirtualBox did not say which host-only adapter it made: ${out.trim().split('\n').pop()}`)
  const name = named[1]
  // An address on the host's side, and a DHCP server, or a machine attached to
  // it gets nothing and the whole point is lost.
  await run(['hostonlyif', 'ipconfig', name, '--ip', '192.168.56.1', '--netmask', '255.255.255.0']).catch(() => {})
  await run(['dhcpserver', 'add', '--interface', name,
    '--server-ip', '192.168.56.100', '--netmask', '255.255.255.0',
    '--lower-ip', '192.168.56.101', '--upper-ip', '192.168.56.254', '--enable']).catch(() => {})
  return name
}

// WHAT ADDRESS A MACHINE HAS, asked of the DHCP server rather than of the guest.
//
// This works with the machine mid-install, wedged, or with no guest additions —
// which is exactly when nothing else can answer. The lease is looked up by the
// MAC of the machine's second adapter, which is on the host-only network.
async function leaseFor (name, mac) {
  const nets = await run(['list', 'dhcpservers'], { quiet: true })
  const network = (/NetworkName:\s*(HostInterfaceNetworking-.*)/.exec(nets) || [])[1]
  if (!network) return null
  // VBoxManage wants the MAC as it prints it in showvminfo: 12 hex digits.
  const out = await run(['dhcpserver', 'findlease', '--network', network.trim(), '--mac-address', mac], { quiet: true })
    .catch(() => '')
  const ip = (/IP Address:\s*([0-9.]+)/i.exec(out) || [])[1]
  return ip || null
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

// Pull the machine's network cable, or plug it back in.
//
// Exists for one reason: to find out what this app does when a machine it is
// watching goes away and comes back. That is not a hypothetical failure -- a
// laptop sleeps, a switch reboots, wifi drops -- and everything here reasons
// about it rather than having seen it: the run is detached so it "should"
// survive, the agent "should" redial, the queue "should" keep waiting.
//
// The cable rather than the guest's own networking, deliberately. Turning an
// interface off from inside is a different experiment: the machine knows it did
// it, and can undo it. Unplugging it from out here is what the machine cannot
// tell from the rest of the world disappearing.
const setLink = (name, on) =>
  run(['controlvm', name, 'setlinkstate1', on ? 'on' : 'off'], { tags: [name] })

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

// SNAPSHOTS ARE A TREE, AND THE KEY NAMES SAY SO.
//
// This read every `SnapshotName...=` line, kept the name, and threw the rest of
// the key away -- so five snapshots in a line and five taken from the same point
// arrived here identical. They are completely different situations: one is a
// history, the other is five alternatives branching off one moment, and which it
// is decides what deleting any of them costs.
//
// The suffix IS the parentage. VirtualBox writes the path of child indices into
// the key itself:
//
//     SnapshotName="post-install"           the root
//     SnapshotName-1="setup"                its child
//     SnapshotName-1-1="node-setup"         and its child
//     SnapshotName-2="something else"       a SECOND child of the root
//
// so the depth is the number of segments and the parent is the key with the last
// segment removed. Nothing has to be inferred from order or from names.
//
// THE CURRENT ONE IS FOUND BY NODE, NOT BY NAME. `CurrentSnapshotNode` names the
// exact key, and that matters because VirtualBox allows two snapshots to have
// the same name -- which this project has already been bitten by once. Matching
// on the name would mark both, or the wrong one.
// WHEN each snapshot was taken, which VBoxManage does not report at all.
//
// `snapshot list` gives names, uuids and descriptions and no times, so a list of
// five points to come back to said nothing about which was oldest -- and "which
// of these is the one from before I broke it" is most of what somebody is asking
// when they read this panel.
//
// VirtualBox keeps it in the machine's own `.vbox`, which is where its GUI reads
// it from, so this is its record rather than a guess. The path comes from
// VBoxManage rather than being assembled from the machine's name, because a
// machine's folder does not have to be named after it.
//
// CACHED ON THE FILE ITSELF. This is asked for on every draw of a panel that
// redraws every three seconds; the file changes only when a snapshot is taken or
// thrown away, and its size and modified time say so. Reading branches per draw
// is what once put 94% of the window in `spawn`, and this is the same shape.
const timesCache = new Map()

async function snapshotTimes (name) {
  try {
    const cfg = (await info(name)).CfgFile
    if (!cfg) return new Map()
    const stat = fs.statSync(cfg)
    const key = `${stat.mtimeMs}:${stat.size}`
    const hit = timesCache.get(cfg)
    if (hit && hit.key === key) return hit.times

    const times = new Map()
    const xml = fs.readFileSync(cfg, 'utf8')
    for (const m of xml.matchAll(/<Snapshot\s+uuid="\{([^}]+)\}"[^>]*?timeStamp="([^"]+)"/g)) {
      times.set(m[1], m[2])
    }
    timesCache.set(cfg, { key, times })
    return times
  } catch {
    // Unreadable is not a failure: every snapshot simply has no time, which the
    // panel shows as nothing rather than as an error about a file nobody asked
    // about.
    return new Map()
  }
}

async function snapshots (name) {
  try {
    const out = await run(['snapshot', name, 'list', '--machinereadable'], { quiet: true })

    const byKey = new Map()
    const field = (line, prefix) => {
      const m = new RegExp(`^${prefix}((?:-\\d+)*)="(.*)"$`).exec(line)
      return m ? { key: `SnapshotName${m[1]}`, path: m[1], value: m[2] } : null
    }

    for (const raw of out.split('\n')) {
      const line = raw.trim()
      for (const [prefix, into] of [['SnapshotName', 'name'], ['SnapshotUUID', 'uuid'], ['SnapshotDescription', 'description']]) {
        const f = field(line, prefix)
        if (!f) continue
        if (!byKey.has(f.key)) byKey.set(f.key, { key: f.key, path: f.path })
        byKey.get(f.key)[into] = f.value
      }
    }

    const currentNode = (out.match(/^CurrentSnapshotNode="(.*)"$/m) || [])[1] || null
    const current = (out.match(/^CurrentSnapshotName="(.*)"$/m) || [])[1] || null

    const times = await snapshotTimes(name)

    const list = [...byKey.values()].map(s => {
      const parts = s.path ? s.path.slice(1).split('-') : []
      return {
        name: s.name,
        uuid: s.uuid || null,
        taken: (s.uuid && times.get(s.uuid)) || null,
        description: s.description || '',
        key: s.key,
        // The key with its last segment removed, which is its parent's key.
        parent: parts.length ? `SnapshotName${parts.length > 1 ? '-' + parts.slice(0, -1).join('-') : ''}` : null,
        depth: parts.length,
        current: !!currentNode && s.key === currentNode
      }
    })

    // Depth first, so a list rendered in order already reads as the tree it is.
    const order = []
    const walk = parent => {
      for (const s of list.filter(x => x.parent === parent)) { order.push(s); walk(s.key) }
    }
    walk(null)
    // Anything the walk did not reach would be a key with a parent that is not
    // there. It should not happen, and dropping it silently would be worse than
    // showing it flat.
    for (const s of list) if (!order.includes(s)) order.push(s)

    return { snapshots: order, current, currentNode, deepest: order.reduce((n, s) => Math.max(n, s.depth), 0) }
  } catch {
    // No snapshots at all is an error from VBoxManage, not a problem here.
    return { snapshots: [], current: null, currentNode: null, deepest: 0 }
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

// ---- the guest's own account of its boot ---------------------------------
//
// THE OTHER HALF OF THE BLIND SPOT. VBox.log is the hypervisor's story: devices,
// disks, what the host did. It has nothing to say about a guest that boots and
// then sits there, because from outside that is a machine running perfectly.
//
// A serial port in raw-file mode is a wire out of the guest that needs nothing
// running inside it. The kernel writes to ttyS0 from its first line — long
// before the network, before systemd, before anything this app could talk to —
// and VirtualBox copies every byte into a file on this host. That is the boot
// this app has never been able to see.
//
// TWO HALVES, AND THIS IS ONLY ONE. The port has to exist (here) and the guest
// has to be told to use it (a kernel command line, in provisioning). Either
// alone gives an empty file, which is why the action that turns this on says so.
//
// Only while the machine is off: VirtualBox will not add a port to a running
// machine, and a machine that has to be stopped to be debugged is worth knowing
// about before rather than after.
async function setSerial (name, file) {
  if (!file) {
    await run(['modifyvm', name, '--uart1', 'off'], { tags: [name] })
    return { name, on: false, file: null }
  }
  try { fs.mkdirSync(path.dirname(file), { recursive: true }) } catch { /* it exists */ }
  // 0x3f8/IRQ4 is COM1, which is what `console=ttyS0` means in the guest. Raw
  // file rather than a pipe or a socket: a file survives the machine going away,
  // and the whole point is reading it after a boot that never finished.
  await run(['modifyvm', name, '--uart1', '0x3F8', '4', '--uartmode1', 'file', file], { tags: [name] })
  return { name, on: true, file }
}

// ---- what VirtualBox itself wrote down -----------------------------------
//
// THE ONE ACCOUNT OF A BOOT THAT NOBODY HERE WAS WATCHING.
//
// A machine that will not come up says nothing to this app: there is no agent
// yet, so no log line, and the only tool for it was a screenshot — which
// answers "splash screen or stuck", and nothing else. VirtualBox has been
// writing the whole story to a file the entire time, and this app could not read
// it.
//
// FROM THE FILE, NOT FROM VBoxManage, and that is the point rather than a
// shortcut. The moment this is most wanted is when VirtualBox is wedged, which
// is exactly when `showvminfo` hangs too — so the ordinary location is tried
// first with plain file reads, and the machine is only ASKED where its folder is
// if that fails. Debugging a stuck hypervisor through the stuck hypervisor is
// how a diagnosis costs an afternoon.
//
// VirtualBox rotates these: VBox.log is the current run, VBox.log.1 the one
// before it, and so on. The run that failed is usually not the newest one by the
// time somebody comes to look, which is why they are all listed.
const DEFAULT_LOGS = name => path.join(os.homedir(), 'VirtualBox VMs', name, 'Logs')

// The service's own log, which is about VirtualBox rather than about any one
// machine: registry locks, sessions that would not open, a host that refused to
// start a VM at all.
const SERVICE_LOG = () => path.join(os.homedir(), '.VirtualBox', 'VBoxSVC.log')

async function logFolder (name) {
  const usual = DEFAULT_LOGS(name)
  try { if (fs.statSync(usual).isDirectory()) return usual } catch { /* not where it usually is */ }
  const folder = await machineFolder(name)
  if (!folder) return null
  const at = path.join(folder, 'Logs')
  try { return fs.statSync(at).isDirectory() ? at : null } catch { return null }
}

async function logs (name) {
  const at = await logFolder(name)
  if (!at) return { folder: null, files: [] }
  const files = fs.readdirSync(at)
    .filter(f => /^VBox\.log(\.\d+)?$/i.test(f))
    .map(f => {
      const s = fs.statSync(path.join(at, f))
      return { file: f, bytes: s.size, at: new Date(s.mtimeMs).toISOString() }
    })
    // Newest first, by what VirtualBox wrote rather than by name: VBox.log.10
    // sorts before VBox.log.2 as text, and nobody wants to think about that.
    .sort((a, b) => (a.at < b.at ? 1 : -1))
  return { folder: at, files }
}

// The end of one of them, which is where a failure is. Read whole and sliced
// rather than streamed: these are a few megabytes at the very most, and reading
// is non-exclusive — VirtualBox holds the file open and appending to it, which a
// plain read does not disturb.
async function logRead (name, { which = null, lines = 200, find = null } = {}) {
  const wanted = String(which || 'VBox.log')
  const service = /^service$|VBoxSVC/i.test(wanted)
  const file = service ? SERVICE_LOG() : path.join((await logFolder(name)) || '', wanted)

  if (!service && !/^VBox\.log(\.\d+)?$/i.test(wanted)) {
    throw new Error(`"${wanted}" is not a VirtualBox log. Ask for VBox.log, VBox.log.1 and so on, or "service" for VBoxSVC.log.`)
  }
  let text = null
  try { text = fs.readFileSync(file, 'utf8') } catch (e) {
    throw new Error(`Could not read ${file}: ${e.code === 'ENOENT' ? 'there is no such log — the machine may never have been started' : e.message}`)
  }

  const all = text.split(/\r?\n/)
  const rows = find
    ? all.filter(l => new RegExp(find, 'i').test(l))
    : all
  const want = Math.max(1, Math.min(Number(lines) || 200, 5000))
  return {
    file,
    lines: rows.slice(-want),
    of: all.length,
    matched: find ? rows.length : null
  }
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
  isos, bridges, hostOnlyIfs, makeHostOnlyIf, leaseFor, hostAddress,
  start, stop, setLink, screenshot, snapshots, takeSnapshot, restoreSnapshot, deleteSnapshot, destroy,
  logs, logRead, logFolder, setSerial,
  OFF_STATES
}
