'use strict'

// Work waits for a machine; a machine does not wait for work.
//
// THE NATURAL STATE OF A RUNNER IS OFF. That is the whole shape of this file.
// A machine is not a thing you keep warm and hand jobs to -- it is switched on
// because there is something to do, brought to a known state, given exactly one
// task, and switched off again when that task is done. Between tasks there is
// nothing running, nothing holding a credential, and nothing to go stale.
//
// So a task does not name a machine. It waits, and the first machine that is
// free takes it. Which machine did the work is a fact recorded afterwards rather
// than a decision made in advance, and that is what makes a second runner useful
// without anybody rebalancing anything.
//
// CLEAN FIRST, AND THAT MEANS ROLLED BACK. A machine that has done a task is
// carrying that task: its branch, its checkout, its files, whatever the worker
// left in a home directory. Reusing it would let one task's leavings reach
// another's work, which is not a hypothetical -- the whole reason a task is
// judged by its branch is that anything else is somebody's account of what
// happened. So the machine is restored to its base snapshot before it is
// started, every time, and a machine with no base snapshot is not available:
// there is nowhere clean to bring it back to.
//
// EVERY STEP GOES THROUGH THE ACTIONS. This drives the same surface a person
// drives, so every refusal still applies -- the protected default, the branch
// claim, a machine that may not be moved off its branch. A scheduler with its
// own private path to the machines would be a second set of rules, and the
// second set is always the one that turns out to be wrong.

const TICK = 15000

// One task at a time per machine, and one machine at a time per task. Held in
// memory rather than in the task file because it describes what THIS process is
// doing right now: a dashboard that has just restarted is not running anything,
// whatever the file says, and a stale claim in a file would keep a machine out
// of service until somebody noticed.
const busyWith = new Map()

const workspaces = require('../core/workspaces')
// Read for one thing only: whether the supervisor is to be woken when a task
// lands. See the end of run().
const settings = require('../core/settings')
// The registry, for the one thing here that is a claim rather than an act: a
// machine handed over to a person has to be marked borrowed, and `vmBorrow`
// cannot do it because it brings the machine up as part of borrowing it.
const vms = require('../machines/vms')
// The one tag this app gives a meaning to. See vms.js.
const { SUPERVISOR } = vms
const store = require('./store')
// The other kind of work this dispatches. Its own store, because a judgement is
// a different record about a different subject — see the head of it.
const judging = require('./judging')
// What a judgement hands back, which is the only way it can say anything: it may
// not push to what it is reading.
const files = require('./files')
// What a judgement was read against, for the record it leaves behind.
const judgements = require('../repos/judgements')
// The two things that arrive on their own: an issue somebody filed and a pull
// request somebody proposed. See repos/watching.js.
const watching = require('../repos/watching')
// Which repository in this workspace a name GitHub uses refers to. A pull
// request is named owner/name and a repository here is called something
// shorter, and reading one means knowing which is which.
const remotes = require('../repos/remotes')
const channel = require('../machines/channel')
// One machine coming up at a time, across the whole host — see bringUp below.
const busy = require('../machines/busy')

let running = false
let timer = null
// Said once when it goes quiet, not on every tick. See `tick`.
let idleSaid = false

function begin (actions, log) {
  if (timer) return
  // Adopted before anything new is started, so a restart mid-task does not hand
  // that machine a second one.
  adopt(actions, log).catch(() => { /* said inside */ })
  timer = setInterval(() => tick(actions, log).catch(e => log.on('queue').warn(e.message)), TICK)
  if (timer.unref) timer.unref()
}

const stop = () => { if (timer) { clearInterval(timer); timer = null } }

// ---- who is free -------------------------------------------------------

// A machine that can be given something, and the reasons one cannot.
//
// Reported with a reason rather than filtered silently, because "nothing is
// running and nothing is queued either" and "everything is queued and no machine
// can take it" look identical from outside and want opposite responses.
function availability (vms) {
  return vms.map(v => {
    // BORROWED BY A PERSON, which is not the same as kept back. Kept back is a
    // standing decision about a machine; borrowed is somebody using it right
    // now -- signing a worker in, or sitting in it with an editor open -- and it
    // ends when they say so. Checked first because it is the most specific and
    // the most temporary: a machine somebody is inside is the one the queue must
    // not roll back, whatever else is true of it.
    if (v.borrowed) return { name: v.name, free: false, why: `borrowed — ${v.borrowed.why || 'somebody is using it'}` }

    // A SUPERVISOR IS NOT IN THE POOL AT ALL, and this is not a preference.
    //
    // A supervisor machine runs Claude Code to decide what work to give and asks
    // this dashboard for it. Giving it a task would roll it back to its base
    // snapshot mid-thought and run a worker over the top of the thing that was
    // handing out the work — so it is out, permanently, and by the tag it was
    // built with rather than by a setting somebody can flip.
    //
    // Checked before `forTasks`, which is a decision that can be changed: this
    // one cannot, and reporting it as "kept back" would suggest a button exists.
    if ((v.tags || []).some(t => String(t).toLowerCase() === SUPERVISOR)) {
      return { name: v.name, free: false, why: 'is a supervisor machine, so it is never given task work' }
    }

    // A decision, checked before any of the facts. Someone has said keep this
    // one back, and that outranks it merely looking idle -- which is exactly
    // what a machine somebody is about to use looks like.
    if (v.forTasks === false) return { name: v.name, free: false, why: 'is kept back from the queue' }
    if (busyWith.has(v.name)) return { name: v.name, free: false, why: `doing ${busyWith.get(v.name)}` }
    if (!v.baseSnapshot) return { name: v.name, free: false, why: 'has no base snapshot to come back to, so it cannot be made clean' }
    if (v.branch) return { name: v.name, free: false, why: `still claims ${v.branch}` }
    if (v.stage && v.stage === 'installing') return { name: v.name, free: false, why: 'is being installed' }
    return { name: v.name, free: true, why: null }
  })
}

// ---- the loop ----------------------------------------------------------

// HOW OFTEN THIS HOST LOOKS AT GITHUB, when it is looking at all.
//
// Five minutes, and the number is a judgement rather than a tuning knob: an
// issue that waits five minutes has lost nothing, and a rate limit spent on
// looking is one not available for the work. The queue ticks every fifteen
// seconds and this is checked on each of them -- checking a clock is free,
// and asking GitHub is not.
const LOOK_EVERY = 5 * 60 * 1000
let lookedAt = 0
let looking = false

async function watchIfItIsTime (actions, log) {
  if (looking) return
  if (settings.read().watchGitHub !== true) return
  if (Date.now() - lookedAt < LOOK_EVERY) return
  looking = true
  lookedAt = Date.now()
  try {
    const said = await watching.look()
    for (const one of said.trouble) log.on('github').warn(`could not read the ${one.kind}s on ${one.on}: ${one.why}`)

    // WHAT IS NEW, AND WHAT MOVED. A pull request pushed to since the last
    // look is the same number and a different change, and anything decided
    // about the old commit no longer describes it -- which is worth saying
    // as loudly as a new one arriving.
    const news = [
      ...said.fresh.map(o => `${o.kind === 'issue' ? 'issue' : 'pull request'} ${o.on}#${o.number} "${String(o.title || '').slice(0, 60)}"`),
      ...said.moved.map(o => `${o.on}#${o.number} has been pushed to since it was last read`)
    ]
    if (!news.length) return

    for (const line of news) log.on('github').good(`arrived: ${line}`)

    // AND THE SUPERVISOR IS TOLD, if it answers by itself at all. The same
    // switch as everywhere else: this host may notice without anything being
    // woken, which is the state somebody watching by hand wants.
    if (settings.read().supervisorWakes === true) {
      actions.supervisorWake.run({ why: `arrived on GitHub — ${news.join('; ')}` })
        .catch(e => log.on('supervisor').warn(`it could not be woken about GitHub: ${e.message}`))
    }
  } catch (e) {
    log.on('github').warn(`could not look at GitHub: ${e.message}`)
  } finally {
    looking = false
  }
}

