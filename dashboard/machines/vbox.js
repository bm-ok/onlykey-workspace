'use strict'

// The virtual machine manager: list them, make one, remove one, turn them on and
// off.
//
// This lives outside core/ deliberately. A virtual machine is not a
// project-specific idea, so the word is not banned here -- what was wrong before
// was VM lifecycle welded into the work loop, so that the tool could not be used
// without one. Here it is a thing you manage, and the loop does not know it
// exists.

const fs = require('node:fs')
const path = require('node:path')
const log = require('../core/log')
const { run } = require('./run')

// Installed but not on PATH is the normal case on Windows, so look where it
// actually is before giving up.
const CANDIDATES = [
  process.env.VBOX_MSI_INSTALL_PATH && path.join(process.env.VBOX_MSI_INSTALL_PATH, 'VBoxManage.exe'),
  process.env.VBOX_INSTALL_PATH && path.join(process.env.VBOX_INSTALL_PATH, 'VBoxManage.exe'),
  'C:\\Program Files\\Oracle\\VirtualBox\\VBoxManage.exe',
  '/usr/bin/VBoxManage',
  '/usr/local/bin/VBoxManage'
].filter(Boolean)

let cached
function exe () {
  if (cached) return cached
  cached = CANDIDATES.find(p => { try { return fs.existsSync(p) } catch { return false } }) || 'VBoxManage'
  return cached
}

const available = () => CANDIDATES.some(p => { try { return fs.existsSync(p) } catch { return false } })

const vbox = (args, opts = {}) => run(exe(), args, { tags: ['vm'], ...opts })

// ---- reading ----------------------------------------------------------

async function list () {
  if (!available()) return { available: false, vms: [] }

  const [defined, running] = await Promise.all([
    vbox(['list', 'vms'], { quiet: true }),
    vbox(['list', 'runningvms'], { quiet: true })
  ])
  const names = text => text.split('\n')
    .map(l => (l.match(/^"(.*)"\s+\{(.+)\}$/) || []).slice(1))
    .filter(m => m.length).map(([name, uuid]) => ({ name, uuid }))

  const up = new Set(names(running).map(v => v.name))
  return {
    available: true,
    vms: names(defined).map(v => ({ ...v, running: up.has(v.name) }))
  }
}

// ---- switching on and off --------------------------------------------

const start = async name => {
  log.on('vm', name).info(`Starting ${name}`)
  await vbox(['startvm', name, '--type', 'headless'], { tags: ['vm', name] })
  log.on('vm', name).good(`${name} is starting. Give it a moment before connecting.`)
  return { started: name }
}

// The button, not the plug. A guest that is mid-write should be allowed to
// finish; pulling power is a separate, explicit choice.
const stop = async (name, force = false) => {
  const to = log.on('vm', name)
  to.info(force ? `Powering ${name} off` : `Asking ${name} to shut down`)
  await vbox(['controlvm', name, force ? 'poweroff' : 'acpipowerbutton'], { tags: ['vm', name] })
  to.good(force ? `${name} is off.` : `${name} was asked to shut down.`)
  return { stopped: name }
}

// ---- adding and removing ---------------------------------------------

// Creates a registered VM with a disk and a port forward for ssh. It does not
// install an operating system -- attach an installer and boot it, or attach a
// disk that already has one.
async function create ({ name, memory = 4096, cpus = 2, diskGb = 30, sshPort = 2222, iso = '' }) {
  if (!available()) throw new Error('VirtualBox is not installed, or not where this expected to find it.')
  if (!name || !/^[\w.-]+$/.test(name)) throw new Error('Give the machine a name using letters, numbers, dots or dashes.')

  const to = log.on('vm', name)
  const tags = ['vm', name]
  to.info(`Creating ${name}`)

  await vbox(['createvm', '--name', name, '--ostype', 'Ubuntu_64', '--register'], { tags })
  await vbox(['modifyvm', name,
    '--memory', String(memory), '--cpus', String(cpus),
    '--nic1', 'nat', '--audio-driver', 'none', '--graphicscontroller', 'vmsvga'], { tags })
  await vbox(['modifyvm', name,
    '--natpf1', `ssh,tcp,127.0.0.1,${sshPort},,22`], { tags })

  const info = await vbox(['showvminfo', name, '--machinereadable'], { quiet: true })
  const folder = (info.match(/^CfgFile="(.*)"$/m) || [])[1]
  const disk = path.join(path.dirname(folder || '.'), `${name}.vdi`)

  await vbox(['createmedium', 'disk', '--filename', disk, '--size', String(diskGb * 1024)], { tags })
  await vbox(['storagectl', name, '--name', 'SATA', '--add', 'sata', '--controller', 'IntelAhci'], { tags })
  await vbox(['storageattach', name, '--storagectl', 'SATA', '--port', '0', '--device', '0',
    '--type', 'hdd', '--medium', disk], { tags })

  if (iso) {
    await vbox(['storagectl', name, '--name', 'IDE', '--add', 'ide'], { tags })
    await vbox(['storageattach', name, '--storagectl', 'IDE', '--port', '1', '--device', '0',
      '--type', 'dvddrive', '--medium', iso], { tags })
  }

  to.good(`${name} created. ssh reaches it on 127.0.0.1:${sshPort} once an operating system is installed and running.`)
  return { name, sshPort, disk, iso: iso || null }
}

// Deletes the VM and its disks. Said plainly because it is the one action here
// that destroys something.
async function remove (name) {
  const to = log.on('vm', name)
  to.warn(`Deleting ${name} and its disks`)
  await vbox(['unregistervm', name, '--delete'], { tags: ['vm', name] })
  to.good(`${name} is gone.`)
  return { removed: name }
}

module.exports = { available, list, start, stop, create, remove, exe }
