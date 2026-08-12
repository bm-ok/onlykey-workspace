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
      const out = await vbox.destroy(name)
      return { ...out, ...vms.forget(name) }
    }
  },
  vmForget: { about: 'Stop managing a virtual machine without deleting it', takes: ['name'], run: ({ name }) => vms.forget(name) },
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
      await vbox.takeSnapshot(name, title.trim(), description || '')
      const vm = vms.get(name)
      if (!vm.baseSnapshot) vms.update(name, { baseSnapshot: title.trim() })
      return vbox.snapshots(name)
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
      // OKC_QUIET_SAY: the agent already streams stdout, so the script should not
      // also post each line over HTTP or every one arrives twice.
      return channel.run(name, `curl -fsSL '${url}' -o /root/okc-again.sh && OKC_QUIET_SAY=yes bash /root/okc-again.sh`, { what: `${file} again` })
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
  vmScripts: { about: 'The provisioning scripts available to swap between', run: async () => ({ available: scripts.list(), stages: scripts.STAGES }) },
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
// The split: /provision/* answers anyone, because that is what a guest needs and
// all it can do is read its own scripts and report progress. /api/* answers
// loopback only.
const isLocal = req => {
  const from = req.socket.remoteAddress || ''
  return from === '127.0.0.1' || from === '::1' || from === '::ffff:127.0.0.1'
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
      log.on('vm', name, 'guest').good(`${name} asked for ${file}`)
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