async function tick (actions, log) {
  if (running) return

  // NOTHING TO DISPATCH WHEN THERE IS NOWHERE TO DELIVER.
  //
  // Read through the store this would have returned an empty board and idled
  // quietly, which is the right OUTCOME reached by the wrong route: "no tasks"
  // and "no workspace" are different sentences, and a queue that cannot tell
  // them apart is one that would happily dispatch the moment a stale file
  // answered. Said once, on the tick after it closes, because a heartbeat every
  // fifteen seconds saying nothing is happening is how a log stops being read.
  if (!workspaces.open()) {
    if (!idleSaid) { idleSaid = true; log.on('queue').info('no workspace is open — nothing is dispatched until one is') }
    return
  }
  idleSaid = false

  running = true
  try {
    // ---- HAS ANYTHING ARRIVED FROM OUTSIDE ------------------------------
    //
    // The two things that turn up on their own: an issue somebody filed, and
    // a pull request somebody proposed. Nothing else in this app arrives --
    // every other piece of work starts with a person or a supervisor writing
    // it down.
    //
    // ON THE QUEUE RATHER THAN THE DRAW LOOP, and every few minutes rather
    // than every few seconds. The rule this respects is that a paint function
    // must not reach the network; this is the queue, which already runs
    // whether or not a window is open, and it is off until somebody switches
    // it on. See repos/watching.js.
    //
    // NOT AWAITED INTO THE DISPATCH PATH. A slow GitHub is not a reason for
    // the queue to stop giving out work, so this is fired and let go, exactly
    // like waking the supervisor is.
    watchIfItIsTime(actions, log)

    const { tasks } = await actions.tasks.run({})
    // Oldest first WITHIN A KIND, and judgements ahead of tasks — see `order`
    // at the foot of this file, which is the one place that rule is written and
    // is what the Queue tab reports. Everything here is a task today, so this
    // is exactly the old ordering until there is a second kind to sort.
    //
    // A PERSON'S TASK IS NEVER PICKED UP HERE, wherever it got its state from.
    // The queue's job is to find work nobody is doing and give it to a worker,
    // and a task that says a person is doing it is not that — dispatching one
    // rolls a machine back to a snapshot and runs Claude over the top of it.
    // Belt and braces with the adoption rule above: this is the door, and it
    // should be shut whether or not something upstream went wrong.
    // BOTH KINDS IN ONE LINE, and `order` puts judgements at the front of it.
    //
    // A judgement written for a person is skipped for exactly the reason a
    // person's task is: the queue's job is to find work nobody is doing and give
    // it to a worker, and dispatching one would roll a machine back and run
    // Claude over a change somebody was reading themselves.
    const toJudge = judging.read()
      .filter(j => j.state === 'queued' && j.by !== 'person' && j.job)
      .map(j => ({ ...j, kind: 'judgement', ref: judging.refOf(j.number) }))

    const waiting = order([
      ...toJudge,
      ...tasks.filter(t => t.state === 'queued' && t.worker !== 'person').map(t => ({ ...t, kind: 'task', ref: `#${t.number}` }))
    ])
    if (!waiting.length) return

    const { vms } = await actions.vmList.run({})
    const free = availability(vms).filter(a => a.free)
    if (!free.length) return

    // WHICH MACHINES A TASK WILL ACCEPT.
    //
    // A task with no tag takes anything free, which is what every task did
    // before this existed and is still the ordinary case. A task WITH a tag
    // takes only machines carrying it — "run this on the test machines", "run
    // this on the one with the hardware plugged in" — and waits rather than
    // taking somebody else's.
    //
    // WAITS, RATHER THAN FALLING BACK. A tag that quietly means "prefer" is a
    // tag that sends work to the wrong machine on a busy afternoon, which is the
    // one thing somebody who bothered to tag a machine was trying to prevent.
    // The board says a tagged task is waiting for a tagged machine; nothing
    // happens silently.
    const tagsOf = name => (vms.find(v => v.name === name) || {}).tags || []
    // The rule itself is at the foot of this file, so what this dispatches by and
    // what `taskQueue` promises are the same function rather than two readings
    // of the same paragraph.
    const willTake = (task, machine) => takes(task, tagsOf(machine.name))

    for (const task of waiting) {
      // Taken from the free list by MATCH rather than by position, so a tagged
      // task waiting for a machine it cannot have does not hold up the ones
      // behind it that would take anything.
      const at = free.findIndex(m => willTake(task, m))
      if (at < 0) {
        if (String(task.tag || '').trim()) {
          log.on('queue').info(`${task.ref} wants a machine tagged "${task.tag}" and none is free — it waits`)
        }
        continue
      }
      const next = free.splice(at, 1)[0]
      if (!next) break
      // Claimed synchronously, before any await, so two ticks cannot hand the
      // same machine to two tasks.
      busyWith.set(next.name, task.ref)

      // A JUDGEMENT GOES DOWN ITS OWN PATH. It shares everything up to the point
      // where work is given — a machine, rolled back, dialled in, holding a
      // credential — and then differs in the two ways that matter: it is set up
      // on what it READS, and it may not push to it. See runJudgement.
      if (task.kind === 'judgement') {
        runJudgement(actions, log, task, next.name).catch(async e => {
          log.on('queue', next.name).bad(`${task.ref} — ${e.message}`)
          try {
            judging.update(task.id, {
              state: 'done',
              attempts: [...(task.attempts || []), { machine: next.name, at: new Date().toISOString(), failed: e.message }]
            })
          } catch { /* the log already carries it */ }
        })
        continue
      }

      run(actions, log, task, next.name).catch(async e => {
        log.on('queue', next.name).bad(`#${task.number} — ${e.message}`)
        // A task whose setup failed has to LAND somewhere.
        //
        // It threw before it could be marked done, so it stayed in `given` for
        // ever: not queued, so nothing would pick it up; not done, so the board
        // showed it working with no worker anywhere; and on the next restart the
        // queue would adopt it and put its machine away all over again.
        //
        // Marked done rather than re-queued, deliberately. The attempt happened
        // and produced nothing, which is a true and useful thing to see -- and a
        // task that re-queues itself onto a machine that just failed to boot
        // does that for ever, quietly, with nobody deciding anything.
        try {
          await actions.taskUpdate.run({
            id: task.id,
            task: {
              state: 'done',
              attempts: [...(task.attempts || []), { machine: next.name, at: new Date().toISOString(), failed: e.message }]
            }
          })
        } catch { /* the log already carries it */ }
      })
    }
  } finally {
    running = false
  }
}

