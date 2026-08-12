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
const data = require('./core/data')
const vbox = require('./machines/vbox')
const vms = require('./machines/vms')
const provisioner = require('./machines/provisioner')
const scripts = require('./machines/scripts')
const channel = require('./machines/channel')
const machines = require('./machines/store')
const { provision, reach } = require('./machines/provision')
const editor = require('./machines/editor')
const repos = require('./repos/serve')
const busy = require('./machines/busy')
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
  vmStart: { about: 'Start a virtual machine', takes: ['name', 'type'], run: ({ name, type }) => { vms.get(name); return busy.during(name, 'being started', () => vbox.start(name, type === 'headless' ? 'headless' : 'gui')) } },
  vmStop: { about: 'Shut a virtual machine down, or pull its power', takes: ['name', 'force'], run: ({ name, force }) => { vms.get(name); return busy.during(name, 'being shut down', () => vbox.stop(name, !!force)) } },
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
      // Refused while it is running. VirtualBox would store the machine's memory
      // beside its disk, so the snapshot arrives the size of the machine's RAM --
      // and it is a picture of something caught mid-thought rather than a point
      // worth coming back to. vmBaseSnapshot is the one that takes a running
      // machine, because it shuts it down first and starts it again after.
      if (!await vbox.isOff(name)) {
        throw new Error('Shut the machine down first — a snapshot taken while it is running stores its memory too, which makes it enormous. "Make a clean starting point" does the shutting down for you.')
      }
      await vbox.takeSnapshot(name, title.trim(), description || '')
      const vm = vms.get(name)
      vms.update(name, {
        baseSnapshot: vm.baseSnapshot || title.trim(),
        snapshots: { ...(vm.snapshots || {}), [title.trim()]: vm.branch || null }
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

  vmSnapshotRestore: {
    about: 'Go back to a snapshot, discarding everything since',
    takes: ['name', 'title'],
    run: ({ name, title }) => busy.during(name, 'being restored', async () => {
      const vm = vms.get(name)
      if (!await vbox.isOff(name)) throw new Error('Shut the machine down first — VirtualBox will not restore a snapshot while it is running.')
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
      vms.update(name, { branch })

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
  hostKeys: {
    about: 'Public ssh keys on this machine, to authorise on a new machine',
    run: async () => {
      const dir = path.join(require('node:os').homedir(), '.ssh')
      if (!fs.existsSync(dir)) return { keys: [] }
      const keys = fs.readdirSync(dir).filter(f => f.endsWith('.pub')).map(f => {
        const text = fs.readFileSync(path.join(dir, f), 'utf8').trim()
        return { file: f, key: text, comment: text.split(/\s+/).slice(2).join(' ') || f }
      })
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
      return {
        asked: true,
        repos,
        commits,
        files,
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

      return editor.open({ dir, remote: `${user}@${address}`, tags: [name] })
    }
  },

  capture: {
    about: 'Save what the window currently looks like, as rendered HTML',
    takes: ['html'],
    run: async ({ html }) => {
      const dir = process.env.OKC_STATE || path.join(__dirname, 'state')
      fs.mkdirSync(dir, { recursive: true })
      const file = path.join(dir, 'capture.html')
      fs.writeFileSync(file, String(html || ''))
      log.on('capture').good(`Saved what the window looks like to ${file}`)
      return { file, bytes: String(html || '').length }
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
          onHello: name => { try { vms.update(name, { installTicket: null }) } catch { /* it may already be gone */ } }
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
