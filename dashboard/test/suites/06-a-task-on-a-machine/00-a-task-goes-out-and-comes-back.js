'use strict'

// a task on a machine — written here, done there, delivered back
//
// The round trip, and the reason the rest of this exists. A branch is cut, a
// task is written on it under an approved job and an approved contract, it is
// QUEUED, and then nothing here touches anything: the queue finds a free
// machine, brings it up, sets up the workspace, dispatches the work, waits for
// it, takes the machine's credential back and puts the machine away.
//
// THE QUEUE DOES THE WORK, NOT THIS DRILL. Every step could be driven by hand —
// vmBorrow, vmWorkspace, taskGive — and doing so would prove that dispatching
// works while saying nothing about whether work left in the queue ever reaches a
// machine. That is the thing that runs unattended at three in the morning, so
// that is the thing under test.
//
// IT USES A JOB THAT DOES NOT CALL CLAUDE. `api-tour` uses every helper a job is
// handed and hands back a file, which is exactly the shape this needs to watch:
// dispatched, ran, delivered, artifact. Waiting on a model would be slower, need
// a credential, and prove less — whether a worker writes good code is not a
// question this suite can answer.

const { it, cleanup } = require('../../../tasks/harness')
const { scratch, aLine } = require('../../helpers')

const JOB = 'api-tour'

it('there is a machine free, a job to run, and this was asked for', async ({ okc, assert, slow, state, log }) => {
  assert.needs(slow, 'this gives a task to a real machine and waits for it — minutes, and it holds a runner. Ask for it with: suiteRun --suite "a task on a machine" --slow true')

  const { jobs } = await okc('jobs')
  const job = (jobs || []).find(j => j.id === JOB && j.approved)
  assert.needs(job, `"${JOB}" is not an approved job here, and an unapproved job is refused on purpose`)

  const { vms } = await okc('vmList')
  const free = vms.filter(v => v.stage === 'ready' && !v.branch && !v.borrowed && v.forTasks !== false && v.baseSnapshot)
  assert.needs(free.length, 'no machine is free, ready and holding nothing — the queue would have nothing to give this to')
  state.machines = free.map(v => v.name)
  state.began = Date.now()
  log(`free and at rest: ${free.map(v => `${v.name} (${v.state}, on "${v.baseSnapshot}")`).join(', ')}`)
  log(`the job is "${job.name}" — ${job.about}`)
}, { gate: true })

it('a cut is made, and a task is written on it', async ({ okc, assert, state, log }) => {
  state.line = await aLine(okc, assert)
  state.branch = scratch('round-trip')
  await okc('branchCreate', { branch: state.branch, reason: 'a drill proving work goes out to a machine and comes back', group: state.line })

  const { contracts } = await okc('contracts')
  const contract = (contracts || []).find(c => c.approved)
  assert.needs(contract, 'no contract is approved, and a task carries the rules a worker is held to')

  state.task = await okc('taskCreate', {
    task: {
      title: 'drill: a task on a machine',
      brief: 'Run the job. This is a drill — the work itself is the job, and the point is that it arrives, runs and comes back.',
      branch: state.branch,
      job: JOB,
      contractId: contract.id
    }
  })
  assert.equal(state.task.state, 'draft', 'A task starts as a draft, and this one did not')
  assert.equal(state.task.jobName, ((await okc('jobs')).jobs.find(j => j.id === JOB) || {}).name, 'The job name did not travel with the task')
  log(`cut "${state.branch}" from line "${state.line}"`)
  log(`task #${state.task.number || state.task.id} "${state.task.title}" written as a ${state.task.state}, under "${state.task.contractName}"`)
})

it('and queued — after which nothing here touches it', async ({ okc, assert, state, log }) => {
  const queued = await okc('taskQueue', { id: state.task.id })
  assert.ok(queued, 'Nothing was said about queueing it')

  const { tasks } = await okc('tasks')
  const mine = tasks.find(t => t.id === state.task.id)
  assert.equal(mine.state, 'queued', `It was queued and reports "${mine.state}"`)
  assert.ok(!mine.machine, 'A queued task has no machine yet — the queue decides that, not whoever wrote it')
  log(`#${mine.number || mine.id} is "${mine.state}" and names no machine — from here nothing in this drill touches it until it is done`)
})

