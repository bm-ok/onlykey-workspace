'use strict'

// The API. It hosts no page.
//
// NW.js opens the window from disk as an app page, and that page requires this
// module and calls the same `actions` table directly -- one process, no socket in
// between. So the HTTP side exists for exactly one client: a machine being
// provisioned, which fetches its scripts over it and reports back the same way.
//
// `node server.js` runs the same thing with no window, for driving it by hand.

const http = require('node:http')
const https = require('node:https')
const fs = require('node:fs')
const path = require('node:path')

const log = require('./core/log')
const ipc = require('./core/ipc')
const keys = require('./core/keys')
const ssh = require('./core/ssh')
const data = require('./core/data')
const secret = require('./core/secret')
const vbox = require('./machines/vbox')
const vms = require('./machines/vms')
const provisioner = require('./machines/provisioner')
const scripts = require('./machines/scripts')
const channel = require('./machines/channel')
const tasks = require('./tasks/store')
const artifact = require('./tasks/artifact')
const harness = require('./tasks/harness')
const approval = require('./tasks/approval')
const archive = require('./tasks/archive')
const files = require('./tasks/files')
const queue = require('./tasks/queue')
require('./tasks/planned')   // registers the drills with the harness
const machines = require('./machines/store')
const { provision, reach } = require('./machines/provision')
const editor = require('./machines/editor')
const repos = require('./repos/serve')
const busy = require('./machines/busy')
const session = require('./machines/session')
const dispatch = require('./machines/dispatch')
const auth = require('./machines/auth')
const branches = require('./repos/branches')
const workspace = require('./repos/workspace')

const started = new Date().toISOString()

// The port we actually ended up on. A guest is told to fetch its scripts from
// here, so this has to be what is really listening rather than a default.
let port = Number(process.env.PORT || 7373)
let channelPort = Number(process.env.OKC_CHANNEL_PORT || 7374)

// The one thing served without encryption, on a port of its own.
//
// It has to be. A machine being built has nothing yet -- no certificate, no
// authority, nothing to check anything against -- so the very first fetch cannot
// be verified by any means it already holds. What it CAN hold is a fingerprint,
// passed on the installer's command line, which is short and not a secret.
//
// So this serves exactly one thing: the authority's certificate, which is public
// by design. Everything with anything at stake in it -- the machine's token, its
// scripts, its repositories -- is on the encrypted port, fetched only once the
// authority has been checked against that fingerprint.
let caPort = Number(process.env.OKC_CA_PORT || 7375)

// ---- the actions ------------------------------------------------------
//
// One flat table: everything the tool can do, each with a line saying what it is
// for. /api/actions serves this table and the window builds its own list of every
// capability from it, so nothing can exist here without showing up there.

// A snapshot of a machine holding a credential is a copy of that credential,
// and it outlives everything: the task, the machine, and any decision to revoke
// it. The design note this follows says it plainly -- the credential is part of
// the task, never part of the snapshot -- and until now that was a sentence in a
// log line rather than something that could not happen.
//
// READ FROM THE REGISTRY, not from the machine. A snapshot is taken while the
// machine is OFF, which is exactly when it cannot be asked anything -- so the
// fact is recorded when a credential is put there and cleared when it is taken
// away, the same way the branch it may push is.
//
// A hard refusal rather than a warning. A warning about a secret is advice, and
// the thing being prevented is silent and permanent.
// A title that is already taken on this machine.
//
// VIRTUALBOX ALLOWS TWO SNAPSHOTS WITH THE SAME NAME, and everything here
// restores BY NAME -- the queue does it before every task. So a second "base"
// makes every future restore a coin toss between a clean starting point and
// whatever else somebody called base a month ago, and nothing announces the
// ambiguity: the restore succeeds, on the wrong disk.
//
// It happened here: a machine ended up with `base` at the root of its tree and
// `base` three levels down. Refused at the source rather than resolved later,
// because by the time it matters the two are indistinguishable to anybody
// reading a list of names.
async function refuseIfThatTitleIsTaken (name, title) {
  const wanted = String(title || '').trim().toLowerCase()
  const { snapshots = [] } = await vbox.snapshots(name)
  const flat = []
  const walk = list => list.forEach(s => { flat.push(s.name); if (s.children) walk(s.children) })
  walk(snapshots)
  if (flat.some(s => String(s).trim().toLowerCase() === wanted)) {
    throw new Error(`"${name}" already has a snapshot called "${title}". VirtualBox would allow a second one, and then restoring by that name is a coin toss between them — pick another name, or throw the old one away first with vmSnapshotDelete.`)
  }
}

function refuseIfItHoldsACredential (name) {
  const vm = vms.read().find(v => v.name === name)
  if (vm && vm.holdsCredential) {
    throw new Error(`"${name}" is holding a worker credential, and a snapshot would keep a copy of it for as long as the snapshot exists. Take it back first: vmCredentialsForget --name ${name}`)
  }
}

// A path that is meant to be on the guest, checked for having been eaten on the
// way here.
//
// Git Bash rewrites anything shaped like an absolute unix path in a command
// line into a Windows one, so `--folder /home/okc/work` arrives as
// `C:/Program Files/Git/home/okc/work`. Nothing rejects it: the machine simply
// cannot find that directory, falls back to the home folder, and the work
// happens somewhere nobody asked for -- silently, and looking like success.
//
// Caught here rather than fixed here, because guessing what was meant is how a
// task lands in a third wrong place. `MSYS_NO_PATHCONV=1` or a leading `//` stops
// the shell doing it.
function guestPath (p, what) {
  if (!p) return p
  if (/^[A-Za-z]:[\\/]/.test(p) || p.includes('\\')) {
    throw new Error(`"${p}" is a path on this host, not on the machine. If you are in Git Bash it rewrote ${what} on the way here; run it as MSYS_NO_PATHCONV=1 okc.js ... or write the path with two leading slashes.`)
  }
  return p
}

let wantedShot = null

