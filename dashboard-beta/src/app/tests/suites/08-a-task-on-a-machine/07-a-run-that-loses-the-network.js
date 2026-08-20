'use strict'

// a run that loses the network — the view goes, the work does not
//
// THE FAULT THIS GUARDS, and it is the most expensive one in this suite because
// it destroys work that was perfectly fine. The queue waited on a run by polling
// the machine, and a failed poll THREW — out of the wait, out of the task, and
// into the `finally` that puts a machine away. So fifteen seconds of no network
// powered the machine off and rolled it back MID-RUN, while the run itself was
// detached, still going, and about to be destroyed by the thing supervising it.
//
// Pulling the cable for one minute cost the whole task.
//
// WHAT IS TRUE INSTEAD: an outage is something happening to the DASHBOARD, not to
// the work. A run is detached on purpose, so being unable to SEE it is a reason
// to look again rather than a reason to end it. Patience is bounded and generous
// — see OUT_OF_TOUCH in tasks/queue.js — because the cost of waiting too long is
// a machine held, and the cost of giving up too early is somebody's afternoon.
//
// IT RAN AS PROSE ON 13 AUGUST AND PASSED, with nothing checking it since. That
// is the worst state for a property this expensive: believed, and unattended.
//
// HOW THE OUTAGE IS MADE. `vmNetwork` pulls the cable from OUTSIDE the guest,
// which is the honest version — nothing inside the machine is told, and nothing
// in this app is told either. The dashboard finds out the way it would after a
// real outage: by silence.

const { it, draft, cleanup } = require('../../harness')
const { scratch, aLine } = require('../../helpers')

const JOB_ID = 'drill-slow-work'
const KIND = 'test'

// LONG ENOUGH TO PULL A CABLE IN THE MIDDLE OF. Everything this drill is about
// happens while a run is in flight, so the run has to still be in flight after
// the outage has been made, noticed and mended. Three minutes of sleeping, said
// out loud as it goes so the log shows it was alive throughout.
const CODE = `'use strict'

// SLOW ON PURPOSE. Written by a drill and removed by it.
//
// It does nothing but say where it has got to, for long enough that a cable can
// be pulled out and put back while it runs. The point of the drill is that this
// run is untouched by any of that.
module.exports = async ({ log, report, artifact, sh }) => {
  const STEPS = 18
  for (let i = 1; i <= STEPS; i++) {
    log('still here, step ' + i + ' of ' + STEPS)
    await report('working (' + i + '/' + STEPS + ')')
    await new Promise(r => setTimeout(r, 10000))
  }
  // A PATH ON THIS MACHINE, NOT CONTENT: \`artifact\` reads the file it is given.
  const FILE = '/tmp/drill-slow-work.txt'
  sh('echo "this run outlived an outage of the dashboard view of it" > ' + FILE)
  await artifact(FILE)
  return { finished: true, steps: STEPS }
}
`

it('a machine, and work slow enough to interrupt', async ({ okc, assert, slow, state, log }) => {
  assert.needs(slow, 'this puts a real task on a real machine, pulls its network out mid-run and waits — minutes. Ask for it with: suiteRun --suite "a task on a machine" --slow true')

  const { vms } = await okc('vmList')
  const free = vms.filter(v => v.stage === 'ready' && !v.branch && !v.borrowed && v.forTasks !== false && v.baseSnapshot)
  assert.needs(free.length, 'no machine is free, ready and holding nothing')
  state.tag = free.some(v => (v.tags || []).includes(KIND)) ? KIND : null

  const saved = await okc('jobSave', {
    id: JOB_ID,
    name: 'drill: slow work',
    about: 'Says where it has got to for three minutes. Written by a drill and removed by it.',
    code: CODE
  })
  state.job = JOB_ID
  assert.ok(saved.approved, 'the job this drill wrote is not approved, so the queue would refuse it')

  state.line = await aLine(okc, assert)
  state.branch = scratch('lost-network')
  await okc('branchCreate', { branch: state.branch, reason: 'a drill proving a run outlives the dashboard losing sight of it', group: state.line })

  const { contracts } = await okc('contracts')
  const contract = (contracts || []).find(c => c.approved)
  assert.needs(contract, 'no contract is approved, and a task carries the rules a worker is held to')

  state.task = await okc('taskCreate', {
    task: {
      title: 'drill: work that outlives an outage',
      brief: 'The job is slow on purpose. Its network is taken away and given back while it runs.',
      branch: state.branch,
      job: JOB_ID,
      contractId: contract.id,
      tag: state.tag
    }
  })
  log(`#${state.task.number} on "${state.branch}", job "${JOB_ID}"`)
}, { gate: true, minutes: 6 })