// ---- one judgement, start to finish ------------------------------------
//
// The same shape as a task run, and deliberately not the same function. What is
// shared is the machine handling — rolled back, brought up, given a credential,
// put away afterwards — and those are called here rather than copied. What
// differs is the two things that make a judgement a judgement:
//
//   IT IS SET UP ON WHAT IT READS. A branch cut is read on its own branch; a PR
//   cut is read on the line the pull requests were opened from, because that is
//   where the change is. Reading code means having it, so the machine is set up
//   exactly as a worker's would be.
//
//   AND IT MAY NOT PUSH. Being set up on a branch is what every other machine's
//   permission to push is MADE of, so this would otherwise hand a judge the
//   right to write to the very line it is judging. The refusal is on the host,
//   in the git route, where no guest can edit it — see server.js. Nothing here
//   relies on the judging job being written politely.
//
// What it hands back it hands back as artifacts, filed under the judgement,
// which is the only way it can say anything at all.
async function runJudgement (actions, log, judgement, machine) {
  const to = log.on('queue', machine)
  const id = judgement.id
  const ref = judgement.ref || judging.refOf(judgement.number)

  const spent = {}
  const began = Date.now()
  const phase = async (name, fn) => {
    const at = Date.now()
    try { return await fn() } finally { spent[name] = Date.now() - at }
  }

  // WHICH BRANCH CARRIES THE CHANGE. A judgement's subject is never a branch it
  // owns — this is where the code it must read happens to live.
  const subject = judgement.subject || {}

  // INSIDE THE TRY, AND THAT IS THE WHOLE POINT OF MOVING IT.
  //
  // This resolution used to sit above, where a throw skipped the `finally` that
  // puts the machine away and takes it out of `busyWith` — so the FIRST failure
  // any judgement can have was also the one failure that leaked a machine. It
  // was found the first time a subject this could not resolve reached the queue:
  // kit-1 read "doing J36" with nothing on it and nothing coming, and the queue
  // would not have touched it again until a restart.
  //
  // Nothing had started yet, so nothing was left running and no credential was
  // out — but that is luck about WHERE the throw was, not a property of the
  // code. Anything that fails between here and `bringUp` has the same shape.
  try {
    // AN ARRIVED PULL REQUEST IS NOT A BRANCH IN THIS WORKSPACE UNTIL IT IS
    // BROUGHT HERE.
    //
    // A branch cut and a PR cut are both this host's own work and are already
    // in the repositories. A pull request from outside is on GitHub and nowhere
    // else, so the first step of reading one is fetching `refs/pull/<n>/head`
    // into a local branch — which `prFetch` does, and which CHECKS THE
    // ALLOWANCE AGAIN as it goes.
    //
    // Checked twice on purpose. The first check is at judgementCreate, minutes
    // or hours ago; this one is now, against the commit GitHub has now. In
    // between, the author may have pushed — and what a person allowed was a
    // commit, not a pull request number.
    let reading = null
    let branch = null

    if (subject.kind === 'pull') {
      // WHICH REPOSITORY HERE, from the name GitHub uses. The subject carries
      // owner/name because that is where a pull request lives; a repository in
      // this workspace is called something shorter.
      const row = remotes.read().find(x =>
        x.repo === subject.on ||
        x.issuesOn === subject.on ||
        (x.remote && `${x.remote.owner}/${x.remote.repo}` === subject.on))
      if (!row) throw new Error(`${ref} reads ${subject.on}, and no repository in this workspace is that.`)

      const got = await phase('fetching', () => actions.prFetch.run({ repo: row.repo, number: subject.number }))
      to.info(`${ref}: ${subject.on}#${subject.number} is here as "${got.branch}" at ${String(got.head).slice(0, 7)}`)

      // AND IT IS THE COMMIT THAT WAS JUDGED. `prFetch` proves somebody allowed
      // what is on GitHub now; this proves what is on GitHub now is what this
      // judgement was written about. A judgement of a different commit filed
      // under this one's name is the thing every "current" question downstream
      // would then be answering wrongly.
      if (subject.sha && got.head && String(got.head) !== String(subject.sha)) {
        throw new Error(`${ref} was written about ${String(subject.sha).slice(0, 7)} and ${subject.on}#${subject.number} is now at ${String(got.head).slice(0, 7)}. Ask for a judgement of the commit it is on.`)
      }

      reading = { repo: row.repo, branch: got.branch }
      branch = got.branch
    } else {
      branch = subject.kind === 'cut' ? subject.source : subject.branch
      if (!branch) throw new Error(`${ref} does not say what it is reading, so there is nothing to set a machine up on.`)
    }

    to.info(`${ref} "${judgement.title}" -> ${machine}`)
    judging.update(id, { state: 'given', machine })

    await phase('bringUp', () => bringUp(actions, to, machine))
    await phase('credential', () => actions.vmCredentialsPut.run({ name: machine }))
    await phase('workspace', () => actions.vmWorkspace.run({
      name: machine,
      branch,
      // Only set when what is being read arrived from outside: the pull
      // request's branch in its own repository, every other repository on its
      // default, and nothing claimed anywhere. See vmWorkspace.
      reading,
      // What this machine is for, left on it so it can say so if it dials back
      // in. A judgement says what it is READING, which is the honest sentence
      // for a machine that will not be delivering anything.
      task: subject.kind === 'pull'
        ? `${ref}: reading ${subject.name} — a pull request that arrived from outside this workspace. The change is on "${branch}" in ${reading.repo}; every other repository is on its default so you can say whether any of them needed changing too. Hand findings back as files; this machine may not push anywhere.`
        : `${ref}: reading ${subject.name} — a judgement. Hand findings back as files; this machine may not push.`
    }))

    const started = await actions.jobRun.run({
      id: judgement.job,
      judgement: id,
      name: machine
    })
    judging.update(id, {
      run: started.run,
      attempts: [...(judgement.attempts || []), { run: started.run, machine, at: new Date().toISOString() }]
    })

    const outcome = await phase('reading', () => waitForRun(actions, to, machine, started.run, Number(judgement.hours) || 6))

    // ---- WHY, IF IT WENT WRONG, WHILE THE MACHINE IS STILL UP ------------
    //
    // A job's own output lives ON THE MACHINE, and the machine is restored to
    // its base snapshot the moment this function ends. So a run that failed
    // takes the reason with it, and what is left on this host is "exit 1" and
    // nothing else.
    //
    // That cost two diagnoses today. The second was worse than the first: a
    // judge read three repositories for four minutes, wrote a 21,000-character
    // survey, and the run still exited 1 — and the sentence saying why was
    // deleted with the machine before anybody could read it.
    //
    // READ ONLY WHEN IT FAILED, because a successful run's output is already
    // summarised and this is a round trip to a machine that is about to go away.
    if (outcome.exit !== 0) {
      try {
        const tail = await actions.vmRunOutput.run({ name: machine, run: started.run, lines: 30 })
        const said = String((tail && (tail.output || tail.tail)) || '').trim()
        if (said) {
          to.bad(`${ref} failed — what the run said before the machine was put away:`)
          for (const line of said.split('\n').slice(-30)) to.info('  ' + line)
        }
      } catch (e) {
        to.warn(`${ref} failed and its output could not be read off ${machine}: ${e.message}`)
      }
    }

    // WHAT CAME BACK, before the machine is touched again — it is about to be
    // rolled back, which is exactly when nobody is watching.
    const handed = files.list(judgement.uid) || []

    // WHAT IT CONCLUDED, AND WHAT IT READ, both taken now.
    //
    // A judge ends its answer with one line — `RECOMMENDATION: accept|reject`,
    // or `CLAIM: true|false|unclear` — and that line is what everything
    // downstream turns on: whether there is work, and whether a change may be
    // sent out. Read from the file the judge actually handed back rather than
    // from anything the run reported about itself, because the file is what a
    // person will read too, and two accounts of one judgement is one too many.
    //
    // AND THE TIPS, so this judgement can say later whether it still describes
    // what is there. A judgement made before another push is a judgement of
    // something else, and without this it would read as current for ever.
    let concluded = null
    for (const f of handed) {
      let text = ''
      try { text = String((files.read(judgement.uid, f.file) || {}).text || '') } catch { continue }
      // THREE LANES, THREE VOCABULARIES, AND THE READER HAS TO KNOW ALL OF
      // THEM.
      //
      //   RECOMMENDATION: accept|reject   a change this host made, going out
      //   CLAIM: true|false|unclear       a question somebody asked about code
      //   RECOMMEND: YES|NO               a pull request that arrived
      //
      // The third is not a synonym invented here — it is what the prompt for
      // reading an arrived pull request ASKS FOR, in those words, because "do
      // you recommend pulling this" is the sentence a person wants under
      // somebody else's pull request. This reader knew the first two, so a
      // judge that followed its instructions exactly was recorded as having
      // "reached no conclusion" after reading for three and a half minutes and
      // writing twelve thousand characters ending in RECOMMEND: NO.
      //
      // MAPPED, NOT KEPT. Downstream asks one question of this field — is this
      // judgement a rejection — and a lane whose values it does not recognise
      // reads as "not a rejection", which is the wrong way round for the one
      // lane that is about somebody else's code.
      const m = text.match(/^\s*(RECOMMENDATION|CLAIM|RECOMMEND):\s*(accept|reject|true|false|unclear|yes|no)\s*$/mi)
      if (m) {
        const said = m[2].toLowerCase()
        concluded = said === 'yes' ? 'accept' : said === 'no' ? 'reject' : said
        break
      }
    }
    const read = judgements.tipsFor(judgement.subject)
    if (concluded) to.info(`${ref} concluded: ${concluded}`)

    spent.total = Date.now() - began
    const latest = judging.get(id)
    // HOW THE RUN ENDED, KEPT ON THE ATTEMPT. The log said "exit 1" and the
    // record did not, so a judgement that CRASHED and one that read the change
    // and found nothing were the same row afterwards — and the panel described
    // the crash as a finding: "it read the change and handed nothing back. That
    // is an answer." It was not an answer. `check a claim` died at `require`
    // thirty-seven seconds in, having read nothing at all.
    //
    // The distinction cannot be recovered later: the machine is rolled back a
    // few lines below, and the exit code goes with it.
    const marked = (latest.attempts || []).map(a => a.run === started.run
      ? { ...a, spent, exit: outcome.exit === undefined ? null : outcome.exit, outcome: outcome.state || null }
      : a)

    // DONE MEANS THE READING ENDED, not that a verdict was reached. A judgement
    // that ran and said nothing is a real and useful thing to see: it is the
    // difference between "nobody has looked" and "somebody looked and would not
    // say". The verdict is recorded separately — see judgementVerdict.
    judging.update(id, {
      state: 'done',
      attempts: marked,
      read: new Date().toISOString(),
      // NOT A VERDICT. `concluded` is what the judge recommends; the verdict is
      // recorded by a person, and a supervisor has no tool for either. Kept
      // apart in the record for the same reason they are kept apart in the flow.
      concluded: concluded || null,
      tips: read
    })

    to[handed.length ? 'good' : 'warn'](
      `${ref} done — ${outcome.state}${outcome.exit === undefined ? '' : ` (exit ${outcome.exit})`} — ${handed.length ? `${handed.length} file(s) handed back` : 'nothing handed back'}`)
    to.info(`${ref} took ${secs(spent.total)} — ${Object.entries(spent)
      .filter(([k]) => k !== 'total').map(([k, v]) => `${k} ${secs(v)}`).join(', ')}`)

    // AND THE SUPERVISOR IS TOLD, which it was not, and which left a hole in the
    // middle of its own loop.
    //
    // A finished TASK woke it and a finished JUDGEMENT did not — so the one
    // thing a supervisor is most often waiting on was the one thing that never
    // arrived. It queues a judge because it cannot see the code, records that it
    // is waiting, and then sits there: the answer lands, the board changes, and
    // nothing tells it. It found out whenever something ELSE happened to wake
    // it, which on a quiet host is never.
    //
    // This is the more important of the two wakes, not the lesser. A task
    // finishing produces work to look at; a judgement finishing produces a
    // DECISION to make — whether there is work at all, or whether a change may
    // go out — and it is the step everything downstream of the gate waits on.
    //
    // Same conditions as the task's: only when it has been switched on, never
    // awaited, and never fatal. A supervisor that cannot be woken must not hold
    // up the machine being put away.
    try {
      if (settings.read().supervisorWakes === true) {
        actions.supervisorWake.run({ why: `${ref} finished — ${concluded ? `it concluded "${concluded}"` : 'it reached no conclusion'}` })
          .catch(e => log.on('supervisor').warn(`it could not be woken after ${ref}: ${e.message}`))
      }
    } catch (e) {
      log.on('supervisor').warn(`could not tell the supervisor about ${ref}: ${e.message}`)
    }
  } finally {
    // ALWAYS, and for the same reason a task's machine is: a machine left on,
    // holding a credential, is out of service until somebody notices, and the
    // credential outlives the work in a snapshot. There is no handed-over case
    // here — a judgement with no job never reaches the queue.
    await putAway(actions, log, machine)
    busyWith.delete(machine)
  }
}

