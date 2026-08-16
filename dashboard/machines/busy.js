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
// EVERYTHING WAITS ITS TURN, AND A TURN IS SHORT. Boots and installs alike.
//
// It was not always: an install used to hold this for its whole length and
// refuse everything else, on the reasoning that twelve minutes is too long to
// wait silently. Both halves of that were wrong.
//
// It never actually held anything — `vmInstall` starts an installer and returns,
// so the hold lasted about four seconds and a second install began straight over
// the top of the first. Proved by doing it, deliberately, to see what would
// happen.
//
// And refusing was the wrong correction. WHAT COMPETES IS THE FIRST MINUTE: a
// snapshot restore and a cold kernel boot, pulling on disk and every core at
// once. After that an install is mostly waiting on a mirror, and two of them
// coexist perfectly well. Blocking the second for twelve minutes would cost most
// of an evening to avoid one minute of contention.
//
// So a turn ends when the machine's console says something — its kernel is up
// and running code — which is a fact reported by the machine rather than a guess
// about how long a boot takes. See untilItSpeaks in actions/machines.js.
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
    // AN INSTALL IS NO LONGER A SPECIAL CASE. It used to hold this for its
    // whole length and refuse everything else, because there was no way to tell
    // when the expensive part was over. There is now: the machine's console
    // starts carrying bytes the moment its kernel is up, and that is where the
    // turn ends — see untilItSpeaks in actions/machines.js. What competes is
    // the first minute, not the twelve.
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

// A BREATH BETWEEN MACHINES, AFTER THE KERNEL IS UP AND BEFORE THE NEXT STARTS.
//
// The turn ends when a machine's console speaks, which is the kernel alive and
// running code — but "alive" is not "settled". The seconds straight after are
// the heaviest of the whole boot: the initrd is handing over, the disk is being
// read hardest, and udev is bringing devices up. Starting the next machine into
// exactly that is what the turn-taking exists to avoid, and ending the turn on
// the first byte hands it over at the worst possible moment.
//
// Five seconds, and it is a settle rather than a guess about how long a boot
// takes — the waiting was already done by listening to the console. Cheap
// against the minutes a boot costs, and the difference between staggering
// machines and merely offsetting them.
const SETTLE_MS = 5000

function giveUpTurn () {
  // An inner turn ending is not the turn ending. Only the outermost one hands
  // the host to the next machine.
  if (holder && holder.depth > 1) { holder.depth--; return }
  holder = null
  const next = waiting.shift()
  if (!next) return
  clearTimeout(next.timer)

  // Held by the machine that is about to start, not left ownerless, or anything
  // arriving during the pause would see a free host and start immediately —
  // which is the race this pause exists to close.
  holder = { name: next.name, kind: next.kind, depth: 1 }
  setTimeout(() => next.resolve(), SETTLE_MS)
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