it('and once it is really running, the cable comes out', async ({ okc, assert, state, log }) => {
  await okc('taskQueue', { id: state.task.id })

  // WAIT FOR A RUN, NOT FOR A MACHINE. Being given to a machine happens minutes
  // before there is anything to interrupt — in between it is rolled back,
  // started, booted, dialled in and set up. Pulling the cable then would test
  // the setup rather than the waiting, which is a different thing entirely and
  // would fail for reasons that are not the point.
  for (let i = 0; i < 96; i++) {
    const { tasks } = await okc('tasks')
    const t = (tasks || []).find(x => x.id === state.task.id)
    if (t && t.machine) state.machine = t.machine
    if (t && t.run) { state.run = t.run; break }
    await new Promise(r => setTimeout(r, 5000))
  }
  assert.ok(state.run, `no run started within eight minutes${state.machine ? ` on ${state.machine}` : ''}, so there is nothing to interrupt`)

  state.pulled = Date.now()
  await okc('vmNetwork', { name: state.machine, connected: false })
  log(`${state.machine} is running ${state.run}; its cable is out`)
}, { minutes: 12 })

it('and the queue says it cannot see it, rather than giving up on it', async ({ okc, assert, state, log }) => {
  // THE SENTENCE THAT MATTERS. Not that nothing broke — that the app SAYS what
  // has happened to it, because a machine that has gone quiet and a machine that
  // has finished look identical from here until somebody writes the difference
  // down.
  let said = null
  for (let i = 0; i < 30; i++) {
    const lines = ((await okc('events')).events || []).map(e => String(e.text || ''))
    said = lines.find(x => /cannot reach/.test(x) && x.includes(state.machine))
    if (said) break
    await new Promise(r => setTimeout(r, 5000))
  }
  assert.ok(said, `the queue never said it had lost sight of ${state.machine}. Either it has not noticed, or — the fault this exists for — it has already given up and put the machine away`)
  assert.ok(/carries on|detached|regardless/i.test(said), `it noticed, but what it said does not make clear the work is unaffected: "${said}"`)

  // AND THE TASK IS STILL IN FLIGHT. This is the assertion that would have
  // failed before the fix: the run was ended and the machine put away.
  const { tasks } = await okc('tasks')
  const mine = (tasks || []).find(x => x.id === state.task.id)
  assert.notEqual(mine.state, 'done', 'the task was ended while its machine was merely unreachable — losing sight of a run is not the run ending')

  log(said)
}, { minutes: 6 })

it('and when the cable goes back in, the run is found again and finishes', async ({ okc, assert, state, log }) => {
  await okc('vmNetwork', { name: state.machine, connected: true })
  const out = Math.round((Date.now() - state.pulled) / 1000)

  // FOUND AGAIN, IN THOSE WORDS. The app says the run was never in doubt, only
  // its view of it — which is the whole distinction this drill exists to keep.
  let back = null
  for (let i = 0; i < 48; i++) {
    const lines = ((await okc('events')).events || []).map(e => String(e.text || ''))
    back = lines.find(x => /answering again/.test(x) && x.includes(state.machine))
    if (back) break
    await new Promise(r => setTimeout(r, 5000))
  }
  assert.ok(back, `${state.machine} was reachable again and the queue never said so — it should notice, and say the run was never in doubt`)
  log(`out of touch for ${out}s — ${back}`)

  for (let i = 0; i < 96; i++) {
    const { tasks } = await okc('tasks')
    const t = (tasks || []).find(x => x.id === state.task.id)
    if (t && t.state === 'done') { state.done = t; break }
    await new Promise(r => setTimeout(r, 5000))
  }
  assert.ok(state.done, 'the run never finished after the network came back')

  // AND IT ENDED NORMALLY. Not abandoned, not unreachable — the outage was the
  // dashboard's, and the work never knew about it.
  const ended = ((await okc('events')).events || []).map(e => String(e.text || ''))
    .find(x => x.includes(`#${state.done.number} done`))
  assert.ok(ended, `nothing said #${state.done.number} was done`)
  assert.ok(!/abandoned|unreachable/.test(ended), `the run outlived the outage and was still reported as ${ended.replace(/^.*done — /, '')} — "we stopped being able to see it" must not become "it failed"`)
  log(ended)
}, { minutes: 15 })

it('and what it made came home', async ({ okc, assert, state, log }) => {
  // THE LAST WORD ON WHETHER THE WORK SURVIVED: the file it wrote is here. A run
  // reported as finished that handed back nothing would mean the outage cost the
  // work after all, quietly.
  //
  // `taskFiles`, NOT `taskArtifact`. They answer two different questions and the
  // difference is easy to miss: taskArtifact is about what landed on the BRANCH
  // — commits — and this job commits nothing, so it answers "nothing has arrived
  // on this branch yet", correctly, about a run that handed back a file
  // perfectly well. Asked the wrong one first, and the honest answer to the
  // wrong question looked exactly like the work having been lost.
  const handed = await okc('taskFiles', { id: state.task.id })
  const files = handed.files || []
  assert.ok(files.length, 'the run finished and handed nothing back, so the outage cost the work after all — quietly, which is the worst way')
  assert.ok(files.some(f => /drill-slow-work/.test(f.name || f.path || '')),
    `something came back but not what the job made: ${files.map(f => f.name || f.path).join(', ')}`)
  log(`handed over: ${files.map(f => `${f.name || f.path} (${f.bytes} bytes)`).join(', ')}`)
})

