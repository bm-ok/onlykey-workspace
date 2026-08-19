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

// AND TWO MORE THAT SAY WHAT A MACHINE IS FOR — WHICH IS A DIFFERENT KIND OF
// FACT FROM THE ONE ABOVE, AND THE DIFFERENCE DECIDES WHETHER THEY CAN CHANGE.
//
// The supervisor tag describes WHAT WAS BUILT. A supervisor skips the project's
// half of provisioning and gets the app's own instead, including a second user
// for the sign-in desk — see machines/scripts.js. You cannot retag your way into
// that, so the tag is fixed at creation and refused afterwards.
//
// A JUDGE AND A WORKER ARE THE SAME MACHINE. Same provision, same scripts, same
// disk. What separates them is which SIGN-IN they may be lent and which work the
// queue sends them — both decisions this host makes at the time, about a machine
// that is identical either way. So these two are ordinary tags that can be moved,
// and a machine can be turned from a worker into a judge by saying so.
//
// (The first version of this made `judge` immutable by copying the supervisor
// rule without its reason. The reason is provisioning, and it does not apply.)
//
// WHAT DOES STILL HAVE TO BE TRUE is that neither changes underneath running
// work: a machine that becomes a judge mid-task, or a worker mid-judgement,
// would be lent the wrong identity for what it is already doing. That is a
// question about whether it is BUSY, not about when it was made — see vmTags.
//
// AND THEY COMPOSE WITH EVERY OTHER TAG, which is the point of using tags at all.
// `judge` and `test` together is the kit's judge pool; `worker` and `test` is the
// kit's worker pool. Nothing here has to know those combinations exist.
//
// A machine carrying this reads changes and says whether they hold. It is given
// work by the queue like any runner — a judgement is queued, dispatched and put
// away exactly as a task is — so unlike a supervisor it is not out of the pool.
// What it is, is a DIFFERENT pool: judgements ask for this tag, and a machine
// carrying it is lent a judge's sign-in rather than a worker's.
//
// WHY SEPARATE THEM AT ALL. A judge says whether work holds; a worker writes the
// work. On one machine with one identity those are the same account, and "who
// said this is good" stops being separable from "who wrote it" — which is the
// whole thing a judge is for. Keeping them apart costs a machine and buys the
// only property that makes a verdict worth reading.
//
// A TAG RATHER THAN A FLAG, exactly as above: the queue already reads tags when
// it decides which machines a piece of work will accept, and a second idea of
// "which machines are eligible" beside the one that exists is how the two come
// to disagree.
const JUDGE = 'judge'

// AND THE ONE THAT SAYS "ORDINARY WORK", stated rather than implied.
//
// A machine with neither special tag has always been a runner, and still is —
// nothing on this host has to be retagged. What this adds is the ability to SAY
// it, which matters once there is something else it could be: "worker" and
// "judge" beside each other read as two choices, where "judge" and nothing read
// as a special case and a default.
const WORKER = 'worker'

// WHICH OF THE THREE A MACHINE IS, asked in one place.
//
// A machine is a runner unless it says otherwise. Both special tags are refused
// after creation — see vmTags — so this cannot change under a machine that is
// already holding something.
//
// SUPERVISOR WINS IF BOTH ARE SOMEHOW PRESENT, which should be impossible and is
// resolved anyway: of the two wrong answers, "this is the machine that decides"
// is the one that refuses more, and when a record is confused the safe reading
// wins. The same order the rest of this app uses — see whatIsOn.
const kindOf = vm => {
  const tags = (vm && vm.tags) || []
  const has = want => tags.some(t => String(t).toLowerCase() === want)
  // ---- SILENCE IS NOT AN ANSWER --------------------------------------------
  //
  // THIS USED TO SAY WORKER for a machine carrying no role tag, on the grounds
  // that every machine made before the tag existed was an ordinary runner and
  // requiring it would have made them all kindless overnight. That was true and
  // it was a GUESS, and the thing it was guessing about is which credential to
  // hand the machine.
  //
  // The queue picks a sign-in by the machine's kind. So "untagged means worker"
  // is not a default, it is this host deciding on its own that an unlabelled box
  // should be given a worker's identity -- and being right about that only for
  // as long as nobody builds a machine for something else.
  //
  // NULL, AND EVERY CALLER HAS TO SAY WHAT IT DOES ABOUT IT. The queue skips it,
  // lending refuses it and says which tag to add, and the register reports it
  // plainly instead of dressing it as a runner. A machine with no role is
  // perfectly usable by hand; it is only automatic work that must not guess.
  const kinds = kindsOf(vm)
  // ONE NAME WHERE THERE IS ONE, and null where there is none. A machine that
  // is BOTH has no single kind and must not be asked for one -- see kindsOf.
  return kinds.length === 1 ? kinds[0] : null
}

