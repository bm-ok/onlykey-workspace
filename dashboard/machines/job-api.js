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

// ---- what a worker remembers, carried both ways ------------------------
//
// THROUGH CURL, AND SYNCHRONOUSLY, because `claude()` is synchronous and these
// have to happen either side of it. Node's https is callback-only, so a promise
// here would mean the archive going up while the next line of the job is already
// running -- which for the backup means racing the end of the run. curl is
// already how a guest reaches this host: dispatch.js writes `okc-artifact` as a
// curl call with the same authority and the same credential.
const HOME = process.env.HOME || '/root'
const curlAuth = () => ['--cacert', CA, '-u', VM + ':' + TOKEN, '-sS', '--max-time', '180']

// Everything Claude keeps, EXCEPT the credential.
//
// `~/.claude` holds `.credentials.json`, this machine's worker token. The host
// already has a copy, sealed; letting it ride along here would write an unsealed
// one into every task's archive, in a folder whose whole purpose is to be kept
// for a long time. A machine is handed a credential on the way up and it is
// taken back on the way down, and that path is the only one it should have.
const NOT_THESE = ['--exclude=.credentials.json', '--exclude=*.lock', '--exclude=shell-snapshots']

function rememberedByThisTask () {
  if (!BASE || !VM || !TOKEN) return null
  const tgz = path.join(here, 'claude-restore.tgz')
  const head = path.join(here, 'claude-restore.head')
  cp.execFileSync('curl', [...curlAuth(), '-D', head, '-o', tgz, `${BASE}/session?vm=${encodeURIComponent(VM)}`], { stdio: 'ignore' })

  const headers = fs.readFileSync(head, 'utf8')
  // 204 is the ordinary answer on a task's first run, not a failure.
  if (/^HTTP\/[\d.]+ 204/mi.test(headers)) return null
  if (!/^HTTP\/[\d.]+ 200/mi.test(headers)) {
    throw new Error('the dashboard answered ' + (headers.split('\n')[0] || '').trim())
  }
  const said = headers.match(/^x-okc-session:\s*(.+)$/mi)
  return { file: tgz, session: said ? said[1].trim() : '' }
}

function rememberThis (id) {
  if (!BASE || !VM || !TOKEN) return
  const tgz = path.join(here, 'claude-keep.tgz')
  // Relative to $HOME so it unpacks as `.claude` wherever it lands, rather than
  // carrying an absolute path that only makes sense on the machine that made it.
  cp.execFileSync('tar', ['-czf', tgz, '-C', HOME, ...NOT_THESE, '.claude'], { stdio: ['ignore', 'ignore', 'pipe'] })
  const where = `${BASE}/session?vm=${encodeURIComponent(VM)}&id=${encodeURIComponent(id || '')}&folder=${encodeURIComponent(process.cwd())}`
  cp.execFileSync('curl', [...curlAuth(), '-X', 'POST', '--data-binary', '@' + tgz, '-H', 'content-type: application/gzip', where], { stdio: ['ignore', 'ignore', 'pipe'] })
  const size = fs.statSync(tgz).size
  try { fs.unlinkSync(tgz) } catch { /* it served its purpose */ }
  return size
}

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

// A CONST RATHER THAN A PROPERTY READ THROUGH `this`, because a job is handed
// this object and destructures it -- `({ claude, log })` -- and a destructured
// method has no receiver. `this.prompt` inside one is undefined, always, and
// would have made `claude()` with no argument fail with "there is no brief" on a
// run that had a perfectly good prompt.
const PROMPT = process.env.OKC_PROMPT_ID
  ? Object.freeze({
      id: process.env.OKC_PROMPT_ID,
      name: process.env.OKC_PROMPT_NAME || null,
      text: read('prompt.txt')
    })
  : null

// THE RULES THAT PROMPT RUNS UNDER, read from the file written beside this one.
//
// A prompt names a contract, so a run that carries a prompt carries its rules
// too -- and a job is handed both rather than having to go and find one. The
// text is here so a job can write it down, quote it, check something against it,
// or hand it to a worker it starts; the id and name are here so it can say which
// rules it was, which is what makes a run record worth reading later.
const CONTRACT = process.env.OKC_CONTRACT_ID
  ? Object.freeze({
      id: process.env.OKC_CONTRACT_ID,
      name: process.env.OKC_CONTRACT_NAME || null,
      text: read('contract.md')
    })
  : null

