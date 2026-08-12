'use strict'

// One click to open the work in VS Code, wherever the work is.

const fs = require('node:fs')
const path = require('node:path')
const log = require('../core/log')
const { run } = require('./run')

// `code` is frequently not on PATH, so look where it installs before failing --
// and let a machine override it, because a fixed guess is how a tool becomes
// unusable on somebody's setup.
const CANDIDATES = [
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
  'C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd',
  '/usr/bin/code',
  '/usr/local/bin/code',
  '/snap/bin/code'
].filter(Boolean)

function command (machine) {
  if (machine && machine.editor) return machine.editor
  const found = CANDIDATES.find(p => { try { return fs.existsSync(p) } catch { return false } })
  return found || (process.platform === 'win32' ? 'code.cmd' : 'code')
}

// A local folder opens directly; a folder on an ssh machine opens through VS
// Code's own remote, so it is the same click either way.
async function open (machine, where) {
  const target = where || machine.path
  if (!target) throw new Error(`There is no folder to open for "${machine.name}". Set one in its settings.`)

  const to = log.on('editor', machine.id)
  const cmd = command(machine)
  const args = machine.kind === 'ssh'
    ? ['--remote', `ssh-remote+${machine.host}`, target]
    : [target]

  to.info(`Opening ${target}${machine.kind === 'ssh' ? ` on ${machine.host}` : ''} in VS Code`)
  try {
    await run(cmd, args, { tags: ['editor', machine.id] })
    to.good('VS Code was asked to open it.')
    return { opened: target, using: cmd }
  } catch (e) {
    // The likely cause is worth saying, since the fix is a setting on this page.
    to.bad(`Could not run "${cmd}". If VS Code is installed somewhere else, set the editor command in this machine's settings.`)
    throw new Error(`Could not open VS Code using "${cmd}". Set the editor command in "${machine.name}" settings.`)
  }
}

module.exports = { open, command, candidates: () => CANDIDATES }
