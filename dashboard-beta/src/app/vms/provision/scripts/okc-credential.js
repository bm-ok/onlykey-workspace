#!/usr/bin/env node
'use strict'

// THE GUEST'S HALF OF A CREDENTIAL HANDOVER.
//
// Two steps, because a shell command is one shot and there is a person's worth of
// round trip in between:
//
//   okc-credential begin     make a keypair, keep the private half, print the
//                            public one
//   okc-credential finish    read the sealed reply on STDIN, open it with that
//                            private half, write the credential, and forget the
//                            key
//
// WHY ANY OF THIS. The credential used to arrive as itself inside a shell
// command: visible in `ps` to every user on this machine, kept in shell history,
// and a plain string in the dashboard's memory on the way. The channel was always
// encrypted — that was never the hole. What crosses now is a public key and a
// ciphertext, and neither is a secret.
//
// THE PRIVATE HALF TOUCHES DISK, and that is the honest cost of doing it in two
// commands. It is written 0600 in a directory only this user can enter, it exists
// for the seconds between the two steps, and `finish` removes it whether or not
// the decryption worked. The alternative — one long-lived key per machine — would
// mean a key on disk for the life of the machine that opens every credential it
// is ever handed, which is worse in the way that matters.
//
// ON STDIN, NOT IN ARGV. The sealed reply is not secret, and putting it in a
// command line anyway would be teaching the habit this exists to break.
//
// NO DEPENDENCIES. Node's own crypto, the same primitives the host uses — see
// core/handover.js, which this must agree with exactly.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')

const VERSION = 'okc-handover-1'
const HOME = process.env.HOME || os.homedir()
const DIR = path.join(HOME, '.okc-handover')
const KEY = path.join(DIR, 'private.pem')
const WHERE = path.join(HOME, '.claude', '.credentials.json')

const keyFrom = (shared, salt) =>
  Buffer.from(crypto.hkdfSync('sha256', shared, salt, Buffer.from(VERSION, 'utf8'), 32))

function begin () {
  // A FRESH PAIR EVERY TIME. The key that can open a credential exists for one
  // handover, so a recording of an old exchange is not something a key found
  // later will open.
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519')

  fs.rmSync(DIR, { recursive: true, force: true })
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 })
  fs.writeFileSync(KEY, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })

  // The only thing printed, and it is public by definition.
  process.stdout.write(publicKey.export({ type: 'spki', format: 'pem' }).toString().trim() + '\n')
}

function finish (raw) {
  let sealed = null
  try { sealed = JSON.parse(raw) } catch (e) { fail(`the sealed reply is not JSON: ${e.message}`) }
  if (!sealed || sealed.v !== VERSION) fail(`this is not ${VERSION}`)

  let privateKey = null
  try {
    privateKey = crypto.createPrivateKey(fs.readFileSync(KEY, 'utf8'))
  } catch {
    fail('there is no key here to open it with — "begin" was not run, or something has already used it')
  }

  let text = ''
  try {
    const shared = crypto.diffieHellman({ privateKey, publicKey: crypto.createPublicKey(sealed.pub) })
    const key = keyFrom(shared, Buffer.from(sealed.salt, 'base64'))
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'))
    text = Buffer.concat([decipher.update(Buffer.from(sealed.body, 'base64')), decipher.final()]).toString('utf8')
  } catch (e) {
    // FORGOTTEN EVEN WHEN IT FAILED. A key left behind is one that opens the next
    // reply somebody replays at this machine.
    forget()
    fail(`it would not open: ${e.message}`)
  }

  forget()

  // 0600 AND ONLY EVER WRITTEN HERE. Claude Code reads this file itself; what
  // this app controls is that it arrives without being in a command line, and
  // that it is taken away again when the work ends.
  fs.mkdirSync(path.dirname(WHERE), { recursive: true })
  fs.writeFileSync(WHERE, text, { mode: 0o600 })

  // A fingerprint, never the value — the same sixteen hex characters the host
  // compares by, so both sides can say "the same one" without either printing it.
  const print = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16)
  process.stdout.write(`okc-credential-placed ${print}\n`)
}

const forget = () => { try { fs.rmSync(DIR, { recursive: true, force: true }) } catch { /* already gone */ } }

function fail (why) {
  process.stderr.write(`okc-credential: ${why}\n`)
  process.exit(1)
}

const what = process.argv[2]
if (what === 'begin') {
  begin()
} else if (what === 'finish') {
  const chunks = []
  process.stdin.on('data', c => chunks.push(c))
  process.stdin.on('end', () => finish(Buffer.concat(chunks).toString('utf8')))
} else {
  fail('say "begin" or "finish". begin prints a public key; finish reads the sealed reply on stdin.')
}
