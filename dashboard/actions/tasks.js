'use strict'

// The board: writing work down, giving it out, watching it, and judging
// what came back.
//
// Part of the one table every caller reaches: see actions/table.js for why
// these are in separate files and still one surface.

// The table itself, so an action can call another by name. Required rather
// than passed, and read inside a `run` rather than at load time, which is what
// lets these files be split at all -- at load time half of them do not exist
// yet, and by the time anything runs they all do.
const actions = require('./table')

// Everything the table is built out of, in one place rather than a require
// block repeated nine times. See actions/shared.js.
const s = require('./shared')
const {
  log, keys, ssh, data, secret, github, remotes, landings, prtemplate, drafts, judgements,
  vbox, vms, provisioner, scripts, channel, tasks, judging, artifact,
  archive, files, sessions, prompts, contracts, jobs, jobrun, workspaces, queue, machines, provision, reach, editor, repos,
  busy, session, dispatch, auth, branches, workspace, fs, path, https,
  started, net, inTheWay, refuseIfThatTitleIsTaken, refuseIfItHoldsACredential,
  guestPath, workFolder, credentialLife, rememberCredentialCheck, twoLines, whoAsked
} = s

// THE CUT COMES FIRST, and this is where that stops being a habit.
//
// A task delivers on a branch. Naming one nobody has cut writes a task that
// cannot be delivered and that nothing will notice until a machine has been
// borrowed, set up and pointed at a branch that is not there — which is the
// expensive end of a mistake made at the cheap end.
//
// The window has always enforced it by offering a list to pick from, and a UI
// that offers a list is a habit rather than a rule: the command line, the queue
// and anything written six weeks from now go through here instead. A drill
// asking for it in the wrong order is what showed it was only a habit.
//
// Asked of the repositories rather than of a record. A branch is a fact about a
// folder — somebody may have cut it in a terminal a second ago, or deleted it —
// and a list kept alongside would be a second opinion about it.
function mustBeCut (branch) {
  if (!branch) return
  const here = (branches.all().branches || []).some(b => b.name === branch)
  if (!here) {
    throw new Error(`There is no branch called "${branch}" in this workspace. Cut it first, on the Branches tab — a task delivers on a branch, and one nobody has cut is work with nowhere to land.`)
  }
}

// WHOSE MEMORY THIS IS, WHEN THE TASK MAY BE GONE.
//
// These outlive the tasks that made them, on purpose -- what was produced
// outlives the note about it. That was written down and then not followed
// through: every action reached one by looking the task up first, so the moment
// a board was cleared its own sessions became unreachable, and the Forget button
// answered `There is no task "testing-claude"` about a thing sitting on screen
// in front of somebody. Kept deliberately and then impossible to throw away is
// the worst of both.
//
// So the task is looked up if it is there, and the id is taken as a uid if it is
// not. Nothing is invented: it only falls through when something is actually
// stored under that name.
function whoseSession (id) {
  const key = String(id || '')
  let task = null
  try { task = tasks.get(key) } catch { /* the board may have moved on without it */ }
  if (task) return { task, uid: task.uid }
  if (sessions.get(key)) return { task: null, uid: key }
  throw new Error(`There is nothing kept under "${key}" — no task by that name, and no session either. Ask for "sessions" to see what is there.`)
}

// WHAT A MACHINE IS OFFERED, as opposed to what exists.
//
// A library only grows and every rung ever written stays readable — so the
// window and the command line see all of it, always, with each row saying
// whether it is in play. A SUPERVISOR sees only what is in play, because it is
// choosing rather than curating: a list of six chains where two are current is
// a list where the wrong pick is available and looks identical to the right one.
//
// `_fromMachine` is stamped by server.js from the token that authenticated the
// call, so it cannot be claimed by the caller — see the note there. A person at
// the window and a person at the CLI are both people; a machine is the thing
// this narrows for.
//
// NOT A SECOND SET OF RULES. Nothing here refuses anything: a set-aside job named
// directly still runs if something has its id. This is about what is OFFERED,
// and the refusals that matter — approval, the judge gate — are where they were.
const offeredTo = (rows, asked) => (asked && asked._fromMachine
  ? rows.filter(r => r.setAside !== true)
  : rows)

