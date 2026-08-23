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
//
// IT PROVES WHO IT IS FIRST. The socket is on this machine and reachable by
// anything else on it, so the app asks for a shared secret before it will take a
// command — see the long note in src/app/core/ipc/main.js for why that is a check
// rather than something structural. Reading the token is what makes this program
// privileged, and what makes it privileged is being run by the account that
// started the app. Nothing here is configured; both ends work out the same two
// paths from the same two rules.

const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')

const ADDRESS = process.platform === 'win32'
  ? '\\\\.\\pipe\\okc-dashboard-beta'
  : path.join(os.tmpdir(), 'okc-dashboard-beta.sock')

// Beside the socket, derived the same way — see the note on the other end.
const TOKEN_FILE = path.join(os.tmpdir(), 'okc-dashboard-beta.token')

const TIMEOUT = 15 * 60 * 1000

// THE TWO WAYS THIS IS MISSING ARE DIFFERENT PROBLEMS AND IT SAYS BOTH, because
// "permission denied" and "no such file" lead somewhere completely different and
// a caller who reads only "cannot read the token" will check the wrong one.
function readToken () {
  try {
    return fs.readFileSync(TOKEN_FILE, 'utf8').trim()
  } catch (err) {
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      throw Object.assign(new Error(
        `The token at ${TOKEN_FILE} is not readable by this account.\n` +
        'It belongs to whoever started the app; run this as that user.'), { refused: true })
    }
    throw Object.assign(new Error(
      `There is no token at ${TOKEN_FILE}.\n` +
      'The app writes it at startup and removes it on the way out, so either nothing is running — ' +
      'start it with "npm start" — or it is running as a different user.'), { notRunning: true })
  }
}

function call (action, args = {}) {
  return new Promise((resolve, reject) => {
    let token
    try { token = readToken() } catch (err) { return reject(err) }

    const socket = net.createConnection({ path: ADDRESS })
    let buf = ''

    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`"${action}" did not answer within ${Math.round(TIMEOUT / 1000)}s.`))
    }, TIMEOUT)

    const finish = (fn, value) => { clearTimeout(timer); socket.end(); fn(value) }

    // BOTH LINES AT ONCE, and the replies sorted out by id. Waiting for the
    // greeting to come back before sending the command would put a round trip in
    // front of every call this program makes, for a socket on the same machine
    // that has already decided the answer by the time the first write lands.
    socket.on('connect', () => {
      socket.write(JSON.stringify({ id: 0, auth: token }) + '\n')
      socket.write(JSON.stringify({ id: 1, action, args }) + '\n')
    })

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

        // THE GREETING'S REPLY ARRIVES FIRST AND IS NOT THE ANSWER. A refused
        // greeting is the whole story and stops here; an accepted one is
        // bookkeeping and the caller never hears about it.
        if (reply.id === 0) {
          if (!reply.ok) {
            return finish(reject, Object.assign(new Error(reply.error || 'it would not take the token, and did not say why'), { refused: true }))
          }
          continue
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

//---------------------------------------------------------------------------
// HOW AN ANSWER PRINTS, FROM THE PLUGIN THE ANSWER BELONGS TO.
//
// A FOURTH HALF, beside window.js, server.js and main.js, and it earns its place
// the same way they do: `okc.js todos` printing a wall of braces is not a command
// line, it is a JSON dump with a prompt in front of it. Whoever knows how a
// todo should read is whoever wrote the todo pane, and they are one folder away.
//
// A PLAIN MODULE, NOT A rectify PLUGIN, because this process has no graph in it.
// The CLI is a separate program that knows one socket and nothing else — that is
// what lets it work while the window is closed, and what stops it booting a
// second copy of the app to ask a question. So a cli.js is required, not started,
// and it may not consume anything.
//
// THE SAME FOLDER RULES AS THE OTHER THREE: one or two levels down, no leading
// `_` or `.`, never inside a vendor. A fifth reading of one sentence is a fifth
// chance to disagree with it, so test/plugins.test.js holds this one too.
//
// AND NOTHING HERE IS REQUIRED. An action with no printer prints as JSON, which
// is what everything did before this existed.
//---------------------------------------------------------------------------

const APP = path.join(__dirname, '..', 'src', 'app')
const DEPTH = 2

const scanned = (name) => name[0] !== '_' && name[0] !== '.' && name !== 'vendor'

function cliHalves (dir, left, out) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const entry of entries) {
    if (!entry.isDirectory() || !scanned(entry.name)) continue
    const here = path.join(dir, entry.name)
    if (fs.existsSync(path.join(here, 'cli.js'))) out.push(path.join(here, 'cli.js'))
    if (left > 1) cliHalves(here, left - 1, out)
  }
  return out
}

