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
  vbox, vms, provisioner, scripts, channel, tasks, artifact,
  archive, files, prompts, contracts, jobs, jobrun, workspaces, queue, machines, provision, reach, editor, repos,
  busy, session, dispatch, auth, branches, workspace, fs, path, https,
  started, net, inTheWay, refuseIfThatTitleIsTaken, refuseIfItHoldsACredential,
  guestPath, workFolder, credentialLife, rememberCredentialCheck, twoLines
} = s

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
    about: 'Write a task: what the work is, and the branch it delivers on',
    needs: 'workspace',
    takes: ['task'],
    run: ({ task }) => {
      const input = typeof task === 'string' ? JSON.parse(task) : task
      if (!input || typeof input !== 'object') throw new Error('Pass the task as an object.')
      const why = branches.nameIsOk(String(input.branch || '').trim())
      if (why) throw new Error(why)

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
      return tasks.add(input)
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
      const free = queue.availability((await actions.vmList.run({})).vms)
      const can = free.filter(a => a.free)
      log.on('task', task.id).good(`#${task.number} queued`)
      return {
        ...queued,
        waitingFor: can.length ? null : free.map(a => `${a.name} ${a.why}`),
        note: can.length
          ? `${can.length} machine(s) can take it; the next tick picks it up.`
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

  queueState: {
    about: 'What the queue is doing, and which machines could take work',
    needs: 'workspace',
    run: async () => {
      const { vms } = await actions.vmList.run({})
      // The STORE, not the `tasks` action.
      //
      // That action reads every task's branch out of git to say what is on it,
      // which is three or four processes per repository per task -- and this is
      // asked for on every draw, alongside the action that already does it.
      // Nothing here needs to know what a branch contains: a queued task is
      // queued whatever is on its branch.
      const all = tasks.read()
      return {
        ...queue.state(),
        waiting: all.filter(t => t.state === 'queued')
          .sort((a, b) => a.number - b.number)
          .map(t => ({ number: t.number, id: t.id, title: t.title, branch: t.branch })),
        machines: queue.availability(vms),
        every: `${queue.TICK / 1000}s`
      }
    }
  },

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

      await actions.vmWorkspace.run({ name, branch: task.branch, folder: task.folder || undefined })

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
      const withState = attempts.map(a => ({ ...a, ...(known.get(a.run) || { state: 'gone' }) }))

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
    about: 'The jobs this workspace has: scripts that take a prompt and do something with it',
    needs: 'workspace',
    takes: ['tag'],
    run: ({ tag }) => {
      // The prompts as the prompt library itself reports them, so a prompt's own
      // contract is already resolved and this does not work it out a second time
      // with a second chance of getting it wrong.
      const library = actions.prompts.run({}).prompts
      const rows = jobs.all()
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
        jobs: rows,
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

  jobSave: {
    about: 'Write a job, or rewrite it. Written at the window it is approved by whoever wrote it; written over the wire it waits',
    needs: 'workspace',
    takes: ['id', 'name', 'about', 'code', 'promptId', 'tags'],
    run: ({ _overTheWire, ...fields }) => {
      const saved = jobs.save(fields, _overTheWire ? 'the command line' : 'the window')
      log.on('task').info(`${saved.created ? 'wrote' : 'rewrote'} the job "${saved.name}"${saved.approved ? '' : ' — it is waiting to be approved'}`)
      return { ...saved, code: undefined }
    }
  },

  jobApprove: {
    about: 'Say a job is fit to run, having read its script',
    needs: 'workspace',
    takes: ['id', 'note'],
    run: ({ id, note, _overTheWire }) => {
      // The boundary, not a courtesy. This socket is what a supervising model
      // drives, and a job is a program: approving one is a person saying they
      // have read what will run as them.
      if (_overTheWire) throw new Error('Approving is done in the window, by a person who has read the script. A model may write one and may not approve its own.')
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
    about: 'Send a job to a machine and let it run there, with a prompt',
    needs: 'workspace',
    takes: ['id', 'promptId', 'name', 'folder'],
    run: async ({ id, promptId, name, folder }) => {
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

      const out = await jobrun.run({
        id,
        promptId: promptId || one.promptId || null,
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
    about: 'The prompt library: what a worker can be told, written once and kept',
    run: () => {
      const rules = contracts.all()
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
        prompts: list,
        contracts: rules,
        where: prompts.FILE(),
        note: list.length
          ? 'A task copies the text it was given rather than pointing at it, so editing one here never rewrites a task that already went out.'
          : 'Nothing kept yet. A prompt is the brief of a task, written once — worth keeping the moment you would type it a second time.'
      }
    }
  },

  promptSave: {
    about: 'Write a prompt, or rewrite one. The id never changes once it is made',
    takes: ['id', 'name', 'text', 'about', 'contractId'],
    run: ({ id, name, text, about, contractId, _overTheWire }) => {
      // Refused by name here rather than discovered as a dangling reference in
      // the panel three days later.
      if (contractId && !contracts.get(String(contractId))) {
        throw new Error(`There is no contract called "${contractId}". Write it first — the rules a prompt runs under are not a name typed into a box.`)
      }
      const saved = prompts.save({ id, name, text, about, contractId }, _overTheWire ? 'the command line' : 'the window')
      log.on('task').info(`${saved.created ? 'wrote' : 'rewrote'} the prompt "${saved.name}"${saved.approved ? '' : ' — it is waiting to be approved'}`)
      return saved
    }
  },

  promptApprove: {
    about: 'Say a prompt is fit to be sent to a worker, having read it',
    takes: ['id', 'note'],
    run: ({ id, note, _overTheWire }) => {
      // The same boundary as a job, and for the sharper reason: this is the text
      // a worker is actually handed.
      if (_overTheWire) throw new Error('Approving is done in the window, by a person who has read it. A model may write a prompt and may not approve its own.')
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
    about: 'The contract library: the rules a worker is given, written once and kept',
    run: () => {
      const list = contracts.all()
      const waiting = list.filter(c => !c.approved).length
      return {
        contracts: list,
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
    takes: ['id', 'name', 'about', 'text'],
    run: ({ id, name, about, text, _overTheWire }) => {
      const saved = contracts.save({ id, name, about, text }, _overTheWire ? 'the command line' : 'the window')
      log.on('task').info(`${saved.created ? 'wrote' : 'rewrote'} the contract "${saved.name}"${saved.approved ? '' : ' — it is waiting to be approved'}`)
      return saved
    }
  },

  contractApprove: {
    about: 'Say a contract is fit to govern a run, having read it',
    takes: ['id', 'note'],
    run: ({ id, note, _overTheWire }) => {
      // The same boundary as a prompt and a job, and here it is the sharpest of
      // the three: this is the text that says what a worker may NOT do, and a
      // model ratifying its own limits is the one review that reviews nothing.
      if (_overTheWire) throw new Error('Approving is done in the window, by a person who has read it. A model may write a contract and may not approve its own.')
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
