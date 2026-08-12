'use strict'

// The certificate this host serves with, and the small authority that signed it.
//
// Made once and kept. Not regenerated per start: every machine is told to trust
// this authority, so a new one each time would mean every machine losing its
// trust every time the dashboard restarts -- which happens constantly while
// working on it.
//
// KEPT OUTSIDE THE REPOSITORY, in the operating system's per-user data
// directory. `state/` is ignored by git, but ignored is a rule that can be
// changed or overridden by a `-f`; outside the working tree there is nothing for
// git to decide about.
//
// The path is COMPUTED rather than taken from `nw.App.dataPath`, which exists
// only inside NW.js. The command line is a plain node process and so is the
// test, and a certificate nothing outside the window can find is one nothing
// outside the window can hand to a machine. One location, whatever started the
// process -- two would mean two authorities and a machine trusting the wrong.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')

const DIR = process.env.OKC_KEYS || (process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'okc-dashboard')
  : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'okc-dashboard'))

const file = name => path.join(DIR, name)
const CA_KEY = () => file('ca.key')
const CA_PEM = () => file('ca.pem')
const KEY = () => file('server.key')
const PEM = () => file('server.pem')

// One year.
//
// Which means this certificate WILL expire, on a date, and that is the point at
// which every machine stops being able to fetch its scripts or push its work.
// A date nobody remembers choosing is the worst way for that to arrive, so how
// long is left is read off the certificate and reported -- see `state` -- rather
// than discovered as a machine failing for reasons of its own.
const DAYS = '365'

// Said out loud from here on, because a month is enough time to rebuild trust on
// every machine without hurrying.
const WARN_WITHIN_DAYS = 30

// Same problem as VirtualBox: installed but not on PATH is normal on Windows.
// Git ships one, and git is already required here, so this adds nothing that was
// not already a dependency.
const OPENSSL = [
  'openssl',
  'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
  'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe',
  '/usr/bin/openssl'
]

let found = null
function openssl (args, opts = {}) {
  if (!found) {
    for (const candidate of OPENSSL) {
      try {
        execFileSync(candidate, ['version'], { stdio: 'ignore', timeout: 10000, windowsHide: true })
        found = candidate
        break
      } catch { /* try the next */ }
    }
    if (!found) throw new Error('openssl was not found, so a certificate cannot be made. Git ships one; check that git is installed.')
  }
  // stderr is discarded on purpose. openssl narrates key generation with a wall
  // of dots and "-----" separators, none of which is an error and all of which
  // would arrive in the live log looking like one.
  return execFileSync(found, args, {
    encoding: 'utf8',
    timeout: 60000,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
    ...opts
  })
}

// Every address a guest might reach this host on.
//
// A certificate is checked against the name the client DIALLED, and a guest
// dials an IP -- so the IPs have to be in it. subjectAltName specifically, not
// the common name: clients have ignored CN for this purpose for years, and a
// CN-only certificate is the usual reason a self-signed setup fails with an
// error that says nothing about names.
function addresses () {
  const out = new Set(['127.0.0.1', '::1'])
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const e of entries || []) {
      if (e.family === 'IPv4' && !e.address.startsWith('169.254')) out.add(e.address)
    }
  }
  return [...out]
}

const there = p => { try { return fs.statSync(p).isFile() } catch { return false } }

const have = () => there(CA_KEY()) && there(CA_PEM()) && there(KEY()) && there(PEM())

// What the certificate actually covers, read back from the certificate itself
// rather than from what we meant to put in it.
function covers () {
  try {
    const cert = new crypto.X509Certificate(fs.readFileSync(PEM()))
    return String(cert.subjectAltName || '')
      .split(',')
      .map(s => s.trim().replace(/^(IP Address|IP|DNS):/, ''))
      .filter(Boolean)
  } catch { return [] }
}

