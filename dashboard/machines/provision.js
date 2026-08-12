'use strict'

// Provisioning: the steps that get a machine ready, run in order, streaming into
// the live log.
//
// The steps are configuration on the machine, not code in here. This file knows
// how to run a list and when to stop; it never knows what any step is for.

const log = require('../core/log')
const { at } = require('./run')

// Stops at the first failure. A later step almost always assumes an earlier one
// worked, so continuing past a failure produces a second, confusing error about
// something that was never the problem.
async function provision (machine, steps) {
  const list = steps || machine.provision || []
  const to = log.on('provision', machine.id)

  if (!list.length) {
    to.warn(`"${machine.name}" has no setup steps yet. Add them in its settings.`)
    return { machine: machine.id, steps: [], ok: true }
  }

  to.info(`Setting up "${machine.name}" — ${list.length} step${list.length === 1 ? '' : 's'}`)
  const done = []

  for (const [i, step] of list.entries()) {
    const label = step.name || step.run
    to.info(`Step ${i + 1} of ${list.length}: ${label}`)
    try {
      await at(machine, step.run, { tags: ['provision', machine.id], cwd: step.cwd })
      done.push({ name: label, ok: true })
      to.good(`Step ${i + 1} done`)
    } catch (e) {
      done.push({ name: label, ok: false, why: e.message })
      to.bad(`Step ${i + 1} failed: ${e.message}`)
      to.warn(`Stopped here. The steps after this one were not run, because they would assume this one worked.`)
      return { machine: machine.id, steps: done, ok: false, stoppedAt: i + 1 }
    }
  }

  to.good(`"${machine.name}" is set up.`)
  return { machine: machine.id, steps: done, ok: true }
}

// Is this machine reachable at all? Asked before setting up, because "step 1
// failed" is a worse answer than "that address does not answer".
async function reach (machine) {
  const to = log.on('provision', machine.id)
  try {
    const who = await at(machine, machine.kind === 'ssh' ? 'whoami && uname -a' : 'echo ok',
      { tags: ['provision', machine.id], quiet: true })
    to.good(`"${machine.name}" answers: ${who.split('\n').join(' · ')}`)
    return { reachable: true, as: who }
  } catch (e) {
    to.bad(`"${machine.name}" did not answer: ${e.message}`)
    return { reachable: false, why: e.message }
  }
}

module.exports = { provision, reach }
