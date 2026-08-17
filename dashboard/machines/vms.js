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

const data = require('../core/data')

const STATE = data.state()
const FILE = path.join(STATE, 'vms.json')

// Tolerant on purpose. These files get hand-edited, and two ways of writing them
// wrong are easy to hit: a byte-order mark, which JSON.parse rejects outright, and
// a single entry saved as an object rather than a list. Neither should empty the
// list of machines and make it look as though nothing was ever made.
// WHAT A RECORD WRITTEN BY AN OLDER VERSION IS MISSING, filled in on the way
// out rather than by rewriting the file.
//
// Two fields moved from the spec to the top of the record — see add() — and a
// machine made before that has them only in its spec. Both are read on every
// draw and by the queue, so a missing one is not cosmetic: no tags meant a
// supervisor machine was offered to the queue as an ordinary runner.
//
// Read-time and idempotent, so nothing has to be migrated and a record that
// already has them is untouched. `tags: []` set on purpose is left alone —
// only a record that never had the field at all falls back to its spec.
const asRecorded = vm => ({
  ...vm,
  tags: Array.isArray(vm.tags) ? vm.tags : ((vm.spec || {}).tags || []),
  serial: vm.serial !== undefined ? vm.serial : ((vm.spec || {}).serial || null)
})

function read () {
  if (!fs.existsSync(FILE)) return []
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^\uFEFF/, ''))
    // Every reader goes through here \u2014 the queue, the window, update() \u2014 so the
    // filling-in above happens once rather than at each place that asks.
    return (Array.isArray(data) ? data : [data]).map(asRecorded)
  } catch (e) {
    log.on('vm').bad(`${FILE} could not be read (${e.message}). Fix or delete it; no machine is listed until then.`)
    return []
  }
}

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
  // `branch` is the one this machine may push, and null means it may push
  // nothing. Named here rather than appearing the first time one is set, so a
  // machine that has never been set up reads as "not allowed yet" instead of as
  // a field somebody forgot.
  // TAGS ARE LIFTED OUT OF THE SPEC, and this is a fix rather than a tidy-up.
  //
  // `provisioner.fill` puts tags in the spec, because that is where what somebody
  // asked for at creation goes. Everything that READS a tag reads it here at the
  // top: vmTags writes it here, the queue matches on it, the card draws it. So a
  // machine made with tags had them written down in a place nothing looked at —
  // it came back carrying none, and the supervisor machine built with the box
  // ticked was offered to the queue like any other runner.
  //
  // One place to read from, filled from the one place it is asked for.
  const vm = {
    name: spec.name,
    spec,
    tags: Array.isArray(spec.tags) ? spec.tags : [],
    // Where its console is written, for the same reason: the window opens a
    // terminal on this, and buildInVbox is what attached the port.
    serial: spec.serial || null,
    created: new Date().toISOString(),
    baseSnapshot: null,
    reported: null,
    branch: null
  }
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

// THE ONE TAG THIS APP GIVES A MEANING TO, and it is here so that everything
// reading it reads the same string.
//
// Tags are otherwise free text and deliberately so: they are what somebody calls
// a kind of machine, and the tags that exist are the tags on the machines. This
// one is different. A machine carrying it is a SUPERVISOR — it runs Claude Code
// to decide what work to give, asks this dashboard for it over an API of its
// own, and is never given a task itself.
//
// A tag rather than a flag alone, because the queue already reads tags when it
// decides which machines a task will accept, and the alternative was a second
// idea of "which machines are eligible" alongside the one that exists. It is
// applied at creation and refused by vmTags afterwards — see actions/machines.js
// — because a guarantee somebody can type away is not a guarantee.
const SUPERVISOR = 'supervisor'

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
      // And a third question again: whether anybody has a DESKTOP on it.
      //
      // The agent starts as soon as the network works, which is a minute or two
      // before a graphical session exists — so a machine reports itself
      // connected while it is still showing a splash screen. Anything that needs
      // a display, an editor or a browser sign-in, arrives too early and fails
      // for a reason that points nowhere near the cause.
      desktop: !!((channel.list().find(a => a.vm === vm.name) || {}).facts || {}).desktop,
      // AND WHETHER IT WAS EVER MEANT TO HAVE ONE, which is a fact about how it
      // was built and is answerable with the machine switched off. Decided at
      // creation and never after — see provisioner.fill.
      //
      // Missing means yes, deliberately: every machine made before this existed
      // was installed from a desktop image and has one. A machine built since
      // says so either way.
      desktopWanted: (vm.spec || {}).desktop !== false,
      // WHETHER IT IS A SUPERVISOR RATHER THAN A RUNNER, which decides whether
      // the queue will ever look at it. Read from the TAG rather than from the
      // spec flag, because the tag is what every reader here acts on and two
      // sources for one answer is how they come to disagree. The flag is what
      // put the tag there — see provisioner.fill — and vmTags refuses to move it
      // afterwards.
      supervisor: (vm.tags || []).some(t => String(t).toLowerCase() === SUPERVISOR),
      agent: channel.list().find(a => a.vm === vm.name) || null
    })
  }
  return { available: true, vms }
}

module.exports = { all, read, get, add, update, forget, stageOf, STAGES, SUPERVISOR }
