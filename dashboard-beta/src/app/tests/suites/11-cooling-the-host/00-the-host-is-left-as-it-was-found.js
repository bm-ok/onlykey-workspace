'use strict'

// cooling the host — the machines go, and nothing is left behind
//
// The other end of the kit. See the README beside this file for why it is off
// unless asked for, and why doing it marks the build stage dirty.

// WHAT THE KIT MARKED WHEN IT KEPT A MACHINE BACK. See suite 00: warming holds
// every machine that is not the kit's own, so a drill or a supervisor queuing
// untagged work cannot reach somebody's working runner while the kit is running.
const HELD = 'kit-held'

const { it, requires } = require('../../harness')

// The same two the warming stage builds. Named rather than discovered, because
// removing a machine is the one act here that cannot be undone: a name nothing
// else in this project writes is what makes it safe to do without a judgement
// call.
const OURS = ['kit-1', 'kit-2']

requires('the machines are built')

it('this was asked for', async ({ teardown, assert, log }) => {
  // A GATE, AND A DIFFERENT ONE FROM `slow`. Slow says something is expensive;
  // this says something is destructive. A run that quietly removed the machines
  // would cost whoever is working on this app twenty minutes the next time they
  // ran anything, which is the opposite of what a warm host is for.
  assert.needs(teardown, 'the machines are left standing unless the host is being cooled down on purpose. Ask for it with: suiteRun --suite "cooling the host" --teardown true')
  log('cooling the host down: the kit\'s machines will be removed, disks and all')
}, { gate: true })

it('nothing of the kit\'s is still holding anything', async ({ okc, assert, log }) => {
  // BEFORE ANYTHING IS DELETED. A machine mid-task is a machine with work on it
  // that exists nowhere else — the branch it has not pushed is on that disk and
  // nowhere else — and "it was a test machine" is not a reason to throw that
  // away without saying so.
  const { vms } = await okc('vmList')
  const busy = vms.filter(v => OURS.includes(v.name) && (v.branch || v.borrowed || v.holdsCredential))
  assert.ok(!busy.length,
    `${busy.map(v => `${v.name} (${v.branch ? `claims ${v.branch}` : ''}${v.borrowed ? ' borrowed' : ''}${v.holdsCredential ? ' holds a credential' : ''})`).join(', ')} — something is still using the kit's machines. Let it finish, or take it back, before cooling the host down.`)

  const here = OURS.filter(name => vms.some(v => v.name === name))
  log(here.length ? `${here.join(' and ')} are idle and holding nothing` : 'neither of the kit\'s machines is here — nothing to take away')
})

it('and the kit\'s machines are removed, disks and all', async ({ okc, assert, state, log }) => {
  const { vms } = await okc('vmList')
  const here = OURS.filter(name => vms.some(v => v.name === name))
  if (!here.length) {
    log('nothing to remove — the host is already cold')
    state.removed = []
    return
  }

  const gone = []
  for (const name of here) {
    await okc('vmRemove', { name })
    gone.push(name)
  }
  state.removed = gone

  const after = (await okc('vmList')).vms
  const left = gone.filter(name => after.some(v => v.name === name))
  assert.ok(!left.length, `${left.join(', ')} was removed and is still in the list`)
  log(`${gone.join(' and ')} gone, disks and all`)

  // AND THE STAGE THAT BUILT THEM IS NO LONGER TRUE. Nothing failed — this check
  // passing is what undid it — so the build stage is marked dirty rather than
  // contradicted, and the next run of it will build them again.
}, { minutes: 15, invalidates: 'the machines are built' })

it('and nothing the drills made is left on this host', async ({ okc, assert, log }) => {
  // THE POSTCONDITION FOR THE WHOLE KIT, and the reason every writing drill uses
  // a reserved name. A drill cleans up in its own cleanup, and a cleanup does
  // not run when a process is killed, a machine stops answering, or somebody
  // restarts the dashboard mid-run. This is the sweep that does not depend on
  // any of that having gone well.
  const swept = await okc('drillSweep', { remove: true })
  const left = await okc('drillSweep', {})
  const still = (left.branches || []).length + (left.tasks || []).length + (left.machines || []).length
  assert.equal(still, 0, `the sweep ran and this is still here: ${JSON.stringify(left.branches)} ${JSON.stringify(left.tasks)} ${JSON.stringify(left.machines)}`)

  const took = (swept.gone && ((swept.gone.branches || []).length + (swept.gone.tasks || []).length + (swept.gone.machines || []).length)) || 0
  log(took ? `swept ${took} thing(s) the drills had left: ${swept.note}` : 'the drills left nothing to sweep')
}, { minutes: 5 })

it('and the machines the kit kept back are available again', async ({ okc, assert, log }) => {
  // EXACTLY WHAT IT TOOK, WHICH IS WHY IT MARKED THEM. A machine that was already
  // kept back when the kit started was never marked, and is left exactly as it
  // was found — re-enabling one because it happens to be kept back and untagged
  // would be undoing somebody's decision on the way out.
  const machines = (await okc('vmList')).vms || []
  const ours = machines.filter(m => (m.tags || []).includes(HELD))

  for (const m of ours) {
    await okc('vmForTasks', { name: m.name, enabled: true })
    await okc('vmTags', { name: m.name, tags: (m.tags || []).filter(t => t !== HELD) })
  }

  // Said as the queue sees it, rather than as the register does.
  const pools = await okc('pools')
  const stuck = (pools.pools || [])
    .flatMap(p => p.machines)
    .filter(m => ours.some(o => o.name === m.name) && !m.free)
  assert.ok(!stuck.length, `${stuck.map(m => `${m.name} — ${m.why}`).join('; ')}: given back and still not free to the queue`)

  log(ours.length ? `available again: ${ours.map(m => m.name).join(', ')}` : 'the kit was holding nothing back')
})
