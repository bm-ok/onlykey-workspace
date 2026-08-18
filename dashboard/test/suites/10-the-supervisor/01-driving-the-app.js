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

it('and it may send a change out, and not land it', async ({ okc, assert, state, log }) => {
  // THE LINE THIS APP DRAWS, and it is a line rather than an absence of one.
  //
  // A supervisor drives work all the way to a pull request: it pulls so it is not
  // deciding from a stale copy, cuts, writes, queues, makes a line out of what
  // came back, and pushes it onward as a pull request per repository. Then it
  // stops. Merging changes what everybody else builds on, and it is the one place
  // a person reads the change and says yes.
  //
  // Checked as a pair, because either half alone is a different tool: allowed to
  // land and this is an app that merges its own work; not allowed to send and it
  // is an app whose work never leaves.
  const may = new Set(state.may || [])
  for (const send of ['prCutMake', 'prDraftSave', 'repoSync', 'repoForkSync', 'branchAsLine']) {
    assert.ok(may.has(send), `a supervisor cannot "${send}", so the work it drives never leaves this host`)
  }
  for (const land of ['prCutLand', 'prCutUpdate', 'prCutForget', 'branchDelete', 'branchDeleteRemote']) {
    assert.ok(!may.has(land), `a supervisor may "${land}", which puts landing or undoing somebody's reading of a change in the hands of the thing that wrote it`)
  }

  // AND A PULL REQUEST IS CHANGED ONLY AS A CUT.
  //
  // A change that lands in two repositories out of three is the failure the
  // whole PR-cut idea exists to prevent, and something driving the flow
  // unattended is exactly what would produce it.
  //
  // BUT THE RULE WAS WRITTEN ABOUT ONE KIND OF PULL REQUEST AND THERE ARE TWO.
  // A cut is this host's own work, one pull request per repository, opened and
  // landed together. An ARRIVED pull request is somebody else's: one repository,
  // one number, and it can never be a cut because this host did not make it.
  // So "everything touching a pull request must be a prCut" is unsatisfiable for
  // the second kind, and it failed on `prComment` — which is how a judge's
  // findings get back to whoever sent the change, and the only way a supervisor
  // can answer an arrival at all.
  //
  // THE LINE IS CHANGING ONE VERSUS SAYING SOMETHING ABOUT ONE. Landing,
  // closing, retitling — those move a change and must be a cut or nothing.
  // Commenting moves nothing: the worst it can do is be wrong in public, which
  // is visible, answerable and the author's to judge. That is a different kind
  // of risk from half a change landing, and collapsing them cost the supervisor
  // its only way of replying.
  const saysSomething = new Set(['prComment'])
  for (const what of may) {
    if (!/^pr/i.test(what)) continue
    if (saysSomething.has(what)) continue
    assert.ok(/^prCut|^prDraft|^prTemplate|^prompt/.test(what),
      `"${what}" is on the supervisor's list and CHANGES a pull request without being a PR cut — a supervisor moves pull requests as one act across every repository, or not at all. If it only says something about one, name it in saysSomething above and say why.`)
  }

  // AND THE EXCEPTION IS NOT A HOLE. Whatever is excused above must not be able
  // to move anything: this checks the list has not quietly grown a second
  // entry, which is how an exception becomes a category.
  assert.equal(saysSomething.size, 1,
    `${saysSomething.size} actions are excused from the PR-cut rule. One is a judgement; several is a category, and a category wants the rule rewritten rather than extended.`)

  // AND ASKED FOR REAL, not only read off the list. prCutLand with a cut that
  // does not exist would be refused either way — what this proves is that it is
  // refused for being a supervisor, before the action is ever reached.
  const said = await asSupervisor(okc, state.machine, "okc prCutLand '{\"id\":\"nothing\"}'", 'trying to merge a change, as a supervisor')
  assert.ok(/may not ask for/.test(said), `a supervisor asked to merge a change and was refused for some other reason: ${said.slice(0, 300)}`)
  log('it may push a change out and open the pull requests; merging them is refused for being a supervisor')
})

