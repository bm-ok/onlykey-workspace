'use strict'

// Opening the work in VS Code, wherever the work is.
//
// The step between "the machine is ready" and "I am editing in it". Without it a
// person has to find the machine's address, and type it more than once.
//
// Everything here that looks like superstition was measured on a real
// workstation, because the obvious version of this file produces a button that
// silently does nothing:
//
//   * `code` is frequently not on PATH AT ALL, and Insiders is a different
//     binary with a different name -- `code-insiders`. Looking only for `code`
//     finds nothing on a machine that has an editor installed and working.
//   * Node REFUSES to spawn a `.cmd` directly. It throws EINVAL, and throws it
//     SYNCHRONOUSLY -- before any callback and before any 'error' event, so
//     error handling written the normal way never runs. That is the
//     CVE-2024-27980 mitigation, and it fails before the arguments matter.
//   * Spawning successfully is NOT the same as opening. `cmd.exe` starts
//     perfectly well and only then reports that what it was asked to run does
//     not exist, so resolving on spawn reports success for a button that did
//     nothing.

const fs = require('node:fs')
const path = require('node:path')
const { execFile } = require('node:child_process')
const log = require('../core/log')

// Insiders first. Both are found, so nothing needs configuring either way, but
// where both are installed the preference has to be fixed rather than
// incidental: a button that quietly changes which editor it opens the day
// another one is installed is worse than one that always picks the same and can
// be told otherwise.
const EDITORS = [
  ['Microsoft VS Code Insiders', 'code-insiders'],
  ['Microsoft VS Code', 'code']
]

const there = p => { try { return fs.existsSync(p) } catch { return false } }

// Where the editor actually is, and how that was decided -- the second half
// matters when the answer is wrong.
function discover (configured) {
  if (configured) {
    if (!there(configured) && !/[\\/]/.test(configured)) return { command: configured, from: 'configured, on PATH' }
    if (!there(configured)) throw new Error(`The editor is set to ${configured}, and there is nothing there.`)
    return { command: configured, from: 'configured' }
  }

  const roots = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'),
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)']
  ].filter(Boolean)

  for (const [dir, bin] of EDITORS) {
    for (const root of roots) {
      for (const ext of ['.cmd', '']) {
        const candidate = path.join(root, dir, 'bin', `${bin}${ext}`)
        if (there(candidate)) return { command: candidate, from: 'found where it installs' }
      }
    }
  }
  for (const p of ['/usr/bin/code', '/usr/local/bin/code', '/snap/bin/code', '/usr/bin/code-insiders']) {
    if (there(p)) return { command: p, from: 'found where it installs' }
  }
  // Somebody may still have put it on PATH under either name.
  return { command: process.platform === 'win32' ? 'code.cmd' : 'code', from: 'guessed — not found where it installs' }
}

// `vscode-remote://ssh-remote+<user>@<address><absolute path>`
//
// ONE string for the far end, not a user and a host to be joined here. An ssh
// machine is already stored as `user@address`, and a virtual machine's is built
// from what it reported when it dialled in -- so joining them in this file would
// mean one of the two callers producing `user@user@address`, which fails as an
// unreachable host rather than as anything that names the mistake.
//
// user@address rather than a name from ~/.ssh/config, because a config entry is
// a second place the machine's address would live and it goes stale the first
// time the address moves. This form needs nothing on the host but the key, which
// first-boot.sh already installed.
const folderUri = (remote, dir) =>
  `vscode-remote://ssh-remote+${encodeURIComponent(remote)}${dir.startsWith('/') ? '' : '/'}${dir}`

// Windows will not start a .cmd from node directly; it goes through cmd.exe.
//
// `{ shell: true }` is the other way out and is NOT used: the editor installs to
// a path with spaces in it, and the shell splits on them -- so it would need
// quoting done by hand, which is the thing that keeps going wrong here. Through
// cmd.exe, node quotes each argument and no shell parses the path at all.
function launchSpec (command, args) {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)) {
    return { file: process.env.COMSPEC || 'cmd.exe', argv: ['/c', command, ...args] }
  }
  return { file: command, argv: args }
}

// Open a folder: on this machine when there is no host, over VS Code's own
// remote when there is. One folder, not a generated multi-root workspace -- VS
// Code finds every .git inside a folder and shows each repository's status, so
// opening the tree that holds them gives all of them with no file to generate.
// It also means the editor never needs to know what the work spans.
function open ({ dir, remote, command, tags = [] }) {
  if (!dir) throw new Error('There is no folder to open.')

  const { command: exe, from } = discover(command)
  const args = remote
    ? ['--folder-uri', folderUri(remote, dir), '--new-window']
    : [dir, '--new-window']
  const spec = launchSpec(exe, args)

  const to = log.on('editor', ...tags)
  const attempted = `${spec.file} ${spec.argv.map(a => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`
  to.info(`Opening ${dir}${remote ? ` on ${remote}` : ''} in VS Code`)

  // An errno is not something a person can act on, and this is the button where
  // they meet the system. So a failure says what was run and what that
  // particular failure usually means.
  const explain = err => {
    const why = err.code === 'EINVAL' && process.platform === 'win32'
      ? ' — Windows will not start a .cmd directly; this should have gone through cmd.exe.'
      : err.code === 'ENOENT'
        ? ` — that was not found. The editor was ${from}.`
        : ''
    const said = err.detail ? `\n  it said: ${err.detail}` : ''
    return new Error(`Could not start the editor.\n  tried: ${attempted}\n  ${err.code || 'failed'}${why}${said}`)
  }

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn, value) => { if (!settled) { settled = true; fn(value) } }

    let child
    try {
      child = execFile(spec.file, spec.argv, { windowsHide: true }, (err, stdout, stderr) => {
        if (err && err.code) {
          const detail = String(stderr || stdout || '').trim().split('\n')[0]
          to.bad(`the editor did not start: ${detail || err.code}`)
          finish(reject, explain(Object.assign(err, { detail })))
        }
      })
    } catch (err) {
      // The EINVAL path. Thrown synchronously, so it reaches neither the
      // callback nor the 'error' event; here is the only place it can become
      // something readable.
      to.bad(err.message)
      return finish(reject, explain(err))
    }

    child.on('error', err => { to.bad(err.message); finish(reject, explain(err)) })

    // A grace window rather than waiting for exit: the editor outlives this call
    // by design -- the dashboard opened a window, it does not own it -- so
    // waiting for it to close would hang forever. A launcher either fails within
    // milliseconds or has genuinely started.
    const grace = setTimeout(() => {
      to.good('VS Code was asked to open it.')
      finish(resolve, { opened: dir, on: remote || null, using: exe, found: from })
    }, 1500)

    child.on('exit', code => {
      if (code === 0) {
        clearTimeout(grace)
        to.good('VS Code was asked to open it.')
        finish(resolve, { opened: dir, on: remote || null, using: exe, found: from })
      }
      // A non-zero exit is handled by the execFile callback, which has the
      // output needed to explain it.
    })
    if (typeof child.unref === 'function') child.unref()
  })
}

// The machines kept as configuration: this one, or one reached over ssh, where
// the far end is already stored as `user@address`.
const openOn = (machine, where) => {
  const dir = where || machine.path
  if (!dir) throw new Error(`There is no folder to open for "${machine.name}". Set one in its settings.`)
  return open({
    dir,
    remote: machine.kind === 'ssh' ? machine.host : null,
    command: machine.editor,
    tags: [machine.id]
  })
}

module.exports = { open, openOn, discover, folderUri }
