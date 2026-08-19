'use strict'

// two tasks at once, each as itself — the whole of it, running
//
// WHAT IS ALREADY CHECKED NEXT DOOR, and is not this: that two machines CAN hold
// two identities, that one identity cannot be on two machines, and that a
// machine with nothing free to hand it is refused rather than given somebody
// else's. All of that is `vmCredentialsPut` asked directly, by hand, one call at
// a time. See 04-two-machines-two-identities.js.
//
// WHAT THIS IS: the same arrangement doing its job without being asked. Two
// tasks are queued and nothing here touches them again. The queue picks the
// machines, lends each one an identity, runs both at the same time, and gives
// both identities back. Every part of that has been checked in isolation and the
// whole had never been run.
//
// THE DRAFT PREDICTED THE HARD PART and was right to: "the queue serialises most
// work, so getting two runs genuinely overlapping is the harder half of writing
// this". It does not serialise dispatch — a task is started and not awaited, so
// the loop over free machines starts both — but it DOES serialise booting, one
// kernel at a time on purpose. So the two runs start minutes apart and have to
// be long enough to overlap in the middle, which is what the job below is for.
//
// IT COSTS NO SIGN-IN AND NO MODEL. The queue hands a machine its identity for
// every task, whatever the job does with it, so a job that sleeps proves the
// lending exactly as well as one that thinks — and this drill is about who holds
// what, not about what the worker said.

const { it, cleanup } = require('../../../tasks/harness')
const { scratch, aLine } = require('../../helpers')

const JOB_ID = 'drill-two-at-once'
const KIND = 'test'

// LONG ENOUGH TO OVERLAP. The second machine cannot start booting until the
// first has its kernel up, so a job that finishes in twenty seconds would have
// the first run over before the second began — and the drill would pass without
// two things ever having been true at once, which is the only thing it is for.
const CODE = `'use strict'

// Slow on purpose, so two of these are running at the same time. Written by a
// drill and removed by it.
module.exports = async ({ log, report }) => {
  const STEPS = 12
  for (let i = 1; i <= STEPS; i++) {
    log('working, step ' + i + ' of ' + STEPS)
    await report('working (' + i + '/' + STEPS + ')')
    await new Promise(r => setTimeout(r, 10000))
  }
  return { finished: true }
}
`

it('two machines free, and two identities to give them', async ({ okc, assert, slow, state, log }) => {
  assert.needs(slow, 'this runs two real tasks on two real machines at the same time — minutes. Ask for it with: suiteRun --suite "a worker credential" --slow true')

  const { vms } = await okc('vmList')
  const free = vms.filter(v => v.stage === 'ready' && !v.branch && !v.borrowed && v.forTasks !== false && v.baseSnapshot)
  const tagged = free.filter(v => (v.tags || []).includes(KIND))
  assert.needs(tagged.length >= 2, `this needs two machines tagged "${KIND}" free at once, and ${tagged.length} is not two — the whole claim is about two of them at the same time`)
  state.tag = KIND

  // TWO THAT ARE FREE, not two that exist. A guest already out on the supervisor
  // is not available to a runner, and a guest with no token in it cannot be lent
  // at all.
  const { guests } = await okc('guests')
  const spare = (guests || []).filter(g => g.role !== 'supervisor' && g.has && !g.holder)
  assert.needs(spare.length >= 2, `this needs two worker sign-ins free at once, and there are ${spare.length}. Held: ${(guests || []).map(g => `${g.name}${g.holder ? ` (out on ${g.holder})` : ''}`).join(', ')}`)
  state.spare = spare.map(g => g.name)

  const saved = await okc('jobSave', {
    id: JOB_ID,
    name: 'drill: slow enough to overlap',
    about: 'Sleeps for two minutes so two of them run at once. Written by a drill and removed by it.',
    code: CODE
  })
  state.job = JOB_ID
  assert.ok(saved.approved, 'the job this drill wrote is not approved, so the queue would refuse it')

  const { contracts } = await okc('contracts')
  const contract = (contracts || []).find(c => c.approved)
  assert.needs(contract, 'no contract is approved, and a task carries the rules a worker is held to')
  state.contract = contract.id

  log(`${tagged.map(v => v.name).join(' and ')} are free; ${state.spare.join(' and ')} are free to lend`)
}, { gate: true, minutes: 6 })

it('two tasks are queued, and nothing here touches them again', async ({ okc, assert, state, log }) => {
  state.line = await aLine(okc, assert)
  state.branches = []
  state.tasks = []

  for (const which of ['one', 'two']) {
    const branch = scratch(`at-once-${which}`)
    await okc('branchCreate', { branch, reason: 'a drill proving two tasks run at once, each as its own identity', group: state.line })
    state.branches.push(branch)

    const task = await okc('taskCreate', {
      task: {
        title: `drill: one of two at once (${which})`,
        brief: 'It sleeps. What is being watched is which identity its machine is holding while it does.',
        branch,
        job: JOB_ID,
        contractId: state.contract,
        tag: state.tag
      }
    })
    state.tasks.push(task)
    await okc('taskQueue', { id: task.id })
  }

  log(`#${state.tasks[0].number} and #${state.tasks[1].number} are queued — from here the queue decides everything`)
}, { minutes: 4 })

