'use strict'

// a run that runs out of space — it fails as a run, not as a host
//
// THE QUESTION: a worker that writes until there is no room left — a log, a
// build, a runaway loop. What must not happen is that THIS HOST takes the blame.
// A guest out of space has to read as that run failing, with the reason legible,
// and must not damage what this host keeps about it: the kept log, the record of
// what was given out, the branch.
//
// EIGHT MEGABYTES RATHER THAN FORTY GIGABYTES, and that is a real limit on what
// is proven here rather than a shortcut worth hiding. A VirtualBox dynamic disk
// expands as it is written and NEVER SHRINKS: filling a guest for real grows a
// file on the host permanently, and rolling the machine back does not give the
// space back. So the run fills a small filesystem mounted for the purpose, which
// produces the same ENOSPC from the same system call.
//
// WHAT THAT LEAVES UNTESTED is a draft at the bottom rather than something
// quietly not mentioned: with the ROOT filesystem full the agent may not be able
// to write its own log, and "this host can still say what happened" is exactly
// the claim that gets harder. This checks the run's own failure path; it does
// not check the host's under the same pressure.

const { it, draft, cleanup } = require('../../../tasks/harness')
const { scratch, aLine } = require('../../helpers')

const JOB_ID = 'drill-no-space'
const KIND = 'test'

// The job this writes and throws away.
//
// A DRILL WRITING A JOB IS NOT A WAY ROUND APPROVAL. A drill runs only while
// testing mode is on, which is a person's decision at the window, and the same
// call from the command line would wait to be approved by somebody who read it.
const CODE = `'use strict'

// FILL A FILESYSTEM AND FAIL ON IT. Written by a drill, and removed by it.
//
// Eight megabytes, mounted here, rather than the machine's real disk: a
// VirtualBox dynamic disk expands as it is written and never shrinks, so filling
// the guest for real would cost the host tens of gigabytes permanently. What is
// being checked is what happens to a RUN that runs out of room, and a full 8 MB
// filesystem gives the same ENOSPC as a full 40 GB one.
module.exports = async ({ log, report, sh }) => {
  const DIR = '/tmp/okc-no-space'

  await report('making a small filesystem to fill')
  sh('sudo -n umount ' + DIR + ' 2>/dev/null || true')
  sh('sudo -n rm -rf ' + DIR + ' && sudo -n mkdir -p ' + DIR)
  sh('sudo -n mount -t tmpfs -o size=8m tmpfs ' + DIR)
  sh('sudo -n chmod 0777 ' + DIR)

  log(sh('df -h ' + DIR + ' | tail -1').trim())
  await report('filling it')

  // THE LINE THAT MUST FAIL. sh is execSync, so a non-zero exit throws; the
  // runner prints the stack and exits 1, which is a run that FAILED rather than
  // a machine that went quiet.
  sh('dd if=/dev/zero of=' + DIR + '/fill bs=1M count=64')

  // Reached only if 64 MB fitted into 8 MB.
  throw new Error('the filesystem did not fill, so this run proves nothing')
}
`

it('a machine, and a job that writes until there is no room', async ({ okc, assert, slow, state, log }) => {
  assert.needs(slow, 'this puts a real task on a real machine and waits for it — minutes. Ask for it with: suiteRun --suite "a task on a machine" --slow true')

  const { vms } = await okc('vmList')
  const free = vms.filter(v => v.stage === 'ready' && !v.branch && !v.borrowed && v.forTasks !== false && v.baseSnapshot)
  assert.needs(free.length, 'no machine is free, ready and holding nothing')
  state.tag = free.some(v => (v.tags || []).includes(KIND)) ? KIND : null

  const saved = await okc('jobSave', {
    id: JOB_ID,
    name: 'drill: fill a filesystem',
    about: 'Mounts 8 MB, fills it, and fails. Written by a drill and removed by it.',
    code: CODE
  })
  state.job = JOB_ID
  assert.ok(saved.approved, 'the job this drill wrote is not approved, so the queue would refuse it — a drill presses at the window, and what is written there is approved by the writing')

  state.line = await aLine(okc, assert)
  state.branch = scratch('no-space')
  await okc('branchCreate', { branch: state.branch, reason: 'a drill proving a run out of space fails as a run', group: state.line })

  const { contracts } = await okc('contracts')
  const contract = (contracts || []).find(c => c.approved)
  assert.needs(contract, 'no contract is approved, and a task carries the rules a worker is held to')

  state.task = await okc('taskCreate', {
    task: {
      title: 'drill: a run with nowhere to write',
      brief: 'The job fills a small filesystem and fails on it. What is being watched is the record, not the work.',
      branch: state.branch,
      job: JOB_ID,
      contractId: contract.id,
      tag: state.tag
    }
  })
  log(`#${state.task.number} on "${state.branch}", job "${JOB_ID}"`)
}, { gate: true, minutes: 6 })

