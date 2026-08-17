'use strict'

// A SECRET THAT CAN LEAVE THIS COMPUTER, sealed to something a person knows.
//
// `core/secret.js` seals to the Windows account: nothing else on this machine
// can read it, and neither can the same person on a different machine. That is
// exactly right for something kept HERE, and it is useless for a backup — a
// copy of a DPAPI blob is a file only this installation can open, so it survives
// deleting the app and nothing else. Reinstall Windows and it is gone.
//
// So a backup is sealed to a PASSPHRASE instead. What that buys and what it
// costs are both worth saying out loud:
//
//   it can be restored anywhere, by whoever knows the words
//   and it is exactly as safe as those words are
//
// NO PASSPHRASE, NO BACKUP. Writing credentials to a file somebody chose the
// path of, in the clear, is worse than having no backup at all: a backup is a
// thing people copy to other disks without thinking about it, which is the whole
// point of one.
//
// scrypt RATHER THAN A HASH, because the input is a phrase a person can type and
// the attacker's cost has to be raised deliberately. The parameters are stored
// beside the blob so a file written today still opens when the defaults change.
//
// AES-256-GCM, so a tampered file fails to open rather than opening to something
// else. Node's own crypto; this app has no dependencies and is not getting one
// for a KDF.

const crypto = require('node:crypto')

const VERSION = 'okc-portable-1'

// Deliberately slow. 32 MB and N=2^15 is around a tenth of a second here, which
// is nothing when unlocking one file by hand and a great deal when guessing.
const KDF = { N: 32768, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 }

const keyFrom = (passphrase, salt, params = KDF) =>
  crypto.scryptSync(String(passphrase), salt, params.keylen, { N: params.N, r: params.r, p: params.p, maxmem: params.maxmem })

// One blob per secret rather than one for the whole file, so a backup can be
// read entry by entry and a single corrupt one does not take the rest with it.
function seal (passphrase, text) {
  const words = String(passphrase == null ? '' : passphrase)
  if (words.length < 8) {
    throw new Error('A backup passphrase has to be at least 8 characters. It is the only thing standing between this file and whoever finds it — there is no second lock behind it.')
  }

  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const key = keyFrom(words, salt)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(Buffer.from(String(text), 'utf8')), cipher.final()])

  return {
    v: VERSION,
    kdf: { ...KDF },
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    body: body.toString('base64')
  }
}

function open (passphrase, sealed) {
  if (!sealed || sealed.v !== VERSION) throw new Error(`This is not ${VERSION}.`)
  const params = { ...KDF, ...(sealed.kdf || {}) }
  const key = keyFrom(String(passphrase == null ? '' : passphrase), Buffer.from(sealed.salt, 'base64'), params)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'))
  try {
    return Buffer.concat([decipher.update(Buffer.from(sealed.body, 'base64')), decipher.final()]).toString('utf8')
  } catch {
    // ONE SENTENCE FOR BOTH, on purpose. A wrong passphrase and a damaged file
    // are indistinguishable to GCM, and guessing which for somebody would be
    // guessing.
    throw new Error('That did not open: either the passphrase is wrong or the file has been changed since it was written.')
  }
}

module.exports = { seal, open, VERSION }