const actions = {
  status: {
    about: 'Is the server up, and what does it have to work with',
    run: async () => ({
      ok: true,
      started,
      port,
      virtualbox: vbox.available() ? vbox.exe() : null,
      mine: vms.read().length,
      // Repositories left somewhere other than their default branch. Carried on
      // the poll because a dirty one will refuse a push whose owner cannot
      // possibly explain it, and the operator should meet that here rather than
      // as a machine's confusing failure an hour later.
      repos: (() => { try { return branches.blocking() } catch { return [] } })(),
      // Both ways the certificate stops working, checked against the address
      // machines are actually told to use rather than against any address.
      tls: await (async () => {
        try { return keys.state(await vbox.hostAddress()) } catch { return keys.state(null) }
      })()
    })
  },

  // The one way out of a certificate that no longer works -- expired, or no
  // longer naming this host because its address moved.
  //
  // Never automatic. Regenerating drops the trust of every machine that was
  // given the old authority, so it is a decision with a cost, and doing it
  // quietly on a mismatch would break machines to fix a warning.
  tlsRegenerate: {
    about: 'Make a new certificate for this host — every machine must then be set up again',
    run: async () => {
      const made = keys.ensure({ force: true })
      log.on('server').warn('A new certificate was made. Every machine has to be set up again before it can fetch or push.')
      return { covers: made.covers, fingerprint: made.fingerprint, dir: made.dir, restart: 'restart the dashboard for it to be served' }
    }
  },
  actions: {
    about: 'Every action this server has, with what each is for',
    run: async () => ({
      actions: Object.entries(actions).map(([name, a]) => ({ name, about: a.about, takes: a.takes || [] }))
    })
  },

  // Only ever the machines this app made. Everything here refuses a machine that
  // is not in its own registry, because these actions can destroy one.
  vmList: { about: 'The virtual machines this app made, with live state and stage', run: () => vms.all() },
  vmCreate: { about: 'Make a virtual machine and its disk', takes: ['vm'], run: ({ vm }) => provisioner.create(vm || {}) },
  vmInstall: { about: 'Install an operating system, unattended, and run its provisioning scripts', takes: ['name'], run: ({ name }) => busy.during(name, 'being installed', () => provisioner.install(name, { port, caPort })) },
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
      const url = `https://${await vbox.hostAddress()}:${port}/provision/${file}?vm=${encodeURIComponent(name)}`

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

  sshKey: {
    about: "This app's own ssh key — the one that gets into the machines it makes",
    run: () => {
      const state = ssh.state()
      const mine = vms.read()
      return {
        ...state,
        // Which machines would actually accept it, which is not the same
        // question as whether the key exists. A machine built before this key —
        // or with a different one chosen in the dialog — has somebody else's
        // public half in its authorized_keys and nothing here can change that
        // without being able to get in, which is the thing at issue.
        machines: mine.map(vm => ({
          name: vm.name,
          authorised: !!(vm.spec && vm.spec.sshKey && state.publicKey && vm.spec.sshKey.trim() === state.publicKey.trim()),
          builtWith: vm.spec && vm.spec.sshKey ? String(vm.spec.sshKey).split(' ').slice(0, 2).join(' ').slice(0, 28) + '…' : null
        }))
      }
    }
  },

  // Where anything that speaks ssh looks for these machines.
  //
  // Written because VS CODE cannot be told which key to use. `vmShell` could take
  // `-i`, but VS Code Remote runs plain `ssh user@host` and reads everything else
  // from ssh's configuration — so a key that is not in a config file is a key it
  // will never offer, and "open in VS Code" would fall back to whatever the
  // operator's default identity happens to be. Which is the key all of this
  // exists to stop using.
  sshConfig: {
    about: 'Write the ssh config for these machines, so ssh and VS Code find them by name',
    run: () => {
      const mine = ssh.have() ? String(ssh.publicKey() || '').trim() : null
      const machines = vms.read().map(vm => {
        const agent = channel.list().find(a => a.vm === vm.name)
        const live = agent ? String(agent.from || '').replace(/^::ffff:/, '').replace(/:\d+$/, '') : null
        return {
          name: vm.name,
          address: live || vm.lastAddress || null,
          user: (agent && agent.facts && agent.facts.user) || vm.lastUser || (vm.spec && vm.spec.user) || null,
          // Whether this machine would accept the app's key. Machines built
          // before it existed would not, and naming it for them would be
          // insisting on the one identity that cannot work.
          mine: !!(mine && vm.spec && vm.spec.sshKey && String(vm.spec.sshKey).trim() === mine)
        }
      })
      const file = ssh.writeConfig(machines)
      const include = ssh.ensureInclude()
      return {
        file,
        include,
        hosts: machines.filter(m => m.address && m.user).map(m => ({ alias: ssh.aliasFor(m.name), ...m })),
        // Said, because a machine with no address has never dialled in and its
        // absence here is a fact about it rather than a failure of this.
        without: machines.filter(m => !m.address).map(m => m.name)
      }
    }
  },

  sshKeyMake: {
    about: 'Make this app a new ssh key. Machines built with the old one stop letting it in',
    takes: ['force'],
    run: ({ force }) => {
      const had = ssh.have()
      const yes = force === true || force === 'true' || force === 'yes'
      if (had && !yes) {
        throw new Error('There is already a key. Making another one locks this app out of every machine built with the old one — say force to mean it.')
      }
      const made = ssh.make({ force: yes })
      const state = ssh.state()
      log.on('keys')[had ? 'warn' : 'good'](had
        ? `a new ssh key was made — machines built with the old one no longer let this app in (${state.fingerprint})`
        : `ssh key made (${state.fingerprint})`)
      return {
        ...made,
        ...state,
        note: had
          ? 'Every machine built with the old key must be rebuilt, or have this public key added to its authorized_keys by hand while the old key still works.'
          : 'New machines will be built with this. Existing ones were not.'
      }
    }
  },

  tlsKey: {
    about: "This host's certificate: what it names, when it expires, and its authority",
    run: async () => {
      let address = null
      try { address = await vbox.hostAddress() } catch { /* no adapter is its own answer */ }
      const state = keys.state(address)
      // The authority's fingerprint, which is the one number a person may
      // actually need to read out: a brand-new machine checks the authority
      // against it before trusting anything, over a connection that is not yet
      // protected. Published rather than secret, for exactly that reason.
      let fingerprint = null
      try { fingerprint = keys.ensure().fingerprint } catch { /* reported as missing above */ }
      return { ...state, address, fingerprint, dir: keys.DIR }
    }
  },

  hostKeys: {
    about: 'Public ssh keys that could be authorised on a new machine — this app\'s first',
    run: async () => {
      const keys = []

      // THIS APP'S OWN KEY FIRST, and made if it does not exist yet.
      //
      // It is what should go into a new machine: the app can say when it was
      // made and rotate it, nothing else on this computer is opened by it, and
      // it does not vanish with somebody's profile. The operator's personal keys
      // are still offered underneath because a person may deliberately want
      // their own way in — but the default should not be the key that opens
      // everything else they can reach.
      try {
        ssh.make()
        const mine = ssh.publicKey()
        if (mine) keys.push({ file: 'id_okc.pub', key: mine, comment: "this app's own key", mine: true })
      } catch (e) {
        log.on('keys').warn(`could not make this app an ssh key: ${e.message}`)
      }

      const dir = path.join(require('node:os').homedir(), '.ssh')
      if (fs.existsSync(dir)) {
        for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.pub'))) {
          const text = fs.readFileSync(path.join(dir, f), 'utf8').trim()
          keys.push({ file: f, key: text, comment: `${text.split(/\s+/).slice(2).join(' ') || f} — yours`, mine: false })
        }
      }
      return { keys }
    }
  },

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
      return { stage, file: path.basename(scripts.fileFor(vm, stage)), script: scripts.render(stage, vm, { hostAddress: host, port, channelPort, caPort, caFingerprint: keys.ensure().fingerprint }) }
    }
  },

  // Other machines, reached over ssh rather than made here.
  machines: { about: 'Machines reachable over ssh, as opposed to ones this app made', run: async () => ({ machines: machines.all() }) },
  machineAdd: { about: 'Add a machine', takes: ['machine'], run: ({ machine }) => machines.add(machine || {}) },
  machineRemove: { about: 'Forget a machine — nothing on it is touched', takes: ['id'], run: ({ id }) => machines.remove(id) },
  machineReach: { about: 'Does this machine answer', takes: ['id'], run: ({ id }) => reach(machines.get(id)) },
  provision: { about: "Run a machine's setup steps, in order, stopping at the first failure", takes: ['id', 'steps'], run: ({ id, steps }) => provision(machines.get(id), steps) },
  openEditor: { about: 'Open a folder in VS Code, here or over ssh', takes: ['id', 'where'], run: ({ id, where }) => editor.openOn(machines.get(id), where) },

  // Every branch across the workspace, so a machine can be pointed at work that
  // already exists instead of a name being typed twice and spelled differently.
  // The join between branches and machines happens here, not in repos/, which
  // knows nothing about machines and should not start.
  gitBranches: {
    about: 'Every branch across the workspace repositories, which have each, and which are taken',
    run: () => {
      const all = branches.all()
      const mine = vms.read()
      return {
        ...all,
        // Where each default branch actually is, as a commit. The rule is that
        // nothing lands on it; this is the only way to CHECK that, before and
        // after something that was supposed to be refused. Looking at master and
        // finding it plausible is not a check.
        defaultHeads: branches.defaultHeads(),
        branches: all.branches.map(b => {
          const held = mine.find(v => v.branch === b.name)
          const available = !b.protected && !held
          return {
            ...b,
            heldBy: held ? held.name : null,
            // Two questions, answered separately. `available` is whether this
            // branch may be worked on at all; `reclaimable` is whether the host
            // can get out of its way. Both must hold to use it, but they fail
            // for different reasons and are fixed in different places, so
            // `usable` is offered as well rather than instead.
            available,
            usable: available && b.reclaimable
          }
        })
      }
    }
  },

  // Every branch, and everything that decides what to do with it.
  //
  // WHY THIS EXISTS SEPARATELY FROM `gitBranches`. That one answers "may I build
  // on this", which is the question asked when a machine is being set up. This
  // answers "what IS this", which is the question asked when nobody can remember
  // where a branch came from -- and there are, by now, a great many branches.
  //
  // The confusing part is not any single branch, it is that ownership is spread
  // across three places that never met: the repositories know a name exists, the
  // board knows a task claims one, and the machine registry knows one is checked
  // out somewhere. A branch belonging to a task that was thrown away looks
  // exactly like a branch somebody made by hand, and the difference decides
  // whether deleting it loses anything.
  //
  // NOTHING HERE SPAWNS GIT PER BRANCH. What is on a branch comes from the
  // artifact cache, which is keyed on where every ref actually is, so a board of
  // forty branches costs the same two processes as a board of one. That is not an
  // optimisation, it is the difference between this being drawable every three
  // seconds and it being the thing that pinned the window's CPU last time.
  branchBoard: {
    about: 'Every branch: who claims it, what is on it, and whether it can be deleted',
    run: () => {
      const all = branches.all()
      const machines = vms.read()
      const board = tasks.read()

      const rows = all.branches.map(b => {
        const held = machines.find(v => v.branch === b.name) || null
        // Every task that named this branch, not the first. Two tasks on one
        // branch is a mistake worth seeing rather than a case to pick a winner in.
        const claims = board.filter(t => t.branch === b.name)

        // What is on it, from the cache. A protected branch is the baseline
        // everything else is measured against, so asking what it adds to itself
        // is meaningless and is not asked.
        const art = b.protected ? null : artifact.read(b.name)

        // CONTAINED IN THE DEFAULT means every repository holding this branch
        // reports nothing beyond its default -- which is the same statement as
        // "merged", arrived at without a single extra command, because the
        // artifact already had to count it.
        // NULL rather than false for a protected branch. It is the thing
        // everything else is measured against, so "is it contained in the
        // default" has no answer -- and false would read as "it has work nobody
        // has merged", which is the opposite of true.
        const carrying = art ? art.repos.filter(r => !r.missing) : []
        const contained = art ? (carrying.length > 0 && carrying.every(r => r.ahead === 0)) : null

        return {
          ...b,
          heldBy: held ? held.name : null,
          // WHETHER THAT MACHINE IS ACTUALLY RUNNING, which is a different fact
          // and was being collapsed into the first one. A claim is a registry
          // entry and outlives the machine being on -- so a powered-off runner
          // still claiming a branch was reported as "checked out on runner2",
          // with a warning about pulling the checkout out from under it. Both
          // sentences describe something live, about a machine that is off.
          heldRunning: !!(held && held.running),
          // The claim, flattened to what a list can show without a second lookup.
          tasks: claims.map(t => ({ id: t.id, number: t.number, title: t.title, state: t.state })),
          commits: art ? art.commits : 0,
          files: art ? art.files : 0,
          summary: art ? art.summary : 'the default branch — everything else is measured against it',
          contained,
          // Made by this system and then forgotten: it carries work, and the task
          // that asked for it is gone. This is the one row that is genuinely hard
          // to reconstruct by hand, and it is why the tab is worth having.
          orphaned: !b.protected && !claims.length && !held && !!art && art.delivered,
          // Unclaimed and carrying nothing. Not the same as orphaned, and the
          // difference is the whole of what deleting costs: this one is a name
          // and nothing else, so sweeping it up loses exactly nothing. Most of
          // what accumulates here is this -- a drill's branch outliving the
          // drill.
          spare: !b.protected && !claims.length && !held && !!art && !art.delivered,
          // Said in one place so the window and the command line refuse
          // identically, and so the reason is a sentence rather than a flag.
          removable: !b.protected && !held && b.reclaimable,
          whyNot: b.protected
            ? branches.whyProtected(b.name)
            : held
              ? (held.running
                  // Running: deleting it really would pull the checkout out from
                  // under whatever is happening on that machine right now.
                  ? `${held.name} is set up on this branch and is running. Let it go of the branch first — deleting it now would take the checkout out from under it.`
                  // Off: nothing is happening to take anything from. What stands
                  // in the way is the CLAIM, and letting go of one needs the
                  // machine started, because a claim is never dropped without
                  // asking whether it is holding work that exists nowhere else.
                  : `${held.name} still claims this branch, and it is powered off. Letting go of a claim means starting it first: nothing here drops one without asking the machine whether it is holding work that exists nowhere else.`)
              : !b.reclaimable
                ? (b.blocked && b.blocked[0]) || 'something on this host is holding it'
                : null
        }
      })

      return {
        repos: all.repos,
        protected: all.protected,
        branches: rows,
        counts: {
          all: rows.length,
          protected: rows.filter(r => r.protected).length,
          claimed: rows.filter(r => r.tasks.length).length,
          held: rows.filter(r => r.heldBy).length,
          orphaned: rows.filter(r => r.orphaned).length,
          spare: rows.filter(r => r.spare).length,
          contained: rows.filter(r => r.contained).length
        }
      }
    }
  },

  // What is on a branch, asked of the branch rather than of a task.
  //
  // `taskArtifact` answers the same question and needs a task id, which is
  // exactly what an ORPHANED branch does not have -- and an orphaned branch
  // carrying commits is the one thing on the board where somebody has to decide
  // whether to throw work away. Deciding that blind was the only option.
  //
  // Never cached: the summary on the board can be four seconds stale without
  // costing anything, but this is what a person reads before deleting something.
  branchArtifact: {
    about: 'What is on a branch: commits and files per repository, without a task',
    takes: ['branch'],
    run: ({ branch }) => {
      if (!branch) throw new Error('Which branch?')
      return artifact.read(branch, { fresh: true })
    }
  },

  // Everything a branch carries, of every kind, in ONE answer.
  //
  // A branch is where work is kept, and work now arrives in more than one shape:
  // commits, files a run handed over that a branch could not hold, and -- when it
  // exists -- the session that produced them. A panel showing all three should
  // not have to make three calls and stitch them together, because the three
  // would then be from three different moments.
  branchArtifacts: {
    about: 'Everything a branch carries: its commits, the files handed over, and the session',
    takes: ['branch'],
    run: ({ branch }) => {
      if (!branch) throw new Error('Which branch?')

      // Never cached: this is what somebody reads before judging or deleting.
      const git = artifact.read(branch, { fresh: true })

      // Every task that named this branch, and what each of them handed over.
      // Read from the archive rather than the task record, so a task that was
      // thrown away still shows what it produced.
      const onIt = tasks.read().filter(t => t.branch === branch)
      const delivered = onIt.map(t => ({
        task: t.id,
        number: t.number,
        title: t.title,
        state: t.state,
        machine: t.machine || null,
        files: files.list(t.uid)
      }))

      return {
        branch,
        git,
        tasks: delivered,
        files: delivered.flatMap(d => d.files.map(f => ({ ...f, task: d.task, number: d.number }))),
        // SAID PLAINLY RATHER THAN LEFT OUT. A branch is where work lives and a
        // session is how that work was reached, so it belongs here -- and
        // nothing captures one yet. An empty panel would read as "this branch
        // has no session"; this says the tool does not keep them.
        session: {
          kept: false,
          why: 'Nothing captures a worker session yet. The machine is rolled back when its work ends, and the session goes with it — so resuming one, or reading how a branch was reached, is not possible from here.'
        }
      }
    }
  },

  branchDiff: {
    about: "One repository's changes on a branch, in full, without a task",
    takes: ['branch', 'repo', 'file'],
    run: ({ branch, repo, file }) => {
      if (!branch || !repo) throw new Error('Which branch, in which repository?')
      return { branch, repo, file: file || null, diff: artifact.diff(repo, branch, file) }
    }
  },

  // Take a branch out of every repository that has it.
  //
  // Every refusal is here rather than in the window, because the window is one
  // caller. A protected branch is refused outright; a branch a machine is set up
  // on is refused because deleting it pulls the checkout out from under a running
  // job; and a branch carrying commits the default does not have is refused
  // UNLESS the caller says so, since that is the only case where the answer
  // depends on something this cannot know.
  branchDelete: {
    about: 'Delete a branch from every repository that has it',
    takes: ['branch', 'force'],
    run: ({ branch, force = false }) => {
      const row = actions.branchBoard.run({}).branches.find(b => b.name === branch)
      if (!row) throw new Error(`No repository here has a branch called "${branch}".`)
      if (row.whyNot) throw new Error(row.whyNot)

      if (!row.contained && !force) {
        throw new Error(
          `"${branch}" carries ${row.commits} commit(s) that ${row.tasks.length ? 'its task delivered and ' : ''}no default branch has. ` +
          'Deleting it is the only way that work is lost here, so it has to be asked for on purpose: pass force.'
        )
      }

      // Forced at the git level whenever we got this far, because the check that
      // matters was made above against the DEFAULT branch. Git's own -d compares
      // against whatever HEAD happens to be, which in a bare repository being
      // served is not the question anybody asked.
      const gone = branches.remove(branch, { force: true })

      log.on('git').warn(
        `deleted branch "${branch}" from ${gone.deletedFrom.map(d => d.repo).join(', ')}` +
        (row.contained ? '' : ` — it carried ${row.commits} commit(s) no default branch has`)
      )
      // The commits are named on the way out. A branch is a pointer; deleting one
      // does not delete what it pointed at, and for as long as git keeps the
      // object these numbers are how it comes back.
      return {
        ...gone,
        carried: row.commits,
        contained: row.contained,
        tasks: row.tasks,
        note: row.contained
          ? 'Everything on it was already in the default branch.'
          : `It carried ${row.commits} commit(s) that no default branch has. They still exist: ${gone.deletedFrom.map(d => `${d.repo} ${d.was || '(nothing)'}`).join(', ')}`
      }
    }
  },

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
    takes: ['name', 'branch', 'folder'],
    run: async ({ name, branch, folder }) => {
      const vm = vms.get(name)
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

      const cut = branches.ensure(on)
      const made = cut.filter(c => c.created)
      const to = log.on('vm', name)
      to.info(made.length
        ? `cut "${on}" in ${made.map(c => c.repo).join(', ')}`
        : `"${on}" already existed in every repository`)

      const host = await vbox.hostAddress()
      const tls = keys.ensure()
      const script = workspace.script({
        repos: found.map(r => r.name),
        branch: on,
        folder: folder || workspace.folderFor(vm.spec),
        origin: `https://${host}:${port}`,
        machine: name,
        token: vm.spec.token,
        ca: tls.ca.toString()
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

      return { branch: on, folder: folder || workspace.folderFor(vm.spec), repos: found.map(r => r.name), cut, output: r.output }
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
grep -vF '${host}:${port}' "$HOME/.git-credentials" > "$tmp" 2>/dev/null || true
printf '%s\\n' 'https://${name}:${fresh}@${host}:${port}' >> "$tmp"
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

  // ---- authorising a worker -------------------------------------------
  //
  // The one credential that has to exist inside a machine. Everything else here
  // is arranged so a runner holds none -- that is what makes the gate the only
  // way work gets out -- and an agent breaks it, because it cannot work without
  // being able to authenticate.
  //
  // THE HOST HOLDS IT; A MACHINE IS HANDED ONE. Not the reverse. A runner that
  // logged in itself would leave the credential living there as a property of
  // the machine, and machines here are snapshotted, copied and deleted. So one
  // machine is signed in by a person, the credential is taken from it, and every
  // other machine is given a copy when it needs one and stripped when it does
  // not.
  //
  // Kept in the app's data directory, outside the repository, 0600 -- the same
  // place as the certificate and for the same reason.
  // Start a sign-in on a machine and hand back the URL to visit.
  //
  // The dashboard does this rather than a person opening a terminal inside the
  // machine, because a person in the machine is what everything else here
  // replaced -- and because the sign-in is two exchanges with one process, which
  // needs something to hold the process open between them.
  vmAuthBegin: {
    about: 'Start signing a machine\'s worker in, and return the URL to visit',
    takes: ['name', 'wait'],
    run: async ({ name, wait = 25 }) => {
      vms.get(name)
      if (!channel.connected(name)) throw new Error(`"${name}" is not dialled in.`)

      const seconds = Math.max(5, Math.min(Number(wait) || 25, 120))
      const r = await channel.run(name, auth.begin(seconds), { what: 'starting a worker sign-in', timeout: (seconds + 30) * 1000 })
      const out = auth.read(r.output)

      if (out.url) {
        log.on('vm', name).good(`${name} is waiting to be signed in — open ${out.url}`)
        return { name, url: out.url, next: `visit it, then: okc.js vmAuthCode --name ${name} --code "<what it gives you>"`, log: out.log }
      }

      // No URL is not automatically a failure -- it may already be signed in, or
      // it may have refused for a reason of its own. Its own words are the
      // answer; guessing between those would be inventing one.
      // The raw reply when the parsed one is empty. A message built only from
      // fields that turned out to be blank says nothing at all, and the thing
      // most likely to explain that is what actually came back.
      throw new Error(`"${name}" did not offer a sign-in URL${out.finished ? ` (it exited ${out.exit})` : ''}.\nit said: ${out.log || '(nothing)'}\n${out.why || ''}${out.log || out.why ? '' : `\nraw reply:\n${String(r.output || '(empty)').slice(-800)}`}`)
    }
  },

  vmAuthCode: {
    about: 'Give a waiting machine the code from the sign-in page',
    takes: ['name', 'code', 'wait'],
    run: async ({ name, code, wait = 40 }) => {
      vms.get(name)
      if (!channel.connected(name)) throw new Error(`"${name}" is not dialled in.`)
      if (!code || !String(code).trim()) throw new Error('Say what the code is.')

      const seconds = Math.max(5, Math.min(Number(wait) || 40, 120))
      const r = await channel.run(name, auth.code(String(code).trim(), seconds), { what: 'finishing a worker sign-in', timeout: (seconds + 30) * 1000 })
      const out = auth.read(r.output)

      if (out.noPipe) throw new Error(`"${name}" is not waiting for a code. Start it again with vmAuthBegin.`)
      if (out.finished && out.exit === 0) {
        // Recorded HERE too, and not only when this host hands a credential over.
        //
        // A machine that signs itself in is holding a token exactly as much as
        // one that was given one, and the snapshot refusal reads this flag. It
        // was set by vmCredentialsPut and vmCredentialsGrab and not by this,
        // which left the original hole open through a second door: sign in on
        // the machine, snapshot it, and the token is in the snapshot for as
        // long as the snapshot exists.
        vms.update(name, { holdsCredential: true })
        log.on('vm', name).good(`${name}'s worker is signed in — it cannot be snapshotted until that credential is taken back`)
        return { name, signedIn: true, next: `take it with: okc.js vmCredentialsGrab --name ${name}`, log: out.log }
      }
      throw new Error(`"${name}" did not finish signing in${out.finished ? ` (it exited ${out.exit})` : ' (it is still waiting)'}. It said:\n${out.log || '(nothing)'}`)
    }
  },

  vmAuthCancel: {
    about: 'Abandon a sign-in that is part-way through',
    takes: ['name'],
    run: async ({ name }) => {
      vms.get(name)
      if (!channel.connected(name)) throw new Error(`"${name}" is not dialled in.`)
      await channel.run(name, auth.cancel(), { what: 'abandoning a worker sign-in', timeout: 30000 })
      return { name, cancelled: true }
    }
  },

  vmAuthStatus: {
    about: "Whether a machine's worker is signed in",
    takes: ['name'],
    run: async ({ name }) => {
      vms.get(name)
      if (!channel.connected(name)) throw new Error(`"${name}" is not dialled in.`)
      const r = await channel.run(name, 'claude auth status 2>&1 | head -20; echo "---"; ls -l ~/.claude/.credentials.json 2>/dev/null || echo "no credential file"',
        { what: 'checking its worker sign-in', timeout: 60000 })
      return { name, status: r.output }
    }
  },

  // What this host holds, and where it came from.
  //
  // The credential itself is never returned -- not to the window, not to the
  // command line. What a person needs to know is whether there is one, which
  // machine it was taken from and when; the value is only ever handed to a
  // machine that needs it. A page that displays a secret is a page that gets
  // screenshotted.
  credentialsHeld: {
    about: 'Whether this host holds a worker credential, and where it came from',
    run: () => {
      const dir = data.sub('credentials')
      const file = path.join(dir, 'claude.json')
      if (!fs.existsSync(file)) return { held: false, dir }
      let meta = {}
      try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'about.json'), 'utf8')) } catch { /* older ones have none */ }
      const stat = fs.statSync(file)
      return {
        held: true,
        dir,
        file,
        bytes: stat.size,
        taken: meta.taken || stat.mtime.toISOString(),
        from: meta.from || 'unknown',
        // Reported rather than claimed. "Sealed" and "the folder happens to be
        // yours" are different protections, and a reader should be able to tell
        // which one is holding.
        sealed: secret.isSealed(file),
        protection: secret.isSealed(file)
          ? 'encrypted for this Windows account — the file alone is not enough'
          : 'file permissions only — readable by anything running as you'
      }
    }
  },

  vmCredentialsGrab: {
    about: 'Take the signed-in credential from a machine and keep it on this host',
    takes: ['name'],
    run: async ({ name }) => {
      vms.get(name)
      if (!channel.connected(name)) throw new Error(`"${name}" is not dialled in.`)

      // Printed rather than copied out of a path this host cannot see. base64 so
      // a newline or a shell metacharacter in the file cannot change what
      // arrives -- and so the value never appears as readable text in the live
      // log, which is captured and kept.
      const r = await channel.run(name, 'base64 -w0 ~/.claude/.credentials.json 2>/dev/null || echo OKC_NO_CREDENTIAL',
        { what: 'taking its worker credential', timeout: 60000 })

      const b64 = String(r.output || '').split('\n').map(s => s.trim()).filter(Boolean).pop() || ''
      if (!b64 || b64 === 'OKC_NO_CREDENTIAL') {
        throw new Error(`"${name}" has no worker credential to take. Sign in on that machine first: open it and run "claude auth login".`)
      }

      const dir = data.sub('credentials')
      const file = path.join(dir, 'claude.json')
      // Sealed on the way in, so what lands on disk is not the token. It was
      // plain until somebody asked where it was kept, and the honest answer was
      // "readable by anything running as you, or as an administrator, or by
      // whatever backs this folder up".
      const sealed = secret.write(file, Buffer.from(b64, 'base64'))
      // Beside it rather than inside it: which machine it came from and when.
      // The file's own timestamp would answer the second and nothing answers the
      // first, and "where did this come from" is the question asked when
      // something stops working.
      fs.writeFileSync(path.join(dir, 'about.json'), JSON.stringify({ from: name, taken: new Date().toISOString() }, null, 2))

      vms.update(name, { holdsCredential: true })
      log.on('vm', name).good('its worker credential was taken and kept on this host')
      return { from: name, kept: file, sealed, note: 'hand it to a machine with vmCredentialsPut, and take it away again with vmCredentialsForget' }
    }
  },

  vmCredentialsPut: {
    about: 'Hand this host\'s worker credential to a machine',
    takes: ['name'],
    run: async ({ name }) => {
      vms.get(name)
      if (!channel.connected(name)) throw new Error(`"${name}" is not dialled in.`)

      const file = path.join(data.sub('credentials'), 'claude.json')
      if (!fs.existsSync(file)) {
        throw new Error('This host has no worker credential yet. Sign in on one machine and take it with vmCredentialsGrab first.')
      }

      // Opened here and nowhere else. It exists as cleartext for the length of
      // this call and is never written back out in that form.
      const b64 = secret.read(file).toString('base64')

      // AND THE FIRST-RUN WIZARD IS MARKED DONE, which is not a nicety.
      //
      // A valid token is not a usable worker. Claude Code decides whether to run
      // its first-run wizard from a flag in the config, NOT from whether it can
      // authenticate — so a machine holding a perfectly good credential still
      // opens on "choose a theme", and then on "Select login method", which is a
      // sign-in it does not need and cannot finish here. The credential is right
      // there and it asks you to log in anyway.
      //
      // That was reported as "claude doesn't work with the auth key", and it was
      // the wizard the whole time: `claude auth status` said logged in, with the
      // right email and plan, while the screen asked how to log in. Two answers
      // to one question, from the same program, because they read different
      // files.
      //
      // MERGED, NOT WRITTEN OVER. The config is Claude Code's -- it keeps the
      // account, the plan, and everything it has cached there -- so this sets one
      // key and leaves the file otherwise as found. Missing entirely is the
      // ordinary case on a machine that has just been rolled back, and then one
      // key is the whole file.
      const r = await channel.run(name, `set -u
mkdir -p "$HOME/.claude"
umask 077
printf '%s' '${b64}' | base64 -d > "$HOME/.claude/.credentials.json"
chmod 600 "$HOME/.claude/.credentials.json"
node - <<'OKC_READY_EOF'
const fs = require('fs'), os = require('os')
const p = os.homedir() + '/.claude.json'
let j = {}
try { j = JSON.parse(fs.readFileSync(p, 'utf8')) } catch { /* absent or unreadable: one key is the whole file */ }
j.hasCompletedOnboarding = true
fs.writeFileSync(p, JSON.stringify(j))
OKC_READY_EOF
echo okc-credential-placed`, { what: 'handing it a worker credential', timeout: 60000 })

      if (!/okc-credential-placed/.test(r.output || '')) throw new Error(`"${name}" did not take the credential.`)
      vms.update(name, { holdsCredential: true })
      log.on('vm', name).warn(`${name} now holds a worker credential — it cannot be snapshotted until that is taken back`)
      return { to: name, placed: true, ready: true }
    }
  },

  vmCredentialsForget: {
    about: 'Take the worker credential off a machine',
    takes: ['name'],
    run: async ({ name }) => {
      vms.get(name)
      if (!channel.connected(name)) throw new Error(`"${name}" is not dialled in.`)
      const r = await channel.run(name, 'rm -f "$HOME/.claude/.credentials.json" && echo okc-credential-gone',
        { what: 'taking its worker credential away', timeout: 60000 })
      if (!/okc-credential-gone/.test(r.output || '')) throw new Error(`"${name}" still has it.`)
      vms.update(name, { holdsCredential: false })
      log.on('vm', name).good(`${name} no longer holds a worker credential`)
      return { from: name, removed: true }
    }
  },

  // Give a machine a task and let go of it.
  //
  // Returns as soon as the work has STARTED, not when it ends. A task runs for
  // minutes or an hour; waiting for it would make one command look like a hang,
  // hold the machine against anything else, and give no progress at all in the
  // meantime. Progress is read afterwards with vmSessionTail, which is a delta
  // with a bookmark rather than a stream nobody is watching.
  //
  // The credential comes from THIS host's environment and is passed for the life
  // of that one process. It is never written to the machine's disk, because a
  // machine here is snapshotted, copied and deleted, and anything on its disk
  // goes into all three.
  vmDispatch: {
    about: 'Give a machine a task to work on, and return without waiting for it',
    takes: ['name', 'task', 'folder', 'contract', 'resume', 'shell'],
    run: async ({ name, task, folder, contract, resume, shell }) => {
      const vm = vms.get(name)
      if (!channel.connected(name)) throw new Error(`"${name}" is not dialled in, so it cannot be given work.`)
      if (!task || !String(task).trim()) throw new Error('Say what the task is.')

      // Asked before anything is set up, because a worker that cannot
      // authenticate does not fail as "signed out" -- it fails as an api error
      // in a json blob, minutes later, after a workspace has been laid out and
      // a run recorded. The first task ever given out failed exactly that way,
      // and nothing between the button and the log said the obvious thing.
      //
      // Asked of the MACHINE rather than read from the registry. A machine can
      // be signed in three ways -- handed a credential, signed in on itself, or
      // carrying a key in its environment -- and the registry only knows about
      // the first. Refusing a machine that could in fact work is a worse fault
      // than the one being fixed.
      // A shell run has no worker in it, so being signed out is beside the
      // point — refusing one would mean refusing a soak because a credential it
      // will never touch is missing.
      const able = shell ? { output: 'okc-can-authenticate' } : await channel.run(name, 'if [ -s "$HOME/.claude/.credentials.json" ] || [ -n "${ANTHROPIC_API_KEY:-}" ]; then echo okc-can-authenticate; fi',
        { what: 'checking its worker can authenticate', timeout: 30000 })
      if (!/okc-can-authenticate/.test(able.output || '')) {
        throw new Error(`"${name}"'s worker is signed out, so the work would fail the moment it started. Hand it the credential first: vmCredentialsPut --name ${name}`)
      }

      const id = dispatch.newId()
      const where = guestPath(folder, '--folder') || (vm.spec && vm.spec.folder) || workspace.FOLDER

      // The rules a worker is given, read HERE and carried with the task.
      //
      // A path on the machine was the old arrangement and the reason this was
      // never used: nothing puts a file on a machine, so the flag named
      // something no one could make exist. Read from this host, it is a file
      // somebody can actually point at -- and refused by name when it is not
      // there, because a contract that silently fails to load leaves a worker
      // running with no rules while everything reports success.
      let rules = null
      if (contract) {
        const at = path.resolve(String(contract))
        if (!fs.existsSync(at)) throw new Error(`There is no contract at ${at}. It is read from this host, not from the machine.`)
        rules = fs.readFileSync(at, 'utf8')
        if (!rules.trim()) throw new Error(`The contract at ${at} is empty, and an empty contract is worse than none: it reads as though rules were applied.`)
      }
      const to = log.on('vm', name)

      // Where this host can be reached, worked out here rather than left for the
      // guest to assemble. The machine already knows the address; what it does
      // not know is which port artifacts go to, and telling it is cheaper than
      // putting another value in its environment and re-provisioning to get it
      // there.
      let base = null
      try {
        const where2 = await vbox.hostAddress()
        if (where2) base = `https://${where2}:${port}`
      } catch { /* no address means no helper, and the run still runs */ }

      const r = await channel.run(name, dispatch.script({ id, task: String(task), folder: where, contract: rules, resume, shell: !!shell, base }),
        { what: `dispatching ${id}`, timeout: 60000 })

      if (!/okc-dispatched/.test(r.output || '')) {
        throw new Error(`"${name}" did not start the work: ${String(r.output || '').trim().split('\n').pop() || 'it said nothing'}`)
      }

      to.good(`${name} is working on ${id}${rules ? `, under ${path.basename(path.resolve(String(contract)))}` : ''}`)
      return {
        run: id,
        machine: name,
        folder: where,
        // Said plainly, because "no rules" is the dangerous one and it is also
        // the silent one -- a run without a contract looks exactly like a run
        // with one from everywhere except here.
        contract: rules ? path.resolve(String(contract)) : null,
        watch: `okc.js vmSessionTail --name ${name}`,
        note: 'started, not finished — read its session for progress and vmRuns for the outcome'
      }
    }
  },

  // What has been given to a machine, and what became of it.
  //
  // A run with no status is reported as `running` rather than as a missing
  // field, because a caller that has to interpret an absence will eventually
  // interpret it as finished.
  vmRuns: {
    about: 'The tasks given to a machine, and whether they are still going',
    takes: ['name'],
    run: async ({ name }) => {
      vms.get(name)
      if (!channel.connected(name)) throw new Error(`"${name}" is not dialled in, so its runs cannot be read.`)
      const r = await channel.run(name, dispatch.list(), { what: 'reading its runs', timeout: 60000 })
      return { runs: dispatch.runs(r.output) }
    }
  },

  // What a run's own process printed.
  //
  // Different from the session transcript, and worth both: the transcript says
  // what the agent did, this says what happened to the program running it --
  // which is where a crash before it ever started thinking appears.
  vmRunOutput: {
    about: "The tail of one task's raw output",
    takes: ['name', 'run', 'lines'],
    run: async ({ name, run, lines = 40 }) => {
      vms.get(name)
      if (!run) throw new Error('Say which run.')
      if (!channel.connected(name)) throw new Error(`"${name}" is not dialled in.`)
      const r = await channel.run(name, dispatch.output(run, lines), { what: `reading ${run}`, timeout: 60000 })
      // Same boundary as the transcript: this is kept, so it is cleaned first.
      return { run, output: secret.redact(r.output) }
    }
  },

  // The Claude sessions running on a machine.
  //
  // A runner runs Claude Code, and Claude Code writes everything it does to a
  // transcript on that machine. Read over the channel, strictly read-only.
  vmSessions: {
    about: 'The Claude sessions on a machine, newest first',
    takes: ['name'],
    run: async ({ name }) => {
      vms.get(name)
      if (!channel.connected(name)) throw new Error(`"${name}" is not dialled in, so its sessions cannot be read.`)
      const r = await channel.run(name, session.command('list'), { what: 'reading its claude sessions', timeout: 60000 })
      return session.answer(r.output)
    }
  },

  // What a session has done since you last looked.
  //
  // A DELTA, and the bookmark is the point. `since` is a line number in the
  // transcript and comes back as `bookmark`; pass it in next time. A watcher
  // that re-reads from the top spends its whole context re-deriving what it
  // already reported, which for a task running for an hour is most of it.
  //
  // Only what is worth reporting: what it ran, what it wrote, what it was asked,
  // and the lines of a result that carry a verdict. A tool result is tens of
  // kilobytes and almost none of it is news.
  vmSessionTail: {
    about: 'What a machine\'s Claude session has done since a bookmark',
    takes: ['name', 'session', 'since', 'limit'],
    run: async ({ name, session: which = '', since = 0, limit = 40 }) => {
      vms.get(name)
      if (!channel.connected(name)) throw new Error(`"${name}" is not dialled in, so its session cannot be read.`)
      const r = await channel.run(name, session.command('tail', [which, since, limit]), { what: 'reading its session', timeout: 120000 })
      const out = session.answer(r.output)
      if (!out.ok) throw new Error(out.error + (out.sessions ? ` — ${out.sessions.map(s => `${s.id.slice(0, 8)} (${s.title || 'untitled'})`).join(', ')}` : ''))
      return out
    }
  },

  // What a machine is holding that exists nowhere else.
  //
  // For the two actions that destroy a machine's disk. "Everything since is
  // discarded" and "its disks are deleted" are both true and neither says WHAT,
  // so the question they raise -- is there work in there? -- is left to be
  // answered by remembering. This asks the machine instead, which takes about a
  // second.
  //
  // NOT ASKED is its own answer and is reported as one. A machine that is not
  // dialled in cannot be asked, and if that returned an empty list it would read
  // as "nothing to lose" -- which is the most dangerous thing this could say,
  // because a machine that is off is exactly the one nobody has looked at
  // recently. Silence must not be able to mean two different things.
  vmHolds: {
    about: 'What a machine is holding that is not here: commits not pushed, and files not committed',
    takes: ['name'],
    run: async ({ name }) => {
      const vm = vms.get(name)
      if (!channel.connected(name)) {
        return { asked: false, why: `"${name}" is not dialled in, so it cannot be asked what it is holding.`, repos: [] }
      }

      const folder = (vm.spec && vm.spec.folder) || workspace.FOLDER
      // One line per repository, in a shape that is read rather than parsed out
      // of prose -- and nothing at all when there is no workspace, which is a
      // real answer and not a failure.
      const script = `set -u
WS="${folder}"
[ -d "$WS" ] || exit 0
for d in "$WS"/*/; do
  [ -d "$d/.git" ] || continue
  cd "$d" || continue
  name=$(basename "$d")
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)
  # A repository with no upstream has nothing to be ahead OF, so counting
  # @{upstream}..HEAD fails and answers zero -- which reads as nothing to lose
  # about a repository whose every commit exists only here. Untracked means all
  # of it, not none of it.
  if git rev-parse --abbrev-ref '@{upstream}' >/dev/null 2>&1; then
    ahead=$(git rev-list --count '@{upstream}..HEAD' 2>/dev/null || echo 0)
    tracked=yes
  else
    ahead=$(git rev-list --count HEAD 2>/dev/null || echo 0)
    tracked=no
  fi
  dirty=$(git status --porcelain 2>/dev/null | grep -c . || echo 0)
  echo "okc-holds|$name|$branch|$ahead|$dirty|$tracked"
done`

      const r = await channel.run(name, script, { what: 'what it is holding', timeout: 60000 })
      const repos = String(r.output || '').split('\n')
        .map(l => l.trim()).filter(l => l.startsWith('okc-holds|'))
        .map(l => l.split('|'))
        .map(([, repo, branch, ahead, dirty, tracked]) => ({
          repo,
          branch,
          ahead: Number(ahead) || 0,
          dirty: Number(dirty) || 0,
          // Whether those commits are counted against a copy here or are simply
          // all of them. It changes what the number means, so it travels with it.
          tracked: tracked !== 'no'
        }))

      const commits = repos.reduce((n, r) => n + r.ahead, 0)
      const files = repos.reduce((n, r) => n + r.dirty, 0)

      // What it is ALLOWED to push, against what it is actually on.
      //
      // Those are different claims and only the first was ever recorded here.
      // The details panel says "may push fix/thing", which is true and is a
      // permission -- it says nothing about where the machine's work actually
      // is. A machine sitting on another branch is not dangerous, because the
      // push refuses; it is just a machine whose work has nowhere to go, and
      // nothing said so until somebody tried.
      //
      // Only checked where it can be: here, where the machine has just answered.
      const elsewhere = repos.filter(r => vm.branch && r.branch !== vm.branch)
      return {
        asked: true,
        repos,
        commits,
        files,
        mayPush: vm.branch || null,
        elsewhere: elsewhere.map(r => `${r.repo} is on ${r.branch}`),
        adrift: elsewhere.length
          ? `${name} may push ${vm.branch}, but ${elsewhere.map(r => `${r.repo} is on ${r.branch}`).join(' and ')} — work there cannot be pushed until it is on ${vm.branch}.`
          : null,
        // Said once, here, so every caller says it the same way.
        summary: commits || files
          ? [
              commits ? `${commits} commit${commits === 1 ? ' that exists' : 's that exist'} nowhere else` : null,
              files ? `${files} file${files === 1 ? '' : 's'} changed and not committed` : null
            ].filter(Boolean).join(', ')
          : null
      }
    }
  },

  // ---- tasks: what is to be done, and what came back ---------------------
  //
  // The other half of this tool. One side manages machines; this side manages
  // work, and the two meet at exactly one point -- a task is GIVEN to a machine.
  // Neither knows anything else about the other, which is what lets a machine be
  // destroyed mid-task without the task going with it.
  //
  // THE ARTIFACT IS A BRANCH. A task is not done when its worker stops talking,
  // it is done when something arrived here that can be read -- so `delivered` is
  // read from the repositories rather than stored, and a run that exited cleanly
  // having pushed nothing has produced nothing to judge.

  tasks: {
    about: 'The board: every task, newest first, and whether its branch has anything on it yet',
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
    takes: ['task'],
    run: ({ task }) => {
      const input = typeof task === 'string' ? JSON.parse(task) : task
      if (!input || typeof input !== 'object') throw new Error('Pass the task as an object.')
      const why = branches.nameIsOk(String(input.branch || '').trim())
      if (why) throw new Error(why)
      if (input.contract) {
        const at = path.resolve(String(input.contract))
        if (!fs.existsSync(at)) throw new Error(`There is no contract at ${at}. It is read from this host when the task is given out.`)
      }
      return tasks.add(input)
    }
  },

  taskUpdate: {
    about: 'Change a task that has not been given out yet',
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
    takes: ['id'],
    run: async ({ id }) => {
      const task = tasks.get(id)
      if (task.verdict) throw new Error(`#${task.number} has already been judged. Write a new task rather than reopening a decided one.`)
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

  vmRunStop: {
    about: 'Stop a run on a machine, and everything it started',
    takes: ['name', 'run'],
    run: async ({ name, run }) => {
      vms.get(name)
      if (!run) throw new Error('Say which run.')
      if (!channel.connected(name)) throw new Error(`"${name}" is not dialled in.`)

      const r = await channel.run(name, dispatch.stop(String(run)), { what: `stopping ${run}`, timeout: 60000 })
      const said = String(r.output || '')
      const how = said.includes('okc-stop-done') ? 'stopped'
        : said.includes('okc-stop-gone') ? 'was already over'
          : said.includes('okc-stop-nopid') ? 'never recorded a pid, so nothing could be signalled'
            : said.includes('okc-stop-refused') ? 'would not die'
              : 'did not answer'

      if (how === 'would not die' || how === 'did not answer') {
        throw new Error(`${run} ${how}. Look at the machine — something there is ignoring both TERM and KILL.`)
      }
      log.on('vm', name).warn(`${run} ${how}`)
      return {
        name,
        run,
        outcome: how,
        // Said plainly, because a stopped run is not a failed one and the
        // difference matters when somebody reads the board tomorrow: it has no
        // result because it was stopped, not because it went wrong.
        note: 'It reads as `lost` from here on — no result, and nothing left to produce one. The queue puts the machine away as it would for any ended run.'
      }
    }
  },

  taskUnqueue: {
    about: 'Take a task back out of the queue. Does not stop one already running',
    takes: ['id'],
    run: ({ id }) => {
      const task = tasks.get(id)
      if (task.state !== 'queued') throw new Error(`#${task.number} is "${task.state}", not queued. A task already given out is not called back by this — the worker is running and would have to be stopped on its machine.`)
      return tasks.update(id, { state: 'draft' })
    }
  },

  queueState: {
    about: 'What the queue is doing, and which machines could take work',
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
    takes: ['id'],
    // Never cached: this is what somebody judges from, and reading a
    // four-second-old picture of a branch is exactly the wrong moment to.
    run: ({ id }) => artifact.read(tasks.get(id).branch, { fresh: true })
  },

  taskDiff: {
    about: 'One repository\'s changes on a task\'s branch, in full',
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

  // ---- a picture of the window itself ------------------------------------
  //
  // `vmScreenshot` answers "what is that machine doing"; this answers "what does
  // this app actually look like", which had no answer at all. Everything in the
  // Tasks tab was built and driven from a terminal, and the only visual fault
  // found so far was found by a person's eye — a misspelt CSS class produces no
  // error, so a panel can be wrong in a way nothing reports.
  //
  // ASKED HERE, TAKEN THERE. `capturePage` exists only in the window: the node
  // side has no page to photograph. So this leaves a request, and the window
  // notices it on its next draw and answers. That is why it returns a path
  // rather than an image — the file appears a second or two later.
  windowShot: {
    about: 'Ask the window to photograph itself, optionally on a given tab',
    takes: ['note', 'view'],
    run: ({ note, view }) => {
      const file = path.join(data.sub('window'), `window-${data.stamp()}.png`)
      // WHICH TAB, because otherwise only the one that happens to be open can
      // ever be checked. The window is the single part of this that fails
      // silently -- a class that matches no rule, a panel that stopped updating,
      // both of which have happened here -- and photographing it was the answer.
      // But a panel behind a tab nobody clicked is exactly as unverifiable as it
      // was before, and every new tab arrived that way: built, reasoned about,
      // and photographed only once somebody thought to switch to it.
      wantedShot = { file, note: note || null, view: view || null, asked: Date.now() }
      return {
        file,
        view: view || null,
        note: 'The window takes it on its next draw — up to twelve seconds if nobody is looking at it. Read the file once it appears.'
      }
    }
  },

  // Read by the window, and by nothing else. Kept in the table rather than
  // hidden, because the table is what says an action exists.
  windowShotPending: {
    about: 'Whether a picture of the window has been asked for',
    run: () => wantedShot || { file: null }
  },

  windowShotDone: {
    about: 'The window reporting that it took the picture',
    takes: ['file', 'bytes', 'error'],
    run: ({ file, bytes, error }) => {
      wantedShot = null
      if (error) log.on('window').bad(`could not photograph itself: ${error}`)
      else log.on('window').good(`window saved to ${file} (${bytes} bytes)`)
      return { ok: !error }
    }
  },

  // ---- pre-defined work, declared the way tests are declared -------------
  //
  // The drills used to be prose in TEST-PLAN.md, which a person read and typed
  // out. Prose cannot report a status, cannot be listed in a window, and rots
  // against the code it describes. Declared with describe/it they can be
  // enumerated, chosen, run one at a time, and watched.
  //
  // Listing must be free of side effects: opening the dialog is not consent to
  // run anything.

  planned: {
    about: 'Pre-defined tasks and drills, whether each is approved, and its source',
    run: () => {
      const suites = harness.getRegisteredSuites().map(s => ({
        ...s,
        tests: s.tests.map(t => ({ ...t, ...approval.stateOf(s.name, t.name, t.fingerprint) }))
      }))
      const all = suites.flatMap(s => s.tests)
      return {
        suites,
        approved: all.filter(t => t.approved).length,
        waiting: all.filter(t => !t.approved && !t.lapsed).length,
        lapsed: all.filter(t => t.lapsed).length,
        note: 'A model writes these; a person approves them. Half pass by being REFUSED.'
      }
    }
  },

  // Ratifying a definition. A person's act, and the reason it is separate.
  //
  // The supervising model writes these -- that is what it is for -- and a
  // definition it could also approve would be work reviewed by nobody. So the
  // one thing it may not do is sign off its own writing, and this refuses to
  // happen down the socket a supervisor drives.
  plannedApprove: {
    about: 'Approve a pre-defined task, after reading it. From the window only',
    takes: ['suite', 'name', 'note'],
    run: ({ suite, name, note, _overTheWire }) => {
      if (_overTheWire) {
        throw new Error('Approving is done in the window, by a person reading the definition. It is deliberately not available here — this is the socket a supervising session drives, and a definition approved by whatever wrote it has been reviewed by nobody.')
      }
      const found = harness.getRegisteredSuites()
        .flatMap(s => s.tests.map(t => ({ suite: s.name, ...t })))
        .find(t => t.name === name && (!suite || t.suite === suite))
      if (!found) throw new Error(`Nothing registered called "${name}".`)
      return approval.approve(found.suite, found.name, found.fingerprint, note)
    }
  },

  // Asking for a change to be looked at. The half a model IS allowed.
  //
  // Deliberately available over the socket, unlike approving. A model may edit a
  // definition and may ask for the edit to be read; what it may not do is decide
  // the edit is alright. Without this the change still lapses the approval, but
  // it arrives as a bare "this is different" with the reason living in a chat
  // log somebody may never see — so the reader is left diffing source in their
  // head to work out whether they care.
  plannedRequest: {
    about: 'Ask for a changed definition to be read again, and say why',
    takes: ['suite', 'name', 'why'],
    run: ({ suite, name, why }) => {
      const found = harness.getRegisteredSuites()
        .flatMap(s => s.tests.map(t => ({ suite: s.name, ...t })))
        .find(t => t.name === name && (!suite || t.suite === suite))
      if (!found) throw new Error(`Nothing registered called "${name}".`)
      return approval.request(found.suite, found.name, found.fingerprint, why)
    }
  },

  plannedWithdraw: {
    about: 'Take an approval back',
    takes: ['suite', 'name'],
    run: ({ suite, name, _overTheWire }) => {
      if (_overTheWire) throw new Error('Withdrawing an approval is done in the window, for the same reason granting one is.')
      return approval.withdraw(suite, name)
    }
  },

  plannedRun: {
    about: 'Run a pre-defined task or drill, and report what happened',
    takes: ['name', 'suite', 'machine', 'minutes'],
    run: async ({ name, suite, machine, minutes = 20 }) => {
      // Named rather than "run everything". Some of these take ten minutes and
      // occupy a machine, and a button that quietly starts all of them is a
      // button nobody can safely press.
      if (!name && !suite) throw new Error('Say which drill, or which suite. There is no "run all" here on purpose — some of these occupy a machine for ten minutes.')

      // Nothing unapproved runs, whoever is asking.
      //
      // Checked here rather than only in the window, because the window is a
      // courtesy and this is the boundary. A supervising session may pick from
      // the plan and run it; what it may not do is run something a person has
      // not read -- including something it wrote itself five minutes ago.
      const registered = harness.getRegisteredSuites()
        .flatMap(s => s.tests.map(t => ({ suite: s.name, ...t })))
        .filter(t => (!name || t.name === name) && (!suite || t.suite === suite))
      if (!registered.length) throw new Error(`Nothing matched${name ? ` "${name}"` : ''}${suite ? ` in "${suite}"` : ''}. Ask "planned" for the list.`)

      const blocked = registered
        .map(t => ({ ...t, ...approval.stateOf(t.suite, t.name, t.fingerprint) }))
        .filter(t => !t.approved)
      if (blocked.length) {
        throw new Error(blocked.map(t => `"${t.name}" ${t.why}`).join('; ') + '. Approve it in the window, after reading what it does.')
      }

      const to = log.on('drill', ...(machine ? [machine] : []))
      const okc = async (action, args = {}) => {
        const found = actions[action]
        if (!found) throw new Error(`No action called "${action}"`)
        return found.run(args)
      }

      // Given to the tests rather than imported by them, so a drill polls
      // through one shape and the timeout is stated in minutes where a person
      // reads it instead of in milliseconds where a person mistypes it.
      const waitFor = async (get, done, { what = 'something', minutes: mins = 10, every = 10000 } = {}) => {
        const deadline = Date.now() + mins * 60000
        for (;;) {
          const seen = await get()
          if (done(seen)) return seen
          if (Date.now() > deadline) throw new Error(`Waited ${mins} minutes for ${what} and it did not happen`)
          await new Promise(r => setTimeout(r, every))
        }
      }

      const started = Date.now()
      const result = await harness.run({
        okc,
        waitFor,
        machine: machine || null,
        log: line => to.info(String(line)),
        timeoutMs: Math.max(1, Number(minutes) || 20) * 60000,
        // Reported as it happens, into the same live log as everything else,
        // because a drill that takes ten minutes and says nothing until the end
        // is indistinguishable from one that has hung.
        onTestUpdate: ({ testName, status, error }) => {
          if (status === 'running') to.info(`running: ${testName}`)
          else if (status === 'passed') to.good(`passed: ${testName}`)
          // Could not run is a note, not a fault: it says something about the
          // moment rather than about the code, and colouring it red is how a
          // suite teaches somebody to ignore red.
          else if (status === 'unrunnable') to.warn(`could not run: ${testName} — ${error}`)
          else to.bad(`FAILED: ${testName} — ${String(error || '').split('\n')[0]}`)
        },
        testFilter: (t, s) => (!name || t === name) && (!suite || s === suite)
      })

      if (!result.suites.length) throw new Error(`Nothing matched${name ? ` "${name}"` : ''}${suite ? ` in "${suite}"` : ''}. Ask "planned" for the list.`)
      return { ...result, seconds: Math.round((Date.now() - started) / 1000) }
    }
  },

  // The way in when the way in has stopped working.
  //
  // THIS IS THE BACK DOOR, and it is the reason an ssh key is put on every
  // machine at build time. Everything else here talks to a machine through its
  // agent — which is exactly the thing that is broken when you most need to look
  // inside. A silent agent is indistinguishable from a dead machine from this
  // side, and the difference is written in the guest's own journal.
  //
  // That is not hypothetical: an agent was found awake, correctly diagnosing its
  // own lost connection, writing so to its journal, and stuck. Nothing on this
  // side could have said that. One `journalctl -u okc-agent` did.
  //
  // The address comes from the registry rather than the channel, deliberately.
  // Asking the agent where it lives is no use when the agent is the problem, so
  // it is recorded every time a machine dials in and used long afterwards.
  vmShell: {
    about: 'How to ssh into a machine — the way in when its agent has stopped answering',
    takes: ['name'],
    run: ({ name }) => {
      const vm = vms.get(name)
      const agent = channel.list().find(a => a.vm === name)

      // Live first, remembered second. They are usually the same; when they are
      // not, the live one is right and the remembered one is what there is.
      const live = agent ? String(agent.from || '').replace(/^::ffff:/, '').replace(/:\d+$/, '') : null
      const address = live || vm.lastAddress || null
      const user = (agent && agent.facts && agent.facts.user) || vm.lastUser || (vm.spec && vm.spec.user) || null

      if (!address) {
        throw new Error(`Nothing knows where "${name}" is. It has to have dialled in at least once for its address to be recorded — start it and wait, or look in VirtualBox.`)
      }

      // Kept current here, because this is the moment somebody is about to use
      // it — and an alias pointing at an address a machine no longer has is
      // worse than no alias at all.
      try { actions.sshConfig.run({}) } catch { /* the direct target below still works */ }

      const alias = ssh.aliasFor(name)
      return {
        name,
        user,
        address,
        alias,
        // The app's key ONLY IF THIS MACHINE WOULD ACCEPT IT.
        //
        // Forcing it unconditionally broke the way into every machine built
        // before the key existed: they have somebody else's public half in their
        // authorized_keys, and insisting on this one turned a working back door
        // into "Permission denied" — on the machines most likely to need one.
        //
        // So it is offered where it fits and ssh is left to its own devices
        // where it does not, which is exactly what happened before. A machine
        // built with the operator's key is still reached with the operator's
        // key; the change only ever applies to machines built since.
        identity: (ssh.have() && vm.spec && vm.spec.sshKey &&
                   String(vm.spec.sshKey).trim() === String(ssh.publicKey() || '').trim())
          ? ssh.KEY()
          : null,
        // Both, because they answer different questions: one to run, one to
        // paste somewhere else.
        target: `${user}@${address}`,
        command: `ssh ${alias}`,
        live: !!live,
        note: live
          ? 'Its agent is answering, so vmRun would work too — this is for looking at things the agent cannot tell you.'
          : `Not dialled in. This address is where it was last seen${vm.lastSeenAt ? ` (${new Date(vm.lastSeenAt).toLocaleString()})` : ''}, which is the whole reason it was written down.`
      }
    }
  },

  // The back door, used rather than described.
  //
  // `vmShell` says how to get in; this goes in. THE DIFFERENCE FROM `vmRun` IS
  // WHAT IT DOES NOT NEED: vmRun speaks to the agent, and the agent is precisely
  // the thing that is broken when somebody wants to look inside a machine. It
  // also cannot hold a long command — the agent answers this host's beats from
  // the same loop that runs the command, so anything slow makes it look dead,
  // and the connection is dropped underneath the work. That is not theory; it is
  // what happened trying to run one headless prompt.
  //
  // ssh has neither problem. It is already provisioned, it is how the Terminal
  // tab and VS Code get in, and it keeps its own connection.
  //
  // NOT A SHELL FOR A PERSON — that is the Terminal tab, which needs a terminal
  // this side does not have. This is one command, run to completion, output
  // returned.
  vmShellRun: {
    about: 'Run one command on a machine over ssh — works when its agent does not',
    takes: ['name', 'command', 'timeout', 'input'],
    run: async ({ name, command, timeout, input = null }) => {
      if (!command) throw new Error('There is no command to run.')
      // Coerced, because everything that arrives from the command line or over
      // the wire is a string, and execFile rejects a string timeout with an
      // error about unsigned integers that says nothing about where it came from.
      timeout = Number(timeout) || 120000
      const where = actions.vmShell.run({ name })
      const { execFile } = require('node:child_process')

      const args = [
        // No pty. A command that finishes is not an interactive session, and
        // -tt would wrap the output in whatever a terminal was asked to draw.
        '-o', 'BatchMode=yes',
        '-o', 'StrictHostKeyChecking=accept-new',
        ...(where.identity ? ['-o', `IdentityFile=${String(where.identity).split('\\').join('/')}`, '-o', 'IdentitiesOnly=yes'] : []),
        where.target,
        // A LOGIN SHELL, because that is where a guest's PATH is set. Without it
        // `claude`, `node` and anything else installed per-user is simply not
        // found, and the answer is "command not found" rather than the real one.
        'bash -lc ' + `'${String(command).replace(/'/g, `'\\''`)}'`
      ]

      log.on('vm', name).info(`over ssh: ${String(command).split('\n')[0].slice(0, 80)}`)

      return await new Promise((resolve, reject) => {
        const child = execFile('ssh', args, { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
          // REDACTED ON THE WAY IN, like every other thing a machine says. A
          // command run here can print an environment, and this output is
          // returned to a window and to a supervising session that keeps it.
          const output = secret.redact(`${stdout || ''}${stderr || ''}`)
          if (err && err.killed) return reject(new Error(`"${name}" did not finish that within ${Math.round(timeout / 1000)}s. Output so far:\n${output}`))
          resolve({
            name,
            target: where.target,
            // A non-zero exit is an ANSWER, not a failure of this action: `grep`
            // finding nothing is exit 1 and is exactly what was asked.
            exit: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
            output
          })
        })

        // WHATEVER IS BEING SENT GOES DOWN STDIN, NOT ARGV.
        //
        // A command line is not a transport. Windows caps the whole line at
        // about 32k, and a file of any size base64'd into an argument reaches
        // the far end TRUNCATED IN THE MIDDLE OF A QUOTE — where the shell
        // reports "unexpected EOF" and says nothing about length, so it reads as
        // a quoting mistake. Which is what it looked like, until the same
        // quoting worked for a smaller file.
        if (input != null) child.stdin.end(input)
        else child.stdin.end()
      })
    }
  },

  // Open a virtual machine's work in VS Code, over its own remote.
  //
  // The address is not configured, discovered or looked up: the machine dialled
  // in, so we already know where it is, and a machine that moved has already
  // said so. That is why this needs it CONNECTED rather than merely running --
  // running means VirtualBox has it powered on, which says nothing about there
  // being an address to open.
  //
  // The folder is asked for rather than assumed. A home directory is `/home/<user>`
  // on most machines and not on all of them, and the cost of guessing is a button
  // that opens the wrong folder, or an empty one, without saying it did.
  vmEditor: {
    about: "Open a machine's work in VS Code, over ssh",
    takes: ['name', 'where'],
    run: async ({ name, where }) => {
      const vm = vms.get(name)
      const agent = channel.list().find(a => a.vm === name)
      if (!agent) throw new Error(`"${name}" is not dialled in, so there is no address to open. Start it and wait for it to connect.`)

      const facts = agent.facts || {}
      // The address it DIALLED IN FROM, not the first one it lists about itself.
      // Those are different questions: a machine reports every address it has,
      // and once docker is installed that includes a bridge address like
      // 172.17.0.1 which is real inside the machine and unreachable from here.
      // The socket's far end is the one address proven to work in this
      // direction, because a packet already came back along it.
      const address = String(agent.from || '').replace(/:\d+$/, '') || (facts.addresses || [])[0]
      const user = facts.user || (vm.spec && vm.spec.user)
      if (!address || !user) throw new Error(`"${name}" has not said enough about itself yet to open it.`)

      // Asked once, for one fixed thing, and joined here.
      //
      // The folder can be written `$HOME/workspace` -- that is what it is called
      // in the script that makes it -- but a folder-uri needs a real path. The
      // expansion is done in JS rather than by echoing the folder through a
      // shell, because a folder can be typed in a dialog and interpolating that
      // into a remote command is how a text field becomes a way to run things.
      //
      // Short timeout, because this is a button. The default is measured in half
      // hours, which is right for a setup script and wrong for someone waiting
      // with nothing on screen.
      const home = (await channel.run(name, 'printf "%s\\n" "$HOME"', { what: 'where its home is', timeout: 15000 }))
        .output.trim().split('\n').pop().trim()

      const folder = where || (vm.spec && vm.spec.folder) || workspace.FOLDER
      const dir = folder.replace(/^\$HOME\b/, home).replace(/^~(?=\/|$)/, home)

      // THROUGH THE ALIAS, not through user@address.
      //
      // VS Code runs plain `ssh <what it is given>` and takes the identity from
      // ssh's configuration. Given `okc@1.2.3.4` it would offer whatever the
      // operator's default identity is; given the alias it reads the block this
      // app wrote, which names this app's key and no other. Written just before
      // opening, because an alias pointing at an address the machine no longer
      // has is worse than none.
      try { actions.sshConfig.run({}) } catch { /* the alias may already be right */ }
      const alias = ssh.have() ? ssh.aliasFor(name) : `${user}@${address}`

      return editor.open({ dir, remote: alias, tags: [name] })
    }
  },

  capture: {
    about: 'Save what the window currently looks like: the markup, and a picture of it',
    takes: ['html', 'png'],
    run: async ({ html, png }) => {
      const dir = data.state()
      const file = path.join(dir, 'capture.html')
      fs.writeFileSync(file, String(html || ''))

      // Beside the markup and named the same, because they are one capture of
      // one moment and separating them is how a picture ends up being compared
      // against markup from ten minutes later. The markup says what the window
      // is made of; only the picture says what it looks like, and the faults
      // that matter here — a class matching no rule, a panel off the bottom of
      // the screen — are invisible in the first and obvious in the second.
      let image = null
      if (png) {
        try {
          image = path.join(dir, 'capture.png')
          fs.writeFileSync(image, Buffer.from(String(png), 'base64'))
        } catch (e) {
          image = null
          log.on('capture').warn(`the picture could not be saved: ${e.message}`)
        }
      }

      log.on('capture').good(`Saved what the window looks like to ${file}${image ? `, and a picture to ${image}` : ''}`)
      return { file, bytes: String(html || '').length, image }
    }
  },

  logSince: { about: 'Log lines after an id, and every tag in use', takes: ['since'], run: ({ since }) => ({ entries: log.since(since), tags: log.tags() }) },
  // What a machine could clone, and the address it would use. The address is
  // built from the same host lookup a guest is given for its scripts, because a
  // guest cannot reach us on loopback and an address that only works here is the
  // one mistake this is easy to make.
  gitRepos: {
    about: 'The repositories in the workspace that a machine can clone, and where from',
    takes: ['name'],
    run: async ({ name }) => {
      const found = repos.list()
      let host = null
      try { host = await vbox.hostAddress() } catch { /* said as null below */ }
      const vm = name ? vms.get(name) : null
      return {
        from: repos.DIR,
        host,
        repos: found.map(r => ({
          ...r,
          // Only spelled out for a named machine: the token is that machine's,
          // and a URL with somebody else's in it would not work anyway.
          url: host && vm
            ? `http://${vm.name}:${vm.spec.token}@${host}:${port}/git/${r.name}`
            : host ? `http://<machine>:<its token>@${host}:${port}/git/${r.name}` : null
        }))
      }
    }
  },

  // The only action that answers forever instead of once.
  //
  // An install is twenty-five minutes of silence and then everything at once, so
  // asking repeatedly either misses it or spends the whole time asking. `stream`
  // rather than `run` is what tells the socket to stay open; it is in this table
  // like everything else, because this table is what says an action exists and
  // one kept somewhere else would be missing from `okc` with no arguments.
  logWatch: {
    about: 'Follow the live log as it happens, until you stop it',
    takes: ['since'],
    stream: from => log.since(from || 0),
    subscribe: log.subscribe
  },

  logClear: { about: 'Empty the live log', run: () => { log.clear(); return { cleared: true } } }
}

