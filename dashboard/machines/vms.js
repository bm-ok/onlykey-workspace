'use strict'

// The VMs this app made, and only those.
//
// This registry is a safety boundary, not bookkeeping. The app can power off,
// snapshot, restore and DELETE what it lists -- so it must never list a machine
// somebody else made. VirtualBox is asked for live state, but never for the
// membership of this list: anything not created here is invisible to every action
// in this file, which is a stronger guarantee than remembering to be careful.

const fs = require('node:fs')
const path = require('node:path')
const log = require('../core/log')
const vbox = require('./vbox')
const channel = require('./channel')

const STATE = process.env.OKC_STATE || path.join(__dirname, '..', 'state')
const FILE = path.join(STATE, 'vms.json')

const read = () => fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : []

const write = list => {
  fs.mkdirSync(STATE, { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2))
}

const get = name => {
  const vm = read().find(v => v.name === name)
  // Deliberately the same answer as for a VM that exists but was not made here.
  // Nothing outside this registry is actionable, and saying so any more precisely
  // would be a way to probe what else is on the machine.
  if (!vm) throw new Error(`"${name}" is not a virtual machine this app made, so it will not touch it.`)
  return vm
}

function add (spec) {
  const list = read()
  if (list.some(v => v.name === spec.name)) throw new Error(`This app already has a virtual machine called "${spec.name}".`)
  const vm = { name: spec.name, spec, created: new Date().toISOString(), baseSnapshot: null, reported: null }
  write([...list, vm])
  return vm
}

function update (name, patch) {
  const list = read()
  const vm = list.find(v => v.name === name)
  if (!vm) return null
  Object.assign(vm, patch, { name: vm.name })
  write(list)
  return vm
}

function forget (name) {
  const vm = get(name)
  write(read().filter(v => v.name !== name))
  log.on('vm', name).info(`Removed "${name}" from this app's list. The virtual machine itself was not deleted.`)
  return { forgotten: vm.name }
}

// Where a VM has got to. Reported as a stage rather than a boolean because
// "it is not working" has several very different causes and the useful thing is
// which one.
function stageOf (vm, live) {
  if (!live) return 'defined'                    // we recorded it; VirtualBox has no such machine
  if (channel.connected(vm.name)) return 'connected'  // its agent is talking to us now
  if (vm.baseSnapshot) return 'ready'            // has a snapshot to reset to
  if (vm.reported) return 'online'               // it has reported in at least once
  if (vm.installing) return 'installing'         // an unattended install was started
  return 'created'                               // exists, never heard from
}

const STAGES = ['defined', 'created', 'installing', 'online', 'ready', 'connected']

// The list the UI shows: ours only, with live state attached.
async function all () {
  const mine = read()
  if (!mine.length) return { available: vbox.available(), vms: [] }
  if (!vbox.available()) {
    return { available: false, vms: mine.map(vm => ({ ...vm, live: false, state: 'unknown', stage: 'defined' })) }
  }

  const [defined, running] = await Promise.all([vbox.listAll(), vbox.runningAll()])
  const up = new Set(running.map(v => v.name))

  const vms = []
  for (const vm of mine) {
    const live = defined.some(v => v.name === vm.name)
    vms.push({
      ...vm,
      live,
      running: up.has(vm.name),
      state: live ? await vbox.state(vm.name) : 'missing',
      stage: stageOf(vm, live),
      // Whether its agent is talking to us right now, which is a different question
      // from whether VirtualBox says it is powered on.
      connected: channel.connected(vm.name),
      agent: channel.list().find(a => a.vm === vm.name) || null
    })
  }
  return { available: true, vms }
}

module.exports = { all, read, get, add, update, forget, stageOf, STAGES }
