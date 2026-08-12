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

module.exports = { during, claim, release, what, all: () => [...doing.entries()].map(([name, job]) => ({ name, job })) }