// Everything that decides whether this certificate is still any use, read off
// the certificate rather than from what we meant to put in it.
//
// TWO WAYS IT STOPS WORKING, and they are unrelated. It expires -- a date, known
// in advance, a month's warning. Or the host's address moves and the certificate
// no longer names where guests are told to go, which has no date and no warning
// at all. Both end with machines that cannot fetch or push, so both are answered
// here and neither is left to be discovered as a machine failing.
function state (address) {
  if (!have()) return { ok: false, missing: true }
  let cert
  try { cert = new crypto.X509Certificate(fs.readFileSync(PEM())) } catch { return { ok: false, unreadable: true } }

  const validTo = new Date(cert.validTo)
  const daysLeft = Math.floor((validTo - Date.now()) / 86400000)
  const named = covers()
  const matches = !address || named.includes(address)

  return {
    ok: matches && daysLeft > 0,
    covers: named,
    address: address || null,
    matches,
    validTo: validTo.toISOString(),
    daysLeft,
    expired: daysLeft <= 0,
    expiringSoon: daysLeft > 0 && daysLeft <= WARN_WITHIN_DAYS,
    // Said in full here so every place that reports it says the same thing.
    why: !matches
      ? `The certificate does not cover ${address}. It names ${named.join(', ') || 'nothing'} — this host's address has moved since it was made, so machines cannot verify it. Make a new one.`
      : daysLeft <= 0
        ? `The certificate expired on ${validTo.toDateString()}. Machines cannot fetch their scripts or push their work until a new one is made.`
        : daysLeft <= WARN_WITHIN_DAYS
          ? `The certificate expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}, on ${validTo.toDateString()}. Making a new one means every machine has to be set up again, so it is worth doing before it stops.`
          : null
  }
}

const matches = address => state(address).matches

function make () {
  fs.mkdirSync(DIR, { recursive: true })
  const names = addresses()

  // The authority. Only ever signs this one certificate, and its private key
  // never leaves this directory -- what a machine is given is the certificate,
  // which is public by design.
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', CA_KEY(), '-out', CA_PEM(), '-days', DAYS,
    '-subj', '/CN=okc-dashboard local authority',
    '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0',
    '-addext', 'keyUsage=critical,keyCertSign,cRLSign'])

  const csr = file('server.csr')
  const ext = file('server.ext')
  openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', KEY(), '-out', csr, '-subj', '/CN=okc-dashboard'])

  fs.writeFileSync(ext, [
    'basicConstraints=CA:FALSE',
    'keyUsage=critical,digitalSignature,keyEncipherment',
    'extendedKeyUsage=serverAuth',
    `subjectAltName=${['DNS:localhost', ...names.map(n => `IP:${n}`)].join(',')}`
  ].join('\n') + '\n')

  openssl(['x509', '-req', '-in', csr, '-CA', CA_PEM(), '-CAkey', CA_KEY(),
    '-CAcreateserial', '-out', PEM(), '-days', DAYS, '-extfile', ext])

  try { fs.unlinkSync(csr); fs.unlinkSync(ext) } catch { /* tidiness only */ }
  for (const p of [CA_KEY(), KEY()]) {
    try { fs.chmodSync(p, 0o600) } catch { /* best effort on Windows */ }
  }
  return names
}

// The certificate and key to serve with, making them first if there are none.
//
// `force` is the way out of the one thing a never-expiring certificate cannot
// survive: the host's address changing. Nothing regenerates on its own, because
// doing so silently would break every machine's trust without anybody asking for
// it -- it is offered, and reported, and left as a decision.
function ensure ({ force = false } = {}) {
  if (force || !have()) make()
  const ca = fs.readFileSync(CA_PEM())
  return {
    dir: DIR,
    key: fs.readFileSync(KEY()),
    cert: fs.readFileSync(PEM()),
    ca,
    caFile: CA_PEM(),
    covers: covers(),
    // What a guest checks the authority against before trusting it. Not a
    // secret: it is published so that fetching the authority over an
    // unprotected connection is still safe, which is what makes the very first
    // fetch on a brand-new machine possible at all.
    fingerprint: new crypto.X509Certificate(ca).fingerprint256.replace(/:/g, '').toLowerCase()
  }
}

module.exports = { ensure, have, covers, matches, state, addresses, DIR, CA_PEM }
