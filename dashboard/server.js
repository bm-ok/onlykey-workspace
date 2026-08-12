'use strict'

// The API, and the page in front of it.
//
// This is a library with an entry point, not a script: NW.js starts it inside its
// own Node context (see main.js) so the app is one process, and `node server.js`
// starts the same thing headlessly. Either way there is exactly one server and
// exactly one API, so the window, a browser and a machine dialling in are all
// clients of the same thing.

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const work = require('./core/work')
const eco = require('./core/ecosystem')
const log = require('./core/log')
const machines = require('./machines/store')
const vbox = require('./machines/vbox')
const { provision, reach } = require('./machines/provision')
const editor = require('./machines/editor')

const UI = path.join(__dirname, 'ui')
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' }

// ---- the actions ------------------------------------------------------
//
// One flat table: everything the tool can do, each with a line saying what it is
// for. /api/actions serves this table, the window builds its own list of every
// capability from it, and nothing can exist here without showing up there.

const actions = {
  status: {
    about: 'Is the server up, and what is it serving',
    run: async ({ ecosystem = 'local' }) => {
      let serving = null
      try {
        const e = eco.load(ecosystem)
        serving = { id: e.id, name: e.name, repos: e.repos.length, file: e.file }
      } catch (err) {
        serving = { error: err.message }
      }
      return { ok: true, serving, ecosystems: eco.list(), started }
    }
  },
  actions: {
    about: 'Every action this server has, with what each is for',
    run: async () => ({
      actions: Object.entries(actions).map(([name, a]) => ({ name, about: a.about, takes: a.takes || [] }))
    })
  },

  overview: {
    about: 'The tasks worth doing, the repos they need, and what is in flight',
    run: async ({ ecosystem = 'local' }) => {
      const e = eco.load(ecosystem)
      return {
        ecosystem: { id: e.id, name: e.name, about: e.about, file: e.file },
        repos: await eco.health(e),
        tasks: work.tasks(ecosystem),
        work: work.all().sort((a, b) => b.started.localeCompare(a.started))
      }
    }
  },

  start: { about: 'Begin an attempt at a task', takes: ['task'], run: ({ ecosystem = 'local', task }) => work.start(ecosystem, task) },
  offer: { about: 'Say an attempt is ready to be reviewed', takes: ['id'], run: ({ id }) => work.offer(id) },
  review: { about: 'What an attempt actually changed', takes: ['id'], run: ({ id }) => work.review(id) },
  accept: { about: 'Commit an attempt — all repos or none', takes: ['id', 'note'], run: ({ id, note }) => work.accept(id, note) },
  discard: { about: 'Throw an attempt away, saving it to a patch first', takes: ['id'], run: ({ id }) => work.discard(id) },
  putBack: { about: 'Restore an attempt that was thrown away', takes: ['id'], run: ({ id }) => work.putBack(id) },

  machines: { about: 'The machines you have, and the virtual machines that exist', run: async () => ({ machines: machines.all(), vbox: await vbox.list() }) },
  machineAdd: { about: 'Add a machine', takes: ['machine'], run: ({ machine }) => machines.add(machine || {}) },
  machineUpdate: { about: 'Change a machine', takes: ['id', 'patch'], run: ({ id, patch }) => machines.update(id, patch || {}) },
  machineRemove: { about: 'Forget a machine — nothing on it is touched', takes: ['id'], run: ({ id }) => machines.remove(id) },
  machineReach: { about: 'Does this machine answer', takes: ['id'], run: ({ id }) => reach(machines.get(id)) },

  vmList: { about: 'Virtual machines, and which are running', run: () => vbox.list() },
  vmCreate: { about: 'Make a virtual machine and its disk', takes: ['vm'], run: ({ vm }) => vbox.create(vm || {}) },
  vmRemove: { about: 'Delete a virtual machine and its disks', takes: ['name'], run: ({ name }) => vbox.remove(name) },
  vmStart: { about: 'Start a virtual machine', takes: ['name'], run: ({ name }) => vbox.start(name) },
  vmStop: { about: 'Shut a virtual machine down, or pull its power', takes: ['name', 'force'], run: ({ name, force }) => vbox.stop(name, !!force) },

  provision: { about: 'Run a machine\'s setup steps, in order, stopping at the first failure', takes: ['id', 'steps'], run: ({ id, steps }) => provision(machines.get(id), steps) },
  openEditor: { about: 'Open the work in VS Code, here or over ssh', takes: ['id', 'where'], run: ({ id, where }) => editor.open(machines.get(id), where) },

  // For looking at what the window actually rendered, rather than what the
  // source says it should have. Ctrl+Shift+D in the window sends it here.
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

const started = new Date().toISOString()

const body = req => new Promise((resolve, reject) => {
  let s = ''
  req.on('data', c => { s += c; if (s.length > 1 << 20) reject(new Error('Too much data')) })
  req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}) } catch { reject(new Error('That was not valid JSON')) } })
})

function handler (req, res) {
  const url = new URL(req.url, 'http://localhost')

  // The live log. Server-sent events rather than a socket library: it is one
  // direction and needs no dependency.
  if (url.pathname === '/api/log/stream') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
    for (const e of log.since(url.searchParams.get('since'))) res.write(`data: ${JSON.stringify(e)}\n\n`)
    const stop = log.subscribe(e => res.write(`data: ${JSON.stringify(e)}\n\n`))
    const beat = setInterval(() => res.write(': beat\n\n'), 25000)
    req.on('close', () => { stop(); clearInterval(beat) })
    return
  }

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

// 127.0.0.1 by default: nothing about this should be reachable from off the
// machine unless somebody asks for that on purpose.
function start ({ port = Number(process.env.PORT || 7373), host = process.env.HOST || '127.0.0.1' } = {}) {
  const server = http.createServer(handler)
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      log.on('server').good(`Listening on http://${host}:${port}`)
      resolve({ server, port, host, url: `http://${host}:${port}/`, stop: () => server.close() })
    })
  })
}

module.exports = { start, actions, handler }

// Headless: the same server, without the window.
if (require.main === module) {
  start()
    .then(s => console.log(`Open ${s.url}`))
    .catch(e => { console.error(e.message); process.exit(1) })
}
