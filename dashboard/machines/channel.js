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

        // Handed out rather than written down here, because this file must not
        // know about the registry -- vms.js already requires this one, and the
        // other direction would be a cycle.
        // It has a token now, so whatever carried it here is spent. Told rather
        // than inferred: this is the only moment anything knows a machine has
        // finished being built, and the install ticket must not outlive it.
        // The address goes with it. The socket's far end rather than anything
        // the machine says about itself: a machine lists every address it has,
        // and once docker is installed that includes a bridge address that is
        // real inside it and unreachable from here. A packet has already come
        // back along this one.
        if (onHello) {
          try {
            onHello(vm, {
              address: String(from || '').replace(/^::ffff:/, '').replace(/:\d+$/, ''),
              user: (msg.facts || {}).user || null
            })
          } catch (e) {
            // NOT WORTH DROPPING A SESSION OVER, AND NOT WORTH SAYING NOTHING
            // ABOUT EITHER. This swallowed silently, and what it swallowed was a
            // TypeError on the third line of the handler — so for every machine
            // older than its first boot, the rest of what happens when a machine
            // dials in simply did not happen, and no line anywhere said so. It
            // took adding something below it and watching that not run.
            //
            // The session still survives, which was always right. What changes
            // is that the failure is now a sentence somebody can read.
            log.on('vm', vm, 'channel').warn(`something went wrong handling its arrival: ${e.message}`)
          }
        }
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
  //
  // WHY IT WENT IS RECORDED, which it was not. Both endings arrived here as the
  // same three words — "hung up" — so a machine that rebooted, a machine whose
  // network died, and a connection reset by something in between were one event
  // with one description. Chasing a channel that dropped the instant any command
  // started, the two ends each reported the other closing first and neither could
  // be believed, because the one place that knew the difference was discarding it.
  // WHICH EVENT CAME FIRST is the whole diagnosis, and it was being thrown away.
  //
  // `end` means the far end sent FIN: the machine closed, and this side is only
  // noticing. `error` means the connection broke. `close` on its own means THIS
  // side closed it, which is the answer nobody had -- both ends were reporting
  // the other as having gone, and neither could name it.
  let why = null
  socket.on('end', () => { why = why || 'the machine closed it' })
  socket.on('error', err => { why = why || `error: ${(err && (err.code || err.message)) || 'unknown'}` })
  const gone = () => {
    if (!(vm && agents.get(vm) && agents.get(vm).socket === socket)) return
    dropAgent(vm, why ? `hung up — ${why}` : 'hung up — this side closed it, and nothing here said why')
  }
  socket.on('close', gone)
  socket.on('error', gone)
}

// What a dialled-in machine can say. Deliberately little: it reports output and
// results, and everything about what to run lives on this side.
function handle (vm, msg) {
  const to = log.on('vm', vm, 'guest')

  if (msg.type === 'out') {
    const job = jobs.get(msg.job)
    // KEPT FOR THE CALLER, WITHHELD FROM THE LOG. See `quiet` in run(): the one
    // thing this is for is reading a credential back off a machine, where the
    // caller needs every byte and the log must have none of them.
    if (job) job.lines.push(msg.text || '')
    if (!(job && job.quiet)) to.out(msg.text || '')
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
  // A beat carries one changing fact: whether the machine has a desktop yet.
  //
  // It has to come on the beat rather than only at hello, because it is FALSE
  // when a machine first connects and becomes true a minute or two later — the
  // agent starts as soon as the network works, which is well before anybody has
  // a graphical session. Recorded at hello only, it would say "no desktop" for
  // the rest of the machine's life.
  if (msg.type === 'beat') {
    const agent = agents.get(vm)
    if (agent && agent.facts && typeof msg.desktop === 'boolean' && agent.facts.desktop !== msg.desktop) {
      agent.facts.desktop = msg.desktop
      to.info(msg.desktop ? 'its desktop session is up' : 'its desktop session has gone')
    }
    // AND HOW MUCH OF ITSELF IT IS USING, which VirtualBox cannot answer.
    //
    // Its memory metrics come FROM the guest additions, so a machine built
    // without them — which is now every runner with no desktop — reports
    // nothing on the host side at all. The machine knows, and it is already
    // talking to us every twenty seconds.
    //
    // Kept quietly: this changes constantly and a log line per beat would bury
    // everything else. It is a fact to look at, not an event.
    if (agent && agent.facts && typeof msg.memoryUsedMB === 'number') {
      agent.facts.memoryUsedMB = msg.memoryUsedMB
      if (typeof msg.memoryTotalMB === 'number') agent.facts.memoryTotalMB = msg.memoryTotalMB
    }
    // ANSWERED, because a one-way heartbeat proves nothing.
    //
    // The machine cannot tell a working connection from a severed one by
    // sending: the data sits in its kernel's buffer being retransmitted for
    // about fifteen minutes and every send succeeds. What it can measure is
    // silence from here — so there has to be something to be silent. Without
    // this reply, a machine that lost its network stayed stuck for ever and
    // never redialled.
    if (agent && agent.socket && !agent.socket.destroyed) {
      try { agent.socket.write(JSON.stringify({ type: 'beat' }) + '\n') } catch { /* it is going anyway */ }
    }
    return
  }
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
// `quiet` — WHAT COMES BACK IS NOT PUT IN THE LOG.
//
// The caller still gets every line; the live log gets none of them. There is
// exactly one reason to want this and it is the reason it was added: reading a
// CREDENTIAL back off a machine. `guestBack` does that with `cat`, the guest
// dutifully reports what it printed, and an access token and a refresh token
// were then sitting in the live log — which the window draws, `windowShot`
// photographs, and `logSince` hands to anyone at the command line.
//
// The line saying the command RAN is still logged, because "this host read the
// credential off kit-1" is exactly the kind of act that should be visible. It is
// the VALUE that must not be, which is the rule the Keys tab is built to: a
// model may know something was done in there without knowing what.
function run (name, command, { what = 'command', timeout = 30 * 60 * 1000, quiet = false } = {}) {
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
      quiet,
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