// ---- serving ----------------------------------------------------------

// This port is for machines. Two things are on it, and both name the machine
// they are for and make it prove that:
//
//   /provision/*  a machine's own setup scripts, and its progress. Proved with
//                 the machine's token, or -- while it is still being installed
//                 and has no token yet -- the install ticket it was given on the
//                 installer's command line.
//   /git/*        the repositories, proved with the same token.
//
// There is deliberately no third entry. The actions used to be here behind a
// loopback check, and both the check and `body()` that parsed their arguments
// went with them: dead the moment the route did, and a helper kept "in case"
// is how a route grows back.

// Which machine is asking, by the token it was made with, or null.
//
// HTTP Basic because it is the one scheme git speaks with nothing installed in
// the guest: the credentials sit in the clone URL and git replays them on each
// request. The machine's name is the username, so a push -- when there is one --
// is attributable to a machine rather than to whoever could reach the port.
function machineAsking (req) {
  const m = /^Basic (.+)$/i.exec(req.headers.authorization || '')
  if (!m) return null
  const raw = Buffer.from(m[1], 'base64').toString('utf8')
  const at = raw.indexOf(':')
  if (at === -1) return null
  const name = raw.slice(0, at)
  const token = raw.slice(at + 1)
  // From the registry, so a machine this app did not make has no token that
  // works -- the same boundary every other action is drawn on.
  const vm = vms.read().find(v => v.name === name)
  return vm && vm.spec && vm.spec.token && vm.spec.token === token ? vm : null
}

