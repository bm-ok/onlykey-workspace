'use strict'

// driving the app — the surface a supervisor asks this host for work over
//
// A supervisor machine runs Claude Code and its job is to drive this app: cut a
// branch, write a task on it, queue it, and read what came back. It does none of
// the work itself.
//
// THE SURFACE IS AN ALLOWLIST, NOT A FILTER, and that is what this drill is
// really checking. Every action a supervisor may ask for is named in
// core/supervisor.js, one line each — so adding an action to this app adds
// nothing to what a supervisor can do. A rule like "anything that only reads"
// would grant each new capability on the day it was written, to somebody who was
// not thinking about supervisors at all.
//
// ASKED FROM THE MACHINE, not from this host. The host can call any action it
// likes; the question is what a machine gets when it asks, over the wire, with
// its own token. A drill that called core/supervisor.js directly would prove that
// a list is a list.
//
// IT NEEDS A SUPERVISOR MACHINE THAT IS UP, so it says so and stops rather than
// failing when there is none. Everything it makes, it takes away again.

const { it, cleanup, requires } = require('../../../tasks/harness')

requires('the machines are built')

// What it drives through the app, named once. `api-tour` is the job that needs no
// worker credential — this drill is about who may ASK for work, not about whether
// a model does it well.
const BRANCH = 'drill/supervisor-drives'
const TASK = 'a task the supervisor wrote'

// Run something on the supervisor machine as the user would: through its own
// wrapper, in a login shell, so what is proven is the path a model actually has.
const asSupervisor = async (okc, machine, line, what) => {
  const said = await okc('vmRun', { name: machine, command: `bash -lc ${JSON.stringify(line)}`, what })
  // The first line is the dashboard echoing what it ran.
  return String(said.output || '').split('\n').slice(1).join('\n').trim()
}

const readJson = text => {
  const at = text.indexOf('{')
  if (at < 0) return null
  try { return JSON.parse(text.slice(at)) } catch { return null }
}

it('a supervisor machine is up, and it can ask what it may do', async ({ okc, assert, state, log }) => {
  const machines = (await okc('vmList')).vms || []
  const one = machines.find(m => m.supervisor && m.connected)
  assert.needs(one, 'no supervisor machine is dialled in. Make one with the "Supervisor machine" box ticked, start it, and run this again — this drill asks from the machine, because what the host can call is not the question')
  state.machine = one.name

  const said = await asSupervisor(okc, one.name, 'okc', 'asking what a supervisor may do')
  const answer = readJson(said)
  assert.ok(answer && Array.isArray(answer.may), `it did not answer with a list of what it may do: ${said.slice(0, 200)}`)
  assert.ok(answer.may.length > 0, 'a supervisor is allowed to ask for nothing at all, which makes it a machine that can only sit there')

  // EVERY NAME ON THE LIST IS A REAL ACTION. A list is easy to get wrong in the
  // quietest way there is: a typo names something that does not exist, the
  // supervisor asks for it, and the refusal is about the action rather than
  // about permission — so it reads as "you may not" when it means "there is no
  // such thing".
  // A LIST OF OBJECTS, not a map keyed by name. Written the other way round the
  // first time, which made every name on the supervisor's list look invented —
  // `Object.keys` of an array gives "0", "1", "2", so the comparison was against
  // indices and the first name checked failed. A wrong shape reads exactly like a
  // real finding, which is why the drill was run rather than reasoned about.
  const real = new Set(((await okc('actions')).actions || []).map(a => a.name))
  for (const one of answer.may) {
    assert.ok(real.has(one.what), `"${one.what}" is on the supervisor's list and is not an action this app has`)
    assert.ok(one.why && one.why.length > 10, `"${one.what}" is on the list with no reason given, and the reason is what somebody adding a line has to be able to write`)
  }
  state.may = answer.may.map(m => m.what)
  log(`${answer.may.length} things it may ask for: ${state.may.join(', ')}`)
})

it('and everything else does not exist for it', async ({ okc, assert, state, log }) => {
  // THE THREE THAT MATTER, one from each family that is deliberately absent:
  // deleting a machine, approving what a worker may be told, and landing a change
  // outside this host. None of them is a filter decision — they are simply not on
  // the list.
  for (const [what, args] of [['vmRemove', '{"name":"nothing"}'], ['jobApprove', '{"id":"nothing"}'], ['prCutLand', '{"id":"nothing"}']]) {
    const said = await asSupervisor(okc, state.machine, `okc ${what} '${args}'`, `trying "${what}" as a supervisor`)
    assert.ok(/may not ask for/.test(said),
      `a supervisor asked for "${what}" and was not refused for being a supervisor. What came back: ${said.slice(0, 300)}`)
    // AND THE REFUSAL SAYS WHAT IT MAY DO INSTEAD, because the thing reading it
    // is a model that will otherwise try the same call with a different spelling
    // until something answers.
    assert.ok(/What it may ask for:/.test(said), `the refusal for "${what}" does not say what it may ask for instead: ${said.slice(0, 200)}`)
  }
  log('deleting a machine, approving a job and landing a change are all refused, and the refusal says what it may do instead')
})