it('the run fails, and the machine comes back', async ({ okc, assert, state, log }) => {
  await okc('taskQueue', { id: state.task.id })

  for (let i = 0; i < 60; i++) {
    const { tasks } = await okc('tasks')
    const t = (tasks || []).find(x => x.id === state.task.id)
    if (t && t.machine) { state.machine = t.machine; break }
    await new Promise(r => setTimeout(r, 5000))
  }
  assert.ok(state.machine, 'no machine took this task within five minutes')

  for (let i = 0; i < 96; i++) {
    const { tasks } = await okc('tasks')
    const t = (tasks || []).find(x => x.id === state.task.id)
    if (t && t.state === 'done') { state.done = t; break }
    await new Promise(r => setTimeout(r, 5000))
  }
  assert.ok(state.done, 'the task never ended — a run that fills a filesystem must still end')

  // THE MACHINE IS THE EXPENSIVE THING. A run that ran out of space must not
  // cost one: it comes back, claiming nothing, like any other ended run.
  for (let i = 0; i < 24; i++) {
    const v = ((await okc('vmList')).vms || []).find(x => x.name === state.machine)
    if (v && !v.borrowed && !v.branch) { state.back = v; break }
    await new Promise(r => setTimeout(r, 5000))
  }
  assert.ok(state.back, `${state.machine} did not come back — a run that ran out of space must not cost a machine`)
  log(`#${state.done.number} ran on ${state.machine} and it is back: ${state.back.state}, claiming nothing`)
}, { minutes: 12 })

it('and this host can still say why', async ({ okc, assert, state, log }) => {
  // THE POINT OF THE WHOLE DRILL. A run that died of no space is only useful if
  // somebody can find out that is what happened — and the log is kept HERE,
  // which is what makes it survive the machine being rolled back underneath it.
  const progress = await okc('taskProgress', { id: state.task.id })
  const attempts = progress.attempts || []
  assert.ok(attempts.length, 'no attempt was recorded at all, so this host cannot say anything about what happened')

  const last = attempts[attempts.length - 1]
  const kept = await okc('taskLog', { id: state.task.id, run: last.run })
  const text = String(kept.text || kept.log || '')
  assert.ok(text.length, 'the attempt is recorded but its log was not kept here, so the reason died with the machine')

  // THE REASON, IN THE WORDS THE SYSTEM USED, rather than "it failed". The
  // difference is whether somebody can act on it.
  assert.ok(/No space left on device|ENOSPC/i.test(text),
    `the kept log does not say what went wrong — it should carry the words the system used. It ends: ${text.slice(-300)}`)

  const line = (text.match(/[^\n]*No space left on device[^\n]*/) || ['(ENOSPC, in those words)'])[0]
  log(`kept here, ${text.length} characters, and it says: ${line.trim().slice(0, 90)}`)
})

it('and nothing arrived on the branch', async ({ okc, assert, state, log }) => {
  // A FAILED RUN DELIVERS NOTHING, and the branch is where that is answered. A
  // task can be done and have delivered nothing — two separate questions on
  // purpose, and this is the case that makes them separate.
  const art = await okc('taskArtifact', { id: state.task.id })
  assert.ok(!art.delivered, `something was recorded as delivered by a run that ran out of space: ${JSON.stringify(art.summary || art)}`)
  log(`nothing delivered — ${art.summary || 'the branch carries nothing'}`)
})

cleanup(async ({ okc, state }) => {
  if (state.task) await okc('taskRemove', { id: state.task.id }).catch(() => { /* never written */ })
  if (state.branch) await okc('branchDelete', { branch: state.branch, force: true }).catch(() => { /* nor this */ })
  if (state.job) await okc('jobForget', { id: state.job }).catch(() => { /* nor this */ })
  state.task = null
  state.branch = null
  state.job = null
})

draft('and the same when it is the root filesystem that is full', [
  'WHAT THE CHECK ABOVE DOES NOT COVER, and it is the harder half.',
  'It fills a filesystem mounted for the purpose, so the run fails cleanly while everything around it —',
  'the agent, its log, the channel back to this host — has all the room it needs.',
  'With the ROOT filesystem full, the agent may not be able to write the log that says why,',
  'and "this host can still say what happened" stops being free.',
  'WHY IT IS NOT DONE HERE: a VirtualBox dynamic disk expands as it is written and never shrinks.',
  'Filling a 40 GB guest grows a file on the host by 40 GB, permanently —',
  'rolling the machine back does not give it back.',
  'That is a real cost to somebody\'s disk for one drill, and it is their decision rather than a checkbox.',
  'HOW IT COULD BE DONE CHEAPLY: build a machine with a small FIXED disk for exactly this, tagged so nothing else takes it.',
  'Then filling it is bounded by the disk rather than by how much of the host it is willing to eat.'
].join(' '))