// ---- one task, start to finish ----------------------------------------

async function run (actions, log, task, machine) {
  const to = log.on('queue', machine)
  const id = task.id

  // Whether this ended by handing the machine over rather than by finishing
  // work on it. Declared here because the `finally` at the bottom reads it, and
  // it is the one thing that stops that putting the machine away. See below.
  let handedOver = false

  // How long each part took, kept with the attempt.
  //
  // A total is nearly useless for finding a fault: "the task took nine minutes"
  // says nothing about whether the machine took eight of them to boot. These are
  // the numbers that make a slow step visible afterwards, when nobody was
  // watching the log at the time -- which is most of the time, since the point of
  // a queue is being able to walk away from it.
  const spent = {}
  const began = Date.now()
  const phase = async (name, fn) => {
    const at = Date.now()
    try { return await fn() } finally { spent[name] = Date.now() - at }
  }

  try {
    to.info(`#${task.number} "${task.title}" -> ${machine}`)
    await actions.taskUpdate.run({ id, task: { state: 'given', machine } })

    // --- clean, then on ---------------------------------------------------
    //
    // Rolled back before it is started rather than after it is finished. Both
    // would work and only this one is honest: a machine cleaned "afterwards" is
    // clean only if the last thing that touched it finished properly, and the
    // interesting failures are exactly the ones that did not.
    await phase('bringUp', () => bringUp(actions, to, machine))

    // --- give it the work -------------------------------------------------
    await phase('credential', () => actions.vmCredentialsPut.run({ name: machine }))
    await phase('workspace', () => actions.vmWorkspace.run({
      name: machine,
      branch: task.branch,
      folder: task.folder || undefined,
      // WHAT THIS MACHINE IS FOR, left on the machine so it can say so later.
      // A restart re-queues this task; what brings it back is the machine
      // dialling in and naming it. See the hello handler in server.js.
      task: store.noteFor(task)
    }))

    // ---- the judge's report goes onto the machine with it -------------------
    //
    // A worker's job is to SATISFY THE JUDGE, and it cannot do that if it has
    // never seen what the judge said. The supervisor quotes the finding in the
    // brief, which is necessary and is not enough: a finding is usually a page,
    // with file names and quoted lines in it, and a brief is a paragraph.
    //
    // So whatever the judgement handed back is written into the working folder
    // beside the repositories, under its own name. Not inside a repository —
    // the folder root is not a git repository, so nothing here can be committed
    // by accident, and `ls` shows it immediately.
    //
    // ONLY THE JUDGEMENT THIS TASK CAME FROM. Every judgement ever made would be
    // a filing cabinet; the one that established this work is real is the one
    // the work has to answer.
    if (task.becauseOfId) {
      try {
        const from = judging.get(task.becauseOfId)
        const papers = files.list(from.uid) || []
        for (const f of papers) {
          const body = files.read(from.uid, f.file)
          if (!body || typeof body.text !== 'string') continue
          const called = `${from.ref}-${f.file}`.replace(/[^A-Za-z0-9._-]/g, '-')
          const b64 = Buffer.from(body.text, 'utf8').toString('base64')
          await channel.run(machine,
            `cd ~/workspace 2>/dev/null || cd ~; printf %s '${b64}' | base64 -d > ${JSON.stringify(called)}`,
            { what: `putting ${from.ref}'s report where the worker will find it`, timeout: 60000 })
          to.info(`${from.ref} said ${f.file} — left on ${machine} as ${called}`)
        }
        if (!papers.length) {
          // SAID, because it changes what the worker can do. A task written from
          // a judgement that handed nothing back is a task working from the
          // brief alone, and somebody should know that is what happened.
          to.warn(`${from.ref} handed nothing back, so #${task.number} has only its brief to go on`)
        }
      } catch (e) {
        to.warn(`could not put the judge's report on ${machine}: ${e.message}`)
      }
    }

    // A TASK THAT NAMES A JOB RUNS THAT JOB.
    //
    // It did not, and nothing said so. The job was stored on the task, shown on
    // the board, filled in from the prompt -- and the queue dispatched
    // `claude -p` with the brief anyway, so a task written to run a script ran a
    // worker instead. It failed silently in the worst direction: the run looked
    // completely normal, and the only sign was the artifact that never arrived.
    //
    // Through the action, like every other step here, so a job dispatched by the
    // queue meets exactly the refusals a job dispatched by hand meets -- the
    // script must be approved, the machine must be dialled in, and the workspace
    // gate still applies. A second path for the scheduler is always the one that
    // turns out to be wrong.
    // NO JOB MEANS NOBODY IS SENT. The machine is brought up, set up on the
    // branch cut, and LEFT RUNNING at its desktop for whoever wrote the task.
    //
    // It used to run `claude -p` with the brief, on the reasoning that a task
    // with no job is "the ordinary path" — and that made a worker the default
    // consequence of not choosing anything. Somebody who wrote a task and
    // queued it got a machine booted, a credential placed, Claude run over
    // their branch, and the machine rolled back, having chosen none of it. The
    // board then said "used Claude: yes" about work they never asked a worker
    // to do, which is true and is not the point.
    //
    // A job is what runs. Without one there is nothing to run, and the useful
    // thing to do with a prepared machine is hand it over rather than fill it.
    //
    // NOT PUT AWAY EITHER, which is the other half. Everything below this
    // shuts the machine down and rolls it back when the work ends; there is no
    // work here to end. So it stops at the setup, marks the machine borrowed so
    // the queue does not take it back, and returns.
    if (!task.job && !task.shell) {
      // Claimed with a registry write rather than through `vmBorrow`, which is
      // the action for this and cannot be used here: it brings the machine up
      // itself, and doing that now would roll back the workspace that was set
      // up four lines ago. What is left to do is only the claim.
      handedOver = true
      vms.update(machine, { borrowed: { why: `#${task.number} — set up and waiting for you`, at: new Date().toISOString() } })
      await actions.taskUpdate.run({
        id,
        task: {
          state: 'given',
          machine,
          // AND IT IS A PERSON'S TASK NOW, because that is what just became
          // true: a machine is set up and waiting for somebody to work in it.
          //
          // Saying so is not bookkeeping — it is what makes every existing rule
          // do the right thing. `adopt` re-queues a task sitting in `given` with
          // no run, EXCEPT a person's, and the comment there describes this
          // exact failure: "two machines on one branch, and the work stolen from
          // underneath somebody with an editor open". A handed-over task has no
          // run by design, so without this it is re-queued on every restart and
          // handed to a second machine. That happened to #35 within a minute of
          // this being written.
          //
          // The queue skips a person's task for the same reason, and the window
          // already offers the two doors for one.
          worker: 'person',
          attempts: [...(task.attempts || []), { machine, at: new Date().toISOString(), setUp: true }]
        }
      })
      to.good(`#${task.number} — ${machine} is up on ${task.branch} and waiting. Nothing was run: this task names no job.`)
      to.info(`open it from the task, or give it back with vmReturn --name ${machine}`)
      return
    }

    const started = task.job
      ? await actions.jobRun.run({
          id: task.job,
          task: id,
          name: machine,
          folder: task.folder || undefined
        })
      : await actions.vmDispatch.run({
        name: machine,
        task: task.brief,
        folder: task.folder || undefined,
        // The words it was written under, or the file it was written against.
        // Never both -- vmDispatch refuses that, and a task carries one or the
        // other by construction. See taskCreate.
        rules: task.rules || undefined,
        contractName: task.contractName || undefined,
        contract: task.rules ? undefined : (task.contract || undefined),
        shell: !!task.shell
      })
    const fresh = await actions.tasks.run({})
    const now = fresh.tasks.find(t => t.id === id) || task
    await actions.taskUpdate.run({
      id,
      task: {
        run: started.run,
        // NOTHING SETS `usedClaude` HERE ANY MORE, and that is the point of the
        // early return above. Only two kinds of task reach this line now: one
        // with a job, and a shell run. A shell run has no worker in it, and a
        // job's worker announces itself from the other end — the /session
        // handler sets the flag when a transcript arrives, which is the only
        // proof a job started one rather than only moving files around.
        //
        // A job is the only way this dashboard runs Claude. So "did this task
        // use Claude" has exactly one source, and it is evidence rather than
        // inference.
        attempts: [...(now.attempts || []), { run: started.run, machine, at: new Date().toISOString() }]
      }
    })

    // --- wait for it ------------------------------------------------------
    // How long to wait is the TASK's business, not this file's.
    //
    // Six hours is a sensible default for work somebody is expecting back today,
    // and wrong for a soak deliberately left overnight -- which would be
    // abandoned at hour six while still running perfectly, and the machine put
    // away underneath it. A task that knows it is long says so.
    const outcome = await phase('work', () => waitForRun(actions, to, machine, started.run, Number(task.hours) || 6))

    // Pulled across before the machine is touched again. taskProgress does this
    // too, but that only happens if somebody looks -- and this machine is about
    // to be shut down and rolled back, which is precisely when nobody is.
    await actions.taskProgress.run({ id }).catch(() => { /* the log is best effort; the verdict is not */ })

    const art = await actions.taskArtifact.run({ id })

    // Marked done whatever the outcome was, because done is about the run
    // having ended and not about it having worked. Whether anything actually
    // arrived is read from the branch, and stays a separate question -- a task
    // can be done and have delivered nothing, which is exactly what a worker
    // that was refused by the hook looks like.
    spent.total = Date.now() - began
    const latest = (await actions.tasks.run({})).tasks.find(t => t.id === id)
    const marked = (latest.attempts || []).map(a => a.run === started.run ? { ...a, spent } : a)
    await actions.taskUpdate.run({ id, task: { state: 'done', attempts: marked } })

    to[art.delivered ? 'good' : 'warn'](
      `#${task.number} done — ${outcome.state}${outcome.exit === undefined ? '' : ` (exit ${outcome.exit})`} — ${art.summary}`)
    // Said as one line rather than left in the record, because the record is
    // read when somebody already suspects something; this is what tells them to.
    to.info(`#${task.number} took ${secs(spent.total)} — ${Object.entries(spent)
      .filter(([k]) => k !== 'total').map(([k, v]) => `${k} ${secs(v)}`).join(', ')}`)

    // AND THE SUPERVISOR IS TOLD, if it has been told to listen.
    //
    // A supervisor woke when somebody spoke to it and at no other time, so a task
    // it queued itself finished in silence and it found out whenever the person
    // next said something. That is a supervisor being polled by hand rather than
    // one watching, and this is the difference.
    //
    // WHY HERE. This is the moment a task stops being work in flight and becomes
    // something to decide about: what came back, whether it delivered, whether it
    // is worth sending out. The other two things worth waking for are an issue
    // and a pull request arriving, and neither is knowable without asking GitHub
    // — which this app deliberately never does on a timer. So they are read when
    // it wakes, and this is what wakes it.
    //
    // NOT AWAITED, and never fatal: a supervisor that cannot be woken must not
    // hold up the machine being put away, which is the next thing this does.
    try {
      if (settings.read().supervisorWakes === true) {
        actions.supervisorWake.run({ why: `#${task.number} finished — ${outcome.state}` })
          .catch(e => log.on('supervisor').warn(`it could not be woken after #${task.number}: ${e.message}`))
      }
    } catch (e) {
      log.on('supervisor').warn(`could not tell the supervisor about #${task.number}: ${e.message}`)
    }
  } finally {
    // ALWAYS, and in this order. A machine left on, holding a credential, is
    // the failure that costs something: the credential outlives the task in a
    // snapshot, and the machine is out of service until a person notices.
    //
    // EXCEPT WHEN IT WAS HANDED OVER ON PURPOSE. A task with no job leaves the
    // machine up, set up and claimed, for whoever wrote it — putting it away
    // here would roll back the workspace it was just given and shut it down a
    // second after saying it was ready. It is not "left on" in the sense above:
    // it is borrowed, which the queue already understands and will not touch,
    // and giving it back is `vmReturn`, which takes the credential with it.
    if (!handedOver) await putAway(actions, log, machine)
    busyWith.delete(machine)
  }
}

