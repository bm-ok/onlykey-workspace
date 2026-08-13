#!/usr/bin/env node
'use strict'

// Driving the dashboard from a terminal.
//
// GENERATED FROM THE ACTIONS TABLE, never from a list kept here. `okc` with no
// arguments asks the running dashboard what it can do and prints the answer, so
// an action that exists is listed and one that does not cannot be. A
// hand-written list of commands would be a second copy to forget to update --
// the same reason the window builds its own Actions tab from `/api/actions`
// rather than from a menu somebody maintains.
//
// It talks to a dashboard that is already running, over a local socket, and says
// so when there is not one. It cannot start its own: a second copy would have
// its own empty registry of dialled-in machines and would report every machine
// as disconnected while it sat there connected to the real one.

const ipc = require('../core/ipc')

// --key value, --key=value, and --flag for a bare true.
//
// Values are JSON when they parse as JSON and strings otherwise, so `--force
// true` is a boolean and `--branch fix/try-one` is not accidentally something
// else. A branch called `null` would be the only casualty and git will not
// accept one.
function parse (argv) {
  const args = {}
  let flags = 0
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    flags++
    const eq = a.indexOf('=')
    let key, raw
    if (eq > 0) {
      key = a.slice(2, eq)
      raw = a.slice(eq + 1)
    } else {
      key = a.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) raw = 'true'
      else { raw = next; i++ }
    }
    try {
      args[key] = JSON.parse(raw)
    } catch (e) {
      // A value that OPENS like JSON and does not parse is a mistake, not a
      // string. Falling back silently sent `vmCreate` a string where it wanted
      // an object, and what came back was "give it a name" -- an error about the
      // wrong thing entirely, pointing at a field that was in fact right there.
      //
      // It happens for a real reason on Windows: a shell eats the backslashes in
      // an embedded path, so `C:\\Users` arrives as `C:\Users` and `\U` is not a
      // valid escape. Say that here, where it can still be acted on.
      if (/^\s*[{[]/.test(raw)) {
        throw new Error(`--${key} looks like JSON but did not parse: ${e.message}\n` +
          '  If it contains a Windows path, use forward slashes: C:/Users/... — a shell\n' +
          '  eats the backslashes before this ever sees them.')
      }
      args[key] = raw
    }
  }
  return { args, flags }
}

const pad = (s, n) => String(s).padEnd(n)

async function listActions () {
  const { actions } = await ipc.call('actions')
  const width = Math.max(...actions.map(a => a.name.length))
  console.log('The dashboard can do these. Every one is callable here.\n')
  for (const a of actions) {
    const takes = a.takes && a.takes.length ? `  --${a.takes.join(' --')}` : ''
    console.log(`  ${pad(a.name, width)}  ${a.about}${takes ? `\n  ${pad('', width)}  ${takes.trim()}` : ''}`)
  }
  console.log(`\n  okc <action> [--key value]        run one`)
  console.log(`  okc <action> --json              its answer as JSON, for a script`)
}

// Readable by default and JSON on request, because the two audiences want
// different things and guessing which is which produces output that suits
// neither.
function show (result, asJson) {
  if (asJson) return console.log(JSON.stringify(result, null, 2))
  if (result === undefined || result === null) return console.log('done')
  if (typeof result !== 'object') return console.log(String(result))

  // Anything with obvious output gets it printed as text rather than escaped
  // inside JSON -- output from a machine is the thing being read, and `\n` in a
  // quoted string is not readable.
  if (typeof result.output === 'string') {
    console.log(result.output)
    if (typeof result.code === 'number' && result.code !== 0) console.log(`\nexited ${result.code}`)
    return
  }
  console.log(JSON.stringify(result, null, 2))
}

async function main () {
  const argv = process.argv.slice(2)
  const action = argv.find(a => !a.startsWith('--'))
  const { args } = parse(argv)
  const asJson = args.json === true
  delete args.json

  if (!action) {
    await listActions()
    return 0
  }

  try {
    // Asked of the dashboard rather than kept in a list here, so a streaming
    // action added later needs nothing changed in this file.
    const { actions: known } = await ipc.call('actions')
    const streams = known.some(a => a.name === action && /^Follow /.test(a.about || ''))

    if (streams) {
      // Printed as it arrives and never buffered: the entire point is watching
      // something happen, and a line held back until the end is a line that
      // arrived too late to be worth anything.
      await ipc.call(action, args, {
        onEvent: e => {
          if (asJson) return console.log(JSON.stringify(e))
          const tags = (e.tags || []).join(' ')
          console.log(`${e.at.slice(11, 19)}  ${String(e.level).padEnd(5)}  ${tags.padEnd(18)}  ${e.text}`)
        }
      })
      return 0
    }

    // `vmShell` becomes an actual shell, here, rather than printing a command
    // for somebody to copy.
    //
    // It has to happen in THIS process: the dashboard has no terminal to hand
    // over, and an interactive session needs the one the person is sitting at.
    // So the action answers where the machine is and this replaces itself with
    // ssh — the same thing they would have typed, without the typing.
    //
    // Not when --json was asked for. That is a script asking where a machine is,
    // and dropping it into an interactive session would be a surprise of the
    // worst kind.
    if (action === 'vmShell' && !asJson) {
      const where = await ipc.call(action, args)
      console.error(`${where.command}${where.live ? '' : '   (not dialled in — last known address)'}`)
      const { spawnSync } = require('node:child_process')
      // stdio inherited, so this IS the session: keys, colours, the lot.
      // With --command it runs that and returns; without, it is a shell. The
      // same flag vmRun uses, so which door you go through is the only
      // difference between them.
      const ssh = spawnSync('ssh', [
        '-o', 'StrictHostKeyChecking=accept-new',
        where.target,
        ...(args.command ? [String(args.command)] : [])
      ], { stdio: 'inherit' })
      // ssh's own exit code, passed straight through: a script that runs a
      // command this way should see what the command said, not what this
      // wrapper thought of it.
      return ssh.status === null ? 1 : ssh.status
    }

    show(await ipc.call(action, args), asJson)
    return 0
  } catch (e) {
    console.error(e.message)
    // A refusal is an answer, and a script driving this should stop on one --
    // which is the whole reason it exits non-zero rather than printing a
    // complaint and carrying on.
    if (e.notRunning) return 3
    return 1
  }
}

main().then(code => process.exit(code)).catch(e => {
  console.error(e.message)
  process.exit(1)
})