it('and all it can see of the machines is their names and their tags', async ({ okc, assert, state, log }) => {
  // A SUPERVISOR DECIDES WHERE WORK GOES, WHICH NEEDS THE KINDS AND NOTHING ELSE.
  //
  // A tag is how a task asks for a kind of machine — "the ones the kit built",
  // "the one with the hardware" — and the queue WAITS for a match rather than
  // falling back, so a supervisor that cannot read the kinds either guesses (and
  // the work waits for ever) or never uses them.
  //
  // WHAT IT MUST NOT SEE IS THE REST OF vmList: addresses, snapshots, which
  // machines are holding a credential, what each was built from. None of that is
  // needed to decide where work goes, and all of it is worth having if you are
  // something that talked its way into this machine.
  const said = await asSupervisor(okc, state.machine,
    "okc pools '{}'", 'asking what kinds of machine there are')
  const pools = readJson(said)
  assert.ok(pools && Array.isArray(pools.pools), `it could not read the pools: ${said.slice(0, 300)}`)

  // Every machine it can see is a name, a tag and whether it is free.
  const seen = [...pools.pools.flatMap(p => p.machines || []), ...((pools.untagged || {}).machines || [])]
  assert.ok(seen.length, 'it can see no machines at all, so it cannot tell where work would go')
  for (const m of seen) {
    assert.ok(m.name, 'a machine came back with no name')
    const fields = Object.keys(m).sort().join(',')
    assert.equal(fields, 'free,name,why',
      `a machine in the pools carries ${fields} — the only things a supervisor needs are its name, whether it is free, and why not`)
  }

  // AND NOT THE THINGS THAT ARE NOT ITS BUSINESS, asked of the whole answer
  // rather than field by field: a new key added to vmList one day would arrive
  // here silently, and this is the check that would notice.
  const whole = JSON.stringify(pools)
  for (const tell of ['address', 'token', 'serial', 'holdsCredential', 'snapshot', 'baseSnapshot', 'spec', 'guest']) {
    assert.ok(!new RegExp(tell, 'i').test(whole),
      `the pools answer contains "${tell}", which is a fact about a machine rather than about where work goes`)
  }

  // AND THE FULL LIST IS NOT ON ITS SURFACE AT ALL.
  const tried = await asSupervisor(okc, state.machine, "okc vmList '{}'", 'trying to read the machine list')
  assert.ok(/may not ask for/.test(tried), `a supervisor read the whole machine list: ${tried.slice(0, 300)}`)

  log(`it sees ${seen.length} machine(s) as name + free, in ${pools.pools.length} tagged pool(s), and vmList is refused`)
})

