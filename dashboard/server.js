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
const fs = require('node:fs')
const path = require('node:path')

const log = require('./core/log')
const vbox = require('./machines/vbox')
const vms = require('./machines/vms')
const provisioner = require('./machines/provisioner')
const scripts = require('./machines/scripts')
const channel = require('./machines/channel')
const machines = require('./machines/store')
const { provision, reach } = require('./machines/provision')
const editor = require('./machines/editor')
const repos = require('./repos/serve')

const started = new Date().toISOString()

// The port we actually ended up on. A guest is told to fetch its scripts from
// here, so this has to be what is really listening rather than a default.
let port = Number(process.env.PORT || 7373)
let channelPort = Number(process.env.OKC_CHANNEL_PORT || 7374)

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
      mine: vms.read().length
    })
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
  vmInstall: { about: 'Install an operating system, unattended, and run its provisioning scripts', takes: ['name'], run: ({ name }) => provisioner.install(name, { port }) },
  vmRemove: {
    about: 'Delete a virtual machine and its disks, and forget it',
    takes: ['name'],
    run: async ({ name }) => {
      vms.get(name)                      // refuses anything this app did not make
      // Before the machine goes, so nothing is left holding a session for something
      // that no longer exists -- and so a new machine of the same name cannot
      // inherit it.
      channel.drop(name, 'was deleted')
      const out = await vbox.destroy(name)
      return { ...out, ...vms.forget(name) }
    }
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
  vmStart: { about: 'Start a virtual machine', takes: ['name', 'type'], run: ({ name, type }) => { vms.get(name); return vbox.start(name, type === 'headless' ? 'headless' : 'gui') } },
  vmStop: { about: 'Shut a virtual machine down, or pull its power', takes: ['name', 'force'], run: ({ name, force }) => { vms.get(name); return vbox.stop(name, !!force) } },
  vmInfo: { about: 'Everything VirtualBox knows about one machine', takes: ['name'], run: ({ name }) => { vms.get(name); return vbox.info(name) } },

  vmSnapshots: { about: 'The snapshots a machine has, and which one it is on', takes: ['name'], run: ({ name }) => { vms.get(name); return vbox.snapshots(name) } },
  vmSnapshotTake: {
    about: 'Take a snapshot, with a title of your choosing',
    takes: ['name', 'title', 'description'],
    run: async ({ name, title, description }) => {
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
      if (!vm.baseSnapshot) vms.update(name, { baseSnapshot: title.trim() })
      return vbox.snapshots(name)
    }
  },
  // The point of a base snapshot is somewhere to get back to, and getting back to
  // one needs the machine off -- so this shuts it down, snapshots, and starts it
  // again. Doing it while running would store the memory too and make a much
  // larger snapshot of a machine mid-thought.
  vmBaseSnapshot: {
    about: 'Shut a machine down, snapshot it as a clean starting point, and start it again',
    takes: ['name', 'title'],
    run: async ({ name, title = 'base' }) => {
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
      vms.update(name, { baseSnapshot: title })
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
    }
  },

  vmSnapshotRestore: {
    about: 'Go back to a snapshot, discarding everything since',
    takes: ['name', 'title'],
    run: async ({ name, title }) => {
      vms.get(name)
      if (!await vbox.isOff(name)) throw new Error('Shut the machine down first — VirtualBox will not restore a snapshot while it is running.')
      await vbox.restoreSnapshot(name, title)
      return vbox.snapshots(name)
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
      const url = `http://${await vbox.hostAddress()}:${port}/provision/${file}?vm=${encodeURIComponent(name)}`

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
      return channel.run(name, `curl -fsSL '${url}' -o /tmp/okc-again.sh && ${run}`,
        { what: `${file} again${needsRoot ? ' (with sudo)' : ''}` })
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
      return { stage, file: path.basename(scripts.fileFor(vm, stage)), script: scripts.render(stage, vm, { hostAddress: host, port, channelPort }) }
    }
  },

  // Other machines, reached over ssh rather than made here.
  machines: { about: 'Machines reachable over ssh, as opposed to ones this app made', run: async () => ({ machines: machines.all() }) },
  machineAdd: { about: 'Add a machine', takes: ['machine'], run: ({ machine }) => machines.add(machine || {}) },
  machineRemove: { about: 'Forget a machine — nothing on it is touched', takes: ['id'], run: ({ id }) => machines.remove(id) },
  machineReach: { about: 'Does this machine answer', takes: ['id'], run: ({ id }) => reach(machines.get(id)) },
  provision: { about: "Run a machine's setup steps, in order, stopping at the first failure", takes: ['id', 'steps'], run: ({ id, steps }) => provision(machines.get(id), steps) },
  openEditor: { about: 'Open a folder in VS Code, here or over ssh', takes: ['id', 'where'], run: ({ id, where }) => editor.open(machines.get(id), where) },

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

  logClear: { about: 'Empty the live log', run: () => { log.clear(); return { cleared: true } } }
}

