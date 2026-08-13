'use strict'

// The key this app uses to get into the machines it made.
//
// ITS OWN, not the operator's. Until now the way in was whatever was in
// `~/.ssh/id_ed25519` — the human's personal key, offered by the make-a-machine
// dialog and installed into every guest's `authorized_keys`. That works and is
// wrong for three reasons, none of which show up until they matter:
//
//   * It is the same key that opens everything else that person can reach. A
//     runner is a machine that runs unattended code written by a model; putting
//     the key that opens the operator's real accounts inside it is a larger
//     statement than anybody meant to make.
//   * It is not the app's to reason about. The app cannot say what the key
//     protects, when it was made, or whether it should be rotated, because it
//     belongs to somebody else.
//   * It disappears. A key in a home directory is absent on another account, on
//     a rebuilt workstation, or in any context where this app runs and that
//     person's profile is not loaded.
//
// So this makes and keeps a key of its own, beside the TLS material and for the
// same reasons. The two are the same kind of thing: a credential this app needs
// in order to be itself, which nothing else should have to provide.
//
// KEPT AS A FILE, unsealed, and that is deliberate rather than an oversight.
// `ssh` reads a private key from disk; anything encrypted at rest would have to
// be decrypted to a file before use, which is the same exposure with more steps
// and a temporary copy nobody cleans up. It sits in the app's data directory
// under the user's profile, which is the same protection the TLS private key
// has -- exactly as strong, and worth being honest that this is not more.

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const data = require('./data')

const DIR = process.env.OKC_KEYS || data.DIR

const KEY = () => path.join(DIR, 'id_okc')
const PUB = () => path.join(DIR, 'id_okc.pub')

// ssh-keygen ships with git, which this already requires -- the same reasoning
// that lets the TLS material use git's openssl. Looked for in the same places
// rather than assumed to be on PATH, because on Windows it usually is not.
const KEYGEN = [
  process.env.OKC_SSH_KEYGEN,
  'C:\\Program Files\\Git\\usr\\bin\\ssh-keygen.exe',
  'C:\\Windows\\System32\\OpenSSH\\ssh-keygen.exe',
  '/usr/bin/ssh-keygen',
  'ssh-keygen'
].filter(Boolean)

const there = p => { try { return fs.statSync(p).isFile() } catch { return false } }
const keygen = () => KEYGEN.find(there) || 'ssh-keygen'

const have = () => there(KEY()) && there(PUB())

// The public half, as one line, exactly as it must appear in authorized_keys.
function publicKey () {
  try { return fs.readFileSync(PUB(), 'utf8').trim() } catch { return null }
}

// Its fingerprint, for saying "this is the key" without printing a key.
function fingerprint () {
  if (!have()) return null
  try {
    // SHA256:xxxx... comment -- the middle field is the part a person compares.
    const out = execFileSync(keygen(), ['-lf', PUB()], { encoding: 'utf8', timeout: 15000, windowsHide: true })
    return (out.trim().split(/\s+/)[1]) || null
  } catch { return null }
}

// Made once, and never quietly remade.
//
// A NEW KEY LOCKS OUT EVERY EXISTING MACHINE, because the old public half is
// what is in their authorized_keys and nothing here can reach in to change it.
// So `force` is a deliberate act with a stated cost, not something that happens
// because a file was missing at an awkward moment.
function make ({ force = false } = {}) {
  fs.mkdirSync(DIR, { recursive: true })
  if (have() && !force) return { made: false, path: KEY() }

  for (const f of [KEY(), PUB()]) { try { fs.unlinkSync(f) } catch { /* was not there */ } }

  // ed25519: short, fast, and the default any modern sshd accepts. No
  // passphrase, because this is used unattended -- a passphrase this app would
  // have to store beside the key protects nothing.
  execFileSync(keygen(), [
    '-t', 'ed25519',
    '-N', '',
    '-C', 'okc-dashboard',
    '-f', KEY()
  ], { timeout: 60000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })

  // Windows ignores this; on anything else it is the whole protection, and ssh
  // refuses a private key that others can read.
  try { fs.chmodSync(KEY(), 0o600) } catch { /* as above */ }
  return { made: true, path: KEY() }
}

const ensure = (opts) => { make(opts); return { key: KEY(), pub: PUB(), publicKey: publicKey() } }

// What the window shows: enough to recognise the key, and never the key itself.
function state () {
  if (!have()) {
    return {
      ok: false,
      missing: true,
      why: 'This app has no ssh key of its own yet. Machines built before one exists are reachable only with whatever key was chosen when they were made.'
    }
  }
  let made = null
  try { made = fs.statSync(KEY()).mtime.toISOString() } catch { /* unreadable date is not worth an error */ }
  return {
    ok: true,
    missing: false,
    fingerprint: fingerprint(),
    publicKey: publicKey(),
    // The path, not the contents. A window that shows a private key is a window
    // that ends up in a screenshot.
    file: KEY(),
    made,
    why: null
  }
}

