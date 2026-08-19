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
// THREE ROLES, ONE LIST. A WORKER is lent to a machine that does the work; a
// JUDGE is lent to a machine that reads work and never writes it; a SUPERVISOR
// is the sign-in this host uses itself, for the model that decides what work to
// give rather than the one doing it. They are the same object — a name and a
// sealed token — and the difference is entirely who spends it, so they are one
// store with a `role` on each record and panes that filter on it.
//
// WHY A JUDGE HAS ITS OWN. A judge says whether work holds, and a worker writes
// the work. Sharing one identity between them makes "who said this is good" and
// "who wrote it" the same account, which is the one distinction a judge exists
// to provide. It is also the difference between a review and a signature.
//
// AND `guest` WAS THE OLD NAME FOR A WORKER. It is still what old records say
// and is read as `worker` — see all(). The word was retired because the
// machine-facing half of this app already uses "guest" for the virtual machine
// itself, so one word meant a credential in one file and a computer in the
// next.
//
// A SECOND STORE WOULD BE THE FAULT THIS FILE EXISTS TO FIX. One credential in
// the Keys tab and another somewhere else is how one of them goes stale
// unnoticed; making a separate file for supervisors would recreate that on the
// day it was fixed.
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
// The chosen supervisor sign-in is a setting, and this is the one place that
// turns a name into an identity to use. See supervisorKey below.
const settings = require('./settings')

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
    // WORKER, JUDGE OR SUPERVISOR, and `guest` read as `worker`. Defaulted here
    // rather than migrated, so an old record needs no rewriting to be read.
    //
    // Everything written before there were three roles says `guest`, which meant
    // "lent to a machine that does the work". That is a worker, and calling it
    // one costs nothing to read and stops the word meaning two things -- in the
    // machine-facing half of this app a "guest" is the virtual machine itself.
    role: g.role === 'supervisor' ? 'supervisor' : g.role === 'judge' ? 'judge' : 'worker',
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