it('and what it proposes waits for a person', async ({ okc, assert, state, log }) => {
  // THE ASKING IS THE FEATURE; THE APPROVING IS SOMEBODY ELSE'S.
  //
  // A supervisor may propose a job, a prompt or a contract — a project manager
  // who may not suggest anything is not much of one — and what it writes has to
  // come out UNAPPROVED, because a job is a program and approving one is a person
  // saying they have read what will run as them.
  //
  // THIS IS THE CHECK THAT NEARLY WENT THE OTHER WAY. The supervisor route calls
  // the action table in process, exactly as the window does, and a definition
  // written "at the window" is approved by whoever wrote it. So without the route
  // forcing `_overTheWire`, a machine writing a job would have produced an
  // approved one — a program marked as read by nobody.
  const id = 'drill-supervisor-proposes'
  state.job = id
  const made = readJson(await asSupervisor(okc, state.machine,
    `okc jobSave '${JSON.stringify({ id, name: 'a job the supervisor proposed', about: 'written by a drill, over the supervisor API', code: '#!/usr/bin/env node\nconsole.log("okc: a drill proposed this and it must not run until somebody reads it")\n' })}'`,
    'proposing a job, as the supervisor'))
  assert.ok(made && made.id === id, `the supervisor could not propose a job: ${JSON.stringify(made).slice(0, 300)}`)
  assert.ok(made.approved !== true,
    'a job written by a supervisor came back APPROVED, which means a machine wrote a program and marked it read. Approving is a person saying they have read what will run as them')
  log(`it proposed "${made.name}" and it is ${made.approved ? 'APPROVED' : 'waiting to be approved'}`)

  // AND IT CANNOT APPROVE ITS OWN. Refused for being a supervisor, before the
  // action's own over-the-wire refusal is ever reached — two independent
  // refusals, which is the right number for this one.
  const tried = await asSupervisor(okc, state.machine, `okc jobApprove '${JSON.stringify({ id })}'`, 'trying to approve its own job')
  assert.ok(/may not ask for/.test(tried), `a supervisor was allowed to approve its own job: ${tried.slice(0, 300)}`)

  // Read back from this host rather than believed from the answer: what matters
  // is what the library says, since that is what a task would be written under.
  const held = ((await okc('jobs')).jobs || []).find(j => j.id === id)
  assert.ok(held, 'the job it proposed is not in the library')
  assert.ok(!held.approved, `"${id}" is sitting in the library approved, and nobody read it`)
  log('and it cannot approve its own — the library has it, waiting')

  // AND IT CANNOT CLAIM TO BE THE WINDOW. Who asked is decided from `_overTheWire`,
  // which is an argument — so a supervisor putting it in its own body would be a
  // machine saying "a person wrote this", and the whole approval rule rests on
  // that one word. Every key starting with `_` is dropped before the route sets
  // the flag itself; this is the check that says so.
  const lied = 'drill-supervisor-claims-the-window'
  state.job2 = lied
  const sneaky = readJson(await asSupervisor(okc, state.machine,
    `okc jobSave '${JSON.stringify({ id: lied, name: 'a job claiming to be the window', about: 'written by a drill, claiming a person wrote it', code: '#!/usr/bin/env node\n', _overTheWire: false, _driven: true })}'`,
    'proposing a job while claiming to be the window'))
  assert.ok(sneaky && sneaky.id === lied, `the drill could not write the second job: ${JSON.stringify(sneaky).slice(0, 200)}`)
  assert.ok(sneaky.approved !== true,
    'a supervisor claimed its call came from the window, by putting _overTheWire in its own body, and the job it wrote was approved. What arrives over the wire is data, and data does not get to say where it came from')
  log('and a supervisor claiming to be the window is still over the wire')
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

  // TAGGED FOR A MACHINE THAT DOES NOT EXIST, and that is not a detail.
  //
  // This queues a task and takes it straight back out, to prove both. The queue
  // ticks every fifteen seconds and does not know this is a drill — so it won
  // that race, took the task, brought runner4 up and started dispatching a
  // drill's work. Once it got as far as "There is no branch called
  // drill/supervisor-drives", because the cleanup had already deleted it.
  //
  // A tag no machine carries makes the queue WAIT rather than dispatch — which
  // it does by design, saying so on the board — so the task is genuinely queued,
  // genuinely refused a machine, and nothing is brought up behind this drill's
  // back. Proving "it can queue" does not require proving "a machine can be
  // ambushed".
  // AND IT IS REFUSED UNTIL A JUDGE HAS ESTABLISHED THE WORK IS REAL.
  //
  // THIS CHECK PREDATES THE GATE AND WAS FAILING ON IT, which is the honest
  // reason it is written this way now rather than a tidier one: a supervisor
  // cannot see the codebase, so a task it writes without naming the judgement
  // the work came from is work commissioned from a rumour. Asked without one,
  // over the wire, it is refused — and this asks, because the refusal arriving
  // from the supervisor's OWN side is worth more than the same refusal asked of
  // the action table with a flag set.
  const rumour = readJson(await asSupervisor(okc, state.machine,
    `okc taskCreate '${JSON.stringify({ task: { title: TASK, brief: 'Written by a drill, with nothing behind it.', branch: BRANCH, job: 'api-tour', tag: 'okc-no-machine-carries-this' } })}'`,
    'writing a task with no judgement behind it'))
  assert.ok(rumour && /judgement|becauseOf/i.test(JSON.stringify(rumour)),
    `the supervisor wrote a task with nothing behind it: ${JSON.stringify(rumour).slice(0, 300)}`)
  log('refused a task with no judgement behind it, which is the gate')

  // SO ONE IS ESTABLISHED THE WAY A PERSON ESTABLISHES ONE. At the window, not
  // over the wire: a judgement read and concluded by a person is exactly what
  // the gate is there to require, and a drill that had the supervisor conclude
  // its own would be proving the opposite of the rule.
  // NO QUESTION AND NO JOB, and the two go together: a question is what a JUDGE
  // is asked, added to what its prompt says, so one without a judge is refused —
  // correctly, because there would be nobody to ask. A person reading something
  // themselves has no prompt and needs none; what they concluded goes in the
  // verdict's note, which is where anybody would look for it.
  const judged = await okc('judgementCreate', { kind: 'branch', branch: BRANCH, by: 'person' })
  state.judgement = judged.id
  await okc('judgementVerdict', { id: judged.id, verdict: 'accepted', note: 'A drill: there is work to do here.' })
  log(`${judged.ref} is decided, so a task may now be written from it`)

  const task = readJson(await asSupervisor(okc, state.machine,
    `okc taskCreate '${JSON.stringify({ task: { title: TASK, brief: 'Written by a drill, over the supervisor API.', branch: BRANCH, job: 'api-tour', tag: 'okc-no-machine-carries-this' }, becauseOf: judged.ref })}'`,
    'writing a task as the supervisor'))
  assert.ok(task && task.id, `the supervisor could not write a task: ${JSON.stringify(task).slice(0, 300)}`)
  assert.equal(task.becauseOf, judged.ref, 'the task does not record the judgement it was written from, so "why was this done" is unanswerable later')
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
  // BEFORE THE BRANCH. A judgement holds no branch, but one left open against a
  // subject refuses the next judgement of it — so a drill that abandons one
  // blocks the next run of itself, with a message about something being read
  // that nothing is reading.
  if (state.judgement) { try { await okc('judgementRemove', { id: state.judgement }) } catch { /* never asked for */ } }
  if (state.branch) { try { await okc('branchDelete', { branch: state.branch, force: true }) } catch { /* never cut */ } }
  // The proposed job too. An unapproved job left in the library is a drill's
  // leavings sitting in a list a person is meant to read and act on.
  if (state.job) { try { await okc('jobForget', { id: state.job }) } catch { /* never proposed */ } }
  if (state.job2) { try { await okc('jobForget', { id: state.job2 }) } catch { /* never proposed */ } }
})

