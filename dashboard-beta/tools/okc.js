'use strict'

// The command line. Same actions the window uses, over the socket in
// src/app/core/ipc.
//
//     node tools/okc.js                      every action there is
//     node tools/okc.js <action> [--k v]     run one
//     node tools/okc.js <action> --json      the raw answer, for a script
//
// WHY THIS EXISTS AT ALL, given there is a window. Because the window is one
// caller. An app whose capabilities are reachable only by clicking is one where
// every question has to be asked by a person looking at a screen — no scripting,
// no drills, and nothing to run from another program. The rule carried over from
// the app being ported is that a capability is a row in one table, and the table
// is reached three ways: this, the page, and whatever comes next.
//
// AND IT REFUSES TO START ONE. If nothing is listening, this says so and stops.
// It does not helpfully boot a copy: a second app has its own empty state and
// would report an empty world while the real one sits beside it, which is a
// confusing answer rather than a missing one.

const net = require('node:net')
const os = require('node:os')
const path = require('node:path')

const ADDRESS = process.platform === 'win32'
  ? '\\\\.\\pipe\\okc-dashboard-beta'
  : path.join(os.tmpdir(), 'okc-dashboard-beta.sock')

const TIMEOUT = 15 * 60 * 1000

function call (action, args = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: ADDRESS })
    let buf = ''

    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`"${action}" did not answer within ${Math.round(TIMEOUT / 1000)}s.`))
    }, TIMEOUT)

    const finish = (fn, value) => { clearTimeout(timer); socket.end(); fn(value) }

    socket.on('connect', () => socket.write(JSON.stringify({ id: 1, action, args }) + '\n'))

    socket.on('data', chunk => {
      buf += chunk
      let cut
      while ((cut = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, cut)
        buf = buf.slice(cut + 1)
        if (!line.trim()) continue

        let reply
        try { reply = JSON.parse(line) } catch {
          return finish(reject, new Error('the app sent something that was not JSON'))
        }
        if (!reply.ok) {
          return finish(reject, Object.assign(new Error(reply.error || 'it refused, and did not say why'), { refused: true }))
        }
        return finish(resolve, reply.result)
      }
    })

    socket.on('error', err => {
      clearTimeout(timer)
      const missing = err.code === 'ENOENT' || err.code === 'ECONNREFUSED'
      reject(missing
        ? Object.assign(
            new Error(`The app is not running — nothing is listening on ${ADDRESS}.\nStart it with "npm start".`),
            { notRunning: true })
        : err)
    })
  })
}

// --k v, --flag (true), and --json for the raw answer
function readArgs (argv) {
  const args = {}
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    if (key === 'json') { json = true; continue }
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) { args[key] = true; continue }
    args[key] = next
    i++
  }
  return { args, json }
}

async function main () {
  const argv = process.argv.slice(2)
  const name = argv.find(a => !a.startsWith('--'))
  const { args, json } = readArgs(argv)

  // NO ARGUMENTS IS A QUESTION, not a mistake. "What can this thing do" is the
  // first thing anybody asks, and the answer comes from the running app rather
  // than from a list in a README that can go stale.
  if (!name) {
    const said = await call('actions')
    if (json) return console.log(JSON.stringify(said, null, 2))
    for (const a of said.actions) {
      console.log('  ' + a.name.padEnd(20) + (a.about || ''))
      if (a.takes && a.takes.length) console.log(' '.repeat(22) + a.takes.map(t => '--' + t).join(' '))
    }
    return
  }

  const said = await call(name, args)
  console.log(json || typeof said !== 'string' ? JSON.stringify(said, null, 2) : said)
}

main().catch(err => {
  console.error(err.message)
  // 3 for "nothing is listening", 1 for a refusal — so a script can tell "it
  // said no" from "it was not there", which are different problems.
  process.exit(err.notRunning ? 3 : 1)
})