// Which machine is asking for a machine's scripts, or null.
//
// TWO WAYS TO PROVE IT, because a machine's life has two halves and only the
// second has a secret in it.
//
// Once it has been built it holds its token, and that is the answer -- the same
// credential /git/* already takes.
//
// Before that it holds nothing at all: the script it is fetching is where the
// token comes from, which is the whole chicken-and-egg. So an install carries a
// TICKET, made when the install starts and put on the installer's command line,
// which is the one channel that reaches a machine with nothing on it.
//
// The ticket dies the moment the machine dials in. That matters because the
// command line outlives the install -- VirtualBox writes it into
// `vboxpostinstall.sh` in the machine's folder, where it sits for as long as the
// machine exists. A token there would be a live secret in a plain file; a spent
// ticket is a string that opens nothing.
//
// Named for a machine, always. "Is this a machine we know" is not the question;
// "is this THAT machine" is, and answering the first was how one machine could
// read another's token.
function guestAsking (req, url) {
  const name = url.searchParams.get('vm') || ''
  if (!name) return null

  let vm
  try { vm = vms.get(name) } catch { return null }

  const who = machineAsking(req)
  if (who && who.name === name) return vm

  const ticket = String(url.searchParams.get('ticket') || '')
  if (ticket && vm.installTicket && ticket === vm.installTicket) return vm

  return null
}