// ---- how anything else finds these machines ---------------------------
//
// VS CODE IS WHY THIS EXISTS. `vmShell` can be told which key to use with `-i`,
// but VS Code Remote runs plain `ssh user@host` and takes everything else from
// ssh's own configuration -- so a key that is not in a config file is a key VS
// Code will never offer, and "open in VS Code" would quietly fall back to
// whatever the operator's default identity happens to be. Which is the key this
// whole file exists to stop using.
//
// So the machines get written into a config of their own, and the operator's
// `~/.ssh/config` gets one `Include` line pointing at it. That is the
// conventional way to add hosts without editing somebody's file every time one
// changes: their config keeps whatever is in it, and everything this app
// manages stays in one file it can rewrite wholesale.

const os = require('node:os')

const slashes = p => String(p).split(String.fromCharCode(92)).join('/')

const CONFIG = () => path.join(DIR, 'ssh_config')
const USER_CONFIG = () => path.join(os.homedir(), '.ssh', 'config')

// An alias per machine, so `ssh okc-runner1` works from anywhere and VS Code can
// be pointed at a name rather than at a user and an address it would have to be
// told about separately.
const aliasFor = name => `okc-${String(name).replace(/[^A-Za-z0-9._-]/g, '-')}`

// Rewritten whole, every time, from what the registry knows.
//
// Not appended to: a machine's address changes, machines are deleted, and a file
// that only ever grows would accumulate entries pointing at nothing -- which
// fail slowly and confusingly rather than not existing.
function writeConfig (machines) {
  fs.mkdirSync(DIR, { recursive: true })
  const lines = [
    '# Written by the dashboard. Edits here are lost: it is rewritten whenever a',
    '# machine dials in or is deleted. Anything of your own belongs in ~/.ssh/config.',
    ''
  ]
  for (const m of machines) {
    if (!m.address || !m.user) continue
    lines.push(
      `Host ${aliasFor(m.name)}`,
      `  HostName ${m.address}`,
      `  User ${m.user}`,
      // This key ONLY IF THE MACHINE WOULD ACCEPT IT.
      //
      // Naming it unconditionally broke every machine built before the key
      // existed: they have somebody else's public half in their
      // authorized_keys, and `IdentitiesOnly` then guarantees the one identity
      // that cannot work is the only one offered. A machine built with the
      // operator's key is left to ssh's own defaults, which is what reached it
      // before and still does.
      //
      // Forward slashes: ssh reads this file on Windows too, and a backslash in
      // a config value is an escape character there rather than a separator.
      ...(m.mine ? [`  IdentityFile ${slashes(KEY())}`, '  IdentitiesOnly yes'] : []),
      // These machines are made and destroyed constantly and their addresses are
      // reused, so a changed host key is expected rather than alarming. Not
      // written to the operator's known_hosts for the same reason.
      '  StrictHostKeyChecking no',
      `  UserKnownHostsFile ${slashes(path.join(DIR, 'known_hosts'))}`,
      ''
    )
  }
  fs.writeFileSync(CONFIG(), lines.join('\n'))
  return CONFIG()
}

// The same path, written the way an MSYS build of ssh understands it.
//
// `C:/Users/x` and `/c/Users/x` are the same file and neither program accepts
// the other's spelling.
const msys = p => slashes(p).replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`)

// TWO SPELLINGS OF ONE PATH, because there are two different `ssh` programs on a
// Windows machine and they do not read the same string.
//
// Windows OpenSSH -- the one VS Code Remote runs -- wants `C:/Users/...`. The
// `ssh` that comes with git is an MSYS build, and to it that is a RELATIVE path:
// it looks for a file called `C:` inside `~/.ssh`, does not find one, and
// carries on WITHOUT SAYING ANYTHING, because a missing include is not an error
// in either program. So the alias simply is not there, and `ssh okc-runner2` --
// which is what `vmShell` tells a person to type -- answers "could not resolve
// hostname" as though the machine were the problem.
//
// Writing both lines costs nothing: each program reads the spelling it
// understands and silently ignores the other, which is the same silence that
// caused the bug, used deliberately this time.
const includeLines = () => {
  const win = slashes(CONFIG())
  const nix = msys(CONFIG())
  return win === nix ? [`Include "${win}"`] : [`Include "${win}"`, `Include "${nix}"`]
}

// The operator's config, given the lines it is missing.
//
// `Include` has to come before any `Host` block to apply to everything, which is
// why it goes at the top. Adding it is the only edit this app ever makes to a
// file it does not own, and it is idempotent.
//
// EACH LINE IS CHECKED SEPARATELY, so a config written before this knew about
// the second spelling gets repaired rather than left half-working -- which is
// the state every machine that already exists is in.
function ensureInclude () {
  const user = USER_CONFIG()
  let current = ''
  try { current = fs.readFileSync(user, 'utf8') } catch { /* first time */ }

  const missing = includeLines().filter(l => !current.includes(l))
  if (!missing.length) return { added: false, file: user, lines: [] }

  fs.mkdirSync(path.dirname(user), { recursive: true })
  fs.writeFileSync(user, `# Added by the dashboard, so its machines can be reached by name.\n${missing.join('\n')}\n\n${current}`)
  return { added: true, file: user, lines: missing }
}

module.exports = {
  ensure, make, have, state, publicKey, fingerprint,
  writeConfig, ensureInclude, includeLines, aliasFor, CONFIG, USER_CONFIG,
  KEY, PUB, DIR
}
