'use strict'

// The dial-in channel. THIS SIDE LISTENS; the machine dials in.
//
// The inversion is the whole point, and it is taken from the previous version
// because it was right: the ephemeral side is the wrong one to own the socket. A
// machine rebooting is then an ordinary client reconnecting, and this side keeps
// the log and the live view across it. If it were the other way round, every
// reboot would be an error to handle.
//
// Newline-delimited JSON over plain TCP: no dependency, trivial to re-implement in
// a guest in any language, and it survives a socket dying mid-line because the
// framing is the newline.

const net = require('node:net')
const crypto = require('node:crypto')
const log = require('../core/log')

// A line big enough for a build's output chunk, small enough that a runaway guest
// cannot exhaust memory here.
const MAX_LINE = 4 * 1024 * 1024

const agents = new Map()   // vm name -> { socket, since, from, facts }
let server = null
let jobSeq = 0
const jobs = new Map()     // job id -> { resolve, reject, lines }

const newToken = () => crypto.randomBytes(24).toString('hex')

// ---- listening --------------------------------------------------------

// Every interface, for the same reason the API is: a machine reaches this host by
// its network address. A guest cannot say anything until it proves it holds the
// token for the machine it claims to be, and the token was generated per machine
// when it was made.
function listen ({ port = Number(process.env.OKC_CHANNEL_PORT || 7374), tokenFor }) {
  return new Promise((resolve, reject) => {
    server = net.createServer(socket => onConnection(socket, tokenFor))
    server.once('error', reject)
    server.listen(port, '0.0.0.0', () => {
      log.on('channel').good(`Listening on port ${port} — machines dial in here`)
      resolve({ port })
    })
  })
}

function onConnection (socket, tokenFor) {
  const from = `${socket.remoteAddress}:${socket.remotePort}`
  socket.setNoDelay(true)

  let buffer = ''
  let vm = null

  const send = msg => {
    if (!socket.destroyed) socket.write(JSON.stringify(msg) + '\n')
  }

  const goodbye = why => {
    log.on('channel').warn(`${from}: ${why}`)
    send({ type: 'bye', why })
    socket.destroy()
  }

  socket.on('data', chunk => {
    buffer += chunk
    if (buffer.length > MAX_LINE) return goodbye('sent a line that never ended')

    let cut
    while ((cut = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 1)
      if (!line.trim()) continue

      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        return goodbye('sent something that was not JSON')
      }

      // Nothing is accepted before a valid hello, so an unauthenticated socket can
      // do nothing except be closed.
      if (!vm) {
        if (msg.type !== 'hello') return goodbye('said something before hello')
        const expected = tokenFor(msg.vm)
        if (!expected || msg.token !== expected) return goodbye(`claimed to be "${msg.vm}" without the right token`)

        vm = msg.vm
        const had = agents.get(vm)
        if (had && had.socket !== socket) had.socket.destroy()
        agents.set(vm, { socket, since: new Date().toISOString(), from, facts: msg.facts || {} })
        log.on('vm', vm, 'channel').good(`${vm} dialled in from ${socket.remoteAddress}`)
        send({ type: 'hi' })
        continue
      }

      handle(vm, msg)
    }
  })

  const drop = () => {
    if (vm && agents.get(vm) && agents.get(vm).socket === socket) {
      agents.delete(vm)
      // Not an error: a machine rebooting looks exactly like this, and it will be
      // back.
      log.on('vm', vm, 'channel').info(`${vm} hung up`)
    }
  }
  socket.on('close', drop)
  socket.on('error', drop)
}

// What a dialled-in machine can say. Deliberately little: it reports output and
// results, and everything about what to run lives on this side.
function handle (vm, msg) {
  const to = log.on('vm', vm, 'guest')

  if (msg.type === 'out') {
    to.out(msg.text || '')
    const job = jobs.get(msg.job)
    if (job) job.lines.push(msg.text || '')
    return
  }

  if (msg.type === 'done') {
    const job = jobs.get(msg.job)
    if (msg.code === 0) to.good(`finished: ${msg.what || 'command'}`)
    else to.bad(`failed (${msg.code}): ${msg.what || 'command'}`)
    if (job) {
      jobs.delete(msg.job)
      job.resolve({ code: msg.code, output: job.lines.join('\n') })
    }
    return
  }

  if (msg.type === 'say') return to.out(msg.text || '')
  if (msg.type === 'beat') return
  to.info(JSON.stringify(msg).slice(0, 400))
}

// ---- using it ---------------------------------------------------------

const connected = name => agents.has(name)

const list = () => [...agents.entries()].map(([name, a]) => ({
  vm: name, since: a.since, from: a.from, facts: a.facts
}))

// Runs something on a dialled-in machine and waits for it. This is the fast path:
// re-running a provisioning script on a live machine takes a minute, where
// reinstalling to try a change takes half an hour, and nobody iterates on a
// half-hour loop.
function run (name, command, { what = 'command', timeout = 30 * 60 * 1000 } = {}) {
  const agent = agents.get(name)
  if (!agent) throw new Error(`"${name}" is not dialled in, so there is nothing to run a command on. Start it and wait for it to connect.`)

  const job = String(++jobSeq)
  log.on('vm', name, 'channel').info(`running on ${name}: ${what}`)

  return new Promise((resolve, reject) => {
    const give_up = setTimeout(() => {
      jobs.delete(job)
      reject(new Error(`"${what}" on ${name} did not finish within ${Math.round(timeout / 60000)} minutes.`))
    }, timeout)

    jobs.set(job, {
      lines: [],
      resolve: out => { clearTimeout(give_up); resolve(out) },
      reject: err => { clearTimeout(give_up); reject(err) }
    })

    agent.socket.write(JSON.stringify({ type: 'run', job, command, what }) + '\n')
  })
}

const close = () => {
  for (const a of agents.values()) a.socket.destroy()
  agents.clear()
  return new Promise(r => (server ? server.close(r) : r()))
}

module.exports = { listen, close, connected, list, run, newToken }
