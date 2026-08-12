'use strict'

// Work waits for a machine; a machine does not wait for work.
//
// THE NATURAL STATE OF A RUNNER IS OFF. That is the whole shape of this file.
// A machine is not a thing you keep warm and hand jobs to -- it is switched on
// because there is something to do, brought to a known state, given exactly one
// task, and switched off again when that task is done. Between tasks there is
// nothing running, nothing holding a credential, and nothing to go stale.
//
// So a task does not name a machine. It waits, and the first machine that is
// free takes it. Which machine did the work is a fact recorded afterwards rather
// than a decision made in advance, and that is what makes a second runner useful
// without anybody rebalancing anything.
//
// CLEAN FIRST, AND THAT MEANS ROLLED BACK. A machine that has done a task is
// carrying that task: its branch, its checkout, its files, whatever the worker
// left in a home directory. Reusing it would let one task's leavings reach
// another's work, which is not a hypothetical -- the whole reason a task is
// judged by its branch is that anything else is somebody's account of what
// happened. So the machine is restored to its base snapshot before it is
// started, every time, and a machine with no base snapshot is not available:
// there is nowhere clean to bring it back to.
//
// EVERY STEP GOES THROUGH THE ACTIONS. This drives the same surface a person
// drives, so every refusal still applies -- the protected default, the branch
// claim, a machine that may not be moved off its branch. A scheduler with its
// own private path to the machines would be a second set of rules, and the
// second set is always the one that turns out to be wrong.

const TICK = 15000

// One task at a time per machine, and one machine at a time per task. Held in
// memory rather than in the task file because it describes what THIS process is
// doing right now: a dashboard that has just restarted is not running anything,
// whatever the file says, and a stale claim in a file would keep a machine out
// of service until somebody noticed.
const busyWith = new Map()

let running = false
let timer = null

function begin (actions, log) {
  if (timer) return
  // Adopted before anything new is started, so a restart mid-task does not hand
  // that machine a second one.
  adopt(actions, log).catch(() => { /* said inside */ })
  timer = setInterval(() => tick(actions, log).catch(e => log.on('queue').warn(e.message)), TICK)
  if (timer.unref) timer.unref()
}

const stop = () => { if (timer) { clearInterval(timer); timer = null } }

// ---- who is free -------------------------------------------------------

// A machine that can be given something, and the reasons one cannot.
//
// Reported with a reason rather than filtered silently, because "nothing is
// running and nothing is queued either" and "everything is queued and no machine
// can take it" look identical from outside and want opposite responses.
function availability (vms) {
  return vms.map(v => {
    // A decision, checked before any of the facts. Someone has said keep this
    // one back, and that outranks it merely looking idle -- which is exactly
    // what a machine somebody is about to use looks like.
    if (v.forTasks === false) return { name: v.name, free: false, why: 'is kept back from the queue' }
    if (busyWith.has(v.name)) return { name: v.name, free: false, why: `doing ${busyWith.get(v.name)}` }
    if (!v.baseSnapshot) return { name: v.name, free: false, why: 'has no base snapshot to come back to, so it cannot be made clean' }
    if (v.branch) return { name: v.name, free: false, why: `still claims ${v.branch}` }
    if (v.stage && v.stage === 'installing') return { name: v.name, free: false, why: 'is being installed' }
    return { name: v.name, free: true, why: null }
  })
}

// ---- the loop ----------------------------------------------------------

async function tick (actions, log) {
  if (running) return
  running = true
  try {
    const { tasks } = await actions.tasks.run({})
    // Oldest first. A queue that is not first-in-first-out is a queue somebody
    // has to reason about, and the number is the order they were written.
    const waiting = tasks.filter(t => t.state === 'queued').sort((a, b) => a.number - b.number)
    if (!waiting.length) return

    const { vms } = await actions.vmList.run({})
    const free = availability(vms).filter(a => a.free)
    if (!free.length) return

    for (const task of waiting) {
      const next = free.shift()
      if (!next) break
      // Claimed synchronously, before any await, so two ticks cannot hand the
      // same machine to two tasks.
      busyWith.set(next.name, `#${task.number}`)
      run(actions, log, task, next.name).catch(e => log.on('queue', next.name).bad(e.message))
    }
  } finally {
    running = false
  }
}

// ---- one task, start to finish ----------------------------------------