// ---- WHAT IT SAW ----------------------------------------------------------
//
// 17 August 2026, against supervisor-1 — a machine built with the box ticked,
// running, dialled in, holding nothing. Six checks, half a minute.
//
//     31 things it may ask for: branchArtifact, branchAsLine, branchBoard,
//     branchCreate, changeRead, contracts, jobs, judgements, lineSync, lines,
//     prCutMake, prCutState, prCuts, prDraft, prDraftSave, prTemplatePreview,
//     prompts, repoBranches, repoForkSync, repoOverview, repoSync,
//     repoSyncBranch, repositories, taskArtifact, taskCreate, taskDiff,
//     taskLog, taskProgress, taskQueue, taskUnqueue, tasks
//     PASS a supervisor machine is up, and it can ask what it may do (1s)
//
//     it may push a change out and open the pull requests; merging them is
//     refused for being a supervisor
//     PASS and it may send a change out, and not land it (0s)
//
//     it proposed "a job the supervisor proposed" and it is waiting to be
//     approved
//     and it cannot approve its own — the library has it, waiting
//     and a supervisor claiming to be the window is still over the wire
//     PASS and what it proposes waits for a person (4s)
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
// THE ONE THAT NEARLY WENT THE OTHER WAY. This route calls the action table in
// process, exactly as the window does, and a definition written "at the window"
// is approved by whoever wrote it. The first version of the route passed the
// machine's arguments straight through, so a supervisor writing a job would
// have produced an APPROVED one: a program marked as read by nobody. Asked by
// hand before the check existed, with _overTheWire: false and _driven: true in
// the body, and the answer was "approved": false — the claim is dropped before
// the flag is set.
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
