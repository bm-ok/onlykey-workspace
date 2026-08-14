'use strict'

// WHAT A JOB IS HANDED. This file runs ON THE MACHINE, not here.
//
// It is copied into a run's directory by machines/dispatch.js and required by
// the runner beside it. Keeping it as a real file rather than a string inside
// dispatch.js is not tidiness: it is code that runs somewhere consequential, and
// code that cannot be opened by an editor or checked by `node --check` is code
// that gets read less carefully than it deserves.
//
// EVERY HELPER IS SOMETHING THIS MACHINE COULD ALREADY DO. The shell it has, and
// the HTTP surface it is already trusted on -- the same endpoints an install
// reports through and a task hands artifacts back on. Nothing new is exposed to
// make a job work, and there is still no route from here to the dashboard's
// actions: that property is what makes running a script on a machine safe, and
// it is stated at the top of dispatch.js as part of why a worker may run with
// permissions skipped.
//
// EVERY CALL HAS A DEADLINE. The first version of this shelled out to curl with
// no timeout, and a request that could not be answered hung the whole run: no
// output, no status, and a job that had plainly done something sitting for ever
// looking like one still working. It was found by exercising it on a real
// machine and it is the reason anything here that touches the network fails in
// seconds and says so.

const fs = require('fs')
const cp = require('child_process')
const path = require('path')
const https = require('https')
const { URL } = require('url')

const here = __dirname
const read = f => {
  try { return fs.readFileSync(path.join(here, f), 'utf8') } catch { return '' }
}

const BASE = process.env.OKC_BASE || ''
const CA = process.env.OKC_CA || '/etc/okc/ca.pem'

// THE CREDENTIAL IS A FILE, NOT AN ENVIRONMENT VARIABLE, and that is the whole
// reason it is read here rather than passed in. The note at the top of
// dispatch.js is about exactly this: env is what a transcript dumps, and a run's
// output is captured to the host and kept. It is the machine's own token -- the
// one already written into its git remotes -- so this adds no exposure that
// pushing did not already have, and one fewer way to leak it.
const [VM, TOKEN] = read('auth').trim().split(':')

function call (method, where, body, { timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!BASE) return reject(new Error('this run was not told where the dashboard is, so it cannot hand anything back'))
    if (!VM || !TOKEN) return reject(new Error('this run was not given its machine credential'))

    let ca
    try { ca = fs.readFileSync(CA) } catch { return reject(new Error('the authority is missing at ' + CA)) }

    const req = https.request(new URL(where, BASE), {
      method,
      ca,
      auth: VM + ':' + TOKEN,
      headers: body ? { 'content-length': Buffer.byteLength(body) } : {}
    }, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(text)
        reject(new Error('the dashboard answered ' + res.statusCode + ': ' + text.trim().split('\n')[0]))
      })
    })
    req.setTimeout(timeout, () => req.destroy(new Error('no answer within ' + (timeout / 1000) + 's')))
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

const q = o => Object.entries(o)
  .filter(([, v]) => v !== undefined && v !== null && v !== '')
  .map(([k, v]) => k + '=' + encodeURIComponent(String(v)))
  .join('&')

module.exports = {
  prompt: process.env.OKC_PROMPT_ID
    ? Object.freeze({
        id: process.env.OKC_PROMPT_ID,
        name: process.env.OKC_PROMPT_NAME || null,
        text: read('prompt.txt')
      })
    : null,

  // WHERE IT ACTUALLY IS, not where it was meant to be. The run script cds to
  // the configured folder and falls back to the home directory when there is
  // none -- a machine that has never been given a task has no workspace -- so
  // the configured path can name somewhere that does not exist. Reporting that
  // as the workspace is a job being told something untrue about its own footing.
  workspace: process.cwd(),
  configured: process.env.OKC_FOLDER || null,
  machine: VM || null,
  run: process.env.OKC_RUN || null,

  // TWO PLACES ON PURPOSE. stdout is the run's own record, read afterwards with
  // vmRunOutput; the live log is what somebody watching sees now. A long job
  // with only the first is one nobody can tell is progressing.
  //
  // A line that cannot reach the dashboard is said locally rather than thrown:
  // losing the network is not a reason to fail work that is otherwise fine.
  log (line) {
    const text = String(line)
    process.stdout.write(text + '\n')
    return call('GET', '/provision/say?' + q({ vm: VM, text }), null, { timeout: 8000 })
      .catch(e => process.stdout.write('okc: that line did not reach the dashboard — ' + e.message + '\n'))
  },

  // How far along it is, through the same endpoint an install reports on, so a
  // long job is watchable the way a long install is.
  report (stage) {
    return call('GET', '/provision/report?' + q({ vm: VM, stage: String(stage) }), null, { timeout: 8000 })
      .catch(e => process.stdout.write('okc: that progress report did not reach the dashboard — ' + e.message + '\n'))
  },

  // A file handed back, kept against this run. This one THROWS on failure, unlike
  // the two above: a job that was asked to produce something and could not hand
  // it over has failed, and reporting that as a note in a log would be the run
  // saying it succeeded.
  artifact (file, name) {
    const body = fs.readFileSync(file)
    return call('POST', '/artifact?' + q({
      vm: VM,
      name: name || path.basename(file),
      run: process.env.OKC_RUN || ''
    }), body, { timeout: 60000 })
  },

  // A command, here, in the guest. Synchronous because a job is read top to
  // bottom, and the first thing an async shell helper costs is that.
  // Where the run already is, rather than where the folder was configured to be.
  // Pointing this at a directory that does not exist fails as
  // `spawnSync /bin/sh ENOENT` -- an error about the shell, for a fault in the
  // working directory, which is a sentence nobody could act on.
  sh (cmd, opts = {}) {
    return cp.execSync(cmd, {
      encoding: 'utf8',
      cwd: opts.cwd || process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe']
    })
  },

  // Where this machine clones and pushes. The token is already in the remote
  // URLs its workspace was set up with; this is the same address, for a job that
  // wants a repository the workspace does not already have.
  gitUrl (repo) {
    if (!BASE) throw new Error('this run was not told where the dashboard is')
    return BASE.replace('https://', 'https://' + VM + ':' + TOKEN + '@') + '/git/' + repo
  },

  // For a job that CHECKS rather than does. The drills were this and nothing
  // else, and they were awkward only because it was the sole thing a definition
  // could do.
  assert: {
    ok (cond, why) { if (!cond) throw new Error('check failed: ' + why) },
    equal (a, b, why) {
      if (a !== b) throw new Error('check failed: ' + why + ' — got ' + JSON.stringify(a) + ', wanted ' + JSON.stringify(b))
    },
    async refuses (fn, sub, why) {
      try {
        await fn()
      } catch (e) {
        if (!sub || String(e.message).toLowerCase().includes(String(sub).toLowerCase())) return e
        throw new Error('refused, but not for the stated reason: ' + e.message)
      }
      throw new Error('check failed: it was allowed — ' + why)
    }
  }
}