// One refusal, worded once. ASCII, because curl and wget put it in front of
// somebody with no other information about what went wrong.
function refuseGuest (res, name, why) {
  log.on('provision').warn(`refused ${why} for "${name || 'no machine named'}"`)
  res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
    .end('this asks for the machine it is for, and proof of being that machine.\nan installing machine proves it with its install ticket; a built one with its token.\n')
}

// Serving the workspace's repositories. Read-only for now: cloning is built and
// pushing is not, and the difference is stated rather than left to a 404 that
// would read as "no such repository".
function gitRoute (req, res, url) {
  const who = machineAsking(req)
  if (!who) {
    // Git asks once with no credentials and expects to be challenged -- that is
    // the handshake, and every ordinary clone does it. Warning about it puts a
    // line that reads as a fault in front of the operator twice per clone, so
    // only credentials that were OFFERED AND REFUSED are worth saying anything
    // about.
    if (req.headers.authorization) {
      log.on('git').warn(`refused ${url.pathname} from ${req.socket.remoteAddress} — no machine of this app answers to that name and token`)
    }
    res.writeHead(401, {
      'www-authenticate': 'Basic realm="the workspace repositories"',
      'content-type': 'text/plain'
    }).end('this asks for the name and token of a machine this app made\n')
    return
  }

  // `<name>` and `<name>.git` are both spelled by git clients; the same
  // repository answers to either.
  const rest = url.pathname.slice('/git/'.length)
  const cut = rest.indexOf('/')
  const repo = (cut === -1 ? rest : rest.slice(0, cut)).replace(/\.git$/, '')
  const tail = cut === -1 ? '' : rest.slice(cut)

  const dir = repos.gitDirOf(repo)
  if (!dir) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end(`no repository called "${repo}" in the workspace\n`)
    return
  }

  const service = tail === '/info/refs'
    ? url.searchParams.get('service')
    : (tail === '/git-upload-pack' && 'git-upload-pack') || (tail === '/git-receive-pack' && 'git-receive-pack')

  if (!repos.SERVICES[service]) {
    res.writeHead(400, { 'content-type': 'text/plain' }).end('this serves git\'s smart http protocol and nothing else\n')
    return
  }

  // A push may only ever land on the branch this machine was set up on, and the
  // rule is carried to git rather than checked here: the refs being pushed are
  // inside the packfile stream, so reading them at this layer would mean
  // implementing the protocol to find out. The hook sees them for free, and runs
  // on this host, where no guest can edit or skip it.
  //
  // Refused before any of that when there is no branch recorded, so the failure
  // is "you have not been set up" rather than a hook talking about a branch
  // nobody chose.
  //
  // ASCII ONLY for anything that crosses to a git client, and that is not
  // fussiness. Git relays a remote's message as raw bytes and transcodes
  // nothing, so an em-dash in this sentence reached the operator's terminal as
  // `â` -- a message about a refusal, itself looking broken. The live log is
  // ours and keeps its punctuation.
  const env = {}
  if (service === 'git-receive-pack') {
    if (!who.branch) {
      log.on('git', who.name).warn(`${who.name} tried to push to ${repo} without being set up on a branch`)
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
        .end('no branch is recorded for this machine.\nset it up on a branch from the dashboard, then push again.\nnothing was taken - your commits are still on your own copy.\n')
      return
    }
    // Checked again at the push, and not only when the machine was set up.
    // A machine set up before this rule existed still carries whatever branch it
    // was given, and a branch can become protected afterwards -- checking one
    // out on the host is enough. The recorded permission is therefore not
    // evidence on its own; it is re-read against the rule every time it is used.
    const guarded = branches.whyProtected(who.branch)
    if (guarded) {
      log.on('git', who.name).warn(`${who.name} tried to push ${who.branch}, which is protected`)
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
        .end(`refused: ${who.branch} is protected and cannot be pushed to.\nnothing was taken - your commits are still on your own copy.\n`)
      return
    }

    // Git refuses a push to a branch that is checked out, so a review left open
    // here would fail the machine's push for a reason that has nothing to do
    // with the machine -- and say so in terms of a configuration variable. If
    // that checkout is clean it is worth nothing, so this steps off it. If it is
    // not, the push is refused naming the work that is in the way, which is the
    // one thing the machine's own error could never have said.
    try {
      for (const f of branches.freeEverywhere(who.branch)) {
        if (f.busy) {
          log.on('git', who.name).warn(f.why)
          res.writeHead(409, { 'content-type': 'text/plain; charset=utf-8' })
            .end(`refused: ${f.why}\nnothing was taken - your commits are still on your own copy.\n`)
          return
        }
        if (f.freed) log.on('git', who.name).info(`${f.repo} was on ${f.from} here; moved it back to ${f.to} so the push can land`)
      }
    } catch (e) {
      log.on('git', who.name).warn(`could not clear the way for ${who.branch}: ${e.message}`)
    }

    env.OKC_ALLOW_BRANCH = who.branch
    env.OKC_MACHINE = who.name
  }

  if (tail === '/info/refs') return repos.advertise(res, { dir, service, repo, env })
  return repos.rpc(req, res, { dir, service, repo, env })
}