it('and the queue runs both at once, each machine as a different identity', async ({ okc, assert, state, log }) => {
  // BOTH IN FLIGHT AT THE SAME MOMENT, which is the claim. Not "both ran" —
  // running one after the other would pass that and prove nothing about two
  // identities existing at once.
  let both = null
  for (let i = 0; i < 120; i++) {
    const { tasks } = await okc('tasks')
    const mine = state.tasks.map(t => (tasks || []).find(x => x.id === t.id))
    const running = mine.filter(t => t && t.machine && t.run && t.state !== 'done')
    if (running.length === 2) { both = running; break }
    await new Promise(r => setTimeout(r, 5000))
  }
  assert.ok(both, 'the two tasks were never in flight at the same moment. Either the queue ran them one after another — in which case two identities at once is still unproven — or one of them failed')

  state.machines = both.map(t => t.machine)
  assert.notEqual(state.machines[0], state.machines[1], 'both tasks went to the same machine, so nothing here is about two of anything')

  // AND WHAT EACH IS HOLDING WHILE IT WORKS.
  const { vms } = await okc('vmList')
  const holding = state.machines.map(name => (vms || []).find(v => v.name === name))
  for (const v of holding) {
    assert.ok(v.holdsCredential, `${v.name} is running work and holds no sign-in — the queue hands one to every task, so this one would fail the moment the work needed it`)
    assert.ok(v.guest, `${v.name} holds a sign-in and does not say which, so nothing could tell two of them apart`)
  }

  // THE WHOLE POINT: DIFFERENT ONES. Handing the same identity to two machines
  // is the failure this list of named guests exists to prevent, and it would
  // look like everything working right up until two workers acted as one.
  assert.notEqual(holding[0].guest, holding[1].guest,
    `both machines are working as "${holding[0].guest}". Two machines sharing one identity is the thing named sign-ins exist to stop`)

  state.held = holding.map(v => ({ machine: v.name, guest: v.guest }))
  log(state.held.map(h => `${h.machine} is working as ${h.guest}`).join(', '))
}, { minutes: 20 })

it('and when both are done, both identities are back', async ({ okc, assert, state, log }) => {
  for (let i = 0; i < 120; i++) {
    const { tasks } = await okc('tasks')
    const mine = state.tasks.map(t => (tasks || []).find(x => x.id === t.id))
    if (mine.every(t => t && t.state === 'done')) break
    await new Promise(r => setTimeout(r, 5000))
  }

  // A GUEST LEFT MARKED AS OUT IS GONE FOR GOOD, in practice: nothing will lend
  // it again, and the only sign is a machine being refused an identity days
  // later for a reason that has nothing to do with it.
  for (let i = 0; i < 24; i++) {
    const { guests } = await okc('guests')
    const ours = (guests || []).filter(g => state.held.some(h => h.guest === g.name))
    if (ours.every(g => !g.holder)) { state.back = ours; break }
    await new Promise(r => setTimeout(r, 5000))
  }
  assert.ok(state.back, `${state.held.map(h => h.guest).join(' and ')} are still marked as out after both runs ended. Nothing will lend them again`)

  // AND OFF THE MACHINES THEMSELVES, which is the half that actually matters:
  // the registry saying a machine holds nothing is worth nothing if the file is
  // still on its disk.
  const { vms } = await okc('vmList')
  for (const h of state.held) {
    const v = (vms || []).find(x => x.name === h.machine)
    assert.ok(!v.holdsCredential, `${h.machine} finished its work and still holds a sign-in`)
    assert.ok(!v.guest, `${h.machine} holds nothing and still names ${v.guest} as its guest`)
  }

  log(`${state.back.map(g => g.name).join(' and ')} are back, and neither machine holds anything`)
}, { minutes: 20 })

cleanup(async ({ okc, state }) => {
  for (const t of state.tasks || []) await okc('taskRemove', { id: t.id }).catch(() => {})

  // The machines let go of their branches before the branches can go. See the
  // cleanup in "a run that loses the network" for what happens otherwise.
  for (const name of state.machines || []) {
    for (let i = 0; i < 24; i++) {
      const v = ((await okc('vmList')).vms || []).find(x => x.name === name)
      if (!v || (!v.branch && !v.borrowed)) break
      await new Promise(r => setTimeout(r, 5000))
    }
  }

  for (const b of state.branches || []) await okc('branchDelete', { branch: b, force: true }).catch(() => {})
  if (state.job) await okc('jobForget', { id: state.job }).catch(() => {})
  state.tasks = null
  state.branches = null
  state.job = null
})
