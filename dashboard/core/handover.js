'use strict'

// HANDING A CREDENTIAL TO A MACHINE WITHOUT PUTTING IT IN A COMMAND LINE.
//
// What this replaces: the credential was base64'd and sent as
//
//     printf '%s' '<the whole credential>' | base64 -d > ~/.claude/.credentials.json
//
// down an authenticated channel. The wire was never the problem — that is TLS and
// ssh — and base64 is not encryption. The problem is the three places the value
// exists as itself on the way:
//
//   in argv on the guest    `ps` shows a running command line to every user on
//                           that machine, and the credential is in it
//   in shell history        the command is a shell command, and shells keep them
//   in this host's memory   as a plain string, for the length of the call
//
// SO THE THING THAT ASKED IS THE ONLY THING THAT CAN READ IT. The guest makes a
// keypair, the host makes one, each derives the same shared secret from the
// other's public half, and what crosses is ciphertext. Public keys and ciphertext
// in a command line are not secrets.
//
// X25519 AND AES-256-GCM, both from node's own crypto — this app has no
// dependencies and the guest has node because the agent needs it. GCM rather than
// CBC because it authenticates: a ciphertext altered in transit fails to open
// rather than decrypting to something else.
//
// EPHEMERAL ON BOTH SIDES, one pair per handover. The key that could decrypt a
// credential exists for the length of one call and then does not exist anywhere —
// so a recording of the exchange is not something a stolen key opens later.
//
// WHAT THIS IS NOT. It is not authentication: the guest's public key arrives over
// a channel this app already proved is that machine (its own token, its own ssh
// key), and this adds no opinion about who it is talking to. It is about the
// VALUE not existing in places that keep things.

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

// The one shape both sides agree on, written here and used by the guest half in
// provision/okc-credential.js. A change to either has to be a change to both, so
// the fields are named rather than positional and the version is carried.
const VERSION = 'okc-handover-1'

// HKDF rather than the raw shared secret as a key. X25519 gives 32 bytes with
// structure; a KDF gives 32 bytes without, and binds the key to what it is for so
// the same exchange cannot be reused for something else later.
const keyFrom = (shared, salt) =>
  Buffer.from(crypto.hkdfSync('sha256', shared, salt, Buffer.from(VERSION, 'utf8'), 32))

// The host's half: given what the guest published, produce what only that guest
// can open.
function sealFor (guestPublicPem, text) {
  const guestPublic = crypto.createPublicKey(guestPublicPem)
  const mine = crypto.generateKeyPairSync('x25519')
  const shared = crypto.diffieHellman({ privateKey: mine.privateKey, publicKey: guestPublic })

  // A fresh salt and a fresh iv per handover, sent in the clear beside the
  // ciphertext — neither is secret, and both are what stop two handovers of the
  // same credential looking identical.
  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const key = keyFrom(shared, salt)

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(Buffer.from(text, 'utf8')), cipher.final()])

  return {
    v: VERSION,
    // SPKI/PEM, which is what createPublicKey takes on the other side without any
    // encoding conventions of ours in between.
    pub: mine.publicKey.export({ type: 'spki', format: 'pem' }).toString().trim(),
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    body: body.toString('base64')
  }
}

// The guest's half, kept here as well so this host can prove the round trip
// without a machine — see the drills. The guest runs the same steps in
// provision/okc-credential.js.
function openWith (guestPrivateKey, sealed) {
  if (!sealed || sealed.v !== VERSION) throw new Error(`this is not ${VERSION}`)
  const shared = crypto.diffieHellman({
    privateKey: guestPrivateKey,
    publicKey: crypto.createPublicKey(sealed.pub)
  })
  const key = keyFrom(shared, Buffer.from(sealed.salt, 'base64'))
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(sealed.body, 'base64')), decipher.final()]).toString('utf8')
}

// A pair, for whichever side is asking. The guest makes one per handover and
// throws it away; this is also what the drills use to stand in for a guest.
function aPair () {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519')
  return {
    privateKey,
    publicKey,
    pem: publicKey.export({ type: 'spki', format: 'pem' }).toString().trim()
  }
}

// THE HANDOVER ITSELF, in two round trips, driven from here.
//
// The runner is passed in rather than required, so this file knows nothing about
// machines and the drills can hand it anything that runs a command.

// The guest's half, sent rather than installed. It could be provisioned — but
// then a machine built last month runs last month's half of a protocol this file
// changed today, and the failure is a decryption error on a machine at two in the
// morning. Sending it makes version skew impossible by construction, and it is
// four kilobytes of code that is not a secret.
const GUEST = path.join(__dirname, '..', 'provision', 'okc-credential.js')
const guestHalf = () => fs.readFileSync(GUEST, 'utf8')

const b64 = s => Buffer.from(s, 'utf8').toString('base64')

// Base64 has no shell metacharacter in it, which is why every one of these is
// quoted and none of them is escaped.
const PUT_THE_HALF = `mkdir -p "$HOME/.okc" && printf %s '<b64>' | base64 -d > "$HOME/.okc/credential.js"`

async function deliver ({ run, text, what, andThen = '' }) {
  // STEP ONE: THE GUEST SPEAKS FIRST. It makes the pair, keeps the private half,
  // and prints the public one. Nothing secret has been sent yet — there is
  // nothing to send until it has answered.
  const begin = await run(
    `set -u\n${PUT_THE_HALF.replace('<b64>', b64(guestHalf()))}\nnode "$HOME/.okc/credential.js" begin`,
    { what: what || 'asking it for a key to hand a credential over with', timeout: 60000 })

  // Matched rather than sliced: what comes back has this app's own framing around
  // it, and a key is recognisable.
  const pub = (String(begin.output || '').match(/-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/) || [])[0]
  if (!pub) {
    throw new Error(`It would not make a key to receive a credential with, so nothing was sent. It said: ${String(begin.output || '').trim().slice(-300)}`)
  }

  // STEP TWO: SEALED TO THAT KEY AND NOTHING ELSE. If the machine that answered
  // is not the machine this reaches — which the channel already prevents — what
  // arrives is bytes that will not open.
  const sealed = sealFor(pub, text)

  // ON STDIN. The sealed reply is not a secret and would come to no harm in a
  // command line, but the guest half reads stdin and teaching the other habit is
  // how the next thing to be handed over ends up in argv.
  const done = await run(
    `printf %s '${b64(JSON.stringify(sealed))}' | base64 -d | node "$HOME/.okc/credential.js" finish\n${andThen}`,
    { what: 'handing the credential over, sealed to the key it just made', timeout: 60000 })

  const said = String(done.output || '')
  const placed = said.match(/okc-credential-placed ([0-9a-f]{16})/)
  if (!placed) throw new Error(`It did not take the credential: ${said.trim().slice(-300)}`)

  // THE FINGERPRINT IT ENDED UP WITH, compared by the caller against the one this
  // host sealed. Sixteen hex characters of sha256 — it says "the same one"
  // without either side printing the thing itself.
  return { fingerprint: placed[1], output: said }
}

// What this host would call the same text, so a caller can compare without
// hashing it a second way somewhere else.
const fingerprint = text => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16)

module.exports = { sealFor, openWith, aPair, deliver, fingerprint, guestHalf, VERSION }
