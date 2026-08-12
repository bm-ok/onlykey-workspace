'use strict'

// A local page and a handful of calls behind it. No framework, no build step, no
// dependencies -- `node server.js` and open the address it prints.

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const work = require('./core/work')
const eco = require('./core/ecosystem')

const UI = path.join(__dirname, 'ui')
const PORT = Number(process.env.PORT || 7373)
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' }

const body = req => new Promise(resolve => {
  let s = ''
  req.on('data', c => { s += c })
  req.on('end', () => resolve(s ? JSON.parse(s) : {}))
})

const calls = {
  ecosystems: async () => ({ ecosystems: eco.list() }),
  overview: async ({ ecosystem = 'local' }) => {
    const e = eco.load(ecosystem)
    return {
      ecosystem: { id: e.id, name: e.name, about: e.about, sandbox: e.sandbox.kind },
      repos: await eco.health(e),
      tasks: work.tasks(ecosystem),
      work: work.all().sort((a, b) => b.started.localeCompare(a.started))
    }
  },
  start: ({ ecosystem = 'local', task }) => work.start(ecosystem, task),
  offer: ({ id }) => work.offer(id),
  review: ({ id }) => work.review(id),
  accept: ({ id, note }) => work.accept(id, note),
  discard: ({ id }) => work.discard(id)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const send = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json' })
    res.end(JSON.stringify(obj))
  }

  if (url.pathname.startsWith('/api/')) {
    const call = calls[url.pathname.slice(5)]
    if (!call) return send(404, { error: 'No such call' })
    try {
      send(200, await call(await body(req)))
    } catch (e) {
      // The message is written for the person, so it is what they see.
      send(400, { error: e.message })
    }
    return
  }

  const file = path.join(UI, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname))
  if (!file.startsWith(UI) || !fs.existsSync(file)) {
    res.writeHead(404).end('Not found')
    return
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'text/plain' })
  fs.createReadStream(file).pipe(res)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Open http://127.0.0.1:${PORT}`)
})
