'use strict'

// Runs a command somewhere, and says so in the log while it runs.
//
// "Somewhere" is either this machine or one reached over ssh. Callers do not
// branch on which -- that is the whole point of a machine being a value rather
// than a special case.

const { spawn } = require('node:child_process')
const log = require('../core/log')

// Streams output as it arrives rather than returning it at the end, because a
// long step with nothing on screen is indistinguishable from a hung one.
function run (cmd, args, { cwd, tags = [], quiet = false } = {}) {
  const to = log.on(...tags)
  if (!quiet) to.info(`$ ${[cmd, ...args].join(' ')}`)

  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(cmd, args, { cwd, shell: false })
    } catch (e) {
      to.bad(e.message)
      return reject(e)
    }

    let out = ''
    let err = ''
    child.stdout.on('data', d => { out += d; if (!quiet) to.out(String(d)) })
    child.stderr.on('data', d => { err += d; if (!quiet) to.out(String(d)) })

    child.on('error', e => {
      to.bad(e.code === 'ENOENT' ? `${cmd} is not installed, or not where this expected it` : e.message)
      reject(e)
    })
    child.on('close', code => {
      if (code === 0) return resolve(out.trim())
      const why = (err || out).trim().split('\n').slice(-3).join(' ') || `exit code ${code}`
      to.bad(why)
      reject(new Error(why))
    })
  })
}

// The same call, wherever the machine is. An ssh machine gets the command handed
// to a shell on the far side; this machine runs it directly.
const at = (machine, script, opts = {}) => machine.kind === 'ssh'
  ? run('ssh', [machine.host, opts.cwd ? `cd ${opts.cwd} && ${script}` : script],
      { ...opts, cwd: undefined, tags: [...(opts.tags || []), 'ssh', machine.id] })
  : run(process.platform === 'win32' ? 'cmd' : 'sh',
      process.platform === 'win32' ? ['/c', script] : ['-c', script],
      { ...opts, tags: [...(opts.tags || []), machine.id] })

module.exports = { run, at }