// Off, clean, on, and dialled in.
// ONE MACHINE COMES UP AT A TIME, and this is the only place that is true by
// construction rather than by luck.
//
// The queue has always behaved this way — it starts the next machine after the
// last one has dialled in — but that was a property of running one task at a
// time, not a rule anything enforced. Everything else that brings a machine up
// goes through here too (borrowing, re-provisioning), so the gate belongs at the
// top of it: two machines booting at once do not take twice as long, they wedge
// the host, and the machine that loses sits on its splash screen ignoring its
// own power button.
//
// See machines/busy.js. It waits rather than refusing, because "another machine
// is booting" stops being true in about a minute.
async function bringUp (actions, to, machine) {
  // THE TURN IS THE EXPENSIVE MINUTE, NOT THE WHOLE BOOT.
  //
  // What two machines fight over is the snapshot restore and the cold kernel
  // boot: disk and every core, at once. Once a kernel is up and talking, the
  // rest of a boot is services starting and a network coming up, and the next
  // machine can start into that quite happily.
  //
  // So the host is handed on as soon as this machine's console says something,
  // and the wait for it to DIAL IN — which is what makes it usable, and is
  // minutes later — happens outside the turn. On a queue giving work to several
  // machines that is the difference between starting one a minute and starting
  // one every three.
  //
  // The console is the signal because it is the machine reporting a fact rather
  // than this app guessing how long a boot takes on somebody else's hardware.
  await busy.comingUp(machine, async () => {
    await startItUp(actions, to, machine)
    await actions.vmAwait.run({ name: machine, for: 'console', seconds: 60, tries: 3 })
      .catch(e => to.info(`could not tell when its kernel came up (${e.message.split('.')[0]}) — handing the host on anyway`))
  }, {
    onWait: other => to.info(`waiting for "${other}" to get its kernel up — one machine starts at a time on this host`)
  })

  // Started is not ready. Everything that talks to a guest refuses until it has
  // dialled in, and a machine boots for a minute or two — so this is the step
  // most worth counting out loud, and the one that was silent for five minutes
  // while a machine sat at a cursor.
  await settle(actions, to, machine, v => v.connected, 6 * 60000, 'it to dial in', 60000)
}

