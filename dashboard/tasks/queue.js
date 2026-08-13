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
    // BORROWED BY A PERSON, which is not the same as kept back. Kept back is a
    // standing decision about a machine; borrowed is somebody using it right
    // now -- signing a worker in, or sitting in it with an editor open -- and it
    // ends when they say so. Checked first because it is the most specific and
    // the most temporary: a machine somebody is inside is the one the queue must
    // not roll back, whatever else is true of it.
    if (v.borrowed) return { name: v.name, free: false, why: `borrowed — ${v.borrowed.why || 'somebody is using it'}` }

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
      run(actions, log, task, next.name).catch(async e => {
        log.on('queue', next.name).bad(`#${task.number} — ${e.message}`)
        // A task whose setup failed has to LAND somewhere.
        //
        // It threw before it could be marked done, so it stayed in `given` for
        // ever: not queued, so nothing would pick it up; not done, so the board
        // showed it working with no worker anywhere; and on the next restart the
        // queue would adopt it and put its machine away all over again.
        //
        // Marked done rather than re-queued, deliberately. The attempt happened
        // and produced nothing, which is a true and useful thing to see -- and a
        // task that re-queues itself onto a machine that just failed to boot
        // does that for ever, quietly, with nobody deciding anything.
        try {
          await actions.taskUpdate.run({
            id: task.id,
            task: {
              state: 'done',
              attempts: [...(task.attempts || []), { machine: next.name, at: new Date().toISOString(), failed: e.message }]
            }
          })
        } catch { /* the log already carries it */ }
      })
    }
  } finally {
    running = false
  }
}

// ---- one task, start to finish ----------------------------------------