// ---- serving ----------------------------------------------------------

const body = req => new Promise((resolve, reject) => {
  let s = ''
  req.on('data', c => { s += c; if (s.length > 1 << 20) reject(new Error('Too much data')) })
  req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}) } catch { reject(new Error('That was not valid JSON')) } })
})

// A machine being provisioned reaches us across the network, so we cannot only
// listen on loopback. But the actions can delete a virtual machine, so they are
// not offered across the network either.
//
// Three answers to "who is this for", because there turned out to be three
// questions:
//
//   /provision/*  anyone. All a guest can do with it is read its own setup
//                 scripts and report progress.
//   /git/*        a machine THIS APP MADE, proving it with the token it was
//                 given when it was made -- the same secret it dials in with.
//                 These are the actual source, not a setup script, so "anyone"
//                 is too many; and a guest reaches us across the network, so
//                 "loopback only" is nobody.
//   /api/*        loopback only. These can delete a machine.
const isLocal = req => {
  const from = req.socket.remoteAddress || ''
  return from === '127.0.0.1' || from === '::1' || from === '::ffff:127.0.0.1'
}

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

  // Said plainly and with the right status, because the alternative is a machine
  // reporting that a push failed for a reason nobody can act on.
  if (service === 'git-receive-pack') {
    log.on('git', who.name).warn(`${who.name} tried to push to ${repo}; pushing is not built yet`)
    res.writeHead(403, { 'content-type': 'text/plain' })
      .end('this server does not accept pushes yet — cloning is built, pushing is not\n')
    return
  }

  if (tail === '/info/refs') return repos.advertise(res, { dir, service, repo })
  return repos.rpc(req, res, { dir, service, repo })
}