function handler (req, res) {
  const url = new URL(req.url, 'http://localhost')

  // ---- what a guest talks to -----------------------------------------
  //
  // Plain GETs with no body, because they are called by curl inside an installer.

  if (url.pathname === '/provision/report') {
    const name = url.searchParams.get('vm') || ''
    if (!guestAsking(req, url)) return refuseGuest(res, name, 'a progress report')
    try { provisioner.report(name, url.searchParams.get('stage') || 'running') } catch { /* never worth an error */ }
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok\n')
    return
  }

  // A line from inside a machine, into the same live log as everything else. This
  // is what makes a long install watchable instead of silent.
  //
  // Authenticated like the rest, and it matters more here than it looks: this
  // writes into the operator's log wearing a machine's name, so without it
  // anything on the network could put convincing sentences in front of them and
  // sign them as a machine it is not.
  if (url.pathname === '/provision/say') {
    const name = url.searchParams.get('vm') || ''
    if (!guestAsking(req, url)) return refuseGuest(res, name, 'a line for the log')
    log.on('vm', name, 'guest').out(url.searchParams.get('text') || '')
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok\n')
    return
  }

  // Handing something over that is not a commit.
  //
  // A machine pushes here; this decides where it lands. THE GUEST SENDS A NAME
  // AND NOTHING ELSE -- no task, no branch, no directory -- because the host
  // already knows which task that machine is running and is the only side that
  // should be deciding. A guest that could name its destination could name
  // somebody else's, and the defence against a path would then be a list of
  // spellings of "the parent directory" that somebody has to keep complete.
  //
  // It is the same shape as everything else a guest talks to: prove which
  // machine you are, then be told what you get.
  if (url.pathname === '/artifact' && req.method === 'POST') {
    const name = url.searchParams.get('vm') || ''
    if (!guestAsking(req, url)) return refuseGuest(res, name, 'to hand over an artifact')

    const called = url.searchParams.get('name') || ''
    const why = files.whyNot(called)
    if (why) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end(`${why}\n`)
      return
    }

    // WHICH TASK IT BELONGS TO IS NOT ASKED, IT IS LOOKED UP. A machine is
    // running exactly one task or it is not running one at all, and an artifact
    // from a machine doing nothing has nowhere to belong -- so that is refused
    // with the reason rather than filed somewhere plausible.
    //
    // From the task record rather than from the queue, because the queue only
    // knows about work IT dispatched: a task handed straight to a named machine
    // with taskGive is just as real, and looking in the wrong place would have
    // refused every artifact from one. Both paths write the same two fields.
    const task = tasks.read().find(t => t.machine === name && t.state === 'given') || null
    if (!task) {
      res.writeHead(409, { 'content-type': 'text/plain; charset=utf-8' })
        .end('this machine is not running a task, so there is nothing for an artifact to belong to.\n')
      return
    }

    const chunks = []
    let size = 0
    let refused = false
    req.on('data', chunk => {
      if (refused) return
      size += chunk.length
      // Stopped at the door rather than after it is all in memory, because the
      // point of a cap is not to have accepted the thing it refuses.
      if (size > files.MOST) {
        refused = true
        res.writeHead(413, { 'content-type': 'text/plain; charset=utf-8' })
          .end(`the most this takes is ${files.MOST / 1048576} MB\n`)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (refused) return
      try {
        const kept = files.keep(task.uid, called, Buffer.concat(chunks), { run: task.run || null })
        log.on('vm', name, 'guest').good(`handed over "${called}" (${Math.round(kept.bytes / 1024)} KB) for #${task.number}`)
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('kept\n')
      } catch (e) {
        log.on('vm', name, 'guest').bad(`could not keep "${called}": ${e.message}`)
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end(`${e.message}\n`)
      }
    })
    return
  }

  // The agent, served exactly as it is on disk: it is python, so a shell header
  // would break it. Its values reach it through the service unit instead.
  if (url.pathname === '/provision/agent.py') {
    const name = url.searchParams.get('vm') || ''
    const asking = guestAsking(req, url)
    if (!asking) return refuseGuest(res, name, 'the agent')
    try {
      log.on('vm', name, 'guest').good(`${name} asked for the agent`)
      res.writeHead(200, { 'content-type': 'text/x-python' })
      res.end(scripts.raw(asking, 'agent'))
    } catch (e) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end(`# ${e.message}
`)
    }
    return
  }

  // Any script in provision/, by filename, so a swapped-in one is served the same
  // way as a default. The name is resolved inside that folder and nowhere else.
  //
  // THIS is the one that mattered. A script carries the machine's token, so
  // serving it to anyone that asked meant any machine could read any other
  // machine's secret and then be that machine -- dial in as it, push to its
  // branch. Encryption settled who could read it in transit and did nothing
  // about who could ask for it.
  if (url.pathname.startsWith('/provision/') && url.pathname.endsWith('.sh')) {
    const file = path.basename(url.pathname)
    const name = url.searchParams.get('vm') || ''
    const asking = guestAsking(req, url)
    if (!asking) return refuseGuest(res, name, file)
    try {
      const vm = asking
      const stage = scripts.stageOfFile(file)
      log.on('vm', name, 'guest').good(`${name} asked for ${file} (${scripts.sourceOf(scripts.fileFor(vm, scripts.stageOfFile(file) || file))}'s copy)`)
      vbox.hostAddress().catch(() => '127.0.0.1').then(host => {
        res.writeHead(200, { 'content-type': 'text/x-shellscript' })
        res.end(scripts.render(stage || file, vm, { hostAddress: host, port, channelPort, caPort, caFingerprint: keys.ensure().fingerprint }))
      })
    } catch (e) {
      log.on('vm', 'guest').bad(`something asked for ${file} as "${name}": ${e.message}`)
      res.writeHead(404, { 'content-type': 'text/plain' }).end(`# ${e.message}\n`)
    }
    return
  }

  if (url.pathname.startsWith('/git/')) return gitRoute(req, res, url)

  // ---- and nothing else ----------------------------------------------
  //
  // THE ACTIONS ARE NOT HERE. They were, on /api/*, answering loopback only --
  // and that check was the entire thing standing between anything that could
  // reach this port and an action that deletes a machine.
  //
  // A check is a line of code. It is right until somebody edits it, and it has
  // to keep being right for as long as the route exists. The actions now live on
  // a local socket, which cannot be reached from another machine at all: no
  // address to compare, no interface to bind by accident, nothing to keep
  // enforcing. The strongest version of a check is not needing one.
  //
  // That is the answer to a real question rather than a tidy-up. A machine here
  // may be running something that would start another machine if it could, and
  // "it cannot reach the actions" is a better sentence when nothing has to be
  // asked.
  //
  // What is left on this port is only what a machine legitimately needs, and
  // every bit of it now says which machine it is for and proves it.
  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('This serves machines: their setup scripts and their repositories.\nThe actions are not on this port at all.\n')
}