async function run (actions, log, task, machine) {
  const to = log.on('queue', machine)
  const id = task.id

  // How long each part took, kept with the attempt.
  //
  // A total is nearly useless for finding a fault: "the task took nine minutes"
  // says nothing about whether the machine took eight of them to boot. These are
  // the numbers that make a slow step visible afterwards, when nobody was
  // watching the log at the time -- which is most of the time, since the point of
  // a queue is being able to walk away from it.
  const spent = {}
  const began = Date.now()
  const phase = async (name, fn) => {
    const at = Date.now()
    try { return await fn() } finally { spent[name] = Date.now() - at }
  }

  try {
    to.info(`#${task.number} "${task.title}" -> ${machine}`)
    await actions.taskUpdate.run({ id, task: { state: 'given', machine } })

    // --- clean, then on ---------------------------------------------------
    //
    // Rolled back before it is started rather than after it is finished. Both
    // would work and only this one is honest: a machine cleaned "afterwards" is
    // clean only if the last thing that touched it finished properly, and the
    // interesting failures are exactly the ones that did not.
    await phase('bringUp', () => bringUp(actions, to, machine))

    // --- give it the work -------------------------------------------------
    await phase('credential', () => actions.vmCredentialsPut.run({ name: machine }))
    await phase('workspace', () => actions.vmWorkspace.run({ name: machine, branch: task.branch, folder: task.folder || undefined }))
    const started = await actions.vmDispatch.run({
      name: machine,
      task: task.brief,
      folder: task.folder || undefined,
      contract: task.contract || undefined,
      shell: !!task.shell
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
    // How long to wait is the TASK's business, not this file's.
    //
    // Six hours is a sensible default for work somebody is expecting back today,
    // and wrong for a soak deliberately left overnight -- which would be
    // abandoned at hour six while still running perfectly, and the machine put
    // away underneath it. A task that knows it is long says so.
    const outcome = await phase('work', () => waitForRun(actions, to, machine, started.run, Number(task.hours) || 6))

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
    spent.total = Date.now() - began
    const latest = (await actions.tasks.run({})).tasks.find(t => t.id === id)
    const marked = (latest.attempts || []).map(a => a.run === started.run ? { ...a, spent } : a)
    await actions.taskUpdate.run({ id, task: { state: 'done', attempts: marked } })

    to[art.delivered ? 'good' : 'warn'](
      `#${task.number} done — ${outcome.state}${outcome.exit === undefined ? '' : ` (exit ${outcome.exit})`} — ${art.summary}`)
    // Said as one line rather than left in the record, because the record is
    // read when somebody already suspects something; this is what tells them to.
    to.info(`#${task.number} took ${secs(spent.total)} — ${Object.entries(spent)
      .filter(([k]) => k !== 'total').map(([k, v]) => `${k} ${secs(v)}`).join(', ')}`)
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
    await settle(actions, to, machine, v => !v.running, 120000, 'it to stop', 15000)
  }

  // Rolled back only if it is not already there.
  //
  // putAway leaves a machine ON its base snapshot precisely so it is clean for
  // the next task, and this then restored the same snapshot again five seconds
  // later -- the same operation twice, back to back, on a machine VirtualBox had
  // only just finished restoring. That is the shape of a race, and it produced
  // one: a machine that started to a black screen and never booted.
  //
  // The check is cheap and the skip is safe: `current` is what VirtualBox says
  // the machine is sitting on, not what this app believes.
  const at = await actions.vmSnapshots.run({ name: machine })
  if (at.current === before.baseSnapshot && !before.running) {
    to.info(`already clean at "${before.baseSnapshot}"`)
  } else {
    to.info(`rolling back to "${before.baseSnapshot}"`)
    await actions.vmSnapshotRestore.run({ name: machine, title: before.baseSnapshot })
  }

  to.info('starting it')
  await actions.vmStart.run({ name: machine })
  // Started is not ready. Everything that talks to a guest refuses until it has
  // dialled in, and a machine boots for a minute or two -- so this is the step
  // most worth counting out loud, and the one that was silent for five minutes
  // while a machine sat at a cursor.
  await settle(actions, to, machine, v => v.connected, 6 * 60000, 'it to dial in', 60000)
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

  // The button first, then the plug.
  //
  // `vmStop` presses the ACPI power button, which is right for a machine with an
  // operating system on it and useless for one that never got that far -- there
  // is nothing running to receive the press. A machine that failed to boot
  // therefore sat "running" for the whole timeout and was then rolled back while
  // still running, which fails too, and the machine stayed out of the pool.
  //
  // Waiting a short time and then pulling the plug is safe HERE in a way it
  // would not be elsewhere: this machine is about to be rolled back to a
  // snapshot, so an unfinished write is discarded either way.
  try {
    await actions.vmStop.run({ name: machine })
    await settle(actions, to, machine, v => !v.running, 45000, 'it to shut down', 15000)
  } catch {
    to.warn('it did not answer the power button; pulling the plug')
    try {
      await actions.vmStop.run({ name: machine, force: true })
      await settle(actions, to, machine, v => !v.running, 60000, 'it to stop', 5000)
    } catch (e) { to.warn(`could not stop it at all: ${e.message}`) }
  }

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

const secs = ms => `${Math.round(ms / 1000)}s`

// COUNTING OUT LOUD WHILE NOTHING HAPPENS.
//
// Every long step here is invisible from outside: a machine boots, or a worker
// thinks, and the dashboard says one line at the start and one at the end. In
// between there is no way to tell "still going" from "stuck", and the two want
// opposite responses -- wait, or go and look. This afternoon that gap was five
// minutes of a machine sitting at a black screen with nothing said about it.
//
// So a wait says how long it has been waiting, and says it louder once it has
// gone past what the step USUALLY takes. `usual` is the interesting number, not
// the timeout: a timeout is the point at which we give up, which is deliberately
// generous, and a step running four times its normal length is worth knowing
// about long before that.
//
// Cheap on purpose -- one line every 30 seconds, into the same live log as
// everything else. A progress bar nobody is watching is not the point; a
// timestamped trail somebody can read afterwards is.
function ticking (to, what, { usual = 0, every = 30000 } = {}) {
  const began = Date.now()
  let said = 0
  const timer = setInterval(() => {
    const gone = Date.now() - began
    if (gone - said < every) return
    said = gone
    if (usual && gone > usual * 2) to.warn(`still waiting for ${what} — ${secs(gone)}, and it usually takes about ${secs(usual)}`)
    else to.info(`waiting for ${what} — ${secs(gone)}`)
  }, 5000)
  if (timer.unref) timer.unref()
  return {
    done: () => {
      clearInterval(timer)
      const gone = Date.now() - began
      if (usual && gone > usual * 2) to.warn(`${what}: ${secs(gone)}, about ${Math.round(gone / usual)}x the usual ${secs(usual)}`)
      return gone
    }
  }
}

async function settle (actions, to, machine, ok, timeout, what, usual) {
  const deadline = Date.now() + timeout
  const tick = ticking(to, what, { usual })
  try {
    for (;;) {
      const vm = (await actions.vmList.run({})).vms.find(v => v.name === machine)
      if (vm && ok(vm)) return vm
      if (Date.now() > deadline) {
        // Named with the elapsed time as well as the limit, because "waited 6
        // minutes" reads as a policy and "waited 6 minutes, having expected 40
        // seconds" reads as the fault it is.
        throw new Error(`Waited ${secs(Date.now() - deadline + timeout)} for ${what} and it did not happen${usual ? ` — it usually takes about ${secs(usual)}` : ''}`)
      }
      await wait(5000)
    }
  } finally { tick.done() }
}

// Until the run is over, however it ends.
//
// `lost` counts as over. A run whose process is gone is not going to produce a
// result, and waiting for one would hold a machine out of service for as long as
// the timeout -- which is the whole afternoon, on a task nobody is going to get
// an answer to.
async function waitForRun (actions, to, machine, runId, hours = 6) {
  const deadline = Date.now() + hours * 3600000
  // No `usual` here, and that is the honest answer: a task is as long as the
  // work is, and a five-minute one and a two-hour one are both ordinary. What
  // can be said is how long it HAS been, which is what somebody deciding whether
  // to go and look actually needs.
  const tick = ticking(to, `${runId} to finish`, { every: 60000 })

  // A MACHINE THAT CANNOT BE ASKED IS NOT A MACHINE THAT HAS FINISHED.
  //
  // This waited by polling, and a failed poll threw -- straight out of here, out
  // of the task, and into the `finally` that puts a machine away. So a fifteen
  // second network blip powered the machine off and rolled it back, mid-run,
  // while the work itself was perfectly fine: detached, still going, and about
  // to be destroyed by the thing supervising it. Pulling the cable for one
  // minute cost the whole task.
  //
  // The run is detached on purpose. An outage is something happening to the
  // DASHBOARD, not to the work -- so being unable to see the work is a reason to
  // look again, not a reason to end it. Patience here is bounded but generous:
  // a machine that is really gone is noticed by the loop below eventually, and
  // the cost of waiting too long is a machine held; the cost of giving up too
  // early is somebody's afternoon.
  const OUT_OF_TOUCH = 10 * 60000
  let lostSince = 0

  try {
    for (;;) {
      let runs = null
      try {
        ({ runs } = await actions.vmRuns.run({ name: machine }))
        if (lostSince) {
          to.good(`${machine} is answering again after ${secs(Date.now() - lostSince)} — the run was never in doubt, only our view of it`)
          lostSince = 0
        }
      } catch (e) {
        // Cannot see it. Say so once, keep waiting, and give up only when it has
        // been out of touch long enough to be genuinely gone rather than briefly
        // unreachable.
        // UNREACHABLE AND OFF ARE DIFFERENT. Patience is for a machine that has
        // lost its network while carrying on working; a machine that is powered
        // off is not working, and waiting ten minutes to admit that holds it out
        // of the pool for no reason. VirtualBox can answer this without the
        // guest's help, which is exactly why it is worth asking.
        const still = (await actions.vmList.run({})).vms.find(v => v.name === machine)
        if (!still || !still.running) {
          to.warn(`${machine} is not running any more, so ${runId} is over however it ended`)
          return { state: 'gone' }
        }

        if (!lostSince) {
          lostSince = Date.now()
          to.warn(`cannot reach ${machine} (${e.message}) — the run is detached and carries on regardless; waiting for it to come back`)
        } else if (Date.now() - lostSince > OUT_OF_TOUCH) {
          to.bad(`${machine} has been unreachable for ${Math.round((Date.now() - lostSince) / 60000)} minutes; giving up on ${runId}`)
          return { state: 'unreachable' }
        }
        await wait(15000)
        continue
      }

      const mine = (runs || []).find(r => r.id === runId)
      if (mine && mine.state !== 'running') return mine
      if (!mine) return { state: 'gone' }
      if (Date.now() > deadline) {
        to.warn(`giving up on ${runId} after ${hours} hours; the machine is being put away`)
        return { state: 'abandoned' }
      }
      await wait(15000)
    }
  } finally { tick.done() }
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

  // A task that was being SET UP when this stopped never became a run.
  //
  // It sat in `given` with no run id, which made it invisible to everything: the
  // queue only looks at `queued`, adoption only looks for a run to wait on, and
  // the board showed it working with no worker anywhere. Two of them accumulated
  // in one afternoon, both from restarting the dashboard while a machine was
  // booting.
  //
  // Put back in the queue rather than marked done, and the difference is real:
  // nothing was dispatched, so no work happened and there is nothing to judge.
  // Re-queueing loses nothing and re-running it is exactly what was wanted.
  for (const t of tasks.filter(x => x.state === 'given' && !x.run)) {
    log.on('queue').warn(`#${t.number} was being set up when this stopped, and never started — back in the queue`)
    await actions.taskUpdate.run({ id: t.id, task: { state: 'queued', machine: null } }).catch(() => {})
  }

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

module.exports = { begin, stop, tick, availability, state, busyWith, bringUp, putAway, TICK }