async function startItUp (actions, to, machine) {
  const before = (await actions.vmList.run({})).vms.find(v => v.name === machine)
  if (!before) throw new Error(`"${machine}" is gone`)

  if (before.running) {
    to.info('shutting it down so it can be made clean')
    await actions.vmStop.run({ name: machine, force: true })
    await settle(actions, to, machine, v => !v.running, 120000, 'it to stop', 15000)
  }

  // Rolled back only if it is not already there.
  //
  // putAway leaves a machine ON its base snapshot precisely so it is clean for
  // the next task, and this then restored the same snapshot again five seconds
  // later -- the same operation twice, back to back, on a machine VirtualBox had
  // only just finished restoring. That is the shape of a race, and it produced
  // one: a machine that started to a black screen and never booted.
  //
  // The check is cheap and the skip is safe: `current` is what VirtualBox says
  // the machine is sitting on, not what this app believes.
  const at = await actions.vmSnapshots.run({ name: machine })
  if (at.current === before.baseSnapshot && !before.running) {
    to.info(`already clean at "${before.baseSnapshot}"`)
  } else {
    to.info(`rolling back to "${before.baseSnapshot}"`)
    await actions.vmSnapshotRestore.run({ name: machine, title: before.baseSnapshot })
  }

  to.info('starting it')
  await actions.vmStart.run({ name: machine })
}

// Back to its natural state: off, clean, holding nothing.
//
// Never allowed to throw. It runs in a finally, and a failure to tidy up must
// not replace the error that caused it -- losing the real reason is how a
// machine ends up left on AND nobody knowing why.
async function putAway (actions, log, machine) {
  const to = log.on('queue', machine)

  // Taken back while the machine can still be spoken to. The rollback below
  // would remove the file anyway, but a machine that fails to shut down would
  // then sit there holding a live credential -- and the point of taking it back
  // is that it stops existing on that disk, not that the registry stops saying
  // so.
  try {
    await actions.vmCredentialsForget.run({ name: machine })
  } catch (e) { to.info(`its credential was already gone: ${e.message}`) }

  // The button first, then the plug.
  //
  // `vmStop` presses the ACPI power button, which is right for a machine with an
  // operating system on it and useless for one that never got that far -- there
  // is nothing running to receive the press. A machine that failed to boot
  // therefore sat "running" for the whole timeout and was then rolled back while
  // still running, which fails too, and the machine stayed out of the pool.
  //
  // Waiting a short time and then pulling the plug is safe HERE in a way it
  // would not be elsewhere: this machine is about to be rolled back to a
  // snapshot, so an unfinished write is discarded either way.
  try {
    await actions.vmStop.run({ name: machine })
    await settle(actions, to, machine, v => !v.running, 45000, 'it to shut down', 15000)
  } catch {
    to.warn('it did not answer the power button; pulling the plug')
    try {
      await actions.vmStop.run({ name: machine, force: true })
      await settle(actions, to, machine, v => !v.running, 60000, 'it to stop', 5000)
    } catch (e) { to.warn(`could not stop it at all: ${e.message}`) }
  }

  // ROLLED BACK AT REST, and this is what makes the pool work at all.
  //
  // A machine that has finished a task still CLAIMS that task's branch, and a
  // claimed branch means "not free" -- correctly, because a machine somebody set
  // up by hand must not be taken from under them. So without this the queue
  // deadlocks after exactly one task per machine: everything it has ever used is
  // permanently ineligible, and nothing says why except a line in the state file.
  //
  // It is also what "clean" means when the natural state is off. Between tasks a
  // machine holds no branch, no credential, and none of the last worker's
  // leavings -- so the next task starts from a known disk rather than from
  // whatever the last one happened to leave.
  try {
    const vm = (await actions.vmList.run({})).vms.find(v => v.name === machine)
    if (vm && vm.baseSnapshot && !vm.running) {
      await actions.vmSnapshotRestore.run({ name: machine, title: vm.baseSnapshot })
      to.good(`off again, rolled back to "${vm.baseSnapshot}", free for the next task`)
    } else {
      to.warn('could not roll it back, so it stays out of the pool until somebody does')
    }
  } catch (e) { to.warn(`could not roll it back: ${e.message}`) }
}

// ---- waiting -----------------------------------------------------------

const wait = ms => new Promise(r => setTimeout(r, ms))

const secs = ms => `${Math.round(ms / 1000)}s`

// COUNTING OUT LOUD WHILE NOTHING HAPPENS.
//
// Every long step here is invisible from outside: a machine boots, or a worker
// thinks, and the dashboard says one line at the start and one at the end. In
// between there is no way to tell "still going" from "stuck", and the two want
// opposite responses -- wait, or go and look. This afternoon that gap was five
// minutes of a machine sitting at a black screen with nothing said about it.
//
// So a wait says how long it has been waiting, and says it louder once it has
// gone past what the step USUALLY takes. `usual` is the interesting number, not
// the timeout: a timeout is the point at which we give up, which is deliberately
// generous, and a step running four times its normal length is worth knowing
// about long before that.
//
// Cheap on purpose -- one line every 30 seconds, into the same live log as
// everything else. A progress bar nobody is watching is not the point; a
// timestamped trail somebody can read afterwards is.
function ticking (to, what, { usual = 0, every = 30000 } = {}) {
  const began = Date.now()
  let said = 0
  const timer = setInterval(() => {
    const gone = Date.now() - began
    if (gone - said < every) return
    said = gone
    if (usual && gone > usual * 2) to.warn(`still waiting for ${what} — ${secs(gone)}, and it usually takes about ${secs(usual)}`)
    else to.info(`waiting for ${what} — ${secs(gone)}`)
  }, 5000)
  if (timer.unref) timer.unref()
  return {
    done: () => {
      clearInterval(timer)
      const gone = Date.now() - began
      if (usual && gone > usual * 2) to.warn(`${what}: ${secs(gone)}, about ${Math.round(gone / usual)}x the usual ${secs(usual)}`)
      return gone
    }
  }
}