// ---- WHAT A MACHINE MAY BE, WHICH IS A LIST -------------------------------
//
// A MACHINE CAN BE A WORKER AND A JUDGE AT ONCE. They are the same build --
// what separates them is which sign-in may be lent and which work is sent, and
// both are decisions about an identical disk. So carrying both tags is a
// sensible thing to want on a host with few machines: it takes tasks when there
// are tasks and judgements when there are judgements, one at a time, rolled back
// to base in between.
//
// AND THE SEPARATION THAT MATTERS IS UNHARMED, which is the reason this is
// allowed at all. What must never collapse is the ACCOUNT: the identity that
// says whether work holds must not be the identity that wrote it. That is kept
// by the credential, not by the box -- a machine holds one sign-in at a time and
// gives it back before the next, so a judge machine and a worker machine can be
// the same metal without "who judged this" and "who wrote it" becoming one name.
//
// SUPERVISOR IS EXCLUSIVE, and not by policy: it is a different PROVISION, with
// its own scripts and a sign-in desk. Nothing is stopping the tags from being
// combined; there is simply no such machine.
const kindsOf = vm => {
  const tags = (vm && vm.tags) || []
  const has = want => tags.some(t => String(t).toLowerCase() === want)
  if (has(SUPERVISOR)) return ['supervisor']
  const out = []
  if (has(WORKER)) out.push('worker')
  if (has(JUDGE)) out.push('judge')
  return out
}

// WHETHER THIS MACHINE MAY DO THAT KIND OF WORK. The one question every
// decision here actually has -- asked of the machine and the ROLE together,
// rather than by reading a single kind off the machine and comparing it.
const canBe = (vm, role) => kindsOf(vm).includes(role)

// WHETHER THE QUEUE MAY PICK THIS ONE UP AT ALL. Asked in one place so the
// queue, the pools panel and any drill give the same answer -- and so that "why
// is my machine never taken" has a function to point at rather than a paragraph.
const takesQueuedWork = vm => canBe(vm, 'worker') || canBe(vm, 'judge')

// FOR SAYING, NEVER FOR DECIDING. "worker+judge" is what somebody reads on a
// card; nothing may compare against it.
const kindSaid = vm => kindsOf(vm).join('+') || 'no role yet'

// AND THE POOL EVERY OTHER MACHINE IS IN.
//
// A tag is how work asks for a KIND of machine. Machines with no tag were a kind
// too — the ordinary one — and it had no name, which meant "which pool is this
// machine in" had two sorts of answer: a tag, or a shrug. Anything checking that
// work went where it was meant to had to special-case the shrug.
//
// So an untagged machine carries "default" instead: written onto it when it is
// built and given to the ones that already existed at startup, so the register
// says it rather than a reader inferring it. A task can then ask for "default"
// and mean it, and every machine answers "which pool" with a name.
//
// A TASK WITH NO TAG STILL TAKES ANY FREE MACHINE. That is the ordinary case and
// it has not changed: this names the machines, not the work.
const POOL = 'default'

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
      // AND WHETHER IT IS A JUDGE, which is a different pool rather than being
      // out of the pool. See kindOf and the JUDGE tag above.
      judge: (vm.tags || []).some(t => String(t).toLowerCase() === JUDGE),
      kind: kindOf(vm),
      // EVERY ROLE IT MAY SERVE, and the words for a card. `kind` is null for a
      // machine that is both, on purpose: there is no single answer and anything
      // comparing against one would be picking a winner silently.
      kinds: kindsOf(vm),
      kindSaid: kindSaid(vm),
      agent: channel.list().find(a => a.vm === vm.name) || null
    })
  }
  return { available: true, vms }
}

module.exports = { all, read, get, add, update, forget, stageOf, kindOf, kindsOf, canBe, kindSaid, takesQueuedWork, STAGES, SUPERVISOR, JUDGE, WORKER, POOL }
