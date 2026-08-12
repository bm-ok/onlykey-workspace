'use strict'

// The API, and the page in front of it.
//
// This is a library with an entry point, not a script: NW.js starts it inside its
// own Node context (see main.js) so the app is one process, and `node server.js`
// starts the same thing headlessly. Either way there is exactly one server and
// exactly one API, so the window, a browser and a machine being provisioned are
// all clients of the same thing.
//
// A machine being provisioned is the reason this is an HTTP server rather than
// function calls inside the window.

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const log = require('./core/log')
const vbox = require('./machines/vbox')
const vms = require('./machines/vms')
const provisioner = require('./machines/provisioner')
const scripts = require('./machines/scripts')
const machines = require('./machines/store')
const { provision, reach } = require('./machines/provision')
const editor = require('./machines/editor')

const UI = path.join(__dirname, 'ui')
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' }

const started = new Date().toISOString()

// The port we actually ended up on. A guest is told to fetch its scripts from
// here, so this has to be what is really listening rather than a default.
let port = Number(process.env.PORT || 7373)

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

  vmIsos: { about: 'Installer images VirtualBox already knows about', run: () => vbox.isos() },
  vmBridges: { about: 'Host network adapters a guest could be bridged onto', run: () => vbox.bridges() },
  vmScripts: { about: 'The provisioning scripts available to swap between', run: async () => ({ available: scripts.list(), stages: scripts.STAGES }) },
  vmScript: {
    about: 'One script a machine will receive, exactly as it will get it',
    takes: ['name', 'stage'],
    run: async ({ name, stage = 'unattended' }) => {
      const vm = vms.get(name)
      let host = '127.0.0.1'
      try { host = await vbox.hostAddress() } catch { /* previewing should work with no network */ }
      return { stage, file: path.basename(scripts.fileFor(vm, stage)), script: scripts.render(stage, vm, { hostAddress: host, port }) }
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
        res.end(scripts.render(stage || file, vm, { hostAddress: host, port }))
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

  const file = path.join(UI, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname))
  if (!file.startsWith(UI) || !fs.existsSync(file)) return res.writeHead(404).end('Not found')
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'text/plain' })
  fs.createReadStream(file).pipe(res)
}

// 127.0.0.1 by default. A guest on a bridged adapter cannot reach loopback, so
// installing one needs HOST=0.0.0.0 -- which puts this API on the network, and is
// therefore a decision to make on purpose rather than a default.
function start ({ port: wanted = Number(process.env.PORT || 7373), host = process.env.HOST || '127.0.0.1' } = {}) {
  const server = http.createServer(handler)
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(wanted, host, () => {
      port = server.address().port
      log.on('server').good(`Listening on http://${host}:${port}`)
      resolve({ server, port, host, url: `http://${host}:${port}/`, stop: () => server.close() })
    })
  })
}

module.exports = { start, actions, handler }

if (require.main === module) {
  start()
    .then(s => console.log(`Open ${s.url}`))
    .catch(e => { console.error(e.message); process.exit(1) })
}
