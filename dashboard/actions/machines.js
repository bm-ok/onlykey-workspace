'use strict'

// The virtual machines this app made: making them, starting them,
// snapshotting them, borrowing one and putting it back.
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
  archive, files, prompts, jobs, jobrun, workspaces, queue, machines, provision, reach, editor, repos,
  busy, session, dispatch, auth, branches, workspace, fs, path, https,
  started, net, inTheWay, refuseIfThatTitleIsTaken, refuseIfItHoldsACredential,
  guestPath, workFolder, credentialLife, rememberCredentialCheck, twoLines
} = s

module.exports = {
  // Only ever the machines this app made. Everything here refuses a machine that
  // is not in its own registry, because these actions can destroy one.
  vmList: { about: 'The virtual machines this app made, with live state and stage', run: () => vms.all() },

  vmCreate: { about: 'Make a virtual machine and its disk', takes: ['vm'], run: ({ vm }) => provisioner.create(vm || {}) },

  vmInstall: { about: 'Install an operating system, unattended, and run its provisioning scripts', takes: ['name'], run: ({ name }) => busy.during(name, 'being installed', () => provisioner.install(name, { port: net.port, caPort: net.caPort })) },

  vmRemove: {
    about: 'Delete a virtual machine and its disks, and forget it',
    takes: ['name'],
    run: ({ name }) => busy.during(name, 'being deleted', async () => {
      vms.get(name)                      // refuses anything this app did not make
      // Before the machine goes, so nothing is left holding a session for something
      // that no longer exists -- and so a new machine of the same name cannot
      // inherit it.
      channel.drop(name, 'was deleted')
      const out = await vbox.destroy(name)
      return { ...out, ...vms.forget(name) }
    })
  },

  vmForget: {
    about: 'Stop managing a virtual machine without deleting it',
    takes: ['name'],
    run: ({ name }) => { channel.drop(name, 'is no longer managed here'); return vms.forget(name) }
  },

  // A note for the person, not for the machine: what this one is for, which is the
  // question a list of names cannot answer. Kept in the registry beside the machine
  // rather than in VirtualBox, because it is this app's own record and a machine
  // that is only defined -- with nothing in VirtualBox to describe -- still needs it.
  vmDescribe: {
    about: 'Set the note shown beside a machine in the list',
    takes: ['name', 'description'],
    run: ({ name, description = '' }) => {
      vms.get(name)                      // refuses anything this app did not make
      return vms.update(name, { description: String(description).trim() })
    }
  },

  // Let go of a branch, once there is nothing left on it to lose.
  //
  // THE RULE WAS ALWAYS "until it is clean" and only half of it existed. A
  // machine stays on its branch until it is clean -- and the only way off was a
  // rollback, which discards. So a machine that had finished, pushed everything
  // and was carrying nothing still held its claim for ever, kept out of the
  // queue and unable to be given anything else. That is not the rule being
  // enforced, it is the rule with no exit.
  //
  // CLEAN IS ASKED, NOT ASSUMED, and asked of the machine. Nothing uncommitted
  // and nothing unpushed, in every repository -- which is exactly what vmHolds
  // answers, and it is refused outright if the machine cannot be reached to be
  // asked. A claim released on a guess is how work that exists in one place
  // stops existing anywhere.
  vmRelease: {
    about: 'Let a machine off its branch, once it is holding nothing',
    takes: ['name'],
    run: async ({ name }) => {
      const vm = vms.get(name)
      if (!vm.branch) return { name, branch: null, note: 'It was not on a branch.' }
      if (!channel.connected(name)) {
        throw new Error(`"${name}" is not dialled in, so it cannot be asked whether it is holding anything — and a claim released on a guess is how work stops existing anywhere. Start it first.`)
      }

      const holds = await actions.vmHolds.run({ name })
      if (!holds.asked) throw new Error(`"${name}" could not be asked what it is holding: ${holds.why}`)
      if (holds.summary) {
        throw new Error(`"${name}" is still holding ${holds.summary}. Push it, or throw the machine away deliberately — this only releases a branch there is nothing left to lose on.`)
      }

      vms.update(name, { branch: null })
      log.on('vm', name).good(`let go of ${vm.branch} — it was holding nothing`)
      return {
        name,
        was: vm.branch,
        branch: null,
        note: `"${vm.branch}" is free for another machine, and this one can be given other work. Anything it pushed is still here.`
      }
    }
  },

  // Whether the queue may use this machine at all.
  //
  // Everything else that keeps a machine out of the pool is a FACT about it --
  // it claims a branch, it has no base snapshot, it is mid-install. Those are
  // discovered and they change on their own. This is a DECISION, and it is the
  // only one a person can make about the pool: keep this machine for me.
  //
  // Wanted because the queue is otherwise entitled to any machine that looks
  // idle, and "looks idle" is exactly what a machine somebody is about to use
  // looks like. Rolling it back and handing it a task would discard whatever
  // they had set up, and the first they would know is a clean disk.
  //
  // Default is IN. These are runners; a tool for running work should not need
  // every machine enrolled by hand before it does anything. Opting out is the
  // deliberate act, and it is recorded so it survives a restart.
  vmForTasks: {
    about: 'Let the queue use this machine, or keep it back for yourself',
    takes: ['name', 'enabled'],
    run: ({ name, enabled }) => {
      const vm = vms.get(name)
      const want = enabled === undefined
        ? !(vm.forTasks === false)       // no argument means "toggle it"
        : !(enabled === false || enabled === 'false' || enabled === 'no' || enabled === '0')
      const now = vms.update(name, { forTasks: want })

      // Said plainly, because taking a machine out does NOT stop what it is
      // doing. A person clicking this while a task runs on it is asking for it
      // back, and would otherwise assume it had been freed immediately.
      const doing = queue.state().inFlight.find(f => f.machine === name)
      log.on('vm', name).info(want ? 'available to the queue' : 'kept back from the queue')
      return {
        name,
        forTasks: want,
        note: want
          ? 'The queue may pick this up when it is free and clean.'
          : doing
            ? `It is running ${doing.task} and will finish that first — this stops it being picked up again, it does not interrupt it.`
            : 'The queue will not pick this up. Nothing else about it changes.'
      }
    }
  },

  vmStart: { about: 'Start a virtual machine', takes: ['name', 'type'], run: ({ name, type }) => { vms.get(name); return busy.during(name, 'being started', () => vbox.start(name, type === 'headless' ? 'headless' : 'gui')) } },

  // The session is dropped here, not left to time out.
  //
  // A machine whose power is pulled sends no FIN, so its socket looks perfectly
  // healthy for the seventy seconds it takes silence to be noticed -- and in that
  // window it is listed as connected, commands are dispatched to it, and they
  // hang until the timeout. That is the same fault the README records about a
  // destroyed machine, arriving by a path that had no `drop` in it: vmRemove had
  // one and this did not.
  //
  // Dropped before the stop rather than after, because after is a race with how
  // long VirtualBox takes.
  vmStop: {
    about: 'Shut a virtual machine down, or pull its power',
    takes: ['name', 'force'],
    run: ({ name, force }) => {
      vms.get(name)
      return busy.during(name, 'being shut down', () => {
        channel.drop(name, force ? 'had its power pulled' : 'was asked to shut down')
        return vbox.stop(name, !!force)
      })
    }
  },

  // Pull a machine's network cable, or plug it back in.
  //
  // For finding out what this app does when a machine goes away and comes back,
  // which is not a hypothetical: a switch reboots, wifi drops, a laptop sleeps.
  // Everything here reasons about that case rather than having seen it — the run
  // is detached so it should survive, the agent should redial, the queue should
  // keep waiting — and "should" is what drills are for.
  //
  // It does NOT drop the channel on this side. That is the point: the dashboard
  // is left to notice on its own, exactly as it would if somebody tripped over a
  // cable, rather than being told.
  vmNetwork: {
    about: "Connect or disconnect a machine's network cable, from outside it",
    takes: ['name', 'connected'],
    run: async ({ name, connected }) => {
      vms.get(name)
      if (await vbox.isOff(name)) throw new Error(`"${name}" is not running, so its cable is not plugged into anything.`)
      const on = !(connected === false || connected === 'false' || connected === 'no' || connected === '0')
      await vbox.setLink(name, on)
      log.on('vm', name).warn(on ? 'network cable plugged back in' : 'network cable pulled out')
      return {
        name,
        connected: on,
        note: on
          ? 'It will redial when it notices. Nothing here was told; the dashboard finds out the same way it would after a real outage.'
          : 'The dashboard has not been told. It will keep believing this machine is connected until silence is noticed, which takes about seventy seconds.'
      }
    }
  },

  vmInfo: { about: 'Everything VirtualBox knows about one machine', takes: ['name'], run: ({ name }) => { vms.get(name); return vbox.info(name) } },

  // A picture of what a machine has on screen.
  //
  // For the long silence: an install reports nothing for twenty-five minutes,
  // and until it ends there is no agent to ask and no log line to read. This is
  // the difference between "still working" and "stopped at a prompt nobody is
  // watching", and until now the only way to tell was to open VirtualBox.
  //
  // KEPT, not streamed and thrown away. Written into the app's own data
  // directory -- outside the repository, where git has nothing to decide -- and
  // the path goes into the live log, because a file somebody cannot find is one
  // that may as well not have been written.
  vmScreenshot: {
    about: "A picture of what a machine has on screen right now, saved and logged",
    takes: ['name'],
    run: async ({ name }) => {
      vms.get(name)
      const dir = data.sub('screenshots')
      const file = path.join(dir, `${name}-${data.stamp()}.png`)
      await vbox.screenshot(name, file)
      const bytes = fs.statSync(file).size
      log.on('vm', name).good(`screen saved to ${file}`)
      return { file, bytes, dir }
    }
  },

  vmSnapshots: { about: 'The snapshots a machine has, and which one it is on', takes: ['name'], run: ({ name }) => { vms.get(name); return vbox.snapshots(name) } },

  vmSnapshotTake: {
    about: 'Take a snapshot, with a title of your choosing',
    takes: ['name', 'title', 'description'],
    run: ({ name, title, description }) => busy.during(name, 'being snapshotted', async () => {
      vms.get(name)
      if (!title || !title.trim()) throw new Error('Give the snapshot a title, so it means something when you come back to it.')
      await refuseIfThatTitleIsTaken(name, title)
      // Refused while it is running. VirtualBox would store the machine's memory
      // beside its disk, so the snapshot arrives the size of the machine's RAM --
      // and it is a picture of something caught mid-thought rather than a point
      // worth coming back to. vmBaseSnapshot is the one that takes a running
      // machine, because it shuts it down first and starts it again after.
      if (!await vbox.isOff(name)) {
        throw new Error('Shut the machine down first — a snapshot taken while it is running stores its memory too, which makes it enormous. "Make a clean starting point" does the shutting down for you.')
      }
      refuseIfItHoldsACredential(name)
      // Powered off is not unlocked, and a snapshot taken into that window is
      // taken of a disk VirtualBox has not finished with.
      await vbox.waitUntilUnlocked(name)
      await vbox.takeSnapshot(name, title.trim(), description || '')
      const vm = vms.get(name)
      vms.update(name, {
        baseSnapshot: vm.baseSnapshot || title.trim(),
        snapshots: { ...(vm.snapshots || {}), [title.trim()]: vm.branch || null },
        // Capturing the current state is the other way its disk comes to match a
        // snapshot -- the machine did not move, the snapshot came to it, and
        // there is now nothing beyond the newest one. See vmSnapshotRestore.
        cleanSince: new Date().toISOString()
      })
      return vbox.snapshots(name)
    })
  },

  // The point of a base snapshot is somewhere to get back to, and getting back to
  // one needs the machine off -- so this shuts it down, snapshots, and starts it
  // again. Doing it while running would store the memory too and make a much
  // larger snapshot of a machine mid-thought.
  vmBaseSnapshot: {
    about: 'Shut a machine down, snapshot it as a clean starting point, and start it again',
    takes: ['name', 'title'],
    run: ({ name, title = 'base' }) => busy.during(name, 'being snapshotted', async () => {
      const vm = vms.get(name)
      refuseIfItHoldsACredential(name)
      // Before the machine is shut down, not after. This one takes a machine
      // that is running and stops it first, so a refusal that came later would
      // have already cost the operator their machine and everything on it.
      await refuseIfThatTitleIsTaken(name, title)
      const to = log.on('vm', name)
      const wasRunning = !await vbox.isOff(name)

      if (wasRunning) {
        to.info('shutting down to take a clean snapshot')
        await vbox.stop(name, false)
        // Asked politely first. Only after waiting is the plug pulled, because a
        // guest part-way through writing is what a clean snapshot must not capture.
        if (!await vbox.waitUntilOff(name, { timeout: 120000 })) {
          to.warn('it did not shut down in two minutes; pulling the power')
          await vbox.stop(name, true).catch(() => {})
          await vbox.waitUntilOff(name, { timeout: 60000 })
        }
        await vbox.waitUntilUnlocked(name)
      }

      await vbox.takeSnapshot(name, title, 'a clean starting point, taken once it was set up')
      vms.update(name, {
        baseSnapshot: title,
        snapshots: { ...(vm.snapshots || {}), [title]: vm.branch || null }
      })
      to.good(`"${title}" is now the point this machine can be returned to`)

      if (wasRunning) {
        // Taking the snapshot locks the machine itself, and VirtualBox releases
        // that lock a moment AFTER the command has returned -- so starting
        // straight away loses the race, and this failed every time with
        // "already locked by a session". The snapshot was fine; only the restart
        // was lost, which is the confusing part: the error names the harmless
        // half and the machine is left off with no obvious reason why.
        //
        // Waited out and then retried, the same pair destroy() uses before
        // unregistervm, because they cover different things: SessionState can
        // still read "Unlocked" for the instant the lock lives, and it did here
        // -- 100ms before the start was refused for being locked. So the wait is
        // the ordinary path and the retry is what makes it true.
        await vbox.waitUntilUnlocked(name)
        await vbox.retrying(() => vbox.start(name, 'gui'), { what: 'starting it again', tags: [name] })
        to.info('started again; it will dial back in shortly')
      }
      return { ...await vbox.snapshots(name), baseSnapshot: title, restarted: wasRunning }
    })
  },

  // Throw a snapshot away.
  //
  // Added because a snapshot could be made and returned to but never removed --
  // so a machine accumulated points nobody could clear, and, worse, a snapshot
  // taken by mistake could not be undone. That is not academic: this was written
  // immediately after taking one of a machine holding a credential, which is the
  // one thing the refusal beside it exists to stop.
  //
  // The disks it owns go with it. VirtualBox merges the differencing image back
  // into its parent rather than leaving it orphaned, which is why this can take a
  // while on a machine with a long chain.
  vmSnapshotDelete: {
    about: 'Throw a snapshot away, merging its disk back',
    takes: ['name', 'title'],
    run: ({ name, title }) => busy.during(name, 'having a snapshot removed', async () => {
      const vm = vms.get(name)
      if (!title) throw new Error('Say which snapshot.')
      await vbox.waitUntilUnlocked(name)
      await vbox.deleteSnapshot(name, title)

      // What the registry recorded about it goes too, or the branch it named
      // outlives the point it belonged to.
      const kept = { ...(vm.snapshots || {}) }
      delete kept[title]
      vms.update(name, {
        snapshots: kept,
        baseSnapshot: vm.baseSnapshot === title ? null : vm.baseSnapshot
      })
      log.on('vm', name).good(`snapshot "${title}" is gone`)
      return { ...await vbox.snapshots(name), removed: title }
    })
  },

  vmSnapshotRestore: {
    about: 'Go back to a snapshot, discarding everything since',
    takes: ['name', 'title'],
    run: ({ name, title }) => busy.during(name, 'being restored', async () => {
      const vm = vms.get(name)
      if (!await vbox.isOff(name)) throw new Error('Shut the machine down first — VirtualBox will not restore a snapshot while it is running.')
      // Powered off is not unlocked. See waitUntilUnlocked: a restore issued
      // into that window races the session VirtualBox is still holding, and the
      // machine it leaves behind boots to a black screen with nothing logged.
      await vbox.waitUntilUnlocked(name)
      // The disk is about to become a different disk, so whatever session is
      // recorded for this machine describes something that will not exist in a
      // moment. A machine stopped by pulling its power leaves one that looks
      // healthy for over a minute, and a command sent into that window is
      // dispatched to a socket nobody is on the other end of.
      channel.drop(name, 'was rolled back to a snapshot')
      await vbox.restoreSnapshot(name, title)

      // The disk went back, so what this machine is allowed to push has to go
      // back with it. Restoring to a point taken before any workspace existed
      // leaves a machine whose registry still names a branch -- a standing
      // permission to push work that is no longer on the disk, which is the
      // quiet kind of wrong: nothing fails, and the machine can put commits on a
      // branch it has no copy of.
      //
      // A snapshot this app did not take -- one made in VirtualBox directly --
      // is not in the map, and that reads as null rather than as "leave it
      // alone". Unknown means may-push-nothing, which is recoverable in one
      // click; the other way round is not.
      const was = vm.branch || null
      const now = (vm.snapshots || {})[title]
      const branch = now === undefined ? null : now

      // The credential goes back with the disk, and this is DERIVABLE rather
      // than guessed: a machine holding one cannot be snapshotted at all, so
      // every snapshot that exists was taken while the machine held nothing.
      // Restoring any of them therefore lands on a disk with no credential file
      // on it.
      //
      // It has to be said here or the registry goes on claiming the machine
      // holds one for ever -- which refuses every future snapshot of it and,
      // worse, keeps it out of the queue as a machine that needs tidying when it
      // is already clean.
      // AND THE MOMENT ITS DISK WENT BACK TO MATCHING A SNAPSHOT.
      //
      // Whether a machine has changed since its snapshot is answered by asking
      // whether it has dialled in since -- which is first-hand and right, until
      // a restore, after which the old dial-in is still later than the snapshot
      // was TAKEN and the machine reads as changed for ever. It is not: this
      // just put the disk back, and this is the one place that knows.
      vms.update(name, { branch, holdsCredential: false, cleanSince: new Date().toISOString() })

      const to = log.on('vm', name)
      if (branch !== was) {
        to.warn(branch
          ? `${name} is back at "${title}" and may now push ${branch}, not ${was || 'nothing'}`
          : `${name} is back at "${title}", which predates any workspace — it may push nothing until it is set up again`)
      }
      return { ...await vbox.snapshots(name), branch }
    })
  },

  // ---- borrowing a machine ----------------------------------------------
  //
  // A PERSON TAKING A RUNNER, which the queue had no way to express. There were
  // two states: in the pool, or kept back from it for ever. Neither fits "I am
  // about to sit in this machine for twenty minutes" -- keeping it back works
  // and has to be undone by hand afterwards, which is exactly the sort of thing
  // that gets forgotten and quietly shrinks the pool.
  //
  // Borrowing is temporary and says why. It brings the machine up CLEAN first,
  // because a machine somebody is about to work in should start from the same
  // place a task would: the base snapshot, nothing left from before.
  //
  // It reuses the queue's own bring-up rather than repeating it. "Make a machine
  // clean" already exists, has been debugged, and knows about the things that
  // bite -- a machine that will not answer its power button, a double rollback
  // racing VirtualBox. A second copy would be a second set of those lessons.
  vmBorrow: {
    about: 'Take a machine out of the pool and bring it up clean, for a person to use',
    takes: ['name', 'why'],
    run: async ({ name, why }) => {
      const reason = String(why || '').trim() || 'somebody is using it'
      const { vms: all } = await actions.vmList.run({})

      // Named, or the first one that is genuinely free. Asking for a specific
      // machine that is busy is refused with the queue's own words rather than
      // quietly given a different one.
      let pick = name
      const free = queue.availability(all)
      if (pick) {
        const said = free.find(a => a.name === pick)
        if (!said) throw new Error(`There is no machine called "${pick}".`)
        if (!said.free) throw new Error(`"${pick}" ${said.why}.`)
      } else {
        const first = free.find(a => a.free)
        if (!first) {
          throw new Error(`No machine is free. ${free.map(a => `${a.name} ${a.why}`).join('; ')}.`)
        }
        pick = first.name
      }

      // Claimed BEFORE it is brought up, so the queue's next tick -- which is at
      // most fifteen seconds away and may be sooner -- cannot take it while it
      // is starting.
      vms.update(pick, { borrowed: { why: reason, at: new Date().toISOString() } })

      const to = log.on('vm', pick)
      to.info(`borrowed — ${reason}`)
      try {
        await queue.bringUp(actions, to, pick)
      } catch (e) {
        // Handed back on failure. A machine left borrowed by a bring-up that
        // never finished is out of the pool with nobody using it, which is the
        // failure this whole thing exists to avoid.
        vms.update(pick, { borrowed: null })
        to.bad(`could not bring it up, so it is back in the pool: ${e.message}`)
        throw e
      }

      return {
        name: pick,
        why: reason,
        note: `${pick} is yours until you give it back. The queue will not touch it, and "vmReturn --name ${pick}" puts it away clean.`
      }
    }
  },

  vmReturn: {
    about: 'Give a borrowed machine back: put it away clean, or just release the claim',
    takes: ['name', 'keep'],
    run: async ({ name, keep = false }) => {
      const vm = vms.get(name)
      if (!vm.borrowed) throw new Error(`"${name}" is not borrowed, so there is nothing to give back.`)

      // ASKED WHAT IT IS HOLDING FIRST, because putting it away rolls it back
      // and a person working by hand is exactly who has uncommitted work. The
      // queue's tasks push before they finish; a human in an editor has no such
      // habit, and losing an afternoon to a tidy-up button is not a mistake
      // anybody makes twice with this tool.
      if (!keep) {
        let holds = null
        try { holds = await actions.vmHolds.run({ name }) } catch { /* said below */ }
        if (holds && holds.summary) {
          throw new Error(`"${name}" is still holding ${holds.summary}. Putting it away rolls it back to its base snapshot, which discards that. Push it, or give it back with keep=true to release the claim and leave the machine exactly as it is.`)
        }
      }

      vms.update(name, { borrowed: null })
      if (keep) {
        log.on('vm', name).good('given back — left running, and free for the queue')
        return { name, put: false, note: `${name} is back in the pool as it is. It is still running.` }
      }

      await queue.putAway(actions, log, name)
      return { name, put: true, note: `${name} is off, back at its base snapshot, and free for the queue.` }
    }
  },

  // ---- the two flows a person actually drives ---------------------------
  //
  // Both are the same three or four actions in a row, and both were things a
  // person had to remember the order of. A flow somebody has to assemble from
  // parts is a flow that gets half-done: a machine left running, a credential
  // left on a disk, a branch left claimed by a machine nobody is using.

  vmIsos: { about: 'Installer images VirtualBox already knows about', run: () => vbox.isos() },

  vmBridges: { about: 'Host network adapters a guest could be bridged onto', run: () => vbox.bridges() },

  vmScripts: {
    about: 'The provisioning scripts available, and whether the project overrides one',
    run: async () => ({ available: scripts.list(), stages: scripts.STAGES, projectDir: scripts.WORKSPACE })
  },

  vmScript: {
    about: 'One script a machine will receive, exactly as it will get it',
    takes: ['name', 'stage'],
    run: async ({ name, stage = 'firstBoot' }) => {
      const vm = vms.get(name)
      let host = '127.0.0.1'
      try { host = await vbox.hostAddress() } catch { /* previewing should work with no network */ }
      return { stage, file: path.basename(scripts.fileFor(vm, stage)), script: scripts.render(stage, vm, { hostAddress: host, port: net.port, channelPort: net.channelPort, caPort: net.caPort, caFingerprint: keys.ensure().fingerprint }) }
    }
  },

  // What the dial-in makes possible.
  vmAgents: { about: 'Which machines are dialled in right now, and what they say they are', run: async () => ({ agents: channel.list() }) },

  vmRun: {
    about: 'Run a command on a dialled-in machine and wait for it',
    takes: ['name', 'command', 'what'],
    run: ({ name, command, what }) => {
      vms.get(name)
      if (!command || !command.trim()) throw new Error('Say what to run.')
      return channel.run(name, command, { what: what || command })
    }
  },

  vmSetupAgain: {
    about: 'Run the setup scripts again on a machine that is already up',
    takes: ['name', 'stage'],
    run: async ({ name, stage = 'toolchain' }) => {
      const vm = vms.get(name)
      if (!channel.connected(name)) throw new Error(`"${name}" is not dialled in. Start it and wait for it to connect.`)
      const file = path.basename(scripts.fileFor(vm, stage))
      // Fetched by the machine rather than pushed, so it gets exactly what a fresh
      // install would get -- including any edit made since it was built.
      const url = `https://${await vbox.hostAddress()}:${net.port}/provision/${file}?vm=${encodeURIComponent(name)}`

      // Commands arrive as the user, so a script that touches /etc needs sudo -- the
      // same thing a person would type. `sudo -n` rather than plain sudo so it fails
      // saying it needs a password instead of waiting for one nobody will type.
      // Under /tmp because the user cannot write /root.
      const needsRoot = !file.endsWith('-user.sh')
      const run = needsRoot
        ? `sudo -n env OKC_QUIET_SAY=yes bash /tmp/okc-again.sh`
        : `OKC_QUIET_SAY=yes bash /tmp/okc-again.sh`

      // OKC_QUIET_SAY: the agent already streams stdout, so the script should not
      // also post each line over HTTP or every one arrives twice.
      //
      // The credentials are the MACHINE'S OWN, read from its environment on its
      // own side rather than written into this command. `$OKC_CA`, `$OKC_VM` and
      // `$OKC_TOKEN` are left for the guest's shell to expand: the agent has them
      // from its service unit and anything it dispatches inherits them, which was
      // checked rather than assumed. Putting the token in the command instead
      // would send a machine its own secret back over the channel and leave it in
      // the log line describing what was run.
      try {
        return await channel.run(name,
          `curl -fsSL --cacert "$OKC_CA" -u "$OKC_VM:$OKC_TOKEN" '${url}' -o /tmp/okc-again.sh && ${run}`,
          { what: `${file} again${needsRoot ? ' (with sudo)' : ''}` })
      } catch (e) {
        // first-boot.sh restarts the agent, which ends the connection this was
        // sent over -- so the one script that sets a machine up completely always
        // reports failure, having usually succeeded.
        //
        // It is not turned into success, because this genuinely cannot know: the
        // machine stopped talking half way through and nothing here saw the end.
        // Saying what happened and that the outcome is unknown is the true
        // answer, and inventing a verdict either way is the thing being removed.
        if (/hung up|no longer managed|was deleted/.test(e.message)) {
          log.on('vm', name).info(`${name} restarted its agent, which ended the connection this was sent over — expected for ${file}. It carried on running there; watch for it to dial back in.`)
          return { file, finished: 'unknown', why: 'the machine restarted its agent, so this connection ended before the script did' }
        }
        throw e
      }
    }
  },

  // Offered so a key can be picked rather than pasted. Public keys only: nothing
  // here reads a private key, and there is no reason it ever should.
  // ---- the two keys this app needs to be itself -------------------------
  //
  // They are the same kind of thing and belong together: the TLS material a
  // machine verifies this host by, and the ssh key this host gets back into a
  // machine with. Both live in the app's data directory rather than in anybody's
  // home, both are made once, and remaking either has a cost that has to be said
  // out loud before it happens.

  // Lay out a machine's workspace: every repository, on one branch, pointed back
  // here.
  //
  // The branch is cut HERE first, in each repository that does not have it, and
  // the machine then checks out what already exists. Both halves matter. Cutting
  // it here means the host is the storage: the work has somewhere to land, is
  // listable before any machine has run, and survives the machine being deleted.
  // And a machine that arrives to a branch already checked out has no moment
  // where the obvious thing to do -- commit, push -- reaches a default branch.
  //
  // Creating a branch touches no other ref and no working tree, so the default
  // branch here is not written to at any point.
  vmWorkspace: {
    about: "Set up a machine's workspace: every repository, on one branch, pointed back here",
    needs: 'workspace',
    takes: ['name', 'branch', 'folder', 'task'],
    run: async ({ name, branch, folder, task }) => {
      const vm = vms.get(name)

      // WHAT IS KNOWABLE WITHOUT A MACHINE IS CHECKED WITHOUT ONE.
      //
      // A branch that does not exist is a mistake whether or not anything is
      // running, and it used to be discovered after starting one and waiting for
      // it to dial in -- so the answer to a typo was five minutes away, and
      // arrived as though the machine were the problem.
      const wanted = String(branch || vm.branch || '').trim()
      if (!wanted) throw new Error(`Say which branch "${name}" is to work on.`)
      const known = branches.all().branches.find(b => b.name === wanted)
      if (!known) {
        throw new Error(`There is no branch called "${wanted}". Make it first, with a reason — branchCreate --branch ${wanted} --reason "..." --group "..." — so what it is for and what it starts from are both recorded before anything is built on it. If that name is a typo, this is the refusal that catches it.`)
      }

      // IN SOME REPOSITORIES AND NOT OTHERS, which is a state a workspace
      // reaches on its own: a repository added after a branch was cut does not
      // have it, and nothing here goes back to extend old branches into new
      // repositories.
      //
      // The machine checks out this branch in every repository it is given, so
      // the one without it fails INSIDE THE GUEST, in the middle of a setup, with
      // git's own words about a pathspec. Said here instead, where the fix is one
      // command -- branchCreate cuts it in whatever is missing it and leaves the
      // reason it already has alone.
      if (known.missing.length) {
        throw new Error(`"${wanted}" is not in ${known.missing.join(', ')}, and a machine checks it out in every repository. Extend it first — branchCreate --branch ${wanted} --reason "..." --group "..." cuts it wherever it is missing and keeps the reason it already has.`)
      }

      if (!channel.connected(name)) throw new Error(`"${name}" is not dialled in. Start it and wait for it to connect.`)
      guestPath(folder, '--folder')

      // A machine stays on its branch until it is clean.
      //
      // Not a preference about tidiness: switching is how half-finished work
      // stops being anywhere. The commits would still be on the machine, on a
      // branch it may no longer push, and nothing would say so -- so the work is
      // neither finished nor lost, which is the state that gets discovered weeks
      // later. The only way off a branch is back to a snapshot from before it,
      // which is an action that states plainly what it discards.
      //
      // Refused HERE and not only on the button, because the button is a
      // courtesy and this is the boundary.
      const asked = (branch || '').trim()
      if (vm.branch && asked && asked !== vm.branch) {
        throw new Error(`"${name}" is set up on ${vm.branch} and stays there until it is clean. To work on something else, go back to a snapshot taken before that branch — "Go back to it" says what it discards — or use another machine.`)
      }

      const why = branches.nameIsOk(asked || vm.branch)
      if (why) throw new Error(why)
      const on = (asked || vm.branch).trim()

      // One machine per branch.
      //
      // Two machines on one branch push to the same ref, so the second one to
      // finish is refused as a non-fast-forward -- and its commits are then
      // stranded: real work, on a branch it may push, that cannot land without a
      // merge nobody asked for. That is the same "neither finished nor lost"
      // state that moving a machine between branches produced, arriving by a
      // different door.
      //
      // A branch is therefore CLAIMED by the machine set up on it, and released
      // when that machine is rolled back to a point before it. Two runners on
      // one task deliberately is a real thing to want, but it wants two branch
      // names, not one branch and a race.
      const held = vms.read().find(v => v.name !== name && v.branch === on)
      if (held) {
        throw new Error(`"${on}" is already being worked on by "${held.name}". Two machines on one branch race for the same ref and the loser's commits strand. Pick another branch, or roll "${held.name}" back to a point before it.`)
      }

      const found = repos.list()
      if (!found.length) throw new Error(`There are no repositories in ${repos.DIR} to set up.`)

      // If a repository here is sitting on this branch from a review, step it
      // back onto its default so the machine can use it. Only when that working
      // tree is clean -- otherwise it says whose work is in the way and stops,
      // rather than this app deciding that a machine matters more than whatever
      // somebody left half-done.
      for (const f of branches.freeEverywhere(on)) {
        if (f.busy) throw new Error(f.why)
        if (f.freed) log.on('vm', name).info(`${f.repo} was on ${f.from} here; moved it back to ${f.to} so ${name} can use it`)
      }

      // SETTING A MACHINE UP DOES NOT CREATE A BRANCH ANY MORE. It was the one
      // place they were born, as a side effect, from whatever string a task
      // carried -- so a mistyped name did not fail, it made a branch. Refused
      // above, before the machine is even asked to be running.
      const here = branches.all().branches.find(b => b.name === on)
      const to = log.on('vm', name)
      to.info(`"${on}" exists in ${here.in.join(', ')}${here.missing.length ? `, not in ${here.missing.join(', ')}` : ''}`)

      // ONLY THE REPOSITORIES THIS BRANCH IS ABOUT.
      //
      // The machine used to be handed every repository in the workspace, whatever
      // the work was. Every checkout on it is something a worker can read, change
      // and push, so a change concerning two repositories was granted four — and
      // the extra two are precisely the ones nobody reviews afterwards, because
      // nobody expected the work to touch them.
      //
      // The branch's baseline group is what says which. A group naming three of
      // four repositories is not incomplete; it is a line of work that never
      // reached the fourth, and the fourth has no business being on the machine.
      const scope = branches.scopeOf(on)
      const mine = found.filter(r => scope.repos.includes(r.name))
      if (!mine.length) {
        throw new Error(`"${on}" is about ${scope.repos.join(', ')}, and none of those are in ${repos.DIR}.`)
      }
      if (scope.group) {
        to.info(`it is about ${mine.map(r => r.name).join(', ')} — the "${scope.group}" line${scope.gone.length ? `, which also named ${scope.gone.join(', ')}, no longer here` : ''}`)
      }

      const host = await vbox.hostAddress()
      const tls = keys.ensure()
      const script = workspace.script({
        repos: mine.map(r => r.name),
        branch: on,
        folder: folder || workspace.folderFor(vm.spec),
        origin: `https://${host}:${net.port}`,
        machine: name,
        token: vm.spec.token,
        ca: tls.ca.toString(),
        // A LINE IS WORKED IN, NOT PUSHED TO. Setting a machine up on one is
        // allowed and is the point of a reading task; what it may not do is
        // push back. The host's hook is what actually stops that — this puts a
        // pre-push hook in the guest so a worker finds out where it is working
        // rather than in a rejection an hour later.
        readOnly: branches.isProtected(on),
        // WHAT THIS MACHINE IS FOR, left on the machine. Every path that puts a
        // task on a machine comes through here — the queue, a hand-over, taking
        // one by hand — so this is the one place that knows, and the one place
        // it has to be written.
        task: task || null
      })

      const r = await channel.run(name, script, { what: `setting up the workspace on ${on}`, timeout: 10 * 60 * 1000 })
      if (r.code !== 0) throw new Error(`The workspace was not fully set up on ${name} — see the live log.`)

      // Recorded, because this is what a push is checked against. The machine
      // knows which branch it is on and cannot be trusted to say so -- being the
      // thing the rule is about is exactly what disqualifies it as the source.
      // Written after the setup rather than before: a machine that never got its
      // workspace has not been given permission to push anything.
      vms.update(name, { branch: on })
      log.on('vm', name).good(`${name} may now push ${on}, and nothing else`)

      // `cut` was here, from when this action created the branch. It does not
      // any more -- a branch is made deliberately, with a reason -- so what it
      // reports is where the branch already was, not what it just made.
      return {
        branch: on,
        folder: folder || workspace.folderFor(vm.spec),
        repos: found.map(r => r.name),
        in: here.in,
        output: r.output
      }
    }
  },

  // Give a machine a new secret without rebuilding it.
  //
  // Until now the only answer to a leaked token was deleting the machine and
  // waiting half an hour, which is a bad enough answer that it would not be
  // used -- and an unusable remedy is the same as none.
  //
  // THE ORDER IS THE WHOLE THING. The machine has to be holding the new token
  // before the registry expects it, because the registry is what its next
  // connection is checked against: swap those and the machine is locked out by
  // the very act meant to keep it working. So it is written on the machine
  // first, recorded here second, and only then is the agent restarted -- which
  // is the moment the old one stops being accepted.
  //
  // Refused when it is not dialled in, because there would be no way to deliver
  // the new secret and the machine would be locked out permanently. That is a
  // real limit and it is said, rather than half-done.
  vmRotateToken: {
    about: "Give a machine a new token, without rebuilding it",
    takes: ['name'],
    run: ({ name }) => busy.during(name, 'being given a new token', async () => {
      const vm = vms.get(name)
      if (!channel.connected(name)) {
        throw new Error(`"${name}" is not dialled in, so a new token could not be delivered to it — and recording one here would lock it out for good. Start it, wait for it to connect, then try again.`)
      }

      const fresh = channel.newToken()
      const host = await vbox.hostAddress()

      // Both places the machine keeps it: the agent's environment, and git's
      // credential store. Missing the second would leave a machine that can dial
      // in and cannot push, which is a stranger state than being locked out.
      const written = await channel.run(name, `set -u
sudo -n sed -i "s|^OKC_TOKEN=.*|OKC_TOKEN=${fresh}|" /etc/okc-agent.env
umask 077
touch "$HOME/.git-credentials"
tmp=$(mktemp)
grep -vF '${host}:${net.port}' "$HOME/.git-credentials" > "$tmp" 2>/dev/null || true
printf '%s\\n' 'https://${name}:${fresh}@${host}:${net.port}' >> "$tmp"
mv "$tmp" "$HOME/.git-credentials"
chmod 600 "$HOME/.git-credentials"
echo okc-rotated`, { what: 'taking a new token', timeout: 60000 })

      if (!/okc-rotated/.test(written.output || '')) {
        throw new Error(`"${name}" did not confirm it had taken the new token, so nothing here was changed. It is still using the old one.`)
      }

      vms.update(name, { spec: { ...vm.spec, token: fresh } })
      log.on('vm', name).good(`${name} has a new token; restarting its agent so it uses it`)

      // Severs this connection by design: the agent comes back holding the new
      // secret, and the old one stops working at that moment.
      try {
        await channel.run(name, 'sudo -n systemctl restart okc-agent', { what: 'restarting the agent on its new token', timeout: 30000 })
      } catch { /* the restart is what ends the connection; not finishing is expected */ }

      return { name, rotated: true, note: 'its agent was restarted and will dial back in with the new token' }
    })
  },
}
