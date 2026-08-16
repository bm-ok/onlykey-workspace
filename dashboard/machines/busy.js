'use strict'

// One long thing at a time, per machine.
//
// Snapshotting a machine shuts it down, snapshots it and starts it again.
// Installing wipes its disk and drives an installer for half an hour. Restoring
// throws its disk away. Each of those is several VirtualBox commands with a
// machine in an unfinished state in between -- and VirtualBox answers a second
// one during that window with a session lock error, which arrives as a wall of
// COM text describing an interface nobody asked about.
//
// So a second one is refused HERE, where the refusal can say which machine is
// busy and with what. Not queued: waiting would mean a command that appears to
// hang for twenty-five minutes, and the honest answer to "start this machine"
// while it is being installed is no, not later.
//
// READS ARE NEVER BLOCKED. Asking what a machine's state is, or what it has on
// screen, is exactly what somebody does when something is taking a long time,
// and a lock that stops you looking is a lock that gets worked around.

const doing = new Map()   // machine name -> what it is in the middle of

const what = name => doing.get(name) || null

// Refuses rather than waits, and names both machines involved -- "it is busy" is
// not actionable, "runner1 is being installed" is.
function claim (name, job) {
  const already = doing.get(name)
  if (already) {
    throw new Error(`"${name}" is already ${already}. Wait for that to finish — one of these at a time, because they leave the machine half-way in between and VirtualBox will refuse the second with an error about a session lock.`)
  }
  doing.set(name, job)
}

const release = name => doing.delete(name)

// Claim, run, release whatever happens. A job that threw still has to let go,
// or one failure leaves a machine permanently unusable with nothing running.
async function during (name, job, fn) {
  claim(name, job)
  try {
    return await fn()
  } finally {
    release(name)
  }
}

// ---- and ONE MACHINE COMING UP AT A TIME, across the whole host -----------
//
// The lock above is per machine, and it cannot see the thing that actually goes
// wrong here: two DIFFERENT machines booting at once.
//
// A machine coming up is the most expensive minute this host ever has — a
// snapshot restore, then a cold boot pulling on disk, memory and every core at
// once. Two at the same time do not take twice as long, they wedge: one sat on
// its splash screen for eleven minutes, ignored its power button, and had to
// have the plug pulled. Nothing was broken with it. There was simply not enough
// of the host to go round, and the whole session was spent looking for a fault
// that was never there.
//
// This is the rule the queue already follows and never wrote down: it starts the
// next machine only once the last one has dialled in. Written down here, it
// applies to the paths the queue does not own — somebody pressing Start on two
// machines, a drill borrowing one while another is coming up, re-provisioning.
//
// A BOOT IS WAITED FOR. AN INSTALL IS REFUSED. Both are "a machine coming up"
// and they are nothing alike in the one respect that matters, which is how long
// the answer takes to change.
//
// A boot stops being in the way in about a minute, so what the caller wants is
// their turn, not to be told to try again. An install is twenty-five minutes and
// it does not dial in until its FIRST BOOT — so for most of that time there is
// no agent, no channel, and nothing to say it is nearly done. Making somebody
// wait behind that, silently, is worse than saying no; and the same fact is why
// an install cannot be gated on dialling in the way a boot is.
//
// So an install holds this for its whole length and anything else that wants to
// come up is refused, by name, with the reason. The one refusal that has to be
// right, because a restart in the middle of an install throws away twenty-five
// minutes: see the note about that in the dashboard's own instructions.
let holder = null          // { name, kind } — what is coming up right now
const waiting = []         // boots that have not had their turn yet

const booting = () => holder

function takeTurn (name, kind, waitMs, onWait) {
  return new Promise((resolve, reject) => {
    if (!holder) { holder = { name, kind, depth: 1 }; return resolve() }

    // THE SAME MACHINE, INSIDE ITS OWN TURN. `bringUp` holds this for the whole
    // boot and then calls vmStart, which takes it as well — so without this the
    // one path that matters most waits for a turn only it could give up, for
    // ever. Counted rather than a flag, because the nesting is two deep today
    // and nothing says it stays that way.
    if (holder.name === name) { holder.depth++; return resolve() }
    if (holder.kind === 'install') {
      return reject(new Error(`"${holder.name}" is being installed, which takes about twenty-five minutes and does not dial in until its first boot. "${name}" is not being started — one machine comes up at a time on this host, and two at once wedges it. Wait for the install, or watch it on the Runners tab.`))
    }
    if (onWait) onWait(holder.name)
    const mine = { name, kind, resolve, reject, timer: null }
    // Only the WAIT is bounded. What runs afterwards takes as long as it takes —
    // an install is half an hour by nature, and a timeout around the work itself
    // would be a machine abandoned half-built.
    mine.timer = setTimeout(() => {
      const at = waiting.indexOf(mine)
      if (at >= 0) waiting.splice(at, 1)
      reject(new Error(`Waited ${Math.round(waitMs / 60000)} minutes for "${holder ? holder.name : 'another machine'}" to finish coming up before starting "${name}". One machine comes up at a time on purpose — two at once wedges this host.`))
    }, waitMs)
    waiting.push(mine)
  })
}

function giveUpTurn () {
  // An inner turn ending is not the turn ending. Only the outermost one hands
  // the host to the next machine.
  if (holder && holder.depth > 1) { holder.depth--; return }
  holder = null
  const next = waiting.shift()
  if (!next) return
  clearTimeout(next.timer)
  holder = { name: next.name, kind: next.kind, depth: 1 }
  next.resolve()
}

async function comingUp (name, fn, { kind = 'boot', waitMs = 12 * 60000, onWait = null } = {}) {
  await takeTurn(name, kind, waitMs, onWait)
  try {
    return await fn()
  } finally {
    giveUpTurn()
  }
}

module.exports = {
  during,
  claim,
  release,
  what,
  comingUp,
  booting,
  all: () => [...doing.entries()].map(([name, job]) => ({ name, job }))
}