async function run (actions, log, task, machine) {
  const to = log.on('queue', machine)
  const id = task.id
  try {
    to.info(`#${task.number} "${task.title}" -> ${machine}`)
    await actions.taskUpdate.run({ id, task: { state: 'given', machine } })

    // --- clean, then on ---------------------------------------------------
    //
    // Rolled back before it is started rather than after it is finished. Both
    // would work and only this one is honest: a machine cleaned "afterwards" is
    // clean only if the last thing that touched it finished properly, and the
    // interesting failures are exactly the ones that did not.
    await bringUp(actions, to, machine)

    // --- give it the work -------------------------------------------------
    await actions.vmCredentialsPut.run({ name: machine })
    await actions.vmWorkspace.run({ name: machine, branch: task.branch, folder: task.folder || undefined })
    const started = await actions.vmDispatch.run({
      name: machine,
      task: task.brief,
      folder: task.folder || undefined,
      contract: task.contract || undefined
    })
    const fresh = await actions.tasks.run({})
    const now = fresh.tasks.find(t => t.id === id) || task
    await actions.taskUpdate.run({
      id,
      task: {
        run: started.run,
        attempts: [...(now.attempts || []), { run: started.run, machine, at: new Date().toISOString() }]
      }
    })

    // --- wait for it ------------------------------------------------------
    const outcome = await waitForRun(actions, to, machine, started.run)

    // Pulled across before the machine is touched again. taskProgress does this
    // too, but that only happens if somebody looks -- and this machine is about
    // to be shut down and rolled back, which is precisely when nobody is.
    await actions.taskProgress.run({ id }).catch(() => { /* the log is best effort; the verdict is not */ })

    const art = await actions.taskArtifact.run({ id })

    // Marked done whatever the outcome was, because done is about the run
    // having ended and not about it having worked. Whether anything actually
    // arrived is read from the branch, and stays a separate question -- a task
    // can be done and have delivered nothing, which is exactly what a worker
    // that was refused by the hook looks like.
    await actions.taskUpdate.run({ id, task: { state: 'done' } })
    to[art.delivered ? 'good' : 'warn'](
      `#${task.number} done — ${outcome.state}${outcome.exit === undefined ? '' : ` (exit ${outcome.exit})`} — ${art.summary}`)
  } finally {
    // ALWAYS, and in this order. A machine left on, holding a credential, is
    // the failure that costs something: the credential outlives the task in a
    // snapshot, and the machine is out of service until a person notices.
    await putAway(actions, log, machine)
    busyWith.delete(machine)
  }
}

// Off, clean, on, and dialled in.
async function bringUp (actions, to, machine) {
  const before = (await actions.vmList.run({})).vms.find(v => v.name === machine)
  if (!before) throw new Error(`"${machine}" is gone`)

  if (before.running) {
    to.info('shutting it down so it can be made clean')
    await actions.vmStop.run({ name: machine, force: true })
    await settle(actions, machine, v => !v.running, 120000, 'it to stop')
  }

  to.info(`rolling back to "${before.baseSnapshot}"`)
  await actions.vmSnapshotRestore.run({ name: machine, title: before.baseSnapshot })

  to.info('starting it')
  await actions.vmStart.run({ name: machine })
  // Started is not ready. Everything that talks to a guest refuses until it has
  // dialled in, and a machine boots for a minute or two.
  await settle(actions, machine, v => v.connected, 6 * 60000, 'it to dial in')
}