function printers () {
  const all = {}
  for (const file of cliHalves(APP, DEPTH, [])) {
    let half
    // A BROKEN PRINTER MUST NOT COST YOU THE ANSWER. This is presentation; the
    // result is already in hand, and falling back to JSON is a worse-looking
    // answer rather than no answer at all.
    try { half = require(file) } catch (err) {
      console.error('the printers in ' + path.relative(APP, file) + ' did not load: ' + err.message)
      continue
    }
    Object.assign(all, (half && half.print) || {})
  }
  return all
}

// --k v, --flag (true), --k=v, and --json for the raw answer
//
//---- A VALUE THAT OPENS LIKE JSON IS JSON ----------------------------------
//
//EVERY VALUE ARRIVED AS A STRING, and some actions want an object: `vmCreate
//--vm '{"name":"runner1"}'` handed `spec.fill` a string, which has no `name` on
//it, and the answer was "Give it a name using letters, numbers, dots or dashes"
//— an error about the wrong thing entirely, pointing at a field that was in fact
//right there.
//
//The app being ported from parses here and says exactly that in its own comment.
//This was lost in the port and cost the first attempt at `vmCreate`.
//
//AND WHAT OPENS LIKE JSON AND DOES NOT PARSE IS A MISTAKE, NOT A STRING.
//Falling back silently is what produced the misleading error above, so it throws
//with the fix in it — because it happens for a real reason on Windows: a shell
//eats the backslashes in an embedded path, so `C:\Users` arrives with `\U` in
//it, which is not a valid escape.
function readArgs (argv) {
  const args = {}
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue

    let key, raw
    const eq = a.indexOf('=')
    if (eq > 2) {
      key = a.slice(2, eq)
      raw = a.slice(eq + 1)
    } else {
      key = a.slice(2)
      if (key === 'json') { json = true; continue }
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) raw = 'true'
      else { raw = next; i++ }
    }
    if (key === 'json') { json = true; continue }

    try {
      args[key] = JSON.parse(raw)
    } catch (e) {
      if (/^\s*[{[]/.test(raw)) {
        throw new Error(`--${key} looks like JSON but did not parse: ${e.message}\n` +
          '  If it contains a Windows path, use forward slashes: C:/Users/... — a shell\n' +
          '  eats the backslashes before this ever sees them.')
      }
      args[key] = raw
    }
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
  if (json) return console.log(JSON.stringify(said, null, 2))
  if (typeof said === 'string') return console.log(said)

  const show = printers()[name]
  if (!show) return console.log(JSON.stringify(said, null, 2))

  // A PRINTER THAT THROWS IS A BUG IN THE PRINTER, not a reason to lose what the
  // app said. It says so and prints the answer the old way.
  let text
  try { text = show(said) } catch (err) {
    console.error('the printer for "' + name + '" threw: ' + err.message)
    return console.log(JSON.stringify(said, null, 2))
  }
  console.log(Array.isArray(text) ? text.join('\n') : String(text))
}

// REQUIRED RATHER THAN RUN, when something is checking the walk above rather
// than asking the app a question. Without this guard, requiring this file to test
// its folder rules prints the whole action list into the test output and then
// exits the runner.
module.exports = { cliHalves, printers }

// RUN WHEN RUN, AND SILENT WHEN REQUIRED. Without this, something checking the
// folder rules above prints the whole action list into its own output and then
// exits the test runner.
if (require.main === module) {
  main().catch(err => {
    console.error(err.message)
    // 3 for "nothing is listening", 1 for a refusal — so a script can tell "it
    // said no" from "it was not there", which are different problems.
    process.exit(err.notRunning ? 3 : 1)
  })
}
