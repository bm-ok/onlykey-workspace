'use strict'

// The actions, for something on this machine that is not the window.
//
// A local socket rather than a port: a Unix domain socket where there is one, a
// named pipe on Windows. Node treats both as `path`, so this is one
// implementation and not two behind a flag.
//
// WHY NOT THE HTTP API, which already exists and already answers loopback only.
// Because "loopback only" is a CHECK -- a line of code comparing an address,
// which is right until somebody edits it, and which stands between a stranger on
// the network and actions that delete disks. A local socket is not reachable
// from another machine at all. There is no address to get wrong, no interface to
// bind to by accident, and no rule to keep enforcing. The strongest version of a
// check is not needing one.
//
// Newline-delimited JSON, the same as the machines dial in with. No dependency,
// and re-implementable in a guest, a shell script or another language in an
// afternoon.

const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')

// Named for the app rather than for a port, because that is what it is: one
// dashboard per machine, and a second one would be a different app with a
// different name.
const ADDRESS = process.env.OKC_IPC || (process.platform === 'win32'
  ? '\\\\.\\pipe\\okc-dashboard'
  : path.join(os.tmpdir(), 'okc-dashboard.sock'))

// ---- the server ------------------------------------------------------

function listen (actions, { log } = {}) {
  // A Unix socket is a file and outlives the process that made it, so a crash
  // leaves one behind that nothing is listening on -- and binding then fails
  // with EADDRINUSE for a server that is not running. Windows pipes disappear
  // with their last handle and need none of this.
  if (process.platform !== 'win32') {
    try { if (fs.existsSync(ADDRESS)) fs.unlinkSync(ADDRESS) } catch { /* reported by listen below */ }
  }

  const server = net.createServer(socket => {
    let buf = ''
    socket.on('error', () => { /* a client that leaves mid-call is not an event */ })
    socket.on('data', chunk => {
      buf += chunk
      let cut
      while ((cut = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, cut)
        buf = buf.slice(cut + 1)
        if (line.trim()) answer(line, socket, actions, log)
      }
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(ADDRESS, () => {
      // On Unix the socket is a file, and its permissions are the whole of who
      // may drive this. Left at the default umask another account on the same
      // machine could delete a virtual machine; 0600 says only this user.
      // Windows pipes carry an ACL granting the creating user instead, so there
      // is nothing to set.
      if (process.platform !== 'win32') {
        try { fs.chmodSync(ADDRESS, 0o600) } catch { /* better to serve than to refuse over this */ }
      }
      resolve({ server, address: ADDRESS, close: () => close(server) })
    })
  })
}

function close (server) {
  return new Promise(resolve => server.close(() => {
    if (process.platform !== 'win32') {
      try { if (fs.existsSync(ADDRESS)) fs.unlinkSync(ADDRESS) } catch { /* going away anyway */ }
    }
    resolve()
  }))
}

// One request, one reply, carrying back the id it came with -- so a caller can
// have more than one in flight without matching replies by their order.
async function answer (line, socket, actions, log) {
  let req
  try {
    req = JSON.parse(line)
  } catch {
    return say(socket, { id: null, ok: false, error: 'that was not valid JSON' })
  }

  const action = actions[req.action]
  if (!action) {
    return say(socket, { id: req.id ?? null, ok: false, error: `No action called "${req.action}"` })
  }

  // One action answers forever instead of once.
  //
  // Everything else here is a question with an answer, which is the right shape
  // for nearly all of it. Watching is not: an install is twenty-five minutes of
  // nothing followed by everything at once, and asking repeatedly either misses
  // it or spends the whole time asking. So this one keeps the socket and pushes.
  //
  // It stays in the actions table -- with `stream` instead of `run` -- because
  // the table is what says an action exists. An action handled somewhere else
  // and left out of it would be invisible to `okc` with no arguments, which is
  // the one place anybody looks to find out what there is.
  if (action.stream) return follow(req, socket, action)

  try {
    // Marked as having come down the pipe.
    //
    // The window calls the same table in-process and this is absent there, which
    // is the only place the two callers differ -- and one action needs that
    // difference. Approving a pre-defined task is a HUMAN act ratifying
    // something a model wrote, and this socket is exactly what a supervising
    // model drives. Without this, a session could write a definition and then
    // approve its own work, which is the one path nothing reviews.
    //
    // It is a boundary rather than a proof: anyone at this keyboard can open the
    // window. That is fine -- the person at the keyboard is who approval is for.
    // What it stops is approval happening as a step inside an automated run.
    const result = await action.run({ ...(req.args || {}), _overTheWire: true })
    say(socket, { id: req.id ?? null, ok: true, result })
  } catch (e) {
    // The message and nothing else. A stack trace here would be this app's
    // internals arriving where a person asked a question about their machines.
    if (log) log.on('ipc').warn(`${req.action}: ${e.message}`)
    say(socket, { id: req.id ?? null, ok: false, error: e.message })
  }
}

const say = (socket, obj) => { try { socket.write(JSON.stringify(obj) + '\n') } catch { /* gone */ } }

// Everything already logged, then everything from here on.
//
// Both halves matter. Only the new ones and a watcher started a second late
// misses the line it was started for; only the old ones and it is a poll wearing
// a different name. The caller says where to carry on from with `since`, so a
// watcher that reconnects does not repeat what it already showed.
//
// Unsubscribed when the socket goes, and not before -- a listener left attached
// to a closed socket is a leak that grows every time somebody presses ctrl-c.
function follow (req, socket, action) {
  const from = Number((req.args || {}).since || 0)
  const seen = new Set()

  const send = entry => {
    if (seen.has(entry.id)) return
    seen.add(entry.id)
    say(socket, { id: req.id ?? null, ok: true, event: entry })
  }

  for (const entry of action.stream(from)) send(entry)
  const stop = action.subscribe(send)

  const done = () => { try { stop() } catch { /* already gone */ } }
  socket.on('close', done)
  socket.on('error', done)
  socket.on('end', done)
}

// ---- the client ------------------------------------------------------

// Talks to a dashboard that is ALREADY RUNNING, and says so when there is not
// one.
//
// It deliberately cannot start its own. A second copy would have its own empty
// registry of dialled-in machines, so every machine would report as not
// connected while sitting there connected to the real one -- an answer that is
// confidently wrong rather than missing.
function call (action, args = {}, { timeout = 15 * 60 * 1000, onEvent } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: ADDRESS })
    let buf = ''
    // A watch has no answer to wait for, so nothing to time out. Anything else
    // does, and a caller left hanging on a dashboard that stopped replying is
    // worse than one told it gave up.
    const timer = onEvent
      ? null
      : setTimeout(() => {
          socket.destroy()
          reject(new Error(`"${action}" did not answer within ${Math.round(timeout / 1000)}s.`))
        }, timeout)

    const finish = (fn, value) => { if (timer) clearTimeout(timer); socket.end(); fn(value) }

    socket.on('connect', () => socket.write(JSON.stringify({ id: 1, action, args }) + '\n'))
    socket.on('data', chunk => {
      buf += chunk
      let cut
      while ((cut = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, cut)
        buf = buf.slice(cut + 1)
        if (!line.trim()) continue

        let reply
        try { reply = JSON.parse(line) } catch { return finish(reject, new Error('the dashboard sent something that was not JSON')) }

        if (!reply.ok) return finish(reject, Object.assign(new Error(reply.error || 'it refused, and did not say why'), { refused: true }))
        // A stream keeps going; a question is answered once and done.
        if (onEvent && 'event' in reply) onEvent(reply.event)
        else return finish(resolve, reply.result)
      }
    })
    socket.on('close', () => { if (onEvent) finish(resolve, { watched: true }) })
    socket.on('error', err => {
      clearTimeout(timer)
      const missing = err.code === 'ENOENT' || err.code === 'ECONNREFUSED'
      reject(missing
        ? Object.assign(new Error(`The dashboard is not running — nothing is listening on ${ADDRESS}.\nStart it with "npm start", or "npm run headless" for no window.`), { notRunning: true })
        : err)
    })
  })
}

module.exports = { listen, call, ADDRESS }
