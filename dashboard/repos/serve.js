'use strict'

// The workspace's repositories, served over HTTP so a machine can clone them.
//
// Node and git, nothing else. Git's own transport is a pair of programs --
// `upload-pack` reads, `receive-pack` writes -- and the HTTP protocol is a thin
// wrapper around piping them: ask what refs exist, then stream a packfile. So
// this spawns the same git that is already on the host and gets out of the way.
//
// WHY THIS RATHER THAN A SHARED FOLDER. A guest pushing to a writable mount runs
// `receive-pack` ITSELF, on its own side of the share -- so the repository's
// hooks execute in the guest, and the guest can also rewrite them, because the
// mount is writable and they live inside it. Enforcement at that end is a
// request, not a rule. Served over HTTP, the pack programs run HERE, in a
// directory no guest can reach, and a refusal is a refusal.
//
// It stays generic the way everything else here does: it does not know the name
// of a single repository. It serves what it finds.

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const { spawn } = require('node:child_process')
const log = require('../core/log')

// Same convention as the provisioning scripts: what belongs to a project lives
// outside the app, and one variable moves it.
const DIR = process.env.OKC_REPOS_DIR || path.join(__dirname, '..', '..', 'workspace')

const isDir = p => { try { return fs.statSync(p).isDirectory() } catch { return false } }
const isFile = p => { try { return fs.statSync(p).isFile() } catch { return false } }

// A name from a URL is never joined to a path until it has been through this.
//
// Not a blocklist of "../" and friends: a name either matches this or it is not
// a name. Anything else -- a slash, a backslash, a drive letter, a leading dot --
// is refused before it can be part of a path, because the alternative is being
// sure that every way of spelling "the parent directory" was thought of.
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

// Where a repository's git directory actually is, or null if there is not one.
//
// Both shapes are served. An ordinary checkout keeps its git directory in `.git`
// and is what is sitting in the workspace; a bare one IS the directory. Told
// apart by what is inside rather than by the name, because `<name>.git` is a
// convention and conventions are not always followed.
function gitDirOf (name) {
  if (!NAME.test(name)) return null
  const base = path.join(DIR, name)
  if (!isDir(base)) return null

  const dotGit = path.join(base, '.git')
  if (isDir(dotGit)) return dotGit
  if (isDir(path.join(base, 'objects')) && isFile(path.join(base, 'HEAD'))) return base
  return null
}

// What there is to clone. Read fresh per request, like the provisioning scripts,
// so a repository added to the workspace needs nothing restarted.
function list () {
  if (!isDir(DIR)) return []
  return fs.readdirSync(DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && NAME.test(e.name))
    .map(e => ({ name: e.name, dir: gitDirOf(e.name) }))
    .filter(r => r.dir)
    // Bare means the git directory IS the directory, rather than a `.git` inside
    // it. Compared rather than read off the name: `<name>.git` is only a
    // convention, and a bare repository not spelled that way would be labelled
    // backwards -- which will matter as soon as pushes land in bare repos.
    .map(r => ({ name: r.name, bare: r.dir === path.join(DIR, r.name) }))
}

// ---- the protocol ----------------------------------------------------
//
// Git frames its control messages as "pkt-lines": four hex digits giving the
// length, then the bytes. The length COUNTS THE FOUR DIGITS, which is the detail
// every hand-written version gets wrong -- and it fails as a client that will not
// clone rather than as an error saying what was wrong. So the length is computed
// from the finished line here and never written by hand.
const pkt = line => (Buffer.byteLength(line) + 4).toString(16).padStart(4, '0') + line
const FLUSH = '0000'

const SERVICES = {
  'git-upload-pack': 'upload-pack',
  'git-receive-pack': 'receive-pack'
}

// What a write is allowed to be.
//
// `core.hooksPath` points git at the app's own hook rather than one inside the
// repository being written to. Two things follow, and both matter: nothing is
// ever written into the repositories -- they stay ordinary checkouts that git,
// VS Code and a person at a terminal all see identically -- and the rule lives
// somewhere no guest can reach, which is what makes it a rule.
//
// The other two are git's own, and they protect the thing that makes this
// storage: history that arrived is not allowed to change or vanish. Enforced
// here rather than in the hook because git already does it, and a second
// implementation would only be a chance to get it wrong.
const HOOKS = path.join(__dirname, 'hooks')
const WRITE_CONFIG = [
  '-c', `core.hooksPath=${HOOKS}`,
  '-c', 'receive.denyNonFastForwards=true',
  '-c', 'receive.denyDeletes=true'
]

const noCache = {
  'cache-control': 'no-cache, max-age=0, must-revalidate',
  expires: 'Fri, 01 Jan 1980 00:00:00 GMT',
  pragma: 'no-cache'
}

// Git is spawned the same way for both phases, so its failure is handled once.
//
// A spawn that fails after the headers have gone out cannot be turned into an
// error page -- the client is already reading a body. Destroying the response is
// then the honest move: git reports "the remote end hung up", which is true,
// rather than a clean-looking empty result that reads as an empty repository.
function pipeGit (res, args, { onExit, env } = {}) {
  const git = spawn('git', args, env ? { env: { ...process.env, ...env } } : undefined)
  git.on('error', err => {
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' }).end(`git could not be run: ${err.message}\n`)
    else res.destroy()
  })
  git.stdout.pipe(res)
  // stderr is git talking to an operator, not to the client. It belongs in the
  // live log with everything else rather than corrupting the packfile.
  git.stderr.on('data', d => log.on('git').warn(String(d).trim()))
  if (onExit) git.on('close', code => onExit(code))
  return git
}

// The arguments for one service. A write carries the rules with it, so there is
// no path that starts receive-pack without them.
const argsFor = (service, dir, extra = []) => service === 'git-receive-pack'
  ? [...WRITE_CONFIG, 'receive-pack', '--stateless-rpc', ...extra, dir]
  : ['upload-pack', '--stateless-rpc', ...extra, dir]

// Phase one: what refs are here, and what this server can do.
function advertise (res, { dir, service, repo, env }) {
  res.writeHead(200, { 'content-type': `application/x-${service}-advertisement`, ...noCache })
  res.write(pkt(`# service=${service}\n`) + FLUSH)
  log.on('git', repo).info(`${repo}: advertising refs for ${service}`)
  pipeGit(res, argsFor(service, dir, ['--advertise-refs']), { env })
}

// Phase two: the packfile itself, in whichever direction.
//
// The request body may be gzipped -- git compresses it when it is worth it, and
// says so in a header. Piped through undecoded, git reads compressed bytes as
// protocol and the clone fails in a way that points nowhere near the cause.
function rpc (req, res, { dir, service, repo, env }) {
  res.writeHead(200, { 'content-type': `application/x-${service}-result`, ...noCache })

  const started = Date.now()
  const to = log.on('git', repo)
  to.info(`${repo}: ${service}`)

  const git = pipeGit(res, argsFor(service, dir), {
    env,
    onExit: code => {
      const took = ((Date.now() - started) / 1000).toFixed(1)
      if (code === 0) to.good(`${repo}: ${service} finished in ${took}s`)
      else to.bad(`${repo}: ${service} exited ${code} after ${took}s`)
    }
  })

  const body = req.headers['content-encoding'] === 'gzip' ? req.pipe(zlib.createGunzip()) : req
  body.pipe(git.stdin)
  // A client that goes away mid-clone leaves git waiting on a pipe that will
  // never close.
  req.on('aborted', () => git.kill())
}

module.exports = { DIR, list, gitDirOf, advertise, rpc, SERVICES, NAME }
