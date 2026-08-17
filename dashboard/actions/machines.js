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

// UNTIL THE MACHINE SAYS SOMETHING, which is how the host knows a kernel is up.
//
// THE SIGNAL IS THE MACHINE'S OWN VOICE, not a stopwatch. A fixed wait is a
// guess about somebody else's hardware: too short on a loaded host and too long
// on an idle one, and wrong in a different direction every time. The console
// starts carrying bytes the moment the kernel does anything at all, and that is
// the fact worth waiting for.
//
// Two signals exist and they answer different questions. The console says "this
// kernel is alive", which is the expensive minute and the only part that
// competes with another machine coming up. Dialling in says "this machine is
// ready to be given work", which is minutes later and is what queue.bringUp
// already waits for. This is the first one.
//
// The cap is a bound, not a timer: a machine that never speaks must not hold the
// host for ever. Reached only when something is wrong, and it says so.
// SIXTY SECONDS IS NOT A GUESS AT HOW LONG A BOOT TAKES — it is how long a
// kernel takes to say ANYTHING, which is a much smaller and much steadier
// number. A machine that has not managed one line in a minute is not slow, it is
// stuck: runner1 sat on a splash screen for eleven minutes, ignored its power
// button, and had to have the plug pulled. It never said a word in all of it.
//
// So silence is treated as a failed start rather than as patience: pull the
// power, start it again, and listen once more. Three starts and then it is
// somebody's problem — a machine that cannot boot three times running has
// something wrong that another attempt will not fix, and the honest thing is to
// stop and say so rather than cycle it all afternoon.
//
// `tries` is 1 by default, because most callers only want to WAIT. The paths
// that are actually responsible for a machine being up — installing one, and
// the queue bringing one up for a task — ask for the retries.
async function untilItSpeaks (name, { capMs = 60000, tries = 1 } = {}) {
  const vm = vms.read().find(v => v.name === name)
  const file = vm && vm.serial
  const to = log.on('vm', name)
  if (!file) {
    // No console, no signal. Said rather than replaced with a guess — a machine
    // whose console is not captured is one nothing can watch, and that is worth
    // knowing at the moment it matters rather than later.
    to.info('its console is not being captured, so nothing can tell when its kernel is up — vmSerial turns that on')
    return { spoke: false, why: 'no console' }
  }

  // AND THE PORT HAS TO EXIST, not just the file.
  //
  // The register saying "this machine's console is captured" is a statement
  // about a file on this host. Whether anything is WRITING to it is a fact about
  // the VirtualBox machine — and a rebuild makes a new machine with no serial
  // port, leaving a file that will never grow again.
  //
  // Without this check, silence from a machine with no port reads as "the kernel
  // never came up", and a perfectly healthy install gets its power pulled three
  // times. That happened, mid-install, and it was this app doing it.
  const conf = await vbox.info(name).catch(() => ({}))
  if (!conf.uart1 || conf.uart1 === 'off') {
    to.info('this machine has no serial port, so its silence says nothing — not treating that as a failed start')
    return { spoke: false, why: 'no port' }
  }

  const size = () => { try { return fs.statSync(file).size } catch { return 0 } }
  const listen = async () => {
    const began = Date.now()
    const was = size()
    while (Date.now() - began < capMs) {
      if (size() > was) return Math.round((Date.now() - began) / 1000)
      await new Promise(r => setTimeout(r, 500))
    }
    return null
  }

  for (let attempt = 1; attempt <= Math.max(1, tries); attempt++) {
    const took = await listen()
    if (took !== null) {
      to.good(`its kernel is up and talking after ${took}s${attempt > 1 ? ` (start ${attempt})` : ''} — the host is free for the next machine`)
      return { spoke: true, took, attempt }
    }
    if (attempt >= Math.max(1, tries)) break

    // THE POWER IS PULLED RATHER THAN ASKED. A machine that has not reached a
    // kernel has nothing to answer an ACPI button with — asking it politely is
    // a minute spent proving what its silence already said.
    to.warn(`nothing on its console in ${Math.round(capMs / 1000)}s — its kernel never came up. Pulling the power and starting it again (start ${attempt + 1} of ${tries})`)
    await vbox.stop(name, true).catch(() => {})
    await vbox.waitUntilOff(name, { timeout: 60000 }).catch(() => {})
    await vbox.waitUntilUnlocked(name).catch(() => {})
    await vbox.start(name, 'gui').catch(e => to.bad(`could not start it again: ${e.message}`))
  }

  to.bad(`"${name}" said nothing on its console after ${tries} start(s) — it is not reaching a kernel`)
  return { spoke: false, why: `silent after ${tries} start(s)` }
}

// WHICH MACHINE IS HAVING ITS PROVISIONING UPDATED, IF ANY, across the host.
//
// One at a time is a refusal rather than a queue — see vmProvisionUpdate. In
// this process only, deliberately: it guards concurrent calls, and a restart
// mid-way leaves a machine borrowed and off the pool, which is visible on the
// Runners tab and is the state somebody should be looking at anyway.
//
// UPDATING IS NOT INSTALLING, and the two are deliberately separate words here.
// This re-runs the scripts on the machine as it is and re-bases it — minutes.
// A real re-provision wipes the disk and drives the installer — twenty-five,
// and it is `vmInstall`. Both need testing and only one of them is written.
let updating = null