function add ({ name, token, from = null, note = null, role = 'worker' }) {
  if (!okName(name)) {
    throw new Error(`"${name}" is not a name for a guest. Letters, digits, dash, dot and underscore, up to 64 — it is a filename and a label in a list, so it is refused rather than changed into something you would not recognise.`)
  }
  // A CREDENTIAL IS JSON, AND SOMETHING ON THE WAY HERE MAY HAVE PARSED IT.
  //
  // The command line does: `--token '{"claudeAiOauth":...}'` arrives as an
  // object, because that is what makes `--vm '{...}'` and `--task '{...}'` work.
  // This used to be `String(token)`, which turns an object into the fourteen
  // characters "[object Object]" — and then seals them, records a fingerprint of
  // them, and reports the guest as added. The credential is gone at that point,
  // and the way you find out is a machine answering "not signed in" weeks later.
  //
  // Found by handing a machine one and reading back what landed. The handover was
  // right: it delivered exactly what this host held, which was "[object Object]".
  const text = (token && typeof token === 'object' ? JSON.stringify(token) : String(token || '')).trim()
  if (!text) throw new Error('A guest needs a Claude token. It is sealed to this account and never shown again.')
  if (text === '[object Object]') {
    throw new Error('That token arrived as the words "[object Object]" rather than as a credential — something turned an object into a string on the way here. Nothing was kept; paste the contents of .credentials.json.')
  }
  if (get(name)) throw new Error(`There is already a guest called "${name}". Remove it first, or pick another name — replacing one silently would take a credential away from whatever is using it.`)

  try { fs.mkdirSync(ROOT(), { recursive: true }) } catch { /* it exists */ }
  const sealed = secret.write(fileFor(name), Buffer.from(text, 'utf8'))

  const record = {
    name,
    // One namespace across both roles, because both are filenames in one folder
    // and a supervisor called the same thing as a guest would be one file. See
    // the header: they are the same object, spent by different hands.
    role: role === 'supervisor' ? 'supervisor' : role === 'judge' ? 'judge' : 'worker',
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

// WHICH SIGN-IN MAY SIT ON WHICH MACHINE, and it is a rule about the PAIR.
//
// The first version of this refused a supervisor sign-in outright, wherever it
// was going — which was right about workers and wrong about the one machine that
// needs it. A supervisor MACHINE runs Claude Code to decide what work there is,
// and it cannot do that signed out. What it must not be given is a worker's
// identity, and what a worker must not be given is the supervising one.
//
// So the rule is that the roles match, in both directions:
//
//   supervisor sign-in on a supervisor machine     yes — it is what it is for
//   supervisor sign-in on a runner                 no  — a worker spending the
//                                                        identity that decides
//                                                        what workers do
//   worker sign-in on a supervisor machine         no  — it would take one out
//                                                        of the pool the runners
//                                                        draw from, and bill the
//                                                        deciding to a worker
//
// Enforced at the one point that records a machine holding something, rather
// than at each of the several places that hand one over.
// A MATCH BETWEEN KINDS, RATHER THAN TWO BOOLEANS.
//
// This was `isSupervisor` on both sides and a pair of ifs, which is exactly
// right for two kinds and becomes four ifs for three. A judge is the third —
// a sign-in that reads changes and never writes them — and the rule it wants is
// the rule the other two already follow, so it is written once as an equality
// instead of once per pair.
//
//   worker sign-in      on a runner              yes
//   judge sign-in       on a judge machine       yes
//   supervisor sign-in  on a supervisor machine  yes
//   anything else                                no, and it says which two
//
// WHY EACH CROSSING IS REFUSED, and they are refused for different reasons:
//
//   a supervisor's identity on a runner    a worker spending the identity that
//                                          decides what workers do
//   a worker's identity elsewhere          it holds one of the identities the
//                                          runners draw from, and bills that
//                                          machine's work to a worker
//   a judge's identity on a runner         the reading and the writing become
//                                          one account, so "who said this holds"
//                                          and "who wrote it" stop being
//                                          separable — which is the whole point
//                                          of a judge having its own
//
// Enforced at the one point that records a machine holding something, rather
// than at each of the several places that hand one over.
const SAYS = {
  worker: 'a worker sign-in',
  judge: 'a judge sign-in',
  supervisor: 'a supervisor sign-in'
}
const MACHINE_SAYS = {
  worker: 'a runner',
  judge: 'a judge machine',
  supervisor: 'a supervisor machine'
}

function whyNotOn (role, machineKind, name, machine) {
  const want = role === 'supervisor' || role === 'judge' ? role : 'worker'
  const is = machineKind === 'supervisor' || machineKind === 'judge' ? machineKind : 'worker'
  if (want === is) return null

  const why = want === 'supervisor'
    ? 'Lending it there would let something other than the supervisor spend the identity that decides what workers do.'
    : want === 'judge'
      ? 'A judge has its own identity so that reading a change and writing one are separate accounts — lending it elsewhere collapses that back into one.'
      : `A ${is === 'supervisor' ? 'supervisor' : 'judge'} machine signs in as itself: this would hold one of the identities the runners draw from, and bill that machine's work to a worker.`

  return `"${name}" is ${SAYS[want]} and ${machine} is ${MACHINE_SAYS[is]}. ${why}`
}

// `kind` IS THE MACHINE'S, AND `supervisor` IS STILL ACCEPTED. Callers that
// predate three roles pass a boolean, and a boolean cannot express "judge" — so
// it is read as the two kinds it could ever mean, and a caller that knows better
// passes the kind itself. One of these will be removed when the last boolean
// caller is gone; keeping both for now is what lets that happen a file at a time
// rather than in one change that has to be right everywhere at once.
// ---- WHAT AN IDENTITY IS FOR CAN CHANGE, AND THE TOKEN DOES NOT MOVE ------
//
// A worker and a judge sign-in are the same object: a name and a sealed token.
// What separates them is which machines may hold one, which is a decision about
// this host rather than a property of the credential. So changing it is a label
// change -- nothing is re-sealed, nothing is re-read, and the fingerprint is the
// same afterwards, which is how you can tell it was a relabelling and not a
// replacement.
//
// NOT WHILE IT IS OUT. A sign-in on a machine was lent under the rule that the
// roles match; changing it underneath would leave a judge machine holding a
// worker's identity with nothing having been refused. The same shape as a
// machine's role, and for the same reason -- see vmTags.
//
// AND NOT THE ONE THE SUPERVISOR IS SET TO USE. That name is a setting somewhere
// else, and moving the identity out from under it would leave the supervisor
// pointing at a sign-in it may no longer hold -- discovered the next time it was
// woken, which is the worst moment to find out.
function roleOf (name, want) {
  const all = read()
  const i = all.findIndex(g => g.name === name)
  if (i < 0) throw new Error(`There is no sign-in called "${name}".`)

  const to = String(want || '').toLowerCase()
  if (!['worker', 'judge', 'supervisor'].includes(to)) {
    throw new Error(`"${want}" is not a role. A sign-in is a worker, a judge or a supervisor — which decides the kind of machine it may be lent to.`)
  }

  const was = all[i].role === 'supervisor' ? 'supervisor' : all[i].role === 'judge' ? 'judge' : 'worker'
  if (was === to) return get(name)

  if (all[i].holder) {
    throw new Error(`"${name}" is out on ${all[i].holder}, so what it is for cannot change right now. It was lent under the rule that a machine holds a sign-in of its own kind, and changing it underneath would leave that machine holding the wrong one. Take it back first with guestBack.`)
  }

  const chosen = settings.read().supervisorKey
  if (was === 'supervisor' && chosen === name) {
    throw new Error(`"${name}" is the sign-in the supervisor is set to use, so it cannot stop being a supervisor. Choose another one first on the Runners tab.`)
  }

  all[i] = { ...all[i], role: to }
  write(all)
  return get(name)
}

function lentTo (name, machine, { supervisor = false, kind = null } = {}) {
  const all = read()
  const i = all.findIndex(g => g.name === name)
  if (i < 0) throw new Error(`There is no guest called "${name}".`)
  const on = kind || (supervisor ? 'supervisor' : 'worker')
  const why = whyNotOn(all[i].role, on, name, machine)
  if (why) throw new Error(why)
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

// ---- the one that was here before -----------------------------------------
//
// There was a single credential at `credentials/claude.json`, kept on the Keys
// tab and lent to whoever was working. It becomes a guest, because the list is
// where identities live now and two places holding credentials is how one of
// them goes stale unnoticed.
//
// MOVED, NOT COPIED. The original file is left where it is only until the first
// lend proves the new path works, and `credentialsHeld` reads the list from then
// on — see actions/credentials.js. Copying and leaving both would give this app
// two answers to "what is the token", which is the fault being fixed.
//
// Idempotent, and quiet when there is nothing to do: it runs on startup, and a
// host that has already moved must not gain a second copy on every restart.
function adoptTheOldOne (file, name = 'claude-code') {
  if (read().length) return null                 // already a list; nothing to adopt
  if (!fs.existsSync(file)) return null          // nothing was ever kept here

  let text = null
  try { text = secret.read(file).toString('utf8') } catch { return null }
  if (!String(text).trim()) return null

  const made = add({ name, token: text, from: 'moved from the Keys tab', note: 'the single credential this host used to keep' })
  return made
}

// WHICH SIGN-IN THE SUPERVISOR USES, and why it is a choice rather than a search.
//
// "Whichever is free" is correct with one and a guess with two, and the guess is
// not a small one: it decides which account the supervising is billed to and
// which identity appears in everything it touches. So the pane where the
// sign-ins live is where it is picked, it is remembered in settings, and it is
// used until somebody switches it there.
//
// HERE RATHER THAN IN AN ACTION, because three surfaces need the same answer:
// the thing that signs a supervisor in, the pane that offers the choice, and the
// banner that says what is wrong when there is nothing to give. Two readings of
// "is there a sign-in available" that can disagree is exactly the bug that put a
// banner on screen telling this host it had none while one sat on the Runners
// tab.
//
// FOUR ANSWERS, each with a different repair, which is why this is one function
// rather than a `find`:
//
//   nothing kept         a person, at a browser, on the sign-in desk
//   several, none chosen a person, on the Runners pane -- and no guess meanwhile
//   chosen and free      use it
//   chosen and out       a name to take it back from, and nothing automatic
//
// It never falls back from a choice that is out to one that is free. Somebody
// picking an identity meant that one, and quietly using the other would bill the
// deciding to the account they did not pick, with nothing saying so out loud.
function supervisorKey () {
  const sups = all().filter(g => g.role === 'supervisor' && g.has)

  // WHICH ONE IS BEING USED RIGHT NOW, which is not the same question as which
  // one there is to hand over — and reading one as the other made the pane show
  // no identity in use at the exact moment one was.
  //
  // `key` is "what could be given to a supervisor coming up", so an identity
  // already on a machine is not it. `inUse` is "what a supervisor is signed in
  // as", and for these two that is the same word: a supervisor sign-in can only
  // be lent to a supervisor machine — whyNotOn refuses anything else — so a
  // holder is always a supervisor, and out always means in use.
  const inUse = sups.find(g => g.holder) || null

  if (!sups.length) {
    return { key: null, chosen: null, inUse: null, why: 'this host has no supervisor sign-in at all — sign one in under Runners → Claude supervisor' }
  }

  const picked = settings.read().supervisorKey
  if (!picked) {
    if (sups.length > 1) {
      return { key: null, chosen: null, inUse, why: `there are ${sups.length} supervisor sign-ins and none is chosen — pick one under Runners → Claude supervisor` }
    }
    // One is not ambiguous. Reported as chosen: null so nothing calls a default
    // a decision — the pane says "the only one" rather than "in use".
    return sups[0].holder
      ? { key: null, chosen: null, inUse, why: `"${sups[0].name}" is already out on ${sups[0].holder}`, out: sups[0].holder }
      : { key: sups[0], chosen: null, inUse, why: null }
  }

  const one = sups.find(g => g.name === picked)
  if (!one) {
    // Chosen and then thrown away. Not silently replaced: the setting names an
    // identity somebody picked, and the honest answer is that it is gone.
    return { key: null, chosen: picked, inUse, why: `the chosen sign-in "${picked}" is not kept here any more — pick another under Runners → Claude supervisor` }
  }
  if (one.holder) return { key: null, chosen: picked, inUse, why: `the chosen sign-in "${picked}" is out on ${one.holder}`, out: one.holder }
  return { key: one, chosen: picked, inUse, why: null }
}

module.exports = {
  roleOf, all, get, add, forget, lentTo, backFrom, token, fingerprint, okName, adoptTheOldOne, whyNotOn, supervisorKey, ROOT, fileFor }