async function settle (actions, to, machine, ok, timeout, what, usual) {
  const deadline = Date.now() + timeout
  const tick = ticking(to, what, { usual })
  try {
    for (;;) {
      const vm = (await actions.vmList.run({})).vms.find(v => v.name === machine)
      if (vm && ok(vm)) return vm
      if (Date.now() > deadline) {
        // Named with the elapsed time as well as the limit, because "waited 6
        // minutes" reads as a policy and "waited 6 minutes, having expected 40
        // seconds" reads as the fault it is.
        throw new Error(`Waited ${secs(Date.now() - deadline + timeout)} for ${what} and it did not happen${usual ? ` — it usually takes about ${secs(usual)}` : ''}`)
      }
      await wait(5000)
    }
  } finally { tick.done() }
}

// Until the run is over, however it ends.
//
// `lost` counts as over. A run whose process is gone is not going to produce a
// result, and waiting for one would hold a machine out of service for as long as
// the timeout -- which is the whole afternoon, on a task nobody is going to get
// an answer to.
async function waitForRun (actions, to, machine, runId, hours = 6) {
  const deadline = Date.now() + hours * 3600000
  // No `usual` here, and that is the honest answer: a task is as long as the
  // work is, and a five-minute one and a two-hour one are both ordinary. What
  // can be said is how long it HAS been, which is what somebody deciding whether
  // to go and look actually needs.
  const tick = ticking(to, `${runId} to finish`, { every: 60000 })

  // A MACHINE THAT CANNOT BE ASKED IS NOT A MACHINE THAT HAS FINISHED.
  //
  // This waited by polling, and a failed poll threw -- straight out of here, out
  // of the task, and into the `finally` that puts a machine away. So a fifteen
  // second network blip powered the machine off and rolled it back, mid-run,
  // while the work itself was perfectly fine: detached, still going, and about
  // to be destroyed by the thing supervising it. Pulling the cable for one
  // minute cost the whole task.
  //
  // The run is detached on purpose. An outage is something happening to the
  // DASHBOARD, not to the work -- so being unable to see the work is a reason to
  // look again, not a reason to end it. Patience here is bounded but generous:
  // a machine that is really gone is noticed by the loop below eventually, and
  // the cost of waiting too long is a machine held; the cost of giving up too
  // early is somebody's afternoon.
  const OUT_OF_TOUCH = 10 * 60000
  let lostSince = 0

  try {
    for (;;) {
      let runs = null
      try {
        ({ runs } = await actions.vmRuns.run({ name: machine }))
        if (lostSince) {
          to.good(`${machine} is answering again after ${secs(Date.now() - lostSince)} — the run was never in doubt, only our view of it`)
          lostSince = 0
        }
      } catch (e) {
        // Cannot see it. Say so once, keep waiting, and give up only when it has
        // been out of touch long enough to be genuinely gone rather than briefly
        // unreachable.
        // UNREACHABLE AND OFF ARE DIFFERENT. Patience is for a machine that has
        // lost its network while carrying on working; a machine that is powered
        // off is not working, and waiting ten minutes to admit that holds it out
        // of the pool for no reason. VirtualBox can answer this without the
        // guest's help, which is exactly why it is worth asking.
        const still = (await actions.vmList.run({})).vms.find(v => v.name === machine)
        if (!still || !still.running) {
          to.warn(`${machine} is not running any more, so ${runId} is over however it ended`)
          return { state: 'gone' }
        }

        if (!lostSince) {
          lostSince = Date.now()
          to.warn(`cannot reach ${machine} (${e.message}) — the run is detached and carries on regardless; waiting for it to come back`)
        } else if (Date.now() - lostSince > OUT_OF_TOUCH) {
          to.bad(`${machine} has been unreachable for ${Math.round((Date.now() - lostSince) / 60000)} minutes; giving up on ${runId}`)
          return { state: 'unreachable' }
        }
        await wait(15000)
        continue
      }

      const mine = (runs || []).find(r => r.id === runId)
      if (mine && mine.state !== 'running') return mine
      if (!mine) return { state: 'gone' }
      if (Date.now() > deadline) {
        to.warn(`giving up on ${runId} after ${hours} hours; the machine is being put away`)
        return { state: 'abandoned' }
      }
      await wait(15000)
    }
  } finally { tick.done() }
}

// ---- picking up after a restart ---------------------------------------

// A task left mid-flight when the dashboard stopped.
//
// The dashboard is restarted for every change to it, and a task that was running
// at that moment is not finished -- but nothing in this process knows about it
// any more. Left alone it would sit in `given` for ever while its machine stayed
// on, holding a credential, out of service and looking busy.
//
// Not resumed, because the worker itself is still going or already gone and
// neither can be re-entered from here. What happens is honest: the run is waited
// on if it is still alive, and the machine is put away either way.
async function adopt (actions, log) {
  // Nothing was in flight in a workspace nobody is serving -- and asking would
  // read an empty board and "recover" it, which is adoption doing the one thing
  // it exists to prevent.
  if (!workspaces.open()) return
  const { tasks } = await actions.tasks.run({})

  // A task that was being SET UP when this stopped never became a run.
  //
  // It sat in `given` with no run id, which made it invisible to everything: the
  // queue only looks at `queued`, adoption only looks for a run to wait on, and
  // the board showed it working with no worker anywhere. Two of them accumulated
  // in one afternoon, both from restarting the dashboard while a machine was
  // booting.
  //
  // Put back in the queue rather than marked done, and the difference is real:
  // nothing was dispatched, so no work happened and there is nothing to judge.
  // Re-queueing loses nothing and re-running it is exactly what was wanted.
  //
  // EXCEPT A PERSON'S, whose whole working life is exactly this shape.
  //
  // A task somebody took by hand sits in `given` with no run id for as long as
  // they are working in it — there is no run because there is no worker process;
  // the exit code is a human saying "finished". So this re-queued every one of
  // them on every restart and handed it to Claude on a second machine, while the
  // person was still in the first. Two machines on one branch, and the work
  // stolen from underneath somebody with an editor open.
  //
  // The rule this was written to is still right: `given` with no run means
  // nothing is running. What changed is that "nothing is running" stopped
  // meaning "nothing is happening".
  // RE-QUEUEING IS RIGHT, AND IT IS NOT THE END OF THE STORY.
  //
  // A dashboard that has just started knows nothing about what was in flight, so
  // putting an unstarted task back in the queue is the honest thing to do with
  // it. What was missing is the other half: the machine still knows, and it says
  // so the moment it dials in. See `taskItIsOn` in machines/store.js and the
  // hello handler in server.js — a machine set up for a task carries a note
  // saying which, and reconnecting is what brings the two back together.
  //
  // The alternative was for this to guess from the registry — a machine marked
  // borrowed, a branch claim that looks right — and a guess made here is a guess
  // that has to be right every time, about a machine that may have been reverted
  // by hand while the dashboard was not running. Asking the machine cannot be
  // stale, because the machine is the thing being asked about.
  for (const t of tasks.filter(x => x.state === 'given' && !x.run && x.worker !== 'person')) {
    log.on('queue').warn(`#${t.number} was being set up when this stopped, and never started — back in the queue${
      t.machine ? `. If ${t.machine} still has it, it will say so when it dials in` : ''}`)
    await actions.taskUpdate.run({ id: t.id, task: { state: 'queued', machine: null } }).catch(() => {})
  }

  const midFlight = tasks.filter(t => t.state === 'given' && t.machine && t.run)
  for (const task of midFlight) {
    if (busyWith.has(task.machine)) continue
    busyWith.set(task.machine, `#${task.number}`)
    const to = log.on('queue', task.machine)
    to.warn(`#${task.number} was in flight when this restarted; picking it back up`)
    ;(async () => {
      try {
        const { vms } = await actions.vmList.run({})
        const vm = vms.find(v => v.name === task.machine)
        if (vm && vm.connected) {
          await waitForRun(actions, to, task.machine, task.run)
          await actions.taskProgress.run({ id: task.id }).catch(() => {})
        }
        const art = await actions.taskArtifact.run({ id: task.id })
        await actions.taskUpdate.run({ id: task.id, task: { state: 'done' } })
        to[art.delivered ? 'good' : 'warn'](`#${task.number} done — ${art.summary}`)
      } finally {
        await putAway(actions, log, task.machine)
        busyWith.delete(task.machine)
      }
    })().catch(e => to.bad(e.message))
  }
}