module.exports = {
  tasks: {
    about: 'The board: every task, newest first, and whether its branch has anything on it yet',
    needs: 'workspace',
    run: () => {
      // Newest first, and sorted HERE so the window and the command line agree.
      // The file is append-ordered because that is how it is written; the order
      // it should be read in is a different question, and answering it in two
      // places is how two views of one board start disagreeing.
      //
      // By number rather than by a timestamp: it is the creation order by
      // definition, it cannot tie, and it does not depend on a clock.
      const list = [...tasks.read()].sort((a, b) => (b.number || 0) - (a.number || 0))
      return {
        tasks: list.map(t => {
          // Read per task rather than once, because each delivers on its own
          // branch. Cheap: these are local ref reads against bare repositories.
          const art = artifact.read(t.branch)
          return {
            ...t,
            delivered: art.delivered,
            artifact: art.summary,
            commits: art.commits,
            // FILLED IN FOR TASKS WRITTEN BEFORE THE NAME WAS CARRIED, and only
            // for those: the stored copy wins wherever there is one, so this
            // cannot become a second answer that disagrees with it. A task whose
            // job has since left the library keeps whatever it stored, and one
            // written before there was anything to store falls back to the id —
            // which is what it always showed.
            jobName: t.jobName || (t.job ? ((jobs.get(t.job) || {}).name || null) : null),
            // What the board shows. The stored state says what a person decided;
            // this says what is true, and where they disagree the branch wins.
            // Delivered outranks done, because it is the more informative of
            // two true statements: a done task that delivered nothing and a
            // done task that delivered are the same state and opposite
            // outcomes, and the board should say which.
            reads: t.verdict ? t.state
              : art.delivered ? 'delivered'
                : t.state === 'given' ? 'working'
                  : t.state === 'queued' ? 'queued'
                    : t.state === 'done' ? 'done, nothing delivered'
                      : 'draft'
          }
        })
      }
    }
  },

  taskCreate: {
    about: 'Write a task: what the work is, and the branch it delivers on. Over the wire it also needs the judgement that established the work is real',
    needs: 'workspace',
    takes: ['task', 'becauseOf'],
    run: ({ task, becauseOf, _overTheWire }) => {
      const input = typeof task === 'string' ? JSON.parse(task) : task
      if (!input || typeof input !== 'object') throw new Error('Pass the task as an object.')

      // ---- THE JUDGE IS THE GATE BETWEEN A SUPERVISOR AND A TASK -----------
      //
      // A supervisor cannot see the code. Everything it believes about this
      // codebase, a judge told it — so a task it writes on any other basis is
      // work commissioned from a rumour: an issue somebody filed about a version
      // that no longer exists, a claim about a different project, its own
      // recollection of a finding from a fortnight ago.
      //
      // The cost of that is not abstract. It is a machine booted, rolled back,
      // handed a credential and pointed at a branch for twenty minutes to fix
      // something that was never wrong — and then a second judgement to find out
      // that nothing was.
      //
      // SO WORK OVER THE WIRE NAMES THE JUDGEMENT THAT ESTABLISHED IT IS REAL,
      // and that judgement has to have finished. A queued one has established
      // nothing yet.
      //
      // NOT AT THE WINDOW. A person writing a task has read the code, or has
      // decided they do not need to, and either is their business — this is the
      // same boundary as approving a job, which is refused down the pipe and
      // ordinary at the window.
      if (_overTheWire) {
        const ref = String(becauseOf || '').trim()
        if (!ref) {
          throw new Error('Say which judgement established this work is real — pass becauseOf with its ref, like "J4". You cannot see the code, so a task written without one is work commissioned from a rumour. Ask for a judgement first, read what it handed back, and write the task from that.')
        }
        let found = null
        try { found = judging.get(ref) } catch { found = null }
        if (!found) {
          throw new Error(`There is no judgement "${ref}". Ask for "judging" to see what has been asked for — becauseOf names the judgement whose findings this work comes from.`)
        }
        if (found.state !== 'done') {
          throw new Error(`${found.ref} is "${found.state}" and has not finished reading yet, so it has established nothing. Wait for it, read what it handed back with judgementFindings, and then write the task.`)
        }
        // KEPT ON THE TASK. Six weeks later "why was this done" is answerable by
        // reading the judgement it came from rather than by asking whoever was
        // supervising that afternoon.
        input.becauseOf = found.ref
        input.becauseOfId = found.id
      }

      // WHAT IS IMPOSSIBLE, BEFORE WHAT IS MERELY NOT READY YET.
      //
      // A task asking for a machine tagged "supervisor" can never run: those are
      // out of the queue's pool for good — see availability() in tasks/queue.js —
      // so it would sit queued for ever while the board showed it as waiting.
      //
      // Checked here rather than only in the store, which also refuses it, and
      // the reason is the ORDER a person meets these in. The branch checks below
      // are about the workspace as it stands: cut the branch and the task is
      // fine. This one is about the task itself and is true whatever anybody
      // cuts, so being told about the branch first sends somebody off to fix
      // something that was never the problem. The store keeps its own copy as
      // the backstop for every other way a task can be written.
      if (String(input.tag || '').trim().toLowerCase() === 'supervisor') {
        throw new Error('A task cannot ask for a machine tagged "supervisor". Those are out of the pool for good — a supervisor decides what work to give and is never given any — so this task would sit queued for ever waiting for one.')
      }

      const why = branches.nameIsOk(String(input.branch || '').trim())
      if (why) throw new Error(why)
      mustBeCut(String(input.branch || '').trim())

      // THE RULES ARE COPIED IN, the same way the brief is.
      //
      // `contractId` names one from the library and what gets stored is its
      // WORDS, in `rules`. That is the spine's rule -- every arrow carries a
      // copy -- and it is what makes a finished task readable: a name proves
      // nothing months later about what the worker was actually held to, and the
      // library it named has moved on since.
      //
      // `contract` as a path on this host still works, for the command line and
      // for the one task written before the library existed. Both at once is
      // refused rather than silently preferring one.
      if (input.contractId) {
        if (input.contract) throw new Error('Give it either a contract from the library or a file on this host, not both — otherwise which rules a run was under depends on which line of code read it first.')
        const one = contracts.get(String(input.contractId))
        if (!one) throw new Error(`There is no contract called "${input.contractId}".`)
        if (!one.approved) {
          throw new Error(one.lapsed
            ? `The contract "${one.name}" has been edited since it was approved. Read it and approve it again before writing a task under it.`
            : `The contract "${one.name}" is not approved. What a worker may not do is read before it is sent, the same as what it is told to do.`)
        }
        input.rules = one.text
        input.contractName = one.name
      } else if (input.contract) {
        const at = path.resolve(String(input.contract))
        if (!fs.existsSync(at)) throw new Error(`There is no contract at ${at}. It is read from this host when the task is given out.`)
      }

      // The job's name travels with its id, like the prompt's and the
      // contract's. Refused rather than stored blindly: a task naming a job that
      // does not exist is a task the queue will pick up and fail on, and the
      // moment it is written is the cheap moment to find that out.
      if (input.job) {
        const one = jobs.get(String(input.job))
        if (!one) throw new Error(`There is no job called "${input.job}". Ask for "jobs" to see what there is.`)
        // AND IT IS A JOB FOR DOING WORK. The judging library is kept apart, and
        // the refusal runs in both directions: a judge given to a task would
        // send a machine to READ a change under rules written for reading, on a
        // branch it was told to deliver on.
        if (one.kind === 'judge') {
          throw new Error(`"${one.id}" is a judge — it reads a change and says whether it holds. A task makes one. Pick a job from the work library, or ask for a judgement instead with judgementCreate.`)
        }
        input.jobName = one.name
      }
      const made = tasks.add(input)

      // A TAG NOTHING CARRIES IS WORK THAT WAITS FOR EVER, and the board shows it
      // as queued rather than as wrong. The queue waits by design — a tag that
      // quietly meant "prefer" would send work to the wrong machine on a busy
      // afternoon — so the place to notice a typo is here, where it was written.
      //
      // SAID, NOT REFUSED. A machine can be tagged after the task is written, and
      // that is an ordinary way to work: write the task, then tag the machine
      // that will take it. What is not ordinary is not knowing.
      if (made.tag) {
        const carried = new Set()
        for (const vm of vms.read()) for (const t of vm.tags || []) carried.add(String(t).toLowerCase())
        if (!carried.has(made.tag)) {
          made.warning = `No machine carries the tag "${made.tag}", so this waits in the queue until one does. What is there: ${[...carried].join(', ') || 'no tags at all'}.`
          log.on('task').warn(`#${made.number} asks for a machine tagged "${made.tag}" and none carries it — it will wait`)
        }
      }
      return made
    }
  },

  taskUpdate: {
    about: 'Change a task that has not been given out yet',
    needs: 'workspace',
    takes: ['id', 'task'],
    run: ({ id, task }) => {
      const changes = typeof task === 'string' ? JSON.parse(task) : task
      const current = tasks.get(id)
      // The brief and the branch are what a worker was told and where it
      // delivered. Editing either after the fact rewrites the question a piece
      // of work was the answer to, and a verdict then refers to something that
      // was never asked.
      if (current.machine && (changes.brief || changes.branch || changes.contract)) {
        throw new Error(`"${id}" has already been given to ${current.machine}. What it was asked and where it delivers cannot change now — that would rewrite the question its work answers. Write a new task, or take the verdict on this one first.`)
      }
      if (changes.branch) {
        const why = branches.nameIsOk(String(changes.branch).trim())
        if (why) throw new Error(why)
        // The same rule as writing one. Without it the order holds at the door
        // and not at the window beside it: write the task correctly, then edit
        // the branch to one nobody has cut.
        mustBeCut(String(changes.branch).trim())
      }

      // THE SAME COPY taskCreate MAKES, because this is now how a draft is
      // edited and not only how the queue marks one.
      //
      // Without it, changing which contract a task runs under changed the NAME
      // and left the WORDS — so the board said one contract and the worker was
      // held to another, which is the exact failure the copy exists to prevent,
      // arriving through the one door that did not make it.
      //
      // Only when the key is actually present. Most callers here are the queue
      // and the panel sending a two-field patch, and treating a missing key as
      // "set it to none" would strip the rules off every task the queue touched.
      if ('contractId' in changes) {
        const wanted = String(changes.contractId || '').trim()
        if (wanted) {
          if (changes.contract || (!('contract' in changes) && current.contract)) {
            throw new Error('Give it either a contract from the library or a file on this host, not both — otherwise which rules a run was under depends on which line of code read it first.')
          }
          const one = contracts.get(wanted)
          if (!one) throw new Error(`There is no contract called "${wanted}".`)
          if (!one.approved) {
            throw new Error(one.lapsed
              ? `The contract "${one.name}" has been edited since it was approved. Read it and approve it again before putting a task under it.`
              : `The contract "${one.name}" is not approved. What a worker may not do is read before it is sent, the same as what it is told to do.`)
          }
          changes.rules = one.text
          changes.contractName = one.name
        } else {
          // Taken off, and taken off completely. Leaving the words behind would
          // read as "no contract" everywhere the id is checked and "these rules"
          // everywhere the text is, which is worse than either.
          changes.contractId = null
          changes.rules = null
          changes.contractName = null
        }
      }

      // The job's name, on the same rule and with the same refusal as writing
      // one: a task pointed at a job that does not exist fails in the queue,
      // and here it costs a sentence.
      if ('job' in changes) {
        const wanted = String(changes.job || '').trim()
        const one = wanted ? jobs.get(wanted) : null
        if (wanted && !one) throw new Error(`There is no job called "${wanted}". Ask for "jobs" to see what there is.`)
        changes.job = wanted || null
        changes.jobName = one ? one.name : null
      }

      // The prompt's name travels with its id for the same reason: the library
      // entry may be gone by the time anybody reads the task, and the task
      // should still be able to say where its brief came from.
      if ('promptId' in changes) {
        const wanted = String(changes.promptId || '').trim()
        const one = wanted ? prompts.get(wanted) : null
        if (wanted && !one) throw new Error(`There is no prompt called "${wanted}".`)
        changes.promptId = wanted || null
        changes.promptName = one ? one.name : null
      }

      return tasks.update(id, changes)
    }
  },

  taskRemove: {
    about: 'Throw a task away. Its branch is untouched',
    needs: 'workspace',
    takes: ['id'],
    run: ({ id }) => tasks.remove(id)
  },

  // ---- the queue ---------------------------------------------------------
  //
  // Work waits for a machine; a machine does not wait for work. A queued task
  // names no machine -- the first one that is free takes it, and which one did
  // the work is recorded afterwards rather than decided in advance.

  taskQueue: {
    about: 'Put a task in the queue. The next free machine takes it, runs it, and shuts down',
    needs: 'workspace',
    takes: ['id'],
    run: async ({ id }) => {
      const task = tasks.get(id)
      if (task.verdict) throw new Error(`#${task.number} has already been judged. Write a new task rather than reopening a decided one.`)
      // REFUSED AT THE DOOR, not ignored inside. The queue skips a person's task
      // now, and a task sitting queued that nothing will ever pick up looks
      // exactly like one that is merely waiting its turn — which is the state
      // this whole action's closing note exists to avoid.
      if (task.worker === 'person') {
        throw new Error(`#${task.number} is written for a person — the queue would roll a machine back and run Claude over the top of it. Take it yourself with taskWorkOn, or write it for a worker instead.`)
      }
      const why = branches.nameIsOk(task.branch)
      if (why) throw new Error(why)
      const queued = tasks.update(id, { state: 'queued' })

      // Said now rather than discovered in fifteen minutes' time. A task that
      // can never be picked up looks exactly like one that is merely waiting,
      // and the difference matters most when somebody has gone home.
      //
      // BY THE SAME RULE THE TICK DISPATCHES BY, tag and all. Counting free
      // machines alone answered "4 machine(s) can take it" about a task tagged
      // for a kind of machine this host has none of — the exact sentence the
      // paragraph above says this exists to avoid, written by the code under it.
      const vms = (await actions.vmList.run({})).vms
      const free = queue.availability(vms)
      const tagsOf = name => (vms.find(v => v.name === name) || {}).tags || []
      const can = free.filter(a => a.free && queue.takes(queued, tagsOf(a.name)))
      log.on('task', task.id).good(`#${task.number} queued`)
      return {
        ...queued,
        waitingFor: can.length ? null : free.map(a => `${a.name} ${a.why || `is not tagged "${task.tag}"`}`),
        note: can.length
          ? `${can.length} machine(s) can take it; the next tick picks it up.`
          : task.tag
            ? `Nothing tagged "${task.tag}" is free. It stays queued until something is — a tagged task waits rather than taking a machine of another kind.`
            : 'Nothing can take it yet. It stays queued until something can.'
      }
    }
  },

  // Send a rejected task back to be done again.
  //
  // THE LOOP HAS TO GO BACKWARDS or the shortcut it exists to prevent becomes
  // the only way. The rule is that a bad result is sent back rather than fixed
  // here, because the supervisor's own edits are the one path nothing reviews —
  // and that rule was unenforceable, because a judged task refused to be
  // re-queued at all. The only remaining option was for somebody to open the
  // work and correct it themselves, which is exactly the thing being forbidden.
  //
  // The note is the point. It is what the worker is given, appended to the brief
  // rather than replacing it, so the second attempt can see both what was
  // originally asked and what was wrong with the answer — and so the record
  // afterwards says what it was told, rather than only what it was first asked.
  //
  // SAME BRANCH, and it already has the first attempt's commits on it. The
  // worker continues from where it left off rather than starting again, which is
  // what "send it back" means and is why the branch was never deleted.
  taskSendBack: {
    about: 'Send a rejected task back to be done again, with the reason attached',
    needs: 'workspace',
    takes: ['id', 'note'],
    run: ({ id, note }) => {
      const task = tasks.get(id)
      if (task.state !== 'rejected') {
        throw new Error(`#${task.number} is "${task.state}". Only a rejected task is sent back — an accepted one is finished, and anything else has not been judged yet.`)
      }
      const why = String(note || (task.verdict && task.verdict.note) || '').trim()
      if (!why) throw new Error('There is nothing to send back with. Say what is wrong.')

      const stamped = new Date().toISOString().slice(0, 10)
      const brief = `${task.brief}\n\n--- sent back on ${stamped} ---\n${why}`

      // This changes a brief after the task has been given out, which
      // `taskUpdate` refuses — and the refusal is right: editing the question
      // after the fact rewrites what a piece of work was the answer to. This is
      // the sanctioned exception rather than a way around it, because the change
      // is APPENDED and dated, the previous verdict is kept, and what the second
      // attempt was told is exactly what the record now shows.

      const back = tasks.update(id, {
        state: 'queued',
        brief,
        // Kept rather than overwritten. A task that went round twice and a task
        // that went round once are different pieces of history, and the verdict
        // that caused the second attempt is the most useful part of it.
        verdicts: [...(task.verdicts || []), { ...task.verdict, sentBack: new Date().toISOString() }],
        verdict: null
      })
      log.on('task', task.id).warn(`#${task.number} sent back: ${why.split('\n')[0]}`)
      return { ...back, note: `Back in the queue on ${task.branch}, which still has the first attempt on it. The next free machine continues from there.` }
    }
  },

  // Stop a worker that is still going.
  //
  // Wanted because the alternative was nothing: `taskUnqueue` refuses anything
  // already given out, and the queue waits up to six hours. A worker that hangs,
  // or that is confidently doing the wrong thing, held a machine for the rest of
  // the day and the only way out was to open a shell on the guest.
  //
  // It does NOT shut the machine down or unwind the task. Killing the run is all
  // it does; the queue is already waiting on that run, sees it end, keeps the
  // log, takes the credential back and puts the machine away exactly as it would
  // for one that finished. Doing any of that here as well would be a second
  // place that ends a task, and the two would drift.
  taskStop: {
    about: 'Stop a task that is running. Its machine is put away as usual',
    needs: 'workspace',
    takes: ['id'],
    run: async ({ id }) => {
      const task = tasks.get(id)
      const attempt = [...(task.attempts || [])].reverse().find(a => a.run)
      if (!attempt) throw new Error(`#${task.number} has never been given out, so there is nothing to stop.`)
      if (!task.machine || !channel.connected(task.machine)) {
        throw new Error(`"${task.machine || 'no machine'}" is not dialled in. If it is off, the work is already over — the queue puts a machine away as soon as its run ends.`)
      }
      return actions.vmRunStop.run({ name: task.machine, run: attempt.run })
    }
  },

  taskUnqueue: {
    about: 'Take a task back out of the queue. Does not stop one already running',
    needs: 'workspace',
    takes: ['id'],
    run: ({ id }) => {
      const task = tasks.get(id)
      if (task.state !== 'queued') throw new Error(`#${task.number} is "${task.state}", not queued. A task already given out is not called back by this — the worker is running and would have to be stopped on its machine.`)
      return tasks.update(id, { state: 'draft' })
    }
  },

  // `queueState` used to be here, and moved to actions/queue.js when the queue
  // stopped being a thing only tasks go into. See the head of that file: a
  // judgement waits for a machine exactly as a task does, and they share one
  // queue rather than having one each.

  // Hand a task to a machine: set its workspace up on the task's branch, then
  // dispatch the brief under the task's contract.
  //
  // Both halves go through the actions that already own those rules rather than
  // repeating them -- the branch claim, the protected default, the refusal to
  // move a machine off its branch, and the contract being read from this host
  // are all enforced in one place each, and this is a caller like any other.
  taskGive: {
    about: 'Give a task to a machine: set up its workspace, then dispatch the brief',
    needs: 'workspace',
    takes: ['id', 'name'],
    run: async ({ id, name }) => {
      const task = tasks.get(id)
      if (!name) throw new Error('Say which machine is to do it.')
      if (task.verdict) throw new Error(`"${id}" has already been judged. Write a new task rather than reopening a decided one.`)

      await actions.vmWorkspace.run({ name, branch: task.branch, folder: task.folder || undefined, task: tasks.noteFor(task) })

      // WHOSE MACHINE THIS IS, RECORDED BEFORE THE WORK STARTS.
      //
      // The run begins the moment dispatch returns -- detached, immediately --
      // and the first thing it may do is hand an artifact back. That arrives at
      // a host which decides where to file it by asking which task this machine
      // is running, so the answer has to exist BEFORE the question can be asked.
      // Written afterwards, it was a race the run usually won: an artifact
      // pushed two seconds in was refused with "this machine is not running a
      // task", by a host that was about to record that it was.
      //
      // The run id is not known yet and does not need to be -- it is filled in
      // below, and nothing between here and there reads it.
      tasks.update(id, { state: 'given', machine: name })

      let started
      try {
        started = await actions.vmDispatch.run({
          name,
          task: task.brief,
          folder: task.folder || undefined,
          contract: task.contract || undefined,
          shell: !!task.shell
        })
      } catch (e) {
        // Put back what was there. A task marked as running on a machine that
        // never started it is worse than the race this fixes -- the queue would
        // adopt it, wait for a run that does not exist, and put the machine away.
        tasks.update(id, { state: task.state, machine: task.machine || null })
        throw e
      }

      // Appended, never replaced. Giving a task out a second time is the
      // ordinary case rather than an edge one -- a rejection sent back IS a
      // second attempt -- and overwriting the first makes the record say the
      // work was done once, cleanly.
      tasks.update(id, {
        run: started.run,
        attempts: [...(task.attempts || []), { run: started.run, machine: name, at: new Date().toISOString() }]
      })
      log.on('task', id).good(`given to ${name} on ${task.branch}`)
      return { ...started, task: id, branch: task.branch, attempt: (task.attempts || []).length + 1 }
    }
  },

  // What has happened to this task, and what is happening to it now.
  //
  // Separate from `tasks` because it asks the MACHINE, which costs a round trip
  // and needs the machine dialled in. The board must stay cheap enough to redraw
  // every few seconds; this is asked for one task at a time, when somebody is
  // looking at it.
  //
  // History and activity in one answer because they are one question: "what has
  // become of this" is not usefully split into what already happened and what is
  // happening, and asking twice means two round trips to say one thing.
  taskProgress: {
    about: 'Every attempt at a task, and what its worker is doing right now',
    needs: 'workspace',
    takes: ['id', 'lines'],
    run: async ({ id, lines = 12 }) => {
      const task = tasks.get(id)
      const attempts = task.attempts || (task.run ? [{ run: task.run, machine: task.machine }] : [])
      if (!task.machine || !channel.connected(task.machine)) {
        // A real answer rather than a failure. A machine that has been thrown
        // away is the normal end of a task -- the queue shuts it down the moment
        // the work ends -- and the attempts are still worth showing: they are the
        // record, and the machine was only ever where the work happened.
        //
        // STILL ANSWERED PER ATTEMPT, which the first version forgot. It returned
        // the raw attempts with no `state` and no `kept`, so the window drew an
        // empty badge and said "no log was kept here" about runs whose logs were
        // sitting on this host all along. The machine being gone is exactly when
        // the kept copy matters, so that is the worst moment to stop reporting it.
        return {
          task: id,
          attempts: attempts.map(a => ({ ...a, state: a.failed ? 'lost' : 'ended', kept: archive.has(task.uid, a.run) })),
          live: null,
          why: task.machine ? `"${task.machine}" is off — the queue puts a machine away when its work ends` : 'it has not been given out yet'
        }
      }

      const runs = await actions.vmRuns.run({ name: task.machine })
      const known = new Map((runs.runs || []).map(r => [r.id, r]))
      // AN ATTEMPT WITH NO RUN NEVER HAD ONE, which is not the same as its run
      // being gone.
      //
      // This looked every attempt up by `a.run` and called anything it could not
      // find "gone" — reported as "the machine no longer has it". Two kinds of
      // attempt have no run at all and both were being libelled by it:
      //
      //   handed over   a task with no job. The queue sets the machine up and
      //                 leaves it running, so there is nothing to look up and
      //                 the machine emphatically DOES still have it — it is
      //                 sitting there waiting, which the panel said the opposite
      //                 of, next to a button offering to open it
      //   failed        the setup threw before anything was dispatched. The
      //                 reason is already on the attempt; "the machine no longer
      //                 has it" replaces a real explanation with a wrong one
      const withState = attempts.map(a => {
        if (a.failed) return { ...a, state: 'lost' }
        if (!a.run) return { ...a, state: a.setUp ? 'setUp' : 'never started' }
        return { ...a, ...(known.get(a.run) || { state: 'gone' }) }
      })

      // Pulled across the moment it is over, and never again.
      //
      // The machine is the disposable half of this tool: it gets rolled back,
      // deleted, rebuilt, and each of those is a correct thing to do that takes
      // the only account of what happened with it. Two rollbacks in one
      // afternoon erased the record of two runs whose results had already been
      // reported, leaving a task saying work was done and nothing saying how.
      //
      // Here rather than on a timer, because this is the moment somebody is
      // looking at the task -- and a run nobody has looked at since it ended is
      // exactly the one whose machine has not been touched yet.
      for (const a of withState) {
        // NOTHING TO KEEP FOR AN ATTEMPT THAT NEVER RAN. A hand-over and a
        // failed setup both have no run id, so this asked the machine for the
        // output of `undefined` and warned that it could not keep it — three
        // times a draw, for ever, about a log that never existed.
        if (!a.run) continue
        if (a.state === 'running' || a.state === 'gone') continue
        if (archive.has(task.uid, a.run)) continue
        try {
          const out = await actions.vmRunOutput.run({ name: task.machine, run: a.run, lines: 2000 })
          archive.keep(task.uid, a.run, {
            output: out.output || out.text || '',
            machine: task.machine,
            state: a.state,
            exit: a.exit
          })
          log.on('task', id).info(`kept the log of ${a.run}, so it survives the machine`)
        } catch (e) {
          log.on('task', id).warn(`could not keep the log of ${a.run}: ${e.message}`)
        }
      }

      // Only while something is actually running. Pulling a transcript is a
      // guest round trip, and doing it for a finished task every time somebody
      // clicks a card is paying for an answer that cannot change.
      let live = null
      if (withState.some(a => a.state === 'running')) {
        const sessions = await actions.vmSessions.run({ name: task.machine })
        const newest = ((sessions && sessions.sessions) || [])[0]
        if (newest) {
          const tail = await actions.vmSessionTail.run({ name: task.machine, session: newest.id, since: 0, limit: Number(lines) || 12 })
          live = { session: newest.id, title: newest.title, idle: newest.idle, entries: (tail && tail.entries) || [] }
        }
      }
      return { task: id, attempts: withState.map(a => ({ ...a, kept: archive.has(task.uid, a.run) })), live, why: null }
    }
  },

  // The kept log of one attempt, read from this host.
  //
  // Read from here and not from the machine, deliberately: the machine's copy is
  // gone the first time it is rolled back, and this is the copy that is meant to
  // outlive it. `vmRunOutput` still exists for looking at a run in flight, which
  // is the only thing the machine can answer that this cannot.
  taskLog: {
    about: "One attempt's output, kept on this host so it survives the machine",
    needs: 'workspace',
    takes: ['id', 'run', 'lines'],
    run: ({ id, run, lines }) => {
      // Filed under the uid, which is the one identity that never moves. A slug
      // follows the title and a number only means something inside the current
      // board, so either would orphan a task's logs the first time it was
      // renamed or the board was rebuilt.
      const task = tasks.get(id)
      const kept = archive.list(task.uid)
      if (!run) return { task: task.id, number: task.number, attempts: kept, note: kept.length ? 'ask for one by run id' : 'nothing has been kept for this task yet' }
      return { task: task.id, number: task.number, ...archive.read(task.uid, run, { lines }) }
    }
  },

  // Every kept log, including the ones whose task no longer exists.
  //
  // WITHOUT THIS THEY WERE UNREACHABLE. `taskRemove` leaves the logs behind on
  // purpose -- the evidence outliving the note about it is the point -- but
  // `taskLog` needs a task id to find them, and a removed task's id is exactly
  // what is gone. So the record sat on disk under a uid nothing could look up,
  // which is the same as having deleted it, only more expensive.
  //
  // Each row says whether the board still knows the task, because that is the
  // difference between "read it the ordinary way" and "this is all there is".
  taskLogs: {
    about: 'Every run log kept on this host, including tasks that were thrown away',
    needs: 'workspace',
    run: () => {
      const board = new Map(tasks.read().map(t => [t.uid, t]))
      const kept = archive.everything().map(a => {
        const task = board.get(a.uid) || null
        return {
          ...a,
          task: task ? task.id : null,
          number: task ? task.number : null,
          title: task ? task.title : null,
          // Said plainly rather than left to be inferred from a null.
          orphaned: !task
        }
      })
      return {
        kept,
        tasks: kept.length,
        runs: kept.reduce((n, k) => n + k.runs, 0),
        bytes: kept.reduce((n, k) => n + k.bytes, 0),
        orphaned: kept.filter(k => k.orphaned).length,
        where: archive.ROOT(),
        note: kept.length
          ? 'taskLog --id <task> --run <run> reads one; an orphaned uid is a folder under "where"'
          : 'nothing has been kept yet — a log is pulled across when a run finishes'
      }
    }
  },

  // What a task handed over that was not a commit.
  //
  // The branch answers "what did it write"; this answers "what did it BUILD", and
  // for a task whose point is a binary those are different questions with
  // different answers. Filed under the uid like the run logs, so throwing the
  // task away does not orphan what it produced.
  taskFiles: {
    about: 'Files a task handed over — a built binary, an archive, anything a branch cannot hold',
    needs: 'workspace',
    takes: ['id'],
    run: ({ id }) => {
      if (!id) {
        const all = files.everything()
        const board = new Map(tasks.read().map(t => [t.uid, t]))
        return {
          tasks: all.map(a => {
            const t = board.get(a.uid) || null
            return { ...a, task: t ? t.id : null, number: t ? t.number : null, title: t ? t.title : null, orphaned: !t }
          }),
          bytes: all.reduce((n, a) => n + a.bytes, 0),
          where: files.ROOT()
        }
      }
      const task = tasks.get(id)
      const kept = files.list(task.uid)
      return {
        task: task.id,
        number: task.number,
        branch: task.branch,
        files: kept,
        bytes: kept.reduce((n, f) => n + (f.bytes || 0), 0),
        where: files.dirFor(task.uid),
        note: kept.length
          ? 'These are on this host, not on the machine — the machine was rolled back.'
          : 'Nothing was handed over. A run hands a file over by calling "okc-artifact <file>", which is on its PATH.'
      }
    }
  },

  // ---- what workers remember ---------------------------------------------
  //
  // See tasks/sessions.js. A machine is rolled back when its work ends, so a
  // worker's memory is copied here at the end of every run and put back at the
  // start of the next one -- which is what makes a task given out twice a second
  // attempt rather than a stranger starting fresh.
  //
  // NOT GATED ON A WORKSPACE. These outlive the tasks that made them and the
  // board they were on; a folder of repositories being closed is no reason to
  // stop being able to see what a worker was told six weeks ago.
  sessions: {
    about: 'What workers remember, kept per task — restored before a run and taken back after',
    run: () => {
      const kept = sessions.everything()
      const board = new Map(tasks.read().map(t => [t.uid, t]))
      const rows = kept.map(s => {
        const t = board.get(s.uid) || null
        return {
          ...s,
          // From the board where it still exists, and from the record beside the
          // archive where it does not. A task that was thrown away leaves its
          // transcript behind on purpose.
          task: t ? t.id : s.taskId,
          number: t ? t.number : s.number,
          title: t ? t.title : null,
          branch: t ? t.branch : null,
          orphaned: !t,

          // ---- WHAT IT IS ABOUT AND WHICH LANE, FOR THE ONES KEPT BEFORE
          // ---- EITHER WAS WRITTEN DOWN ---------------------------------
          //
          // `aboutWork` records both on every session now, so this is history
          // rather than an ongoing hole: sessions kept before there were lanes
          // name none, and a list of them reads "#42, the work it began with is
          // gone" — which says nothing about the only question somebody has,
          // which is what branch line it was for.
          //
          // IT IS A LOOKUP, NOT A GUESS, and the distinction is the reason this
          // is allowed to fill anything in at all. `board` is the TASK board, so
          // a uid found on it belonged to a task, and a task is worked rather
          // than read — the lane follows from where the record was found. A
          // judgement is not on this board and so is never given a lane here.
          //
          // AND WHAT IS NOT RECOVERABLE IS LEFT EMPTY. A session whose task was
          // thrown away has no branch line anywhere on this host; filing it
          // under the likelier of two lanes would be inventing the answer.
          lane: s.lane || (t ? 'worker' : null),
          about: s.about || (t ? t.branch : null)
        }
      })
      return {
        sessions: rows,
        bytes: rows.reduce((n, s) => n + (s.bytes || 0), 0),
        where: sessions.ROOT(),
        note: rows.length
          ? 'Restored before a worker starts and taken back when it stops, so a task keeps one conversation however many machines it passes through.'
          : 'Nothing yet. A worker started by a job hands its memory back when it finishes, and gets it again next time that task runs.'
      }
    }
  },

  session: {
    about: 'What one task remembers: which conversation, how many runs, and where it is kept',
    takes: ['id'],
    run: ({ id }) => {
      // The task where there is one, so "has this task got a memory yet" is
      // answerable for a task that has never run — which is the ordinary case
      // and cannot go through whoseSession, since nothing is stored yet.
      let task = null
      try { task = tasks.get(String(id)) } catch { /* it may be an orphan's uid */ }
      const memory = sessions.get(task ? task.uid : String(id))
      if (!memory) {
        if (!task) throw new Error(`There is nothing kept under "${id}", and no task by that name either.`)
        return {
          task: task.id,
          number: task.number,
          has: false,
          note: 'Nothing yet. This task has not had a worker finish on it, so there is nothing to carry forward.'
        }
      }
      // `has`, not `kept`. The record already uses `kept` for WHEN it was last
      // written, and a boolean of the same name would have quietly replaced a
      // timestamp with `true` — the panel would then say "kept true" and nobody
      // would know where the date had gone.
      return {
        ...memory,
        has: true,
        task: task ? task.id : memory.taskId,
        number: task ? task.number : memory.number,
        title: task ? task.title : null,
        orphaned: !task
      }
    }
  },

  sessionForget: {
    about: 'Throw away what a task remembers. The next run starts a fresh conversation',
    takes: ['id'],
    run: ({ id }) => {
      // By uid when the task is gone. A memory that outlives its task and cannot
      // then be deleted is kept twice over.
      const { task, uid } = whoseSession(id)
      const gone = sessions.forget(uid)
      log.on('task', task ? task.id : uid).warn(task
        ? `#${task.number} will start a fresh conversation next time — what it remembered was thrown away`
        : `threw away a session left behind by a task that is gone (${uid})`)
      return {
        ...gone,
        orphaned: !task,
        note: task
          ? 'The task, its branch, its files and its logs are untouched. Only the memory is gone.'
          : 'It belonged to a task that no longer exists. Its branch, its files and its logs are untouched.'
      }
    }
  },

  // One of them, as text, so it can be read where it arrived.
  //
  // A file handed back used to be a path in a note: to see what a run produced
  // you left the window, found a folder named after a uid, and opened it in
  // something else. The whole point of handing it over was that it survived the
  // machine; reading it should not need a second program.
  taskFileRead: {
    about: 'Read a file a task handed over, as text',
    needs: 'workspace',
    takes: ['id', 'file'],
    run: ({ id, file }) => {
      const task = tasks.get(id)
      return { ...files.read(task.uid, String(file || '')), task: task.id, number: task.number }
    }
  },

  taskFileForget: {
    about: 'Throw away one file a task handed over. The task and its branch are untouched',
    needs: 'workspace',
    takes: ['id', 'file'],
    run: ({ id, file }) => {
      const task = tasks.get(id)
      const gone = files.forget(task.uid, String(file || ''))
      log.on('task', task.id).warn(`threw away "${gone.name}" from #${task.number}`)
      return { ...gone, note: 'Only the file. The task, its branch and its log are untouched.' }
    }
  },

  // What came back, read the way a pull request is read.
  taskArtifact: {
    about: "What arrived on a task's branch: commits and files, per repository",
    needs: 'workspace',
    takes: ['id'],
    // Never cached: this is what somebody judges from, and reading a
    // four-second-old picture of a branch is exactly the wrong moment to.
    run: ({ id }) => artifact.read(tasks.get(id).branch, { fresh: true })
  },

  taskDiff: {
    about: 'One repository\'s changes on a task\'s branch, in full',
    needs: 'workspace',
    takes: ['id', 'repo', 'file'],
    run: ({ id, repo, file }) => {
      const task = tasks.get(id)
      if (!repo) throw new Error('Say which repository.')
      return { task: id, repo, branch: task.branch, file: file || null, diff: artifact.diff(repo, task.branch, file) }
    }
  },

  // The judgement. A person's decision about work, recorded as a person's
  // decision -- not a merge, and not a gate.
  //
  // Accepting does NOT land anything, which is deliberate. Merging is a separate
  // act with its own rules, and a verdict that quietly merged would make reading
  // the work and publishing it the same button. What this records is that
  // somebody read it and what they thought.
  taskJudge: {
    about: 'Record a verdict on what a task delivered',
    needs: 'workspace',
    takes: ['id', 'verdict', 'note'],
    run: ({ id, verdict, note }) => {
      const task = tasks.get(id)
      const call = String(verdict || '').toLowerCase()
      if (call !== 'accept' && call !== 'reject') throw new Error('The verdict is "accept" or "reject".')

      const art = artifact.read(task.branch, { fresh: true })
      // Refused rather than allowed with a warning. A verdict on an empty branch
      // is a judgement of nothing, and it is indistinguishable afterwards from a
      // judgement of something.
      if (!art.delivered) throw new Error(`Nothing has arrived on "${task.branch}", so there is nothing to judge. A worker that finished without pushing has delivered nothing.`)
      if (call === 'reject' && !String(note || '').trim()) {
        throw new Error('Say why it was rejected. A rejection with no reason is sent back to a worker that cannot ask what was wrong.')
      }

      const decided = tasks.update(id, {
        state: call === 'accept' ? 'accepted' : 'rejected',
        verdict: { call, note: String(note || '').trim() || null, at: new Date().toISOString(), on: art.summary }
      })
      log.on('task', id).good(`${call}ed: ${art.summary}`)
      return decided
    }
  },

  // Giving a task to a PERSON, which is the same act as giving one to a worker.
  //
  //     branch <- task <- claude <- supervisor
  //     branch <- task <- person <- supervisor
  //     supervisor = person || claude
  //
  // The chain is identical and only one step differs: how the work is started,
  // and how it is known to be finished. A worker is dispatched and reports an
  // exit code; a person is handed a machine with an editor open and says when
  // they are done. Everything on both sides of that step -- the branch, the
  // contract, the artifacts, the verdict -- is the same, and treating the human
  // path as a different kind of thing is what kept it off the board entirely:
  // a machine borrowed, an editor opened, and no task, no attempts, no verdict
  // and no record that any of it happened.
  taskWorkOn: {
    about: 'Take a task yourself: a machine set up on its branch, opened in VS Code or in a terminal here',
    needs: 'workspace',
    takes: ['id', 'name', 'open'],
    run: async ({ id, name, open = 'editor' }) => {
      const task = tasks.get(id)
      if (task.verdict) throw new Error(`"${task.id}" has already been judged. Write a new task rather than reopening a decided one.`)
      if (!task.branch) throw new Error(`"${task.id}" has no branch, and a machine is set up on one.`)

      const started = await actions.branchWorkOn.run({ name, branch: task.branch, folder: task.folder || undefined, open })

      // Recorded the same way a dispatch is, and for the same reason: the task
      // has to say who is doing it and where, or nothing else on the board can.
      tasks.update(task.id, {
        state: 'given',
        machine: started.name,
        attempts: [...(task.attempts || []), { machine: started.name, at: new Date().toISOString(), by: open === 'terminal' ? 'a person, in a terminal' : 'a person, in VS Code' }]
      })
      log.on('task', task.id).good(`taken by hand on ${started.name}, on ${task.branch}`)

      return {
        ...started,
        task: task.id,
        number: task.number,
        // The sign-in state is carried up rather than dropped. This note used to
        // replace branchWorkOn's wholesale, which meant a machine whose worker
        // cannot authenticate handed itself over without mentioning it — and the
        // person finds out by typing `claude` and being told the session expired.
        note: `#${task.number} is yours on ${started.name}.` +
          (started.signedIn === false
            ? ' Claude will NOT run there: this host\'s worker credential has expired. Get a fresh one on the Keys tab.'
            : '') +
          ' Push what you want judged, then finish it — that gives the machine back and puts the task up for a verdict.'
      }
    }
  },

  // A person saying the work is done, which is what a worker's exit code says.
  taskFinished: {
    about: 'Say a task you took by hand is finished: give the machine back and put it up for a verdict',
    needs: 'workspace',
    takes: ['id', 'keep'],
    run: async ({ id, keep = false }) => {
      const task = tasks.get(id)
      if (!task.machine) throw new Error(`"${task.id}" is not on a machine.`)

      // The machine goes back through the same door as everything else, so the
      // same refusal applies: anything uncommitted stops this, because putting a
      // machine away rolls it back.
      const back = await actions.vmReturn.run({ name: task.machine, keep })

      tasks.update(task.id, { state: 'done' })
      log.on('task', task.id).good('finished by hand — waiting on a verdict')
      return {
        task: task.id,
        number: task.number,
        machine: back.name,
        note: `${back.note} #${task.number} is done and waiting to be judged — what it delivered is whatever reached "${task.branch}".`
      }
    }
  },

  // ---- jobs, and the prompts they are given ------------------------------
  //
  //     task <- job <- prompt
  //
  // A job is a SCRIPT: a Node file this app owns, which decides what to do with
  // a prompt. A prompt is what a worker is told. Both are approved by a person
  // who read them, and both are hashed on the thing that will actually be used
  // -- the file's bytes, and the words -- so an edit to either lapses it.
  //
  // See tasks/jobs.js for why the code is a file rather than a string, and
  // tasks/jobrun.js for what a running job is handed.
  jobs: {
    about: 'The jobs this workspace has: scripts that take a prompt and do something with it. "kind" is task or judge',
    needs: 'workspace',
    takes: ['tag', 'kind'],
    run: ({ tag, kind, _fromMachine }) => {
      // The prompts as the prompt library itself reports them, so a prompt's own
      // contract is already resolved and this does not work it out a second time
      // with a second chance of getting it wrong.
      const library = actions.prompts.run({}).prompts
      // TWO LIBRARIES, ASKED FOR BY NAME. Everything is returned when nothing is
      // said, so a plain listing never hides half of what exists — the screens
      // ask for the half they are about, and every row carries its `kind` either
      // way. See tasks/jobs.js for why judging chains are kept apart.
      const want = kind === undefined ? null : (String(kind) === 'judge' ? 'judge' : 'task')
      const rows = jobs.all()
        .filter(j => !want || j.kind === want)
        .filter(j => !tag || (j.tags || []).includes(tag))
        .map(j => {
          const from = j.promptId ? library.find(p => p.id === j.promptId) || null : null
          return {
            ...j,
            // The code is long and this list is read as a list. It is served in
            // full by `job`, which is what the editor asks for.
            code: undefined,
            lines: (j.code || '').split('\n').length,
            prompt: from ? { id: from.id, name: from.name, approved: from.approved, usable: from.usable, whyNot: from.whyNot } : null,
            missingPrompt: !!(j.promptId && !from),
            // WHETHER IT COULD RUN RIGHT NOW, as one answer rather than four
            // flags a reader has to combine.
            //
            // THREE THINGS ARE APPROVED, not two, and the third arrives through
            // the second: the script, the prompt, and the rules that prompt runs
            // under. A job does not name a contract -- a prompt does -- so this
            // asks the prompt whether IT is usable rather than reaching past it
            // to the contract, which keeps the chain in one direction.
            runnable: j.approved && (!j.promptId || !!(from && from.usable)),
            whyNot: !j.there
              ? 'its script is missing'
              : j.lapsed
                ? 'edited since it was approved'
                : !j.approved
                  ? 'not approved'
                  : j.promptId && !from
                    ? 'its prompt is gone'
                    : j.promptId && from && !from.usable
                      ? (from.approved
                          // Said in full, because "its prompt is not usable"
                          // would send somebody to the prompt to find it fine.
                          ? `its prompt "${from.name}" runs under a contract that is not ready — ${from.whyNot}`
                          : `its prompt "${from.name}" is not approved`)
                      : null
          }
        })

      return {
        jobs: offeredTo(rows, { _fromMachine }),
        tags: jobs.tags(),
        prompts: library.map(p => ({ id: p.id, name: p.name, approved: p.approved })),
        where: jobs.DIR(),
        note: rows.length
          ? 'A job runs against the workspace that is open. Nothing unapproved runs, and that means the script AND the prompt it is given.'
          : 'No jobs yet. A job is a script that takes a prompt and does something with it — write one with +.'
      }
    }
  },

  job: {
    about: 'One job, with its script in full',
    needs: 'workspace',
    takes: ['id'],
    run: ({ id }) => {
      const one = jobs.get(id)
      if (!one) throw new Error(`There is no job called "${id}".`)
      return one
    }
  },

  // IN PLAY, OR KEPT AND OUT OF THE WAY. See `use` in tasks/jobs.js for
  // what this is and why bringing one back over the wire costs its approval.
  jobUse: {
    about: 'Jobs a supervisor may pick from. Setting one aside keeps it and stops it being offered; bringing it back over the wire makes it wait to be read again',
    takes: ['id', 'use'],
    run: ({ id, use = false, _overTheWire, _driven }) => {
      const by = whoAsked({ _overTheWire, _driven })
      const was = jobs.get(id)
      if (!was) throw new Error(`There is no job called "${id}".`)

      const one = jobs.use(id, use, { by })
      const now = one.setAside === true ? 'set aside' : 'in use'
      log.on('library').info(`job "${one.name || one.id}" is ${now} — by ${by}`)

      return {
        ...one,
        inUse: one.setAside !== true,
        // SAID WHEN IT HAPPENED, because losing an approval by pressing
        // something called "use it again" is exactly the surprise this app is
        // written against.
        note: one.setAside === true
          ? `"${one.name || one.id}" is set aside. It is kept in full and nothing is offered it until you bring it back.`
          : (was.setAside === true && by !== 'the window'
              ? `"${one.name || one.id}" is in use again, and its approval was withdrawn because it was brought back from down the pipe — read it and approve it before anything can run it.`
              : `"${one.name || one.id}" is in use.`)
      }
    }
  },

  // IN PLAY, OR KEPT AND OUT OF THE WAY. See `use` in tasks/prompts.js for
  // what this is and why bringing one back over the wire costs its approval.
  promptUse: {
    about: 'Prompts a supervisor may pick from. Setting one aside keeps it and stops it being offered; bringing it back over the wire makes it wait to be read again',
    takes: ['id', 'use'],
    run: ({ id, use = false, _overTheWire, _driven }) => {
      const by = whoAsked({ _overTheWire, _driven })
      const was = prompts.get(id)
      if (!was) throw new Error(`There is no prompt called "${id}".`)

      const one = prompts.use(id, use, { by })
      const now = one.setAside === true ? 'set aside' : 'in use'
      log.on('library').info(`prompt "${one.name || one.id}" is ${now} — by ${by}`)

      return {
        ...one,
        inUse: one.setAside !== true,
        // SAID WHEN IT HAPPENED, because losing an approval by pressing
        // something called "use it again" is exactly the surprise this app is
        // written against.
        note: one.setAside === true
          ? `"${one.name || one.id}" is set aside. It is kept in full and nothing is offered it until you bring it back.`
          : (was.setAside === true && by !== 'the window'
              ? `"${one.name || one.id}" is in use again, and its approval was withdrawn because it was brought back from down the pipe — read it and approve it before anything can run it.`
              : `"${one.name || one.id}" is in use.`)
      }
    }
  },

  // IN PLAY, OR KEPT AND OUT OF THE WAY. See `use` in tasks/contracts.js for
  // what this is and why bringing one back over the wire costs its approval.
  contractUse: {
    about: 'Contracts a supervisor may pick from. Setting one aside keeps it and stops it being offered; bringing it back over the wire makes it wait to be read again',
    takes: ['id', 'use'],
    run: ({ id, use = false, _overTheWire, _driven }) => {
      const by = whoAsked({ _overTheWire, _driven })
      const was = contracts.get(id)
      if (!was) throw new Error(`There is no contract called "${id}".`)

      const one = contracts.use(id, use, { by })
      const now = one.setAside === true ? 'set aside' : 'in use'
      log.on('library').info(`contract "${one.name || one.id}" is ${now} — by ${by}`)

      return {
        ...one,
        inUse: one.setAside !== true,
        // SAID WHEN IT HAPPENED, because losing an approval by pressing
        // something called "use it again" is exactly the surprise this app is
        // written against.
        note: one.setAside === true
          ? `"${one.name || one.id}" is set aside. It is kept in full and nothing is offered it until you bring it back.`
          : (was.setAside === true && by !== 'the window'
              ? `"${one.name || one.id}" is in use again, and its approval was withdrawn because it was brought back from down the pipe — read it and approve it before anything can run it.`
              : `"${one.name || one.id}" is in use.`)
      }
    }
  },

  jobSave: {
    about: 'Write a job, or rewrite it. Written at the window it is approved by whoever wrote it; written over the wire it waits',
    needs: 'workspace',
    takes: ['id', 'name', 'about', 'code', 'promptId', 'tags', 'kind'],
    run: ({ _overTheWire, _driven, ...fields }) => {
      const a = { _overTheWire, _driven }
      const saved = jobs.save(fields, s.whoAsked(a))
      log.on('task').info(`${saved.created ? 'wrote' : 'rewrote'} the job "${saved.name}"${saved.approved ? '' : ' — it is waiting to be approved'}`)
      return { ...saved, code: undefined }
    }
  },

  jobApprove: {
    about: 'Say a job is fit to run, having read its script',
    needs: 'workspace',
    takes: ['id', 'note'],
    run: ({ id, note, _overTheWire, _driven }) => {
      // The boundary, not a courtesy. This socket is what a supervising model
      // drives, and a job is a program: approving one is a person saying they
      // have read what will run as them.
      if (_overTheWire || _driven) throw new Error('Approving is done in the window, by a person who has read the script. A model may write one and may not approve its own. A press driven from the command line is the command line, whichever button it lands on.')
      const done = jobs.approve(id, note)
      log.on('task').good(`job "${done.name}" approved`)
      return { ...done, code: undefined }
    }
  },

  jobWithdraw: {
    about: 'Take a job\'s approval back. Nothing is deleted; it stops being runnable',
    needs: 'workspace',
    takes: ['id'],
    run: ({ id }) => {
      const done = jobs.withdraw(id)
      log.on('task').warn(`approval withdrawn for the job "${done.name}"`)
      return { ...done, code: undefined }
    }
  },

  jobForget: {
    about: 'Throw a job away, script and all',
    needs: 'workspace',
    takes: ['id'],
    run: ({ id }) => {
      const gone = jobs.forget(id)
      log.on('task').warn(`job "${gone.name}" thrown away`)
      return { ...gone, note: 'Its script went with it. Anything it already did is untouched.' }
    }
  },

  jobRun: {
    about: 'Send a job to a machine and let it run there, with a prompt — or with what a task or a judgement carries',
    needs: 'workspace',
    takes: ['id', 'promptId', 'task', 'judgement', 'name', 'folder'],
    run: async ({ id, promptId, task: taskId, judgement: judgementId, name, folder }) => {
      const one = jobs.get(id)
      if (!one) throw new Error(`There is no job called "${id}".`)

      // A MACHINE IS REQUIRED, and it is refused rather than chosen for you.
      // Which machine a job runs on decides what it can see and what it leaves
      // behind, and picking one quietly is how work lands somewhere nobody meant.
      if (!name) {
        const free = vms.read().filter(v => channel.connected(v.name))
        throw new Error(free.length
          ? `Say which machine. Connected right now: ${free.map(v => v.name).join(', ')}.`
          : 'Say which machine — and none is connected right now, so start one first.')
      }
      const vm = vms.get(name)
      if (!channel.connected(name)) throw new Error(`"${name}" is not dialled in, so it cannot be given anything.`)

      const to = log.on('job', id, name)

      // THE WORKER CREDENTIAL, BECAUSE A JOB MAY START A WORKER.
      //
      // The queue does three things before it dispatches a task -- bring the
      // machine up, hand it the credential, set the workspace up -- and a job
      // dispatched here did none of them. That was invisible until the API grew
      // `claude()`: a job that ran a worker got
      //
      //     {"is_error":true,"result":"Not logged in · Please run /login"}
      //
      // every time, on a machine whose only fault was that nobody had given it
      // the credential this host has been holding since yesterday.
      //
      // Not fatal, on purpose. Most jobs never start a worker, and a machine
      // that cannot be given one is a reason to say so rather than to refuse
      // work that does not need it -- `claude()` will say the same thing far
      // more precisely if it turns out to matter.
      try {
        await actions.vmCredentialsPut.run({ name })
      } catch (e) {
        to.warn(`${name} has no worker credential — a job that starts one will be refused: ${e.message}`)
      }

      // Where artifacts go. The guest knows its own token and this app's
      // authority; what it does not know is which port to hand a file back on.
      let base = null
      try {
        const where = await vbox.hostAddress()
        if (where) base = `https://${where}:${net.port}`
      } catch { /* no address means no helper, and the job still runs */ }

      // WITH WHAT THE TASK CARRIES, when it is being run for one. A task copied
      // its brief and its rules when it was written; going back to the library
      // here would run it under whatever those say now, which is a different
      // text the moment anybody edits one -- and the task's is the one somebody
      // wrote, queued, and will be judged on.
      //
      // OR WHAT A JUDGEMENT CARRIES, which is the same fields for the same
      // reason — copied in when it was written, so what a finished run was held
      // to cannot be changed afterwards by editing a library entry. Nothing
      // downstream had to learn about judging: the only thing it reads that a
      // task does not carry is `ref`, because J1 and #1 are different work.
      if (taskId && judgementId) throw new Error('Run it for a task or for a judgement, not both — they are different pieces of work and the run belongs to one of them.')
      let forTask = taskId ? tasks.get(taskId) : judgementId ? judging.get(judgementId) : null
      if (taskId && !forTask) throw new Error(`There is no task called "${taskId}".`)

      // A CONTINUATION SAYS SO, AND THIS IS THE PATH THAT MATTERS.
      //
      // The fix for it was first written into vmDispatch alone, where it never
      // once fired: a task with a JOB never touches vmDispatch, and every task
      // in the drill that found the problem has one. The brief becomes the job's
      // prompt in tasks/jobrun.js, so the announcement has to be on the brief
      // before it gets there.
      //
      // See `announcement` in tasks/sessions.js for what it says and why. It
      // returns null unless the conversation this machine is about to resume was
      // written by DIFFERENT work, so a first pass and a second attempt at the
      // same task are both left alone.
      if (forTask && forTask.brief) {
        try {
          const said = sessions.announcement({
            kind: judgementId ? 'judgement' : 'task',
            id: forTask.id,
            uid: forTask.uid,
            item: forTask
          })
          if (said) {
            forTask = { ...forTask, brief: [said, '--- the task ---', '', String(forTask.brief)].join('\n') }
            // SAID OUT LOUD, because whether this fired is otherwise only
            // answerable by reading the code — which is how the first version of
            // it went unnoticed while never firing at all. A brief is not in the
            // run log, so nothing downstream can show it either.
            to.info('this brief is announced as a continuation — it resumes a conversation begun by other work on this subject')
          }
        } catch { /* a brief that could not be annotated is still the brief */ }
      }
      if (forTask && promptId) throw new Error('Give it either a prompt from the library or a task, not both — a task already carries the words it was written with.')

      const out = await jobrun.run({
        id,
        promptId: forTask ? null : (promptId || one.promptId || null),
        fromTask: forTask,
        machine: name,
        // The machine's own token, which the host holds and the guest does not
        // have until something puts it there. See job-api.js.
        token: vm.spec && vm.spec.token,
        prompts,
        contracts,
        dispatch,
        channel,
        base,
        // RESOLVED AGAINST THE MACHINE'S OWN HOME, not passed through as
        // written. The folder is configured as `$HOME/workspace`, which is a
        // shell expansion — and everything that reaches the guest is
        // single-quoted, deliberately, so nothing in a path can run as code.
        // Passing it raw meant `cd '$HOME/workspace'` failing and falling back to
        // the home directory, which a job then reported as its workspace: wrong,
        // and wrong quietly. `workFolder` asks the machine where home is.
        folder: await workFolder(name, folder),
        log: line => to.info(String(line))
      })

      to.good(`${name} is running "${one.name}" as ${out.run}`)
      return out
    }
  },

  // ---- the prompt library ------------------------------------------------
  //
  // Writing a task is writing a prompt. The brief IS the instruction, and it was
  // typed fresh every time -- so the same intention ended up with four wordings
  // and nobody knew which was the good one. These are the kept ones.
  //
  // NOT GATED ON A WORKSPACE, unlike the jobs that consume them. A job names a
  // branch and belongs to a folder of repositories; "read the README against the
  // code" names neither, and a library that emptied itself when somebody
  // switched workspace is one nobody would build.
  prompts: {
    about: 'The prompt library: what a worker can be told, written once and kept. "kind" is task or judge',
    takes: ['kind'],
    run: ({ kind, _fromMachine } = {}) => {
      const rules = contracts.all()
      // Two libraries, asked for by name — see the jobs action above. Everything
      // comes back when nothing is said, and every row carries its own kind.
      const want = kind === undefined ? null : (String(kind) === 'judge' ? 'judge' : 'task')
      // THE CONTRACT IT RUNS UNDER, resolved here, the same way a job's prompt
      // is. A prompt is what a worker is told to do and a contract is what it
      // may not do while doing it, and the two are only ever read together --
      // so "is this usable" is one answer rather than two flags a reader has to
      // combine, and `whyNot` names which half is missing.
      const list = prompts.all().map(p => {
        const under = p.contractId ? rules.find(c => c.id === p.contractId) || null : null
        return {
          ...p,
          contract: under ? { id: under.id, name: under.name, approved: under.approved } : null,
          missingContract: !!(p.contractId && !under),
          usable: p.approved && (!p.contractId || !!(under && under.approved)),
          whyNot: !p.approved
            ? (p.lapsed ? 'edited since it was approved' : 'not approved')
            : p.contractId && !under
              ? 'its contract is gone'
              : p.contractId && under && !under.approved
                ? `its contract "${under.name}" is not approved`
                : null
        }
      })
      return {
        prompts: offeredTo(want ? list.filter(p => p.kind === want) : list, { _fromMachine }),
        contracts: offeredTo(want ? rules.filter(c => c.kind === want) : rules, { _fromMachine }),
        where: prompts.FILE(),
        note: list.length
          ? 'A task copies the text it was given rather than pointing at it, so editing one here never rewrites a task that already went out.'
          : 'Nothing kept yet. A prompt is the brief of a task, written once — worth keeping the moment you would type it a second time.'
      }
    }
  },

  promptSave: {
    about: 'Write a prompt, or rewrite one. The id never changes once it is made',
    takes: ['id', 'name', 'text', 'about', 'contractId', 'kind'],
    run: a => {
      const { id, name, text, about, contractId, kind } = a
      // Refused by name here rather than discovered as a dangling reference in
      // the panel three days later.
      if (contractId && !contracts.get(String(contractId))) {
        throw new Error(`There is no contract called "${contractId}". Write it first — the rules a prompt runs under are not a name typed into a box.`)
      }
      const saved = prompts.save({ id, name, text, about, contractId, kind }, s.whoAsked(a))
      log.on('task').info(`${saved.created ? 'wrote' : 'rewrote'} the prompt "${saved.name}", asked by ${s.whoAsked(a)}${saved.approved ? '' : ' — it is waiting to be approved'}`)
      return saved
    }
  },

  promptApprove: {
    about: 'Say a prompt is fit to be sent to a worker, having read it',
    takes: ['id', 'note'],
    run: ({ id, note, _overTheWire, _driven }) => {
      // The same boundary as a job, and for the sharper reason: this is the text
      // a worker is actually handed.
      if (_overTheWire || _driven) throw new Error('Approving is done in the window, by a person who has read it. A model may write a prompt and may not approve its own. A press driven from the command line is the command line, whichever button it lands on.')
      const done = prompts.approve(id, note)
      log.on('task').good(`prompt "${done.name}" approved`)
      return done
    }
  },

  promptWithdraw: {
    about: 'Take a prompt\'s approval back. Jobs that use it stop being runnable',
    takes: ['id'],
    run: ({ id }) => {
      const done = prompts.withdraw(id)
      log.on('task').warn(`approval withdrawn for the prompt "${done.name}"`)
      return done
    }
  },

  promptForget: {
    about: 'Throw a prompt away. Tasks written from it are untouched — they carry their own copy',
    takes: ['id'],
    run: ({ id }) => {
      const gone = prompts.forget(id)
      log.on('task').warn(`prompt "${gone.name}" thrown away`)
      return { ...gone, note: 'Any task written from it keeps the text it was given. This only removes it from the library.' }
    }
  },

  // ---- the contract library ------------------------------------------------
  //
  // The rules a worker is given, as opposed to the brief. See tasks/contracts.js
  // for why these are separate things and why one had to stop being a file path.
  //
  // NOT GATED ON A WORKSPACE, for the same reason prompts are not: "do not
  // force-push" names no repository.
  contracts: {
    about: 'The contract library: the rules a worker is given, written once and kept. "kind" is task or judge',
    takes: ['kind'],
    run: ({ kind, _fromMachine } = {}) => {
      const want = kind === undefined ? null : (String(kind) === 'judge' ? 'judge' : 'task')
      const list = contracts.all().filter(c => !want || c.kind === want)
      const waiting = list.filter(c => !c.approved).length
      return {
        contracts: offeredTo(list, { _fromMachine }),
        where: contracts.FILE(),
        note: list.length
          ? `${list.length} kept${waiting ? `, ${waiting} waiting to be approved` : ''}. A task copies the rules it was given rather than pointing at them, so editing one here never changes what a task already went out under.`
          : 'Nothing kept yet. A contract is what a worker may and may not do while it works — the same rules for a hundred different briefs.'
      }
    }
  },

  contract: {
    about: 'One contract, with its rules in full',
    takes: ['id'],
    run: ({ id }) => {
      const one = contracts.get(id)
      if (!one) throw new Error(`There is no contract called "${id}".`)
      return one
    }
  },

  contractSave: {
    about: 'Write a contract, or rewrite one. Written at the window it is approved by whoever wrote it; written over the wire it waits',
    takes: ['id', 'name', 'about', 'text', 'kind'],
    run: a => {
      const { id, name, about, text, kind } = a
      const saved = contracts.save({ id, name, about, text, kind }, s.whoAsked(a))
      log.on('task').info(`${saved.created ? 'wrote' : 'rewrote'} the contract "${saved.name}", asked by ${s.whoAsked(a)}${saved.approved ? '' : ' — it is waiting to be approved'}`)
      return saved
    }
  },

  contractApprove: {
    about: 'Say a contract is fit to govern a run, having read it',
    takes: ['id', 'note'],
    run: ({ id, note, _overTheWire, _driven }) => {
      // The same boundary as a prompt and a job, and here it is the sharpest of
      // the three: this is the text that says what a worker may NOT do, and a
      // model ratifying its own limits is the one review that reviews nothing.
      if (_overTheWire || _driven) throw new Error('Approving is done in the window, by a person who has read it. A model may write a contract and may not approve its own. A press driven from the command line is the command line, whichever button it lands on.')
      const done = contracts.approve(id, note)
      log.on('task').good(`contract "${done.name}" approved`)
      return done
    }
  },

  contractWithdraw: {
    about: 'Take a contract\'s approval back. Nothing is deleted; it stops being usable',
    takes: ['id'],
    run: ({ id }) => {
      const done = contracts.withdraw(id)
      log.on('task').warn(`approval withdrawn for the contract "${done.name}"`)
      return done
    }
  },

  contractForget: {
    about: 'Throw a contract away. Tasks written under it are untouched — they carry their own copy',
    takes: ['id'],
    run: ({ id }) => {
      const gone = contracts.forget(id)
      log.on('task').warn(`contract "${gone.name}" thrown away`)
      return { ...gone, note: 'Any task already written under it keeps the rules it was given. This only removes it from the library.' }
    }
  }
}