module.exports = {
  prompt: PROMPT,
  contract: CONTRACT,

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

  // THE JUDGE'S OWN VERDICT, at the end of its session, after the handoff.
  //
  // The one who READ the change is the one who says whether it holds. Not the
  // supervisor — it commissioned the reading and cannot see the code, so it must
  // not grade the answer — and not a person, unless the person is the judge,
  // which is a judgement with no machine in it at all.
  //
  // WHICH JUDGEMENT IS NOT SAID AND CANNOT BE. This host looks it up from what
  // this machine is reading, the same as an artifact and a session: the token
  // proves which machine, and the machine proves nothing else. There is no
  // argument here to point at somebody else's change.
  //
  // AFTER THE HANDOFF, ALWAYS. The findings are the evidence and this is the
  // conclusion; a run that concluded without handing anything back has published
  // a verdict nobody can check.
  //
  // IT THROWS, like `artifact` and unlike `log`. A judgement whose verdict did
  // not arrive is a reading nothing acted on, and reporting that as a note in a
  // log would be the run saying it finished when the only thing that mattered
  // did not.
  //
  //   accept    nothing here should stop this landing
  //   reject    something must be dealt with first, and `why` says what
  //   pending   read, and not settled. A real answer, and not the same as
  //             having not looked
  verdict (what, why) {
    const said = String(what || '').trim().toLowerCase()
    if (!['accept', 'reject', 'pending'].includes(said)) {
      throw new Error(`"${what}" is not a verdict. It is "accept", "reject" or "pending".`)
    }
    if (said === 'reject' && !String(why || '').trim()) {
      throw new Error('a rejection has to say why — nothing is automatically re-run, so that note is the whole of what survives')
    }
    return call('POST', '/verdict?' + q({ vm: VM, verdict: said, note: String(why || '') }), null, { timeout: 15000 })
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

  // A WORKER, GIVEN THE PROMPT, HERE.
  //
  // This is the helper the rest of the API was built around and did not have. A
  // job could survey a machine, run commands and hand files back, but the one
  // thing the whole arrangement exists for -- give a worker a brief and let it
  // work -- was only reachable by dispatching a task, which is the dashboard's
  // job and not a job's. So a job could orchestrate everything except the work.
  //
  // THE SAME COMMAND A TASK GETS, deliberately: `claude -p` with permissions
  // skipped and JSON out, which is what machines/dispatch.js writes into a run
  // script. A worker started here and a worker started by the queue are the same
  // worker on the same machine, or the difference would show up as a job that
  // "worked" and a task that did not.
  //
  // THE BRIEF IS AN ARGUMENT, NOT A SHELL WORD. execFile, no shell, so prose
  // containing quotes, backticks or a $ is passed through byte for byte. The run
  // script has to write the brief to a file and `cat` it precisely because it IS
  // a shell; from node there is a straighter way and this takes it.
  //
  // SYNCHRONOUS, like sh, and this one is worth saying out loud: a worker takes
  // minutes, and nothing else in the job runs while it does -- no log line, no
  // progress. So `report()` before it and after it, rather than during.
  claude (text, opts = {}) {
    const { timeout = 30 * 60 * 1000, cwd = null } = opts
    // REFUSED RATHER THAN IGNORED. This used to take one, and a job written
    // against the old API would otherwise keep passing it and quietly get
    // different behaviour than the line says -- which is worse than an error,
    // because the line still reads as though it worked.
    if ('resume' in opts) {
      throw new Error('a job does not choose which conversation to continue — the task does, and it is restored automatically. Remove `resume`.')
    }
    // Defaulting to the prompt is the ordinary case, not a shortcut: a job whose
    // work IS the prompt should not have to name it.
    const brief = String(text == null ? (PROMPT ? PROMPT.text : '') : text).trim()
    if (!brief) throw new Error('there is no brief to give a worker — pass one, or run this job with a prompt')

    // THE RUN'S OWN CONTRACT UNLESS THE JOB SAYS OTHERWISE, and "otherwise"
    // includes saying none. Tested with `in` rather than by a default value,
    // because those are three different intentions and a default can only tell
    // two of them apart:
    //
    //     claude(brief)                       under the rules this run carries
    //     claude(brief, { contract: text })   under these rules instead
    //     claude(brief, { contract: null })   under no rules, deliberately
    //
    // A worker started with no rules because nobody thought about it, and one
    // started with no rules on purpose, must not be the same line of code.
    const contract = 'contract' in opts ? opts.contract : (CONTRACT ? CONTRACT.text : null)

    try {
      cp.execFileSync('sh', ['-c', 'command -v claude'], { stdio: 'ignore' })
    } catch {
      throw new Error('claude is not installed on this machine, so it cannot be given work')
    }

    // Rules beside the run rather than named by a path, for the reason
    // dispatch.js gives: a path read six weeks later proves nothing about what
    // the worker was actually told.
    //
    // The run's own contract.md is used AS IT ARRIVED and never rewritten -- it
    // is the record of what this run was given, and a job overwriting it would
    // destroy the one copy that was not written by the job. Rules the job
    // supplies itself go in a file of their own, so the two are still
    // distinguishable afterwards.
    let rulesFile = null
    if (contract) {
      const own = CONTRACT && contract === CONTRACT.text
      rulesFile = path.join(here, own ? 'contract.md' : 'contract-given.md')
      if (!own) fs.writeFileSync(rulesFile, String(contract))
    }

    // WHAT IT ALREADY REMEMBERS, PUT BACK BEFORE IT STARTS.
    //
    // The machine is rolled back between tasks, so without this every run is a
    // worker meeting the work for the first time -- and a task given out twice
    // is two strangers rather than a second attempt. The archive is the whole of
    // `~/.claude` as it was when this task last stopped, so it lands back where
    // Claude looks for it without this side having to work out where that is.
    //
    // A JOB DOES NOT CHOOSE WHICH CONVERSATION. It is told, by the host, from
    // the task. `--resume` is not an option this API offers, because "which
    // conversation is this" is a question about the task and a run cannot know
    // the answer -- and a run that could name any id could read the transcript
    // of work it has nothing to do with.
    let resume = null
    try {
      const carried = rememberedByThisTask()
      if (carried) {
        // Into $HOME, because that is where the archive was made from. Nothing
        // is deleted first: the credential this machine was handed on its way up
        // lives in the same folder and is deliberately NOT in the archive, so a
        // clean-then-extract would take it away seconds before it is needed.
        cp.execFileSync('tar', ['-xzf', carried.file, '-C', HOME], { stdio: ['ignore', 'ignore', 'pipe'] })
        try { fs.unlinkSync(carried.file) } catch { /* it served its purpose */ }
        resume = carried.session || null
        process.stdout.write(`okc: carried on from what this task remembers${resume ? ` (${resume.slice(0, 8)})` : ''}\n`)
      }
    } catch (e) {
      // NOT FATAL. A worker that starts fresh does the work; a worker that
      // refuses to start because it could not remember does not. Said out loud,
      // because "it forgot" and "it was never told" look identical afterwards.
      process.stdout.write('okc: could not restore what this task remembers, starting fresh — ' + e.message + '\n')
    }

    const args = ['-p', brief, '--dangerously-skip-permissions', '--output-format', 'json']
    if (rulesFile) args.push('--append-system-prompt-file', rulesFile)
    if (resume) args.push('--resume', String(resume))

    // THE ANSWER IS READ WHETHER OR NOT IT EXITED WELL, and that is not
    // defensive coding — it is the ordinary case. A machine with no worker
    // credential answers
    //
    //     {"is_error":true, ... ,"result":"Not logged in · Please run /login"}
    //
    // and exits 1. Treating a non-zero exit as opaque would report that as "the
    // worker failed: {"is_error":true,"duration_api_ms":0,...}" — the one useful
    // sentence buried in four hundred characters of telemetry, for the single
    // most likely thing to be wrong with a machine.
    let out = ''
    let died = null
    try {
      out = cp.execFileSync('claude', args, {
        encoding: 'utf8',
        cwd: cwd || process.cwd(),
        timeout,
        // A transcript is not small, and truncating one at the default 1MB turns
        // a finished run into unparseable JSON -- which reads as the worker
        // having failed.
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (e) {
      if (e.killed) throw new Error(`the worker was still going after ${Math.round(timeout / 60000)} minutes, so it was stopped`)
      out = String(e.stdout || '')
      died = e
    }

    let said = null
    try { said = JSON.parse(out) } catch { /* it said something else, handled below */ }

    // KEPT NOW, BEFORE ANY OF THE REFUSALS BELOW.
    //
    // Every branch after this point throws, and a run that ended badly is the
    // one whose transcript is worth most -- it is the only record of what the
    // worker was doing when it went wrong. Putting this after the checks would
    // keep a transcript exactly when nobody needs one.
    //
    // The machine is rolled back minutes from now, so this is the last chance
    // rather than an optimisation.
    try {
      const size = rememberThis(said && said.session_id)
      if (size) process.stdout.write(`okc: kept what this task remembers (${Math.round(size / 1024)} KB)\n`)
    } catch (e) {
      // Said, never thrown. Failing the work because its transcript could not be
      // filed would be the tail wagging the dog -- and the work itself may have
      // succeeded, which is the thing somebody actually asked for.
      process.stdout.write('okc: could not keep what this task remembers — ' + e.message + '\n')
    }

    // ITS OWN ANSWER FIRST. A worker that ran and refused is not a worker that
    // did the work, and the difference is inside this JSON rather than in the
    // exit code -- `claude -p` exits 0 having declined, and exits 1 with the
    // reason in `result`.
    if (said && said.is_error) throw new Error('the worker stopped: ' + (said.result || 'it did not say why'))
    if (!said) {
      const loudest = String((died && died.stderr) || out || '').trim().split('\n').slice(-3).join(' ')
      throw new Error((died ? 'the worker failed' : 'the worker answered with something that is not JSON') +
        (loudest ? ': ' + loudest.slice(0, 300) : ''))
    }
    if (died) throw new Error(`the worker exited ${died.status} having said: ${String(said.result || '').slice(0, 300)}`)

    return {
      text: said.result || '',
      session: said.session_id || null,
      turns: said.num_turns || 0,
      // Named for what it is rather than passed through, because `total_cost_usd`
      // is a field of somebody else's JSON and this is an API.
      cost: said.total_cost_usd == null ? null : said.total_cost_usd,
      ms: said.duration_ms || null,
      raw: said
    }
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
