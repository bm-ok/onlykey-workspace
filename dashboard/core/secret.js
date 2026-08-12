'use strict'

// Something worth keeping, kept so that having the file is not enough.
//
// What this protects against, and what it does not. It does NOT protect against
// somebody running as you on this machine -- nothing on a single-user desktop
// can, and pretending otherwise is how a false sense of protection gets built.
// It protects against the file being READ SOMEWHERE ELSE: copied to a backup,
// synced to a cloud folder, pulled off the disk, handed over in a support
// bundle, or picked up by a process running as another account or as an
// administrator.
//
// That is the realistic threat for a credential on a workstation, and a plain
// file loses to all of it. This was plain until it was looked at: the ACL kept
// other users out, and the token was legible to anything that got past that.
//
// ON WINDOWS: DPAPI, through PowerShell, which is always there. The key is
// derived from the logged-in account by the operating system, so there is no key
// of ours to store -- and a key stored next to the thing it encrypts is not
// encryption, it is filing.
//
// ELSEWHERE: the file's own permissions, which are real on those systems.
// Nothing is pretended: `sealed` says which of the two happened, so a reader can
// tell protected-at-rest from merely-not-readable-by-others rather than assuming
// the stronger one.

const fs = require('node:fs')
const os = require('node:os')
const { execFileSync } = require('node:child_process')

const WINDOWS = process.platform === 'win32'

// Marks a file as DPAPI ciphertext. Without it, a file written before this
// existed -- or on another platform -- would be fed to the decryptor and fail as
// corruption rather than as "this one is not sealed".
const MARK = 'okc-dpapi-v1:'

const powershell = script => execFileSync(
  process.env.SystemRoot ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` : 'powershell.exe',
  ['-NoProfile', '-NonInteractive', '-Command', script],
  { encoding: 'utf8', timeout: 30000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
).trim()

// Written and read as base64 through the command line rather than through files,
// so the cleartext never exists anywhere but in memory. A temporary file would
// defeat the whole exercise: it is the copy that gets left behind.
function seal (buffer) {
  if (!WINDOWS) return { data: buffer, sealed: false }
  const b64 = Buffer.from(buffer).toString('base64')
  const out = powershell(
    'Add-Type -AssemblyName System.Security; ' +
    `$b=[Convert]::FromBase64String('${b64}'); ` +
    '[Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Protect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser))'
  )
  return { data: Buffer.from(MARK + out, 'utf8'), sealed: true }
}

function open (buffer) {
  const text = Buffer.from(buffer).toString('utf8')
  if (!text.startsWith(MARK)) return Buffer.from(buffer)      // written before this, or not on Windows
  if (!WINDOWS) throw new Error('This credential was sealed on Windows and can only be opened there, by the account that sealed it.')

  const b64 = text.slice(MARK.length).trim()
  const out = powershell(
    'Add-Type -AssemblyName System.Security; ' +
    `$b=[Convert]::FromBase64String('${b64}'); ` +
    '[Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser))'
  )
  return Buffer.from(out, 'base64')
}

// Whether what is on disk is ciphertext, without opening it. Used to report the
// truth in the window rather than a claim -- and to notice a file that predates
// this and should be sealed on next write.
function isSealed (file) {
  try { return fs.readFileSync(file).toString('utf8').startsWith(MARK) } catch { return false }
}

const write = (file, buffer) => {
  const { data, sealed } = seal(buffer)
  fs.writeFileSync(file, data)
  // Still set, and still worth setting: on anything but Windows it is the whole
  // protection, and on Windows it costs nothing to ask.
  try { fs.chmodSync(file, 0o600) } catch { /* windows ignores this, which is why the sealing exists */ }
  return sealed
}

const read = file => open(fs.readFileSync(file))

// Taken out of anything crossing back from a machine, before it is kept here.
//
// THIS IS THE INTERACTION THAT IS EASY TO MISS. A worker must be able to read
// its own credential -- it cannot authenticate otherwise -- and it runs as the
// user that owns the file, with passwordless sudo besides. So the credential is
// readable by exactly the thing running unattended, and nothing inside the
// machine can change that: encrypting it there would need a key that thing could
// also reach.
//
// What can be changed is what happens when it appears in output. Transcripts and
// run logs are pulled to this host and KEPT, so a token in an env dump, a stack
// trace, an error message or a stray `cat` is not a moment of exposure -- it is
// copied out and filed, permanently, by design.
//
// Defensive rather than trusting: this does not assume a token never appears, it
// assumes one eventually will.
const PATTERNS = [
  // Anthropic keys and oauth tokens, whatever the prefix after sk-ant-.
  [/sk-ant-[A-Za-z0-9_-]{6,}/g, 'sk-ant-[redacted]'],
  // The credential file's own shape, in case it is printed whole.
  [/("(?:accessToken|refreshToken|apiKey)"\s*:\s*")[^"]+(")/g, '$1[redacted]$2'],
  // Anything handed over as a bearer.
  [/(Authorization:\s*Bearer\s+)\S+/gi, '$1[redacted]'],
  [/(ANTHROPIC_API_KEY\s*[=:]\s*)\S+/g, '$1[redacted]']
]

const redact = text => PATTERNS.reduce((s, [re, to]) => s.replace(re, to), String(text == null ? '' : text))

module.exports = { seal, open, write, read, isSealed, redact, WINDOWS, MARK, os }
