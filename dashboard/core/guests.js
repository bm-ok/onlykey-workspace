'use strict'

// THE CLAUDE IDENTITIES THIS HOST HOLDS, one per name.
//
// A "guest" is a Claude Code sign-in kept here: a name somebody chose, and a
// token sealed beside it. It is not a machine and it is not a person — it is the
// thing a machine is lent so a worker on it can authenticate, and the thing a
// supervisor uses when the supervisor is a model rather than somebody typing.
//
// WHY A LIST AND NOT A FILE. There was one credential, at
// `credentials/claude.json`, lent to whoever was working. That is enough while
// one machine works at a time and wrong the moment two do: the Claude CLI
// refreshes the token as it runs, so two machines sharing one sign-in are two
// workers rotating the same credential underneath each other. One per machine
// needs somewhere for several to live, and this is that place.
//
// SEALED, AND NEVER READ BY ANYTHING THAT REPORTS. `core/secret.js` seals each
// token to this Windows account; everything below hands back a name, a date, a
// fingerprint and a holder, and nothing hands back a value. The rule this app is
// built to is that a model may know something was done in the Keys tab without
// knowing what was done — so the list is safe to draw, log and photograph.
//
// A FINGERPRINT RATHER THAN A LENGTH OR A PREFIX. Sixteen hex characters of
// sha256, which is enough to say "this is the same token as before" and useless
// for anything else. That is the comparison the drills make when they check a
// credential survived a round trip.

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const data = require('./data')
const secret = require('./secret')

// One folder, one file per guest, named after the guest. Not a single JSON file
// holding every token: a sealed blob per identity means one going bad cannot
// take the others with it, and removing one is deleting a file rather than
// rewriting a list.
const ROOT = () => data.sub('guests')
const RECORD = () => path.join(ROOT(), 'guests.json')

// A name has to be a filename, and it is shown in a list somebody reads. Letters,
// digits, dash and underscore — refused rather than mangled, because a name that
// arrives back different from what was typed is a name somebody cannot find.
const okName = name => /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(String(name || ''))

const fileFor = name => path.join(ROOT(), `${name}.json`)

function read () {
  try {
    const all = JSON.parse(fs.readFileSync(RECORD(), 'utf8'))
    return Array.isArray(all) ? all : []
  } catch { return [] }
}

function write (all) {
  try { fs.mkdirSync(ROOT(), { recursive: true }) } catch { /* it exists */ }
  fs.writeFileSync(RECORD(), JSON.stringify(all, null, 2), 'utf8')
  return all
}

// What a token IS, as a number, for comparing without reading. See the header.
const fingerprint = text => crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 16)

// ---- what is here ---------------------------------------------------------

// Never the token. Everything else about a guest is safe to show, and this is
// the shape every caller gets — the window, the command line and a drill.
function all () {
  return read().map(g => ({
    name: g.name,
    added: g.added,
    from: g.from || null,
    // Read from the file rather than trusted from the record, so a guest whose
    // file has been removed by hand says so instead of claiming a token.
    has: fs.existsSync(fileFor(g.name)),
    fingerprint: g.fingerprint || null,
    lastGiven: g.lastGiven || null,
    lastGivenTo: g.lastGivenTo || null,
    holder: g.holder || null,
    note: g.note || null
  }))
}

const get = name => all().find(g => g.name === name) || null

// ---- adding and removing --------------------------------------------------

function add ({ name, token, from = null, note = null }) {
  if (!okName(name)) {
    throw new Error(`"${name}" is not a name for a guest. Letters, digits, dash, dot and underscore, up to 64 — it is a filename and a label in a list, so it is refused rather than changed into something you would not recognise.`)
  }
  const text = String(token || '').trim()
  if (!text) throw new Error('A guest needs a Claude token. It is sealed to this account and never shown again.')
  if (get(name)) throw new Error(`There is already a guest called "${name}". Remove it first, or pick another name — replacing one silently would take a credential away from whatever is using it.`)

  try { fs.mkdirSync(ROOT(), { recursive: true }) } catch { /* it exists */ }
  const sealed = secret.write(fileFor(name), Buffer.from(text, 'utf8'))

  const record = {
    name,
    added: new Date().toISOString(),
    from,
    note,
    fingerprint: fingerprint(text),
    sealed,
    lastGiven: null,
    lastGivenTo: null,
    holder: null
  }
  write([...read(), record])
  return get(name)
}

function forget (name) {
  const g = get(name)
  if (!g) throw new Error(`There is no guest called "${name}".`)
  if (g.holder) {
    throw new Error(`"${name}" is on ${g.holder} right now. Take it back first — removing it here would leave a credential on a machine with nothing on this host knowing it is there.`)
  }
  try { fs.rmSync(fileFor(name), { force: true }) } catch { /* already gone */ }
  write(read().filter(x => x.name !== name))
  return { forgotten: name }
}

// ---- lending --------------------------------------------------------------
//
// The record of who has what, kept here rather than worked out from the
// machines: a machine that is switched off still has a credential on its disk,
// and "which guest is on that machine" has to be answerable while it is off.

function lentTo (name, machine) {
  const all = read()
  const i = all.findIndex(g => g.name === name)
  if (i < 0) throw new Error(`There is no guest called "${name}".`)
  all[i] = { ...all[i], holder: machine, lastGiven: new Date().toISOString(), lastGivenTo: machine }
  write(all)
  return get(name)
}

function backFrom (name, { token } = {}) {
  const all = read()
  const i = all.findIndex(g => g.name === name)
  if (i < 0) throw new Error(`There is no guest called "${name}".`)

  // A TOKEN THAT CAME BACK CHANGED IS THE ONE WORTH KEEPING. The CLI refreshes
  // as a worker runs, so what comes off a machine is newer than what went on —
  // and the old path deleted it. Written only when it actually differs, so an
  // unchanged one does not rewrite a sealed file for nothing.
  let rotated = false
  if (token) {
    const print = fingerprint(token)
    if (print !== all[i].fingerprint) {
      secret.write(fileFor(name), Buffer.from(String(token), 'utf8'))
      all[i] = { ...all[i], fingerprint: print, refreshed: new Date().toISOString() }
      rotated = true
    }
  }
  all[i] = { ...all[i], holder: null }
  write(all)
  return { ...get(name), rotated }
}

// The value itself, for the one caller that has to hand it to a machine. Kept
// separate from everything above so that reading a token is a deliberate call
// rather than something that falls out of listing.
const token = name => {
  if (!get(name)) throw new Error(`There is no guest called "${name}".`)
  return secret.read(fileFor(name)).toString('utf8')
}

module.exports = { all, get, add, forget, lentTo, backFrom, token, fingerprint, okName, ROOT, fileFor }