it('and it can cut a branch, write a task on it, and queue it', async ({ okc, assert, state, log }) => {
  // THE WHOLE POINT, END TO END. A supervisor is a project manager: it decides
  // there is work, cuts somewhere for it to land, writes it down, and puts it in
  // the queue. Everything after that is the app doing what it already does.
  const cut = readJson(await asSupervisor(okc, state.machine,
    `okc branchCreate '${JSON.stringify({ branch: BRANCH, reason: 'a drill: the supervisor cutting a branch', group: 'default' })}'`,
    'cutting a branch as the supervisor'))
  assert.ok(cut && (cut.made || []).length, `the supervisor could not cut a branch: ${JSON.stringify(cut).slice(0, 300)}`)
  state.branch = BRANCH
  log(`cut ${BRANCH} in ${cut.made.join(', ')}`)

  const task = readJson(await asSupervisor(okc, state.machine,
    `okc taskCreate '${JSON.stringify({ task: { title: TASK, brief: 'Written by a drill, over the supervisor API.', branch: BRANCH, job: 'api-tour' } })}'`,
    'writing a task as the supervisor'))
  assert.ok(task && task.id, `the supervisor could not write a task: ${JSON.stringify(task).slice(0, 300)}`)
  state.task = task.id
  log(`wrote #${task.number} "${task.title}" on ${task.branch}`)

  const queued = readJson(await asSupervisor(okc, state.machine,
    `okc taskQueue '${JSON.stringify({ id: task.id })}'`,
    'queueing the task it wrote'))
  assert.ok(queued && queued.state === 'queued', `the supervisor wrote a task and could not queue it: ${JSON.stringify(queued).slice(0, 300)}`)
  log(`#${task.number} is queued — the queue takes it from here`)

  // AND IT CAN TAKE IT BACK OUT, which is the one undo on the list. A supervisor
  // that can queue and not unqueue has to be right first time.
  const back = readJson(await asSupervisor(okc, state.machine,
    `okc taskUnqueue '${JSON.stringify({ id: task.id })}'`,
    'taking it back out of the queue'))
  assert.ok(back && back.state !== 'queued', `it could not take its own task back out of the queue: ${JSON.stringify(back).slice(0, 200)}`)
  log('and it took it back out again, so this drill leaves no work running')
}, { minutes: 5 })

it('and the machine it runs on is never given work itself', async ({ okc, assert, state, log }) => {
  // THE OTHER HALF OF THE SAME IDEA, and the moment it matters is exactly now:
  // this machine is running, dialled in, holding no branch and claiming nothing,
  // which is the shape of a machine the queue would take. It is skipped because
  // of what it IS.
  const queue = await okc('queueState')
  const how = ((queue.machines) || []).find(m => m.name === state.machine)
  assert.ok(how, `the queue says nothing about ${state.machine}`)
  assert.ok(how.free === false, `${state.machine} is driving this app and the queue counts it as free to be given work`)
  assert.ok(/supervisor/i.test(String(how.why || '')), `${state.machine} is held back for the wrong reason: "${how.why}"`)
  log(`${state.machine}: ${how.why}`)
})

cleanup(async ({ okc, state }) => {
  // Through the host's own actions rather than the supervisor's, deliberately:
  // throwing work away is not on a supervisor's list, and a drill that needed it
  // to be would be an argument for putting it there.
  if (state.task) { try { await okc('taskRemove', { id: state.task }) } catch { /* never written */ } }
  if (state.branch) { try { await okc('branchDelete', { branch: state.branch, force: true }) } catch { /* never cut */ } }
})

// ---- WHAT IT SAW ----------------------------------------------------------
//
// 17 August 2026, against supervisor-1 — a machine built with the box ticked,
// running, dialled in, holding nothing. Four checks, thirteen seconds.
//
//     16 things it may ask for: branchBoard, branchCreate, contracts, jobs,
//     judgements, lines, prCuts, prompts, taskArtifact, taskCreate, taskDiff,
//     taskLog, taskProgress, taskQueue, taskUnqueue, tasks
//     PASS a supervisor machine is up, and it can ask what it may do (2s)
//
//     deleting a machine, approving a job and landing a change are all refused,
//     and the refusal says what it may do instead
//     PASS and everything else does not exist for it (3s)
//
//     cut drill/supervisor-drives in local-repo-a, local-repo-b, local-repo-c
//     wrote #122 "a task the supervisor wrote" on drill/supervisor-drives
//     #122 is queued — the queue takes it from here
//     and it took it back out again, so this drill leaves no work running
//     PASS and it can cut a branch, write a task on it, and queue it (8s)
//
//     supervisor-1: is a supervisor machine, so it is never given task work
//     PASS and the machine it runs on is never given work itself (0s)
//
// THE REFUSAL, IN ITS OWN WORDS, since the sentence is what a model acts on:
//
//     A supervisor may not ask for "vmRemove". What it may ask for: tasks,
//     taskProgress, taskArtifact, taskDiff, taskLog, branchBoard, lines, jobs,
//     prompts, contracts, prCuts, judgements, branchCreate, taskCreate,
//     taskQueue, taskUnqueue. Everything else on this host does not exist for a
//     supervisor — it is a named list rather than a filter, so nothing is
//     unlocked by an action being added elsewhere.
//
// AND THE FLOW WAS DRIVEN BY HAND FIRST, before this drill existed: supervisor-1
// cut a branch, wrote #121 under the api-tour job and queued it; the queue gave
// it to runner4, which ran it in 67 seconds — bringUp 36s, credential 4s,
// workspace 4s, work 16s — and put itself away. The supervisor was running and
// dialled in throughout and was never offered the work it had created.
//
// The first run of this file failed on its own bug rather than on the app:
// `actions` hands back a LIST of objects and the drill read it as a map, so
// every name on the supervisor's list looked invented. A wrong shape reads
// exactly like a real finding.