// Back to its natural state: off, clean, holding nothing.
//
// Never allowed to throw. It runs in a finally, and a failure to tidy up must
// not replace the error that caused it -- losing the real reason is how a
// machine ends up left on AND nobody knowing why.
async function putAway (actions, log, machine) {
  const to = log.on('queue', machine)

  // Taken back while the machine can still be spoken to. The rollback below
  // would remove the file anyway, but a machine that fails to shut down would
  // then sit there holding a live credential -- and the point of taking it back
  // is that it stops existing on that disk, not that the registry stops saying
  // so.
  try {
    await actions.vmCredentialsForget.run({ name: machine })
  } catch (e) { to.info(`its credential was already gone: ${e.message}`) }

  try {
    await actions.vmStop.run({ name: machine })
    await settle(actions, machine, v => !v.running, 120000, 'it to stop')
  } catch (e) { to.warn(`could not shut it down: ${e.message}`) }

  // ROLLED BACK AT REST, and this is what makes the pool work at all.
  //
  // A machine that has finished a task still CLAIMS that task's branch, and a
  // claimed branch means "not free" -- correctly, because a machine somebody set
  // up by hand must not be taken from under them. So without this the queue
  // deadlocks after exactly one task per machine: everything it has ever used is
  // permanently ineligible, and nothing says why except a line in the state file.
  //
  // It is also what "clean" means when the natural state is off. Between tasks a
  // machine holds no branch, no credential, and none of the last worker's
  // leavings -- so the next task starts from a known disk rather than from
  // whatever the last one happened to leave.
  try {
    const vm = (await actions.vmList.run({})).vms.find(v => v.name === machine)
    if (vm && vm.baseSnapshot && !vm.running) {
      await actions.vmSnapshotRestore.run({ name: machine, title: vm.baseSnapshot })
      to.good(`off again, rolled back to "${vm.baseSnapshot}", free for the next task`)
    } else {
      to.warn('could not roll it back, so it stays out of the pool until somebody does')
    }
  } catch (e) { to.warn(`could not roll it back: ${e.message}`) }
}

// ---- waiting -----------------------------------------------------------

const wait = ms => new Promise(r => setTimeout(r, ms))

async function settle (actions, machine, ok, timeout, what) {
  const deadline = Date.now() + timeout
  for (;;) {
    const vm = (await actions.vmList.run({})).vms.find(v => v.name === machine)
    if (vm && ok(vm)) return vm
    if (Date.now() > deadline) throw new Error(`Waited ${Math.round(timeout / 60000)} minutes for ${what} and it did not happen`)
    await wait(5000)
  }
}

// Until the run is over, however it ends.
//
// `lost` counts as over. A run whose process is gone is not going to produce a
// result, and waiting for one would hold a machine out of service for as long as
// the timeout -- which is the whole afternoon, on a task nobody is going to get
// an answer to.
async function waitForRun (actions, to, machine, runId, hours = 6) {
  const deadline = Date.now() + hours * 3600000
  for (;;) {
    const { runs } = await actions.vmRuns.run({ name: machine })
    const mine = (runs || []).find(r => r.id === runId)
    if (mine && mine.state !== 'running') return mine
    if (!mine) return { state: 'gone' }
    if (Date.now() > deadline) {
      to.warn(`giving up on ${runId} after ${hours} hours; the machine is being put away`)
      return { state: 'abandoned' }
    }
    await wait(15000)
  }
}

// ---- picking up after a restart ---------------------------------------

// A task left mid-flight when the dashboard stopped.
//
// The dashboard is restarted for every change to it, and a task that was running
// at that moment is not finished -- but nothing in this process knows about it
// any more. Left alone it would sit in `given` for ever while its machine stayed
// on, holding a credential, out of service and looking busy.
//
// Not resumed, because the worker itself is still going or already gone and
// neither can be re-entered from here. What happens is honest: the run is waited
// on if it is still alive, and the machine is put away either way.
async function adopt (actions, log) {
  const { tasks } = await actions.tasks.run({})
  const midFlight = tasks.filter(t => t.state === 'given' && t.machine && t.run)
  for (const task of midFlight) {
    if (busyWith.has(task.machine)) continue
    busyWith.set(task.machine, `#${task.number}`)
    const to = log.on('queue', task.machine)
    to.warn(`#${task.number} was in flight when this restarted; picking it back up`)
    ;(async () => {
      try {
        const { vms } = await actions.vmList.run({})
        const vm = vms.find(v => v.name === task.machine)
        if (vm && vm.connected) {
          await waitForRun(actions, to, task.machine, task.run)
          await actions.taskProgress.run({ id: task.id }).catch(() => {})
        }
        const art = await actions.taskArtifact.run({ id: task.id })
        await actions.taskUpdate.run({ id: task.id, task: { state: 'done' } })
        to[art.delivered ? 'good' : 'warn'](`#${task.number} done — ${art.summary}`)
      } finally {
        await putAway(actions, log, task.machine)
        busyWith.delete(task.machine)
      }
    })().catch(e => to.bad(e.message))
  }
}

const state = () => ({ inFlight: [...busyWith.entries()].map(([machine, task]) => ({ machine, task })) })

module.exports = { begin, stop, tick, availability, state, busyWith, TICK }