it('the queue gives it to a machine, on its own', async ({ okc, assert, state, log }) => {
  // THE QUEUE TICKS EVERY FIFTEEN SECONDS, so this waits rather than pokes. What
  // is being watched is a task changing state without anybody asking it to,
  // which is the whole claim: work left here is picked up.
  for (let i = 0; i < 60; i++) {
    const { tasks } = await okc('tasks')
    const mine = tasks.find(t => t.id === state.task.id)
    if (mine && mine.machine) { state.machine = mine.machine; break }
    await new Promise(r => setTimeout(r, 5000))
  }
  assert.ok(state.machine, 'No machine took this task within five minutes — the queue never picked it up')

  // AND THEN IT WAITS FOR THE CLAIM, rather than demanding it in the same
  // breath. Being given a task and claiming its branch are minutes apart: in
  // between the machine is rolled back, started, booted, dialled in and set up.
  //
  // The first version asserted both at once and failed on the truth — "runner4
  // took the task and claims nothing" — seven seconds after the queue had picked
  // it up, while the machine was still starting. It then tore the task down
  // underneath a queue that was mid-flight, which the app handled correctly and
  // which the drill had no business doing.
  for (let i = 0; i < 72; i++) {
    const { vms } = await okc('vmList')
    const took = vms.find(v => v.name === state.machine)
    if (took && took.branch === state.branch) { state.claimed = true; break }
    await new Promise(r => setTimeout(r, 5000))
  }
  assert.ok(state.claimed, `${state.machine} was given the task and never claimed ${state.branch} — it is set up on a branch before any work is dispatched to it`)
  log(`the queue chose ${state.machine} without being asked, and it claims "${state.branch}" — ${Math.round((Date.now() - state.began) / 1000)}s after the task was written`)
}, { minutes: 12 })

it('the work runs there and the task ends', async ({ okc, assert, state, log }) => {
  // Ended, whatever the ending. A drill that only accepts "done" cannot tell a
  // failure from a hang, and those want completely different answers.
  let last = null
  for (let i = 0; i < 180; i++) {
    const { tasks } = await okc('tasks')
    const mine = tasks.find(t => t.id === state.task.id)
    last = mine
    if (mine && (mine.state === 'done' || mine.state === 'failed')) break
    await new Promise(r => setTimeout(r, 5000))
  }
  assert.ok(last, 'The task disappeared while it was being worked on')
  assert.notEqual(last.state, 'given', 'The task is still being worked on after fifteen minutes')
  assert.equal(last.state, 'done', `The task ended as "${last.state}" — its log is taskLog --id ${state.task.id}`)
  state.ended = last
  log(`#${last.number || last.id} ended "${last.state}" on ${last.machine}, ${Math.round((Date.now() - state.began) / 1000)}s after it was written`)
}, { minutes: 20 })

it('and what it did came back here', async ({ okc, assert, state, log }) => {
  // THE WHOLE POINT OF A BRANCH. A worker's account of what it did is worth
  // nothing on its own; what it left on the branch is the artifact, and it is
  // here, on this host, after the machine that made it has been wiped.
  const art = await okc('taskArtifact', { id: state.task.id })
  const said = JSON.stringify(art)
  assert.ok(art, 'Nothing is recorded about what the task delivered')

  const files = await okc('taskFiles', { id: state.task.id }).catch(() => ({ files: [] }))
  const commits = (art.repos || []).reduce((n, r) => n + (r.commits || []).length, 0)
  assert.ok(commits > 0 || (files.files || []).length > 0,
    `The task finished and left nothing behind — no commits on ${state.branch} and no files handed over. ${said.slice(0, 200)}`)
  log(`${commits} commit(s) on the branch, and handed over: ${(files.files || []).map(f => `${f.name || f.path} (${f.bytes} bytes)`).join(', ') || 'nothing'}`)
}, { minutes: 5 })

it('and the machine was put away clean', async ({ okc, assert, state, log }) => {
  // The rule the whole queue rests on: a machine goes back to off, on its base
  // snapshot, claiming nothing, holding no credential. A machine that keeps its
  // claim is never picked up again, and that looks exactly like a quiet queue.
  for (let i = 0; i < 60; i++) {
    const { vms } = await okc('vmList')
    const it = vms.find(v => v.name === state.machine)
    if (it && !it.branch && it.state !== 'running') { state.put = it; break }
    await new Promise(r => setTimeout(r, 5000))
  }
  assert.ok(state.put, `${state.machine} still claims a branch or is still running, five minutes after the work ended`)
  assert.ok(!state.put.borrowed, `${state.machine} was left borrowed`)
  log(`${state.machine}: ${state.put.state}, on "${state.put.baseSnapshot}", claiming nothing, holding nothing`)
}, { minutes: 10 })