function handler (req, res) {
  const url = new URL(req.url, 'http://localhost')

  // ---- what a guest talks to -----------------------------------------
  //
  // Plain GETs with no body, because they are called by curl inside an installer.

  if (url.pathname === '/provision/report') {
    const name = url.searchParams.get('vm') || ''
    try { provisioner.report(name, url.searchParams.get('stage') || 'running') } catch { /* never worth an error */ }
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok\n')
    return
  }

  // A line from inside a machine, into the same live log as everything else. This
  // is what makes a long install watchable instead of silent.
  if (url.pathname === '/provision/say') {
    const name = url.searchParams.get('vm') || ''
    if (vms.read().some(v => v.name === name)) log.on('vm', name, 'guest').out(url.searchParams.get('text') || '')
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok\n')
    return
  }

  // The agent, served exactly as it is on disk: it is python, so a shell header
  // would break it. Its values reach it through the service unit instead.
  if (url.pathname === '/provision/agent.py') {
    const name = url.searchParams.get('vm') || ''
    try {
      const vm = vms.get(name)
      log.on('vm', name, 'guest').good(`${name} asked for the agent`)
      res.writeHead(200, { 'content-type': 'text/x-python' })
      res.end(scripts.raw(vm, 'agent'))
    } catch (e) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end(`# ${e.message}
`)
    }
    return
  }

  // Any script in provision/, by filename, so a swapped-in one is served the same
  // way as a default. The name is resolved inside that folder and nowhere else.
  if (url.pathname.startsWith('/provision/') && url.pathname.endsWith('.sh')) {
    const file = path.basename(url.pathname)
    const name = url.searchParams.get('vm') || ''
    try {
      const vm = vms.get(name)
      const stage = scripts.stageOfFile(file)
      log.on('vm', name, 'guest').good(`${name} asked for ${file} (${scripts.sourceOf(scripts.fileFor(vm, scripts.stageOfFile(file) || file))}'s copy)`)
      vbox.hostAddress().catch(() => '127.0.0.1').then(host => {
        res.writeHead(200, { 'content-type': 'text/x-shellscript' })
        res.end(scripts.render(stage || file, vm, { hostAddress: host, port, channelPort }))
      })
    } catch (e) {
      log.on('vm', 'guest').bad(`something asked for ${file} as "${name}": ${e.message}`)
      res.writeHead(404, { 'content-type': 'text/plain' }).end(`# ${e.message}\n`)
    }
    return
  }

  // ---- the live log --------------------------------------------------

  if (url.pathname.startsWith('/git/')) return gitRoute(req, res, url)

  if (url.pathname === '/api/log/stream') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
    for (const e of log.since(url.searchParams.get('since'))) res.write(`data: ${JSON.stringify(e)}\n\n`)
    const stop = log.subscribe(e => res.write(`data: ${JSON.stringify(e)}\n\n`))
    const beat = setInterval(() => res.write(': beat\n\n'), 25000)
    req.on('close', () => { stop(); clearInterval(beat) })
    return
  }

  // ---- the actions ---------------------------------------------------

  if (url.pathname.startsWith('/api/')) {
    if (!isLocal(req)) {
      log.on('server').warn(`refused ${url.pathname} from ${req.socket.remoteAddress} — the actions are for this machine only`)
      res.writeHead(403, { 'content-type': 'text/plain' }).end('the actions are for this machine only\n')
      return
    }
    const name = url.pathname.slice(5)
    const action = actions[name]
    const send = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json' })
      res.end(JSON.stringify(obj))
    }
    if (!action) return send(404, { error: `No action called "${name}"`, actions: Object.keys(actions) })

    // GET is allowed for reading, so the boot page and curl can ask without
    // constructing a body.
    const args = req.method === 'GET'
      ? Promise.resolve(Object.fromEntries(url.searchParams))
      : body(req)

    args.then(a => action.run(a))
      .then(out => send(200, out))
      .catch(e => {
        // Messages are written for the person, so they are what the page shows.
        log.on('error').bad(`${name}: ${e.message}`)
        send(400, { error: e.message })
      })
    return
  }

  // No page here. NW.js opens the window from disk, so this server exists only for
  // a machine being provisioned.
  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('This is the API. The window is not served from here.\n')
}

// Listens on every interface, because a guest on a bridged adapter reaches this
// host by its network address and loopback would be useless to it. Safe to do only
// because of the split above: what is reachable from the network is a guest asking
// for its own scripts, never an action.
function start ({ port: wanted = Number(process.env.PORT || 7373), host = process.env.HOST || '0.0.0.0' } = {}) {
  const server = http.createServer(handler)
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(wanted, host, async () => {
      port = server.address().port
      try {
        const c = await channel.listen({ tokenFor: name => (vms.read().find(v => v.name === name) || {}).spec?.token })
        channelPort = c.port
      } catch (e) {
        log.on('channel').bad(`could not listen for machines dialling in: ${e.message}`)
      }
      log.on('server').good(`Listening on port ${port} — scripts for machines being provisioned; actions from this machine only`)
      resolve({ server, port, host, url: `http://127.0.0.1:${port}/`, stop: () => server.close() })
    })
  })
}

module.exports = { start, actions, handler }

if (require.main === module) {
  start()
    .then(s => console.log(`Open ${s.url}`))
    .catch(e => { console.error(e.message); process.exit(1) })
}
