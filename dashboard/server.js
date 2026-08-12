'use strict'

// A local page and a flat list of actions behind it. No framework, no build step,
// no dependencies -- `node server.js` and open the address it prints.

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
const PORT = Number(process.env.PORT || 7373)
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' }

const body = req => new Promise((resolve, reject) => {
  let s = ''
  req.on('data', c => { s += c; if (s.length > 1 << 20) reject(new Error('Too much data')) })
  req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}) } catch { reject(new Error('That was not valid JSON')) } })
})

// ---- the actions ------------------------------------------------------
//
// One flat map, one line each. Everything the tool can do is visible here, and
// the page and the cli are both clients over it -- so neither can grow a
// capability the other cannot reach.

const calls = {
  ecosystems: async () => ({ ecosystems: eco.list() }),

  overview: async ({ ecosystem = 'local' }) => {
    const e = eco.load(ecosystem)
    return {
      ecosystem: { id: e.id, name: e.name, about: e.about },
      repos: await eco.health(e),
      tasks: work.tasks(ecosystem),
      work: work.all().sort((a, b) => b.started.localeCompare(a.started))
    }
  },

  // the loop
  start: ({ ecosystem = 'local', task }) => work.start(ecosystem, task),
  offer: ({ id }) => work.offer(id),
  review: ({ id }) => work.review(id),
  accept: ({ id, note }) => work.accept(id, note),
  discard: ({ id }) => work.discard(id),
  putBack: ({ id }) => work.putBack(id),

  // machines
  machines: async () => ({ machines: machines.all(), vbox: await vbox.list() }),
  machineAdd: ({ machine }) => machines.add(machine || {}),
  machineUpdate: ({ id, patch }) => machines.update(id, patch || {}),
  machineRemove: ({ id }) => machines.remove(id),
  machineReach: ({ id }) => reach(machines.get(id)),

  // virtual machines
  vmList: () => vbox.list(),
  vmCreate: ({ vm }) => vbox.create(vm || {}),
  vmRemove: ({ name }) => vbox.remove(name),
  vmStart: ({ name }) => vbox.start(name),
  vmStop: ({ name, force }) => vbox.stop(name, !!force),

  // provisioning and the editor
  provision: ({ id, steps }) => provision(machines.get(id), steps),
  openEditor: ({ id, where }) => editor.open(machines.get(id), where),

  // the log
  logSince: ({ since }) => ({ entries: log.since(since), tags: log.tags() }),
  logClear: () => { log.clear(); return { cleared: true } }
}

// ---- serving ----------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')

  // Live log. Server-sent events rather than a socket library, because it is one
  // direction and needs no dependency.
  if (url.pathname === '/api/log/stream') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    })
    for (const e of log.since(url.searchParams.get('since'))) res.write(`data: ${JSON.stringify(e)}\n\n`)
    const stop = log.subscribe(e => res.write(`data: ${JSON.stringify(e)}\n\n`))
    const beat = setInterval(() => res.write(': beat\n\n'), 25000)
    req.on('close', () => { stop(); clearInterval(beat) })
    return
  }

  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5)
    const call = calls[name]
    const send = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json' })
      res.end(JSON.stringify(obj))
    }
    if (!call) return send(404, { error: `No action called "${name}"`, actions: Object.keys(calls) })
    try {
      send(200, await call(await body(req)))
    } catch (e) {
      // Messages are written for the person, so they are what the page shows.
      log.on('error').bad(`${name}: ${e.message}`)
      send(400, { error: e.message })
    }
    return
  }

  const file = path.join(UI, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname))
  if (!file.startsWith(UI) || !fs.existsSync(file)) return res.writeHead(404).end('Not found')
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'text/plain' })
  fs.createReadStream(file).pipe(res)
})

server.listen(PORT, '127.0.0.1', () => {
  log.on('server').good(`Listening on http://127.0.0.1:${PORT}`)
  console.log(`Open http://127.0.0.1:${PORT}`)
})