module.exports = {
  // Only ever the machines this app made. Everything here refuses a machine that
  // is not in its own registry, because these actions can destroy one.
  vmList: { about: 'The virtual machines this app made, with live state and stage', run: () => vms.all() },

  vmCreate: { about: 'Make a virtual machine and its disk', takes: ['vm'], run: ({ vm }) => provisioner.create(vm || {}) },

  // AND IT HOLDS THE HOST WHILE IT DOES, because an install is the one thing
  // here that cannot be told apart from a wedge while it is happening.
  //
  // It takes about twenty-five minutes and it does NOT dial in until its first
  // boot, so for most of that time there is no agent, no channel and nothing to
  // ask. Another machine starting into that is the case that wedges this host —
  // and unlike two boots, there is no minute-long wait that fixes it. So
  // everything else that would come up is refused by name while this runs. See
  // machines/busy.js.
  vmInstall: {
    about: 'Install an operating system, unattended, and run its provisioning scripts. Nothing else comes up while it does',
    takes: ['name'],
    run: ({ name }) => {
      vms.get(name)

      // STAGGERED, NOT REFUSED — AND THE TURN ENDS WHEN THE KERNEL IS UP.
      //
      // Two things were wrong before, and trying it proved both. The lock was
      // held for the duration of the CALL, and `vmInstall` starts an installer
      // and returns — the twelve minutes happen inside the machine. So the host
      // was held for about four seconds and a second install started straight
      // over the top of the first.
      //
      // Refusing the second one was the wrong correction. What actually competes
      // is the first minute: a snapshot restore and a cold kernel boot, pulling
      // on disk and every core at once. After that an install is mostly waiting
      // on a mirror, and two of them coexist perfectly well. Blocking the second
      // for twelve minutes would cost most of an evening to avoid one minute of
      // contention.
      //
      // So the turn ends when this machine's console SAYS SOMETHING. That is the
      // machine itself reporting that its kernel is up and running code, which
      // is a fact rather than a guess about how long a boot takes — and it is
      // exactly what the serial port was added for.
      return busy.during(name, 'being installed', () => busy.comingUp(name, async () => {
        const started = await provisioner.install(name, { port: net.port, caPort: net.caPort })
        // Three starts at most. An installer that never reaches a kernel is a
        // machine that will sit there for twenty-five minutes achieving nothing,
        // which is exactly how an evening was lost to runner1.
        await untilItSpeaks(name, { tries: 3 })
        return started
      }, { kind: 'install' }))
    }
  },

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

  // WHAT KIND OF MACHINE THIS IS, so work can ask for a kind rather than a name.
  //
  // A task never names a machine — the queue decides that, and a task tied to
  // one machine waits for it while three others sit idle. But there are real
  // reasons to want a KIND: the machines the test kit built, the one with
  // hardware plugged into it, the one on the other network. A tag is how a task
  // says which without saying which one.
  //
  // FREE TEXT, AND DELIBERATELY NOT A LIST SOMEBODY MAINTAINS. The tags that
  // exist are the tags on the machines, read from the machines — so there is no
  // second place to keep them in step, and a tag stops existing when the last
  // machine carrying it does.
  //
  // Lower-cased and de-duplicated, because "Test" and "test" being different
  // tags is a fault that shows up as work never being picked up.
  vmTags: {
    about: 'Tag a machine, so tasks can ask for a kind of machine rather than a name. Pass nothing to read them',
    takes: ['name', 'tags'],
    run: ({ name, tags }) => {
      const vm = vms.get(name)
      if (tags === undefined) return { name, tags: vm.tags || [] }

      const want = [...new Set(
        (Array.isArray(tags) ? tags : String(tags).split(','))
          .map(t => String(t).trim().toLowerCase())
          .filter(Boolean)
      )]

      // EXCEPT THE ONE TAG THAT IS NOT A LABEL.
      //
      // "supervisor" is what keeps a machine out of the task pool — see
      // availability() in tasks/queue.js — and it is decided when the machine is
      // built, because it also decides what gets installed on it. So it cannot
      // be typed on, and it cannot be typed off:
      //
      //   typed on   a runner would stop taking work and would still have none
      //              of what a supervisor needs, which reads as a queue that has
      //              gone quiet
      //   typed off  a supervisor would join the pool and be rolled back to base
      //              mid-thought by the first queued task
      //
      // Refused rather than quietly kept, because a refusal is the only version
      // of this somebody learns from.
      const was = (vm.tags || []).map(t => String(t).toLowerCase())
      const isSupervisor = was.includes(vms.SUPERVISOR)
      if (!isSupervisor && want.includes(vms.SUPERVISOR)) {
        throw new Error(`"${vms.SUPERVISOR}" is not a tag you can add. It is what keeps a machine out of the task pool and it decides what gets installed at first boot, so it is chosen when the machine is made — tick "supervisor machine" then, or make another one.`)
      }
      if (isSupervisor && !want.includes(vms.SUPERVISOR)) {
        throw new Error(`"${name}" is a supervisor machine, so it keeps the "${vms.SUPERVISOR}" tag. Taking it off would put it in the queue's pool, and the first queued task would roll it back to its base snapshot while it was working.`)
      }

      const now = vms.update(name, { tags: want })
      log.on('vm', name).info(want.length
        ? `tagged ${want.map(t => `"${t}"`).join(', ')} — a task asking for one of those can be given this machine`
        : 'no longer tagged, so only work that asks for no particular kind of machine will come here')
      return {
        name,
        tags: now.tags,
        note: want.length
          ? `"${name}" is tagged ${want.join(', ')}. A task with no tag still takes it — a tag adds a way to be asked for, it does not hold a machine back. Use vmForTasks for that.`
          : `"${name}" carries no tags.`
      }
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

  // AND IT WAITS ITS TURN. Starting is the expensive minute on this host — a
  // cold boot pulling on disk, memory and every core — and two at once do not
  // take twice as long, they wedge: one machine sat on its splash for eleven
  // minutes and had to have its power pulled, with nothing wrong with it.
  //
  // The queue has always started the next machine only after the last dialled
  // in. This is that rule applied to the button, which is the path that bypasses
  // the queue: somebody pressing Start on two machines, or a drill borrowing one
  // while another is coming up. See machines/busy.js — it waits rather than
  // refusing, because the answer is a minute away.
  //
  // The wait ends when the machine is STARTED rather than when it has dialled
  // in: this action starts a machine and does not follow it. `vmAwait` is how
  // anything waits for the rest, and queue.bringUp holds the gate for the whole
  // boot because it is the one that cares.
  vmStart: {
    about: 'Start a virtual machine, waiting its turn if another is coming up',
    takes: ['name', 'type'],
    run: ({ name, type }) => {
      vms.get(name)
      // THE TURN ENDS WHEN THE KERNEL IS UP, not when VBoxManage returns.
      //
      // Starting a machine is instant to ask for and expensive to do: the reply
      // comes back in a moment and the machine then pulls on the disk and every
      // core for the next minute. This used to end its turn on that reply, so
      // "one machine at a time" held for about a second — the queue and the
      // installer both listen to the console before handing the host on, and
      // this, the one a person presses, did not.
      //
      // Its own failure to speak is not this action's failure. A machine with no
      // console capture cannot say anything, which untilItSpeaks reports and
      // does not treat as an error; what matters here is that the host is not
      // handed to the next machine while this one is at its heaviest.
      return busy.during(name, 'being started', () => busy.comingUp(name,
        async () => {
          const started = await vbox.start(name, type === 'headless' ? 'headless' : 'gui')
          await untilItSpeaks(name).catch(() => ({ spoke: false }))
          return started
        },
        { onWait: other => log.on('vm', name).info(`waiting for "${other}" to get its kernel up — one machine starts at a time on this host`) }))
    }
  },

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
  // AND IT WAITS TO SEE, because pressing the power button is a REQUEST.
  //
  // `acpipowerbutton` is exactly what the button on a real machine's case does:
  // it tells the guest that somebody would like it to shut down. A guest that is
  // wedged, or still on its boot splash, or has no acpid, ignores it — and this
  // returned the instant the request was sent, with nothing to say. So a stop
  // that did nothing at all was indistinguishable from a stop that worked, and
  // the next thing to look at the machine found it still running with no record
  // of why.
  //
  // Found by a drill: "vmStop" printed nothing, twice, on a machine hung at its
  // splash screen, and it took a screenshot to work out that the machine had
  // simply ignored the request.
  //
  // It does NOT pull the power on its own. That is a different act with a
  // different cost — an unclean shutdown, mid-write — and choosing it is the
  // operator's, which is what `force` is for. What this does instead is say
  // plainly that the machine did not answer, and what to do about it.
  vmStop: {
    about: 'Shut a virtual machine down and wait for it, or pull its power with force',
    takes: ['name', 'force', 'seconds'],
    run: ({ name, force, seconds }) => {
      vms.get(name)
      const pull = force === true || force === 'true'
      // Generous for a request, brief for a pull: a guest shutting down tidily
      // takes as long as its services take, and a power cut is immediate.
      const wait = Math.max(5, Math.min(Number(seconds) || (pull ? 30 : 120), 900)) * 1000

      return busy.during(name, 'being shut down', async () => {
        // ALREADY OFF IS THE STATE THAT WAS WANTED, not an error. VirtualBox
        // answers "Machine 'x' is not currently running", which reads as a
        // failure and stops whatever asked — and stopping a machine that is
        // already stopped is the most ordinary thing in the world: a queue
        // tidying up, a drill cleaning up, somebody pressing it twice.
        if (await vbox.isOff(name)) {
          return { name, off: true, how: 'already', took: 0, note: `"${name}" was already off.` }
        }

        channel.drop(name, pull ? 'had its power pulled' : 'was asked to shut down')
        const began = Date.now()
        await vbox.stop(name, pull)

        const off = await vbox.waitUntilOff(name, { timeout: wait }).then(() => true, () => false)
        const took = Math.round((Date.now() - began) / 1000)
        if (off) {
          log.on('vm', name)[pull ? 'warn' : 'good'](pull ? `power pulled, off after ${took}s` : `shut down after ${took}s`)
          return { name, off: true, how: pull ? 'pulled' : 'asked', took, note: `"${name}" is off after ${took}s.` }
        }

        log.on('vm', name).warn(`did not go off within ${took}s of being asked`)
        return {
          name,
          off: false,
          how: pull ? 'pulled' : 'asked',
          took,
          note: pull
            ? `"${name}" was told to power off and VirtualBox still reports it running after ${took}s. That is VirtualBox itself being stuck rather than the guest — vmInfo says what it thinks the machine is doing.`
            : `"${name}" did not answer the power button within ${took}s. A guest ignores it while it is wedged, still booting, or has no acpid — vmScreenshot is the only thing that tells those apart. Pull its power with force=true when you have looked.`
        }
      })
    }
  },

  // WHERE A MACHINE IS, WHEN IT CANNOT SAY SO ITSELF.
  //
  // Three answers, in order of how much they can be trusted, and the point is
  // that the last one works when the first two are impossible:
  //
  //   dialled in    the machine told us, over its own channel. Best, and gone
  //                 the moment anything is wrong.
  //   last seen     what it said the last time it dialled in. A memory, and it
  //                 may be somebody else's address by now.
  //   its lease     VirtualBox's own DHCP server, on the host-only network every
  //                 machine has a second foot in. Answerable while the machine
  //                 is INSTALLING, wedged, or has no guest additions — which is
  //                 exactly when the other two have nothing.
  //
  // The guest additions' own answer is deliberately not used: it needs the
  // additions, and a terminal-only runner does not have them.
  vmAddress: {
    about: "Where a machine is: what it says, what it last said, and the lease VirtualBox gave it",
    takes: ['name'],
    run: async ({ name }) => {
      const vm = vms.get(name)
      const live = channel.list().find(a => a.vm === name)
      const said = live && live.from ? String(live.from).split(':')[0] : null

      // The second adapter's MAC, which is the one on the host-only network.
      let lease = null
      let mac = null
      try {
        const info = await vbox.info(name)
        mac = info.macaddress2 || null
        if (mac) lease = await vbox.leaseFor(name, mac)
      } catch { /* said below */ }

      const reachable = said || lease || vm.lastAddress || null
      return {
        name,
        dialledIn: said,
        lease,
        lastSeen: vm.lastAddress || null,
        mac,
        reachable,
        note: said
          ? `"${name}" is dialled in from ${said}. Its host-only lease is ${lease || 'not held'}.`
          : lease
            ? `"${name}" is not dialled in, but VirtualBox has given it ${lease} on the host-only network — ssh ${vm.spec && vm.spec.user ? vm.spec.user : 'okc'}@${lease}, or installer@${lease} while it is installing.`
            : vm.lastAddress
              ? `"${name}" is not dialled in and holds no lease. The last address it had was ${vm.lastAddress}, which may be somebody else's by now.`
              : `Nothing knows where "${name}" is. It has never dialled in and holds no host-only lease — if it is running, it has not got as far as a network.`
      }
    }
  },

  // WHAT VIRTUALBOX ITSELF RECORDED, for a machine that will not come up.
  //
  // Between "start it" and "it dialled in" this app has been blind: no agent
  // means no log line, and the only instrument was a screenshot — which
  // distinguishes a splash screen from a prompt and nothing else. A machine sat
  // on that splash for eleven minutes here and there was no way to ask why.
  //
  // VirtualBox wrote the whole account of it while that was happening.
  //
  // TWO KINDS. The machine's own log is one run of one machine — its devices,
  // its disks, what the guest did. The service log is about VirtualBox: a
  // registry lock, a session that would not open, a host that refused to start
  // anything at all. Asking for the wrong one is most of what makes this
  // frustrating by hand, so both are here by name.
  //
  // `find` because these are tens of thousands of lines and the useful ones say
  // Error, or timeout, or the name of a device that would not initialise.
  vmLogs: {
    about: "The VirtualBox logs a machine has: the current run and the ones before it",
    takes: ['name'],
    run: async ({ name }) => {
      vms.get(name)
      const found = await vbox.logs(name)
      return {
        ...found,
        note: found.files.length
          ? `${found.files.length} log(s) in ${found.folder}. VBox.log is the run happening now or the last one; the numbered ones are older, newest first.`
          : `Nothing is logged for "${name}" — it may never have been started.`
      }
    }
  },

  // THE WIRE OUT OF THE GUEST, for a boot nothing inside is alive to report.
  //
  // A serial port in raw-file mode needs nothing running in the guest: the
  // kernel writes to ttyS0 from its first line, before the network, before
  // systemd, before there is any agent to dial home — and VirtualBox copies
  // every byte to a file here. It is the only way to watch a boot that never
  // finishes, which is the failure that prompted it.
  //
  // TWO HALVES AND THIS IS ONE. Turning the port on gives an empty file until
  // the guest is told to use it, which is a kernel command line and therefore
  // provisioning — see provision/first-boot.sh. A machine installed before that
  // existed has the port and says nothing through it, so this says so rather
  // than leaving somebody watching an empty file.
  //
  // Off, on purpose, unless asked for. It is a file the host writes for the
  // whole life of a machine, and a default that quietly logs everything for ever
  // is a default nobody chose.
  vmSerial: {
    about: "Send a machine's console to a file on this host, so its boot can be read. The machine must be off",
    takes: ['name', 'on'],
    run: async ({ name, on }) => {
      const vm = vms.get(name)
      const want = on === undefined ? true : !(on === false || on === 'false' || on === 'no' || on === '0')
      if (!(await vbox.isOff(name))) {
        throw new Error(`"${name}" is running. VirtualBox will not add or remove a serial port on a running machine — stop it first, which is worth knowing before a boot you wanted to watch.`)
      }

      const file = path.join(data.sub('serial'), `${name}.log`)
      const out = await vbox.setSerial(name, want ? file : null)
      vms.update(name, { serial: want ? file : null })
      log.on('vm', name)[want ? 'good' : 'info'](want ? `console is being written to ${file}` : 'console is no longer being written')
      return {
        ...out,
        note: want
          ? `"${name}" writes its console to ${file} from the next time it starts. Read it with vmLog --which serial. It stays empty unless the guest was provisioned to use ttyS0 — machines built before that need their kernel command line changed and a new base snapshot.`
          : `"${name}" no longer writes its console anywhere. ${file} is left as it is.`
      }
    }
  },

  vmLog: {
    about: 'Read a machine\'s VirtualBox log, its console, the console before this boot, or the service log, for why it will not boot',
    takes: ['name', 'which', 'lines', 'find'],
    run: async ({ name, which, lines, find }) => {
      // The service log is about VirtualBox rather than about a machine, so it
      // is readable without naming one this app made.
      if (!/^service$|VBoxSVC/i.test(String(which || ''))) vms.get(name)

      // The console is a file this app chose the name of, so it is read here
      // rather than in the machine layer — which only knows about VirtualBox's
      // own logs.
      // THE BOOT BEFORE THIS ONE, which is usually the one worth reading.
      //
      // Starting a machine truncates its console file, so the record of a boot
      // that went wrong is destroyed by the obvious response to it. One
      // generation is kept aside when a machine starts — see keepThePreviousBoot
      // in machines/vbox.js — and this is how it is read.
      const back = /^(serial|console)[-.]?(previous|last|before)$/i.test(String(which || ''))
      if (back || /^serial$|^console$/i.test(String(which || ''))) {
        const file = path.join(data.sub('serial'), `${name}${back ? '.previous' : ''}.log`)
        let text = null
        try { text = fs.readFileSync(file, 'utf8') } catch {
          if (back) {
            throw new Error(`There is no earlier console for "${name}" at ${file}. One is kept aside each time a machine starts, so there is none until it has been started twice with its console being captured.`)
          }
          throw new Error(`Nothing has been written to ${file}. Either the console is not being captured — vmSerial --name ${name} turns it on, with the machine off — or the guest has not been told to use ttyS0, which is a kernel command line and needs provisioning.`)
        }
        const all = text.split(/\r?\n/)
        const rows = find ? all.filter(l => new RegExp(find, 'i').test(l)) : all
        const want = Math.max(1, Math.min(Number(lines) || 200, 5000))
        return {
          file,
          which: back ? 'the boot before this one' : 'this boot',
          lines: rows.slice(-want),
          of: all.length,
          matched: find ? rows.length : null,
          note: all.length <= 1
            ? `${file} exists and is empty. The port is there and the guest is not talking through it — its kernel command line needs console=ttyS0,115200n8.`
            : `The last ${Math.min(want, rows.length)} of ${all.length} lines the guest wrote to its console${back ? ' the time before this one' : ''}.`
        }
      }

      const out = await vbox.logRead(name, { which, lines, find })
      return {
        ...out,
        note: find
          ? `${out.matched} line(s) matched "${find}" of ${out.of} — the last ${out.lines.length} are here.`
          : `The last ${out.lines.length} of ${out.of} lines. Pass find to search it — "error", "timeout", or a device name.`
      }
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
  // RE-PROVISIONING, AS ONE ACT.
  //
  // A provisioning script is fetched, so editing one here is how a machine
  // changes — but a change applied to a running machine is discarded by the next
  // rollback, which is the machine working exactly as designed. Making it stick
  // means running the scripts again AND taking a new base snapshot, and doing
  // that by hand is six commands in an order that matters, with a wait after
  // each. Skip the snapshot and the change quietly vanishes the next time the
  // machine is put away; skip the reboot and a kernel command line never takes
  // effect.
  //
  // It is not an install. A rebuild is twenty-five minutes and starts from the
  // installer image; this is minutes and starts from the machine as it is, which
  // is what makes iterating on a provisioning script possible at all.
  //
  // ONE AT A TIME, ACROSS THE WHOLE HOST. Not a queue: a refusal. Two of these
  // at once means two machines booting, two snapshot operations and two sets of
  // VirtualBox locks, and the failure mode is a machine left half-provisioned
  // with no base snapshot to come back to. `busy.during` guards one machine at a
  // time and cannot see the other, so the guard lives here.
  vmProvisionUpdate: {
    about: 'Run the setup scripts again on a machine as it is, and make the result its new clean starting point. Not an install. One machine at a time',
    takes: ['name', 'stage'],
    run: async ({ name, stage = 'firstBoot' }) => {
      const vm = vms.get(name)
      if (updating && updating !== name) {
        throw new Error(`"${updating}" is having its provisioning updated. One at a time — two machines booting and snapshotting at once is how one ends up half-set-up with no base to come back to. Wait for it, or watch it on the Runners tab.`)
      }
      if (updating === name) throw new Error(`"${name}" is already having its provisioning updated.`)
      // The refusals that matter BEFORE anything is touched, because this ends
      // in a rollback: a machine holding work would lose it.
      if (vm.branch) throw new Error(`"${name}" claims ${vm.branch}. This ends by putting the machine back to a clean state, which would discard whatever it is working on — let it off its branch first.`)
      if (vm.borrowed) throw new Error(`"${name}" is borrowed — ${vm.borrowed.why || 'somebody is using it'}. Give it back first.`)
      refuseIfItHoldsACredential(name)

      const to = log.on('vm', name)
      updating = name
      const began = Date.now()
      const steps = []
      const step = (what, note) => { steps.push({ what, note }); to.info(note) }

      try {
        // 1. THE CONSOLE FIRST, while it is off — VirtualBox will not add a
        //    serial port to a running machine, and the boot this is about to
        //    cause is exactly the one worth being able to read afterwards.
        if (!await vbox.isOff(name)) {
          step('stop', 'shutting it down so its console can be captured')
          await actions.vmStop.run({ name })
        }
        if (!vm.serial) {
          await actions.vmSerial.run({ name, on: true })
          step('serial', 'its console will be written to this host from now on')
        }

        // 2. Claimed and brought up the same way a person does it, so the queue
        //    cannot take it mid-way.
        step('borrow', 'bringing it up clean')
        await actions.vmBorrow.run({ name, why: 'being re-provisioned' })

        // 3. The scripts again. first-boot.sh restarts the agent, which ends the
        //    channel this was sent over — so it reports failure having usually
        //    succeeded, and the honest test is whether the machine comes back.
        // HOW MANY TIMES IT HAS FINISHED BEFORE, asked before it is asked to
        // finish again. The marker "first boot finished" is already in the log
        // from the original install, so waiting for it to APPEAR waits for
        // something that is there — which is why the first version of this
        // returned instantly and, on a bad day, hung instead.
        const marker = 'first boot finished'
        const finishes = async () => {
          const r = await actions.vmRun.run({
            name,
            command: `grep -c "${marker}" /var/log/okc-provision.log 2>/dev/null || echo 0`,
            what: 'asking whether the scripts have finished'
          })
          return Number(String(r.output || '').trim().split('\n').pop()) || 0
        }
        const before = await finishes().catch(() => 0)

        step('setup', `running ${stage} again, detached so it survives the agent restarting`)
        await actions.vmSetupAgain.run({ name, stage, detach: true })
        await actions.vmAwait.run({ name, for: 'connected', seconds: 420 })

        // AND WAITING FOR THE SCRIPT, IN SHORT QUESTIONS RATHER THAN ONE LONG
        // ONE.
        //
        // The first version asked the guest to wait, in a single command that
        // returned when the log said so. That command travels over the channel
        // the script itself RESTARTS — so the session it was sent on dies, the
        // answer never comes, and the whole update sits there for the channel's
        // half-hour timeout holding the machine borrowed. Which is exactly what
        // it did, in front of somebody who had asked why it was taking so long.
        //
        // Each question is its own job now. A dropped session costs one question
        // rather than the entire wait, and the answer is a COUNT compared with
        // what it was before, so a marker left by an earlier install cannot be
        // mistaken for this run finishing.
        let done = false
        for (let i = 0; i < 240 && !done; i++) {
          await new Promise(r => setTimeout(r, 5000))
          try { done = (await finishes()) > before } catch { /* the agent is restarting; ask again */ }
        }
        if (!done) {
          throw new Error(`The setup scripts did not report finishing within twenty minutes. Nothing has been snapshotted, so the machine is unchanged from its old base. Its own log is /var/log/okc-provision.log.`)
        }
        step('back', 'the scripts finished and it is dialled in')

        // 4. And the new starting point. Without this the whole thing is undone
        //    by the next rollback.
        //
        //    UNDER A NEW NAME, because the old one is still there and this is a
        //    replacement rather than an addition. Two snapshots called "base"
        //    make restoring by that name a coin toss between them, which is what
        //    vmBaseSnapshot refuses — and it refused this on its first run.
        //
        //    The new one is taken BEFORE the old one is thrown away, so there is
        //    never a moment when the machine has no clean point to come back to.
        //    A re-provision that died in between would otherwise leave a machine
        //    that cannot be put away at all.
        const was = vm.baseSnapshot || 'base'
        const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(2, 12)
        const title = `base-${stamp}`
        step('base', `taking "${title}" as the new clean starting point`)
        await actions.vmBaseSnapshot.run({ name, title })
        await actions.vmAwait.run({ name, for: 'connected', seconds: 420 })
        step('boot', 'it booted from the new base and dialled in')

        // 5. Did the console actually come through? Said rather than asserted:
        //    a machine can be perfectly re-provisioned and still not have a
        //    serial console, if the guest half was never part of these scripts.
        let console_ = null
        try {
          const read = await actions.vmLog.run({ name, which: 'serial', lines: 3 })
          console_ = read.of > 1 ? `${read.of} lines` : 'nothing yet'
        } catch (e) { console_ = `not readable — ${e.message.split('.')[0]}` }

        await actions.vmReturn.run({ name })
        step('away', 'put away clean, at the new base')

        // 6. And the one it replaced, now that the machine is off and sitting on
        //    the new one. Last on purpose: deleting a snapshot merges its disk
        //    back, which is the slowest and least reversible step here, and it
        //    is the only one that can be skipped without leaving the machine in
        //    a state nobody wants. A failure is said and not thrown.
        let old = null
        if (was && was !== title) {
          try {
            await actions.vmSnapshotDelete.run({ name, title: was })
            old = `"${was}" was merged back`
            step('tidy', `threw away the old "${was}"`)
          } catch (e) {
            old = `"${was}" is still there — ${e.message.split('.')[0]}`
            to.warn(`the old base could not be removed: ${e.message}`)
          }
        }

        const took = Math.round((Date.now() - began) / 1000)
        return {
          name,
          steps,
          took,
          base: title,
          old,
          console: console_,
          note: `"${name}" was re-provisioned in ${took}s and is off at "${title}". ${old ? old + '. ' : ''}Its console says: ${console_}.`
        }
      } catch (e) {
        // Handed back rather than left claimed. A machine stuck as "borrowed"
        // after a failure is out of the pool with nobody using it.
        to.bad(`re-provisioning stopped: ${e.message}`)
        await actions.vmReturn.run({ name, keep: true }).catch(() => {})
        throw new Error(`"${name}" was not re-provisioned: ${e.message} It is left as it is, out of the pool — look at it on the Runners tab before giving it back.`)
      } finally {
        updating = null
      }
    }
  },

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
      // AND THE BORROW GOES BACK WITH THE DISK, for exactly the reason written
      // above about the branch.
      //
      // A borrow says "this one is mine, do not queue it". After a rollback the
      // machine is on no branch, holds no credential and holds no work — every
      // other field says it is free — and the borrow alone kept it out of the
      // pool, naming work that is not there. runner1 sat like that: `poweroff`,
      // `claims a branch: nothing`, "not on a branch and not running anything",
      // and beside it `borrowed — working on inspection/check1 in a terminal`.
      //
      // Somebody who wants it after rolling it back borrows it again, which is
      // one click. The other way round is a machine nobody can use and nothing
      // explains — and `vmReturn --keep` already exists for releasing a borrow
      // without touching the disk, which is the case this must not be confused
      // with.
      const gaveBack = vm.borrowed || null
      vms.update(name, { branch, borrowed: null, holdsCredential: false, cleanSince: new Date().toISOString() })

      const to = log.on('vm', name)
      if (gaveBack) to.info(`no longer borrowed — it was "${gaveBack.why || 'taken by somebody'}", and the disk it was taken for has gone back`)
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

  // WAITING FOR A MACHINE, as something anybody can ask for.
  //
  // The queue has always waited — for a machine to come up, for a run to end —
  // and every one of those waits was private to it. So the command line could
  // start a machine and then had nothing to do but ask again, and a drill that
  // wanted to prove "it starts and dials in" had to invent a loop of its own.
  //
  // A machine is not up when VirtualBox says it is running. It is up when it has
  // DIALLED IN: booted, provisioned, and holding a channel back to here, which
  // is a minute or two after the power comes on and the only definition anything
  // else in this app cares about.
  //
  // Bounded, and it says how long it waited rather than only that it gave up:
  // "not yet after 180s" and "never" are different problems, and the first one
  // is usually a machine that needs another minute.
  vmAwait: {
    about: 'Wait until a machine speaks on its console, says something in particular, has dialled in, or is off',
    takes: ['name', 'for', 'seconds', 'tries', 'find'],
    run: async ({ name, for: want, seconds, tries, find }) => {
      const machine = vms.get(name)
      const wants = String(want || 'connected')
      const limit = Math.max(5, Math.min(Number(seconds) || 300, 3600)) * 1000
      const began = Date.now()

      // WAITING FOR THE CONSOLE TO SAY SOMETHING IN PARTICULAR.
      //
      // "It spoke" answers one question — is the kernel alive — and there is a
      // whole install after that where the only thing that knows what is
      // happening is the console. An unattended install is twenty-five minutes
      // of a machine nothing here can talk to: no agent, no network, no channel.
      // The steps of it are readable, one line at a time, and until this there
      // was no way to say "wait until it gets to that step".
      //
      // A pattern rather than a stage list, because the stages belong to the
      // installer and the distribution rather than to this app — a list here
      // would be a copy of somebody else's boot sequence, out of date the moment
      // it is written.
      //
      // The file is read rather than watched. It is written by the VirtualBox
      // process a line at a time and there is no event to subscribe to; a read
      // of a local file every second and a half costs nothing next to the thing
      // being waited for.
      if ((wants === 'console' || wants === 'speaking') && String(find || '').trim()) {
        const pattern = new RegExp(String(find), 'i')
        const file = path.join(data.sub('serial'), `${machine.name}.log`)
        for (;;) {
          let hit = null
          try {
            const text = fs.readFileSync(file, 'utf8')
            hit = text.split(/\r?\n/).find(l => pattern.test(l))
          } catch { /* not written yet, which is one of the things being waited for */ }
          if (hit) {
            const took = Math.round((Date.now() - began) / 1000)
            return {
              name: machine.name,
              was: 'said',
              took,
              // The line itself, stripped of the colour a boot is full of, so
              // whatever is waiting can report WHAT it saw rather than that it
              // saw something.
              line: hit.replace(/\[[0-9;?]*[a-zA-Z]/g, '').trim(),
              note: `"${machine.name}" said something matching /${find}/ on its console after ${took}s.`
            }
          }
          if (Date.now() - began >= limit) {
            const took = Math.round((Date.now() - began) / 1000)
            throw new Error(`"${machine.name}" did not say anything matching /${find}/ on its console within ${took}s. vmLog --name ${machine.name} --which serial is what it did say.`)
          }
          await new Promise(r => setTimeout(r, 1500))
        }
      }

      // THE EARLIEST THING A MACHINE CAN SAY, and the most useful one for
      // anything deciding whether the host is free again. "connected" means it
      // is ready for work, which is minutes later; "console" means its kernel is
      // up and running code, which is when the expensive minute ends.
      if (wants === 'console' || wants === 'speaking') {
        // `tries` turns waiting into supervising: silence becomes a failed start
        // rather than patience, and the machine is power-cycled and listened to
        // again. Off unless asked for, because most callers only want to know.
        const said = await untilItSpeaks(machine.name, { capMs: limit, tries: Math.max(1, Number(tries) || 1) })
        const took = Math.round((Date.now() - began) / 1000)
        if (!said.spoke) throw new Error(`"${machine.name}" said nothing on its console within ${took}s (${said.why}).`)
        return { name: machine.name, was: 'speaking', took, note: `"${machine.name}" started talking after ${took}s.` }
      }

      const here = () => {
        if (wants === 'connected') return !!channel.list().find(a => a.vm === machine.name)
        if (wants === 'gone') return !channel.list().find(a => a.vm === machine.name)
        // Anything else is a VirtualBox state, asked of the one place allowed
        // to ask: see machines/vbox.js, one call at a time.
        return null
      }

      if (here() === null) {
        const ok = wants === 'off'
          ? await vbox.waitUntilOff(machine.name, { timeout: limit }).then(() => true, () => false)
          : await vbox.waitForState(machine.name, s => s === wants, { timeout: limit }).then(() => true, () => false)
        const took = Math.round((Date.now() - began) / 1000)
        if (!ok) throw new Error(`"${machine.name}" was not ${wants} after ${took}s.`)
        return { name: machine.name, was: wants, took, note: `"${machine.name}" was ${wants} after ${took}s.` }
      }

      // The channel is in this process, so this is a lookup rather than a call
      // out to anything. Asked twice a second, which costs nothing and makes the
      // answer arrive when it happens rather than up to a tick later.
      while (!here() && Date.now() - began < limit) {
        await new Promise(r => setTimeout(r, 500))
      }
      const took = Math.round((Date.now() - began) / 1000)
      if (!here()) throw new Error(`"${machine.name}" was not ${wants} after ${took}s. A machine that is powered on and not dialled in is either still booting or stuck — vmScreenshot is the only thing that tells those apart.`)
      return { name: machine.name, was: wants, took, note: `"${machine.name}" was ${wants} after ${took}s.` }
    }
  },

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
    about: 'Run the setup scripts again on a machine that is already up. Pass detach for first-boot, which restarts the agent',
    takes: ['name', 'stage', 'detach'],
    run: async ({ name, stage = 'toolchain', detach }) => {
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
      // DETACHED, FOR THE ONE SCRIPT THAT KILLS ITS OWN CALLER.
      //
      // first-boot.sh restarts the agent. The command it is running under is a
      // CHILD of that agent, so the restart takes the script down with it —
      // part-way through, silently, reporting only that the channel ended. The
      // result was a machine that looked re-provisioned and had none of the
      // changes after the line where the agent restarts: found by asking the
      // guest for a file the script writes, and it was not there.
      //
      // `setsid` puts it in its own session so it survives, with its output
      // appended to the provisioning log the scripts already share — because
      // detaching means nobody is listening to stdout any more, and a run
      // nothing recorded is a run nobody can diagnose.
      const away = detach === true || detach === 'true'
      const run = needsRoot
        ? (away
            ? `sudo -n setsid env OKC_QUIET_SAY=yes bash /tmp/okc-again.sh </dev/null >>/var/log/okc-provision.log 2>&1 & echo detached`
            : `sudo -n env OKC_QUIET_SAY=yes bash /tmp/okc-again.sh`)
        : (away
            ? `setsid env OKC_QUIET_SAY=yes bash /tmp/okc-again.sh </dev/null >>/var/log/okc-provision.log 2>&1 & echo detached`
            : `OKC_QUIET_SAY=yes bash /tmp/okc-again.sh`)

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