// A MACHINE DIALS IN AND SAYS WHAT IT IS STILL DOING.
//
// The other half of re-queueing. Restarting this app puts an unstarted task back
// in the queue, and that is right -- a fresh process has no idea what was in
// flight, and the alternative is to guess from a registry written by the process
// that stopped. What it must not do is leave a machine standing there, set up on
// a branch, holding work nobody is claiming, while the queue offers the same
// work to a second machine. That happened to #35: it was handed over, the app
// restarted, and runner2 was booted for a task runner1 was already sitting on.
//
// So the machine answers for itself. `$HOME/.okc-task` is written when its
// workspace is set up and goes away when it is rolled back, which means the note
// exists exactly as long as the setup it describes does.
//
// THE NOTE IS CHECKED, NOT BELIEVED. It comes from a guest, so it is treated as
// a claim: it may only reattach a task that is sitting in the queue unstarted,
// only to a machine that is genuinely set up on that task's branch, and only if
// the branch it names is still the branch the task is about. It cannot take work
// away from another machine, cannot revive a task somebody finished, and cannot
// invent one -- the worst a lying guest achieves is being given a task that was
// going to be given to a machine anyway.
async function redial (actions, log, machine) {
  const to = log.on('queue', machine)

  // ASKED FOR THE FILE ONLY, and the last line of it.
  //
  // A guest shell prints things nobody asked for -- a profile that greets you, a
  // warning from something in the path -- and all of it arrives here as output.
  // The note is one line and it is the last one; taking that rather than the
  // whole reply is what stops a chatty machine reading as a corrupt note.
  let note = null
  const r = await channel.run(machine, 'cat "$HOME/.okc-task" 2>/dev/null || true', {
    what: 'asking what it is working on', timeout: 30000
  })
  const text = String(r.output || '').trim().split('\n').pop().trim()
  if (!text) return null
  try {
    note = JSON.parse(text)
  } catch {
    // Said, not swallowed. A machine that answers this question with something
    // unreadable is a machine whose note was written by a version of this that
    // no longer agrees with this one, and that is worth knowing about.
    to.warn('it answered with something that is not a task note — left alone')
    return null
  }
  if (!note || !note.uid) return null

  // Named by uid and answered by uid. A note carries the number too, and only so
  // this can be said out loud -- looking one up by number would follow a number
  // reissued after the task holding it was deleted.
  let task = null
  try { task = store.get(note.uid) } catch {
    to.info(`it says it has #${note.number}, and there is no such task here any more — left alone`)
    return null
  }
  if (task.uid !== note.uid) return null

  if (task.branch !== note.branch) {
    to.warn(`it says it has #${task.number}, but that task is about ${task.branch} now and its note says ${note.branch} — left alone`)
    return null
  }

  const vm = vms.get(machine)
  if (!vm || vm.branch !== task.branch) {
    to.warn(`it says it has #${task.number}, but it is not set up on ${task.branch} — left alone`)
    return null
  }

  if (task.state !== 'queued') {
    // Not a problem, and usually not even news: a task that is `given` to this
    // same machine is simply already right, which is what happens when nothing
    // restarted. Said only when the note points somewhere it cannot go.
    if (task.state === 'given' && task.machine && task.machine !== machine) {
      to.warn(`it says it has #${task.number}, but that has since been given to ${task.machine} — left alone`)
    }
    return null
  }

  // Whatever the queue is mid-dispatch on stays the queue's. This is a race of
  // seconds -- a machine reconnecting while a tick is running -- and the tick is
  // the one holding the machine.
  if (busyWith.has(machine) || [...busyWith.values()].some(t => t === task.id)) return null

  await actions.taskUpdate.run({
    id: task.id,
    task: {
      state: 'given',
      machine,
      // A machine that dialled back in is one somebody or something already set
      // up, and what it is NOT is a fresh dispatch. Marking it `person` keeps
      // the queue's own recovery -- which re-queues tasks that were being set up
      // and never started -- from taking it straight back off the machine that
      // just told us it has it.
      worker: task.job ? task.worker : 'person'
    }
  })
  to.good(`it dialled back in still holding #${task.number} on ${task.branch} — put back on it`)
  return task
}

const state = () => ({ inFlight: [...busyWith.entries()].map(([machine, task]) => ({ machine, task })) })

// ---- what goes next ----------------------------------------------------
//
// ONE PLACE, BECAUSE TWO WOULD DISAGREE. The Queue tab reports the order and
// this file dispatches in it. Written twice, the two drift the first time
// anything changes — and the failure is a board that says a judgement is next
// while a task goes out, which nobody would think to check because both halves
// look right on their own.
//
// JUDGEMENTS BEFORE TASKS. A judgement reads work that is already waiting to
// land, and behind it somebody is holding a change; a task makes MORE work to be
// read. So a queue that runs tasks first grows the thing it is behind on. This
// is the only priority there is: within a kind it is strictly oldest-first,
// because a queue anybody has to reason about is one somebody works around.
// WHICH MACHINES AN ENTRY WILL ACCEPT, and the same reasoning as `order`: the
// tick applies this rule, so anything that TELLS somebody what will happen has
// to apply the same one. `taskQueue` did not, and answered "4 machine(s) can
// take it" about a task tagged for a kind of machine this host does not have —
// which is precisely the sentence its own comment says it exists to avoid.
//
// WAITS, RATHER THAN FALLING BACK. A tag that quietly means "prefer" is a tag
// that sends work to the wrong machine on a busy afternoon, which is the one
// thing somebody who bothered to tag a machine was trying to prevent.
const wants = entry => String((entry && entry.tag) || '').trim().toLowerCase()
const takes = (entry, tags) => {
  const want = wants(entry)
  if (!want) return true
  return (tags || []).map(t => String(t).toLowerCase()).includes(want)
}

const FIRST = { judgement: 0, task: 1 }
const rank = entry => (FIRST[entry && entry.kind] !== undefined ? FIRST[entry.kind] : FIRST.task)

// Sorts a COPY. The caller's list is usually somebody else's array and a queue
// that reorders what it was shown is a queue that changes a board by reading it.
const order = entries => [...(entries || [])].sort((a, b) => rank(a) - rank(b) || a.number - b.number)

// Said in words, because the board draws it and a model reads it. Kept beside
// the rule so it cannot describe an order that is not this one.
const ORDER = 'Judgements first, then tasks; oldest first within each. A judgement reads work that is already waiting to land, so it goes ahead of work that makes more.'

module.exports = { begin, stop, tick, redial, availability, state, busyWith, bringUp, putAway, order, takes, ORDER, TICK }
