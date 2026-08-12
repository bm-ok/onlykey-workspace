'use strict'

// The dial-in channel. THIS SIDE LISTENS; the machine dials in.
//
// The inversion is the whole point, and it is taken from the previous version
// because it was right: the ephemeral side is the wrong one to own the socket. A
// machine rebooting is then an ordinary client reconnecting, and this side keeps
// the log and the live view across it. If it were the other way round, every
// reboot would be an error to handle.
//
// Newline-delimited JSON over TLS: no dependency beyond what every language has,
// trivial to re-implement in a guest, and it survives a socket dying mid-line
// because the framing is the newline.
//
// Encrypted because the first thing a machine says here is its token. It was a
// plain socket, so that secret crossed the network in clear on every reconnect --
// and a reboot is an ordinary reconnect.

const tls = require('node:tls')
const crypto = require('node:crypto')
const log = require('../core/log')
const keys = require('../core/keys')

// A line big enough for a build's output chunk, small enough that a runaway guest
// cannot exhaust memory here.
const MAX_LINE = 4 * 1024 * 1024

const agents = new Map()   // vm name -> { socket, since, from, facts, lastSeen }
let server = null
let jobSeq = 0
const jobs = new Map()     // job id -> { vm, resolve, reject, lines }

// How long a machine may say nothing before it is assumed gone. The agent sends a
// beat every 20 seconds, so three missed beats.
const SILENT_TOO_LONG = 70000

const newToken = () => crypto.randomBytes(24).toString('hex')

// ---- listening --------------------------------------------------------

// A machine that stops answering has to be noticed, because TCP will not notice for
// us: one killed mid-sentence leaves a socket that looks perfectly healthy.
function watchForSilence () {
  setInterval(() => {
    const now = Date.now()
    for (const [name, agent] of agents) {
      if (now - agent.lastSeen > SILENT_TOO_LONG) {
        dropAgent(name, `has said nothing for ${Math.round((now - agent.lastSeen) / 1000)}s, so it is treated as gone`)
      }
    }
  }, 15000).unref()
}

// Every interface, for the same reason the API is: a machine reaches this host by its
// network address. A guest can say nothing until it proves it holds the token for the
// machine it claims to be, and that token was generated per machine when it was made.
// ENCRYPTED, for the same reason the scripts are: the first thing a machine says
// here is its token, and this used to be a plain socket -- so the secret that
// decides what a machine may push crossed the network in clear on every
// reconnect, and a reboot is an ordinary reconnect. Protecting the scripts and
// not this would have looked finished and moved the exposure rather than
// removing it.
//
// The same certificate the API serves with, and the machine checks it against
// the authority it was given when it was built.
function listen ({ port = Number(process.env.OKC_CHANNEL_PORT || 7374), tokenFor, onHello }) {
  watchForSilence()
  const creds = keys.ensure()
  return new Promise((resolve, reject) => {
    server = tls.createServer({ key: creds.key, cert: creds.cert }, socket => onConnection(socket, tokenFor, onHello))
    server.once('error', reject)
    server.listen(port, '0.0.0.0', () => {
      log.on('channel').good(`Listening on port ${port} — machines dial in here, over TLS`)
      resolve({ port })
    })
  })
}

// Everything that ends a session, in one place, so nothing is half-forgotten.
//
// Rejecting the pending jobs matters as much as closing the socket: a job whose
// machine has gone will never be answered, and without this it sat until its timeout
// -- so asking a destroyed machine to do something appeared to hang rather than to
// fail.
function dropAgent (name, why) {
  const agent = agents.get(name)
  if (agent) {
    agents.delete(name)
    try { agent.socket.destroy() } catch { /* already gone */ }
  }
  for (const [id, job] of jobs) {
    if (job.vm === name) {
      jobs.delete(id)
      job.reject(new Error(`"${name}" ${why}, so the command was not finished.`))
    }
  }
  if (agent) log.on('vm', name, 'channel').warn(`${name} ${why}`)
  return !!agent
}

function onConnection (socket, tokenFor, onHello) {
  const from = `${socket.remoteAddress}:${socket.remotePort}`
  socket.setNoDelay(true)
  // So the operating system notices a peer that vanished without saying goodbye. A
  // VM being destroyed sends no FIN, and without this the socket looks open forever.
  socket.setKeepAlive(true, 20000)

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
        // A second machine claiming the same name replaces the first. Usually this is
        // the same machine reconnecting after a reboot.
        const had = agents.get(vm)
        if (had && had.socket !== socket) dropAgent(vm, 'was replaced by a new connection')
        agents.set(vm, { socket, since: new Date().toISOString(), from, facts: msg.facts || {}, lastSeen: Date.now() })
        log.on('vm', vm, 'channel').good(`${vm} dialled in from ${socket.remoteAddress}`)
        // It has a token now, so whatever carried it here is spent. Told rather
        // than inferred: this is the only moment anything knows a machine has
        // finished being built, and the install ticket must not outlive it.
        if (onHello) { try { onHello(vm) } catch { /* never worth dropping a session over */ } }
        send({ type: 'hi' })
        continue
      }

      // Anything at all counts as a sign of life, not only a beat.
      const agent = agents.get(vm)
      if (agent) agent.lastSeen = Date.now()
      handle(vm, msg)
    }
  })

  // Not an error: a machine rebooting looks exactly like this, and it will be back.
  // Through dropAgent, so anything waiting on it is told rather than left waiting.
  const gone = () => {
    if (vm && agents.get(vm) && agents.get(vm).socket === socket) dropAgent(vm, 'hung up')
  }
  socket.on('close', gone)
  socket.on('error', gone)
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
      vm: name,
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

module.exports = { listen, close, connected, list, run, newToken, drop: dropAgent }