cleanup(async ({ okc, state }) => {
  // THE CABLE FIRST, ALWAYS. A drill that fails halfway leaves a machine with no
  // network, which looks like a broken machine for ever afterwards and is the
  // one thing here that does not fix itself.
  if (state.machine) await okc('vmNetwork', { name: state.machine, connected: true }).catch(() => { /* it is off, or already plugged in */ })

  // THEN WAIT FOR THE MACHINE TO LET GO OF THE BRANCH.
  //
  // A task ending and its machine being put away are not the same moment: the
  // queue stops it, rolls it back and clears the claim afterwards. Deleting the
  // branch in between is refused — correctly, a claimed branch is somebody's —
  // and the first version of this cleanup did exactly that and left a
  // drill/lost-network-* branch behind on every run, including the passing ones.
  //
  // The suite next door says this in its own cleanup: the machine first, because
  // a branch that cannot be deleted because a machine claims it is a worse mess
  // than a branch left behind.
  if (state.machine) {
    for (let i = 0; i < 24; i++) {
      const v = ((await okc('vmList')).vms || []).find(x => x.name === state.machine)
      if (!v || (!v.branch && !v.borrowed)) break
      await new Promise(r => setTimeout(r, 5000))
    }
  }

  if (state.task) await okc('taskRemove', { id: state.task.id }).catch(() => {})
  if (state.branch) await okc('branchDelete', { branch: state.branch, force: true }).catch(() => {})
  if (state.job) await okc('jobForget', { id: state.job }).catch(() => {})
  state.task = null
  state.branch = null
  state.job = null
  state.machine = null
})

draft('and past the bound, a run that FINISHED is thrown away with the disk', [
  'THE OTHER HALF OF THE SAME RULE, and reading the code to answer a question about it',
  'made it a bigger claim than it looked. Patience is bounded: ten minutes out of touch and',
  '`waitForRun` returns "unreachable", after which the `finally` puts the machine away —',
  'which stops it and ROLLS IT BACK TO BASE.',
  '',
  'SO THE INTERESTING CASE IS NOT THE ONE THIS WAS FIRST WRITTEN FOR. "It should say',
  'unreachable rather than finished" is true and is the easy half.',
  '',
  'WHAT IS ACTUALLY LOST, worked out by following what delivery needs rather than by assuming.',
  'EVERYTHING A RUN DELIVERS GOES OVER THE SAME NETWORK THAT IS DOWN: `gitUrl` points at this',
  'host\'s git server, so a push fails exactly as `artifact` does. A run that "finished',
  'successfully" during an outage is therefore mostly hypothetical -- anything it tried to hand',
  'over would have failed at the handover and exited non-zero.',
  '',
  'The two things genuinely destroyed by the rollback are quieter than that and worse to lose:',
  'THE RUN\'S LOG, which lives in out.log ON THE GUEST and is pulled across by taskProgress --',
  'attempted before putAway, failing while unreachable, and then discarded. That is the account',
  'of WHY it failed. And ANY WORK FINISHED ON DISK BUT NOT YET DELIVERED: a worker that spent',
  'four minutes editing files and had not pushed when the cable went. That exists on that disk',
  'and nowhere else.',
  '',
  'WORTH SETTLING BEFORE WRITING THE CHECK: whether putAway should ask the machine what it has',
  'before it rolls it back — which is a change to the app, not to this file, and is the same',
  'shape as the rule adoption already follows (the machine is the thing being asked about,',
  'so asking the machine cannot be stale).',
  '',
  'AND A THIRD THING THIS DRILL DOES NOT COVER: a job that hands its artifact back WHILE the',
  'cable is out. `log` and `report` swallow their errors, `artifact` throws — with one retry,',
  'one second later, for connection-gone errors only. So a run can do four minutes of real work',
  'and end as "exit 1, nothing handed back" because the handover landed in the outage.',
  'That has happened here for real, to a judge that had written a 22,000-character survey.',
  'This drill hands its file back AFTER the cable is plugged in, deliberately, so it proves',
  'the waiting rather than the handover.',
  '',
  'HOW THE BOUND ITSELF COULD BE CHECKED CHEAPLY: OUT_OF_TOUCH is a constant in tasks/queue.js.',
  'Naming it where a drill can read it — the way `stranded` was separated from `adopt` — would',
  'let the decision be asked in milliseconds instead of waited out in ten minutes, which is the',
  'same move that turned the six-hour draft next door into a 49-second check.'
].join(' '))