it('and judging it is refused, because this worker pushed nothing', async ({ okc, assert, state, log }) => {
  // NOT THE CHECK THIS WAS WRITTEN AS, and the change is the app being right.
  //
  // It asked for a verdict — "and it can be judged, which is what all of it was
  // for" — and was told: nothing has arrived on this branch, so there is nothing
  // to judge. That is true. `api-tour` hands a FILE back and never commits, so
  // the branch is exactly as it was cut, and a verdict recorded against it would
  // afterwards be indistinguishable from a verdict on real work.
  //
  // So the drill states what it can actually prove. The delivery it watched in
  // the checks above is an artifact, which is a different thing from a change on
  // a branch, and this is where that difference is enforced.
  //
  // THE ACCEPT PATH IS STILL UNPROVEN, and no job here can prove it: the only
  // credential-free job does not push, and the one that would is a worker with a
  // Claude credential. Proving it needs a job that makes a small change and
  // pushes it — which a person has to write and approve at the window, because
  // approving a job over the wire is refused on purpose.
  const refusal = await assert.refuses(
    () => okc('taskJudge', { id: state.task.id, verdict: 'accept', note: 'a drill: the round trip ran and delivered' }),
    'nothing to judge|without pushing|has arrived',
    'A verdict was recorded on a branch nothing was delivered to')
  log(`refused, and this is what it said:\n${refusal.message}`)

  const { tasks } = await okc('tasks')
  const mine = tasks.find(t => t.id === state.task.id)
  assert.ok(!mine.verdict, 'It was refused and the task carries a verdict anyway')
  log(`#${mine.number || mine.id} ends as "${mine.state}", carrying no verdict`)
})

// IT LETS GO BEFORE IT TIDIES UP. A drill that fails half way leaves a queue
// mid-flight — a machine already starting for a task that is about to be deleted
// — and pulling the branch out from under it is not cleaning up, it is a second
// fault on top of the first.
//
// It happened exactly once and read like this from the app's side: the task was
// removed seven seconds after the queue took it, the branch went a moment later,
// and at 13:57:07 the queue got as far as setting up the workspace and was told
// "There is no branch called drill/round-trip-135601". The refusal was right, the
// machine was left alone and put away, and none of it should have been asked.
//
// So the task is stopped, the machine is given a couple of minutes to be let go,
// and only then does the branch go.
cleanup(async ({ okc, state }) => {
  if (state.task) {
    await okc('taskStop', { id: state.task.id }).catch(() => {})
    await okc('taskRemove', { id: state.task.id }).catch(() => {})
  }
  if (state.branch) {
    for (let i = 0; i < 24; i++) {
      const { vms } = await okc('vmList').catch(() => ({ vms: [] }))
      if (!vms.some(v => v.branch === state.branch)) break
      await new Promise(r => setTimeout(r, 5000))
    }
    await okc('branchDelete', { branch: state.branch, force: true }).catch(() => {})
  }
})

// WHAT IT SAW — 16 August 2026, 14:10, all eight passed
//
//   there is a machine free, a job to run, and this was asked for
//     free and at rest: runner4 (poweroff, on "base"), runner3 (poweroff, on "base")
//     the job is "the whole job API, once each" — Uses every helper a job is
//     handed, on a real machine, and hands the record back
//
//   a cut is made, and a task is written on it
//     cut "drill/round-trip-141015" from line "default"
//     task #98 "drill: a task on a machine" written as a draft, under "how work
//     is delivered"
//
//   and queued — after which nothing here touches it
//     #98 is "queued" and names no machine — from here nothing in this drill
//     touches it until it is done
//
//   the queue gives it to a machine, on its own
//     the queue chose runner4 without being asked, and it claims
//     "drill/round-trip-141015" — 54s after the task was written
//
//   the work runs there and the task ends
//     #98 ended "done" on runner4, 77s after it was written
//
//   and what it did came back here
//     0 commit(s) on the branch, and handed over: api-tour.md
//
//   and the machine was put away clean
//     runner4: poweroff, on "base", claiming nothing, holding nothing
//
//   and judging it is refused, because this worker pushed nothing
//     refused, and this is what it said:
//     Nothing has arrived on "drill/round-trip-141015", so there is nothing to
//     judge. A worker that finished without pushing has delivered nothing.
//     #98 ends as "done", carrying no verdict
//
// SEVENTY-SEVEN SECONDS from writing a task to it being done, on a machine that
// was powered off when it started. The queue's own breakdown that run was
// bringUp 33s, credential 4s, workspace 5s, work 17s — so two thirds of it is a
// machine booting, and the part this app does is the small half.
//
// THE ZERO IS THE INTERESTING NUMBER. Nothing was committed and a file came
// back, which is `api-tour` doing exactly what it says, and it is why the last
// check is a refusal rather than a verdict. An artifact and a change on a branch
// are different deliveries, and only the second one can be judged.