// Listens on every interface, because a guest on a bridged adapter reaches this
// host by its network address and loopback would be useless to it. Safe to do only
// because of the split above: what is reachable from the network is a guest asking
// for its own scripts, never an action.
function start ({ port: wanted = Number(process.env.PORT || 7373), host = process.env.HOST || '0.0.0.0' } = {}) {
  // Made on first start and kept. A machine is told to trust this authority, so
  // this is also the moment its address is checked against what the certificate
  // actually names -- see `status.tls`.
  const tls = keys.ensure()

  const server = https.createServer({ key: tls.key, cert: tls.cert }, handler)

  // The authority, in the clear, and nothing else ever. Written as its own
  // server rather than a path on the main one because a port cannot be both
  // encrypted and not -- and because the list of things reachable without
  // encryption should be visible in one place and be one item long.
  // ONE file. Not the fingerprint beside it, deliberately.
  //
  // Serving both here would look convenient and would be a trap: anything
  // fetching the authority and its fingerprint from the same unprotected place
  // has verified nothing -- whoever could substitute one could substitute the
  // other, and the check would pass while being worthless. The fingerprint has
  // to arrive by a route this one cannot touch, which is the installer's command
  // line, the window, or the command line here.
  const caServer = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url && req.url.startsWith('/ca.pem')) {
      res.writeHead(200, { 'content-type': 'application/x-pem-file' }).end(tls.ca)
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain' })
      .end('this serves ca.pem and nothing else. everything else is on the encrypted port,\nand the fingerprint to check this against does not come from here.\n')
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(wanted, host, async () => {
      port = server.address().port

      await new Promise(done => {
        caServer.once('error', e => { log.on('server').bad(`could not publish the authority: ${e.message}`); done() })
        caServer.listen(caPort, host, () => { caPort = caServer.address().port; done() })
      })
      try {
        const c = await channel.listen({
          tokenFor: name => (vms.read().find(v => v.name === name) || {}).spec?.token,
          // A machine that has dialled in has its token, so the ticket that got
          // it there is spent. Burned here rather than on a timer, because this
          // is the only moment anything knows the install actually finished.
          // Two things, both only knowable at this moment.
          //
          // The ticket is spent: the machine has a token now, so whatever
          // carried it here must not outlive that.
          //
          // And the address is REMEMBERED, because the moment you most want to
          // reach a machine is the moment it has stopped talking to you. It is
          // only knowable while connected — it is the far end of the socket —
          // and by the time somebody needs to ssh in and find out why the agent
          // is silent, there is no socket to ask.
          onHello: (name, seen = {}) => {
            try {
              vms.update(name, {
                installTicket: null,
                ...(seen.address ? { lastAddress: seen.address, lastUser: seen.user || null, lastSeenAt: new Date().toISOString() } : {})
              })
            } catch { /* it may already be gone */ }
          }
        })
        channelPort = c.port
      } catch (e) {
        log.on('channel').bad(`could not listen for machines dialling in: ${e.message}`)
      }

      // The same actions, for something on this machine that is not the window.
      // Not a port: a local socket cannot be reached from another machine at
      // all, so there is no address to check and no rule to keep enforcing.
      let local = null
      try {
        local = await ipc.listen(actions, { log })
        log.on('ipc').good(`Listening on ${local.address} — the same actions, for the terminal`)
      } catch (e) {
        // Worth continuing without: the window is in-process and does not need
        // it, so a dashboard with no command line is still a working dashboard.
        log.on('ipc').warn(`no command line: ${e.message}`)
      }

      // Started with the server, not with the window. A queued task should be
      // picked up because this process is running, not because somebody has the
      // dashboard open — the point of queueing work is that you can walk away
      // from it.
      queue.begin(actions, log)
      log.on('queue').info(`watching for queued work every ${queue.TICK / 1000}s`)

      // Said once, on the start that does it. Moving a machine registry out from
      // under a running app is not something to do quietly -- and on anybody
      // else's copy this is the start where it happens.
      const carried = data.tookOver()
      if (carried && carried.moved.length) {
        log.on('server').good(`moved ${carried.moved.length} state file(s) out of the repository and into ${carried.to}`)
      }
      if (carried && carried.left.length) {
        log.on('server').warn(`${carried.left.join(', ')} could not be moved out of ${carried.from} — there is already a file of that name in ${carried.to}, and the one already there is the live one`)
      }

      log.on('server').good(`Listening on port ${port} over TLS — scripts and repositories for machines being provisioned`)
      log.on('server').info(`The authority is published unencrypted on port ${caPort}, and is the only thing there`)

      // Said at startup rather than discovered when a machine cannot connect.
      // A certificate that no longer names this host's address fails as a
      // verification error inside a guest, which points nowhere near the cause.
      try {
        const where = await vbox.hostAddress()
        const s = keys.state(where)
        if (!s.ok || s.expiringSoon) log.on('server').warn(s.why)
        else log.on('server').info(`The certificate covers ${where} and is good for ${s.daysLeft} days`)
      } catch { /* no address to check against yet; status reports it either way */ }

      resolve({
        server,
        port,
        caPort,
        host,
        url: `https://127.0.0.1:${port}/`,
        ipc: local && local.address,
        stop: () => { if (local) local.close(); caServer.close(); return server.close() }
      })
    })
  })
}

module.exports = { start, actions, handler }

if (require.main === module) {
  start()
    .then(s => console.log(`Open ${s.url}`))
    .catch(e => { console.error(e.message); process.exit(1) })
}
