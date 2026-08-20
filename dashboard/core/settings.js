'use strict'

// What this app is set to, as opposed to what a workspace contains.
//
// Kept beside the events record in the app's own state directory, NOT in a
// workspace's. That is the whole distinction: a branch, a task and a line are
// statements about a folder of repositories, and these are statements about this
// installation — so they survive switching workspace, closing one, and having
// none open at all.
//
// SMALL ON PURPOSE. Anything that belongs to a workspace belongs in the
// workspace's state, and anything that belongs to a machine belongs in the
// registry. What is left is a short list of choices about the app itself, and
// the moment this file grows a hundred keys it has become a place to hide
// behaviour nobody can find.

const fs = require('node:fs')
const path = require('node:path')
const data = require('./data')

const FILE = () => path.join(data.state(), 'settings.json')

// EVERY SETTING IS NAMED HERE WITH ITS DEFAULT, and reading merges onto this.
//
// A setting that only exists once somebody has changed it is a setting nothing
// can list, nothing can explain, and which reads as `undefined` in whatever
// happens to consult it first. The window shows this list; a key absent from it
// is not a setting, it is a typo.
const DEFAULTS = {
  // WHETHER THE DRILLS MAY RUN, and it is off until somebody says otherwise.
  //
  // The suites drive this app for real: they write a task and remove it again,
  // they take a credential off a machine and put it back. Against three
  // scaffolding repositories that is exactly what they are for. Against
  // somebody's actual work it is a stranger typing into their repository, and
  // the app has no way to tell the two apart — so it does not guess.
  testsEnabled: false,

  // AND WHICH WORKSPACE IT WAS TURNED ON FOR.
  //
  // This is what makes "switch workspace and it goes back to off" true by
  // construction rather than by remembering to hook the switch. Enabled means
  // enabled HERE: the check is `testsEnabled && testsFor === the folder now
  // open`, so opening anything else is off without anything having to notice.
  //
  // It also survives the case a hook would miss — a workspace closed and
  // reopened, a second window, the app restarted — because it compares two
  // facts rather than trusting an event to have fired.
  testsFor: null,

  // SOMEBODY DOWN THE PIPE ASKING TO BE ALLOWED, and nothing more than that.
  //
  // A model may want the drills run and may not decide that somebody's
  // repository is a fine place to run them — so it can raise its hand, and a
  // person answers in the window. `{ at, why, forDir }`, or null.
  //
  // Kept on disk with the rest rather than in memory, so a request outlives the
  // restart that a code change causes. Being asked and then having the question
  // vanish because the app reloaded is how somebody ends up running the drills
  // by hand to find out what was wanted.
  testsAsked: null,

  // WHETHER THE SUPERVISOR ANSWERS BY ITSELF, and it is off until somebody says
  // otherwise.
  //
  // A supervisor woken is a machine started and a model spending tokens, on its
  // own initiative, because somebody typed a sentence. That is the entire point
  // of it and it is not a thing to switch on by accident — so this exists, and
  // it defaults to no.
  //
  // WITH IT OFF, the Chat tab is a note left for something that reads it when
  // you next start it by hand. With it on, saying something wakes it: the
  // machine comes up if it is down, one turn runs, and whatever it says appears
  // in the conversation. Nothing else about what it may do changes — it is the
  // same allowlist either way.
  supervisorWakes: false,

  // WHETHER THIS HOST WATCHES GITHUB FOR WORK ARRIVING, and it is off until
  // somebody says otherwise.
  //
  // An issue and a pull request are the only two things in this whole app
  // that turn up on their own. Everything else begins with somebody writing
  // a task -- so without this, a supervisor wakes, sees nothing new, and
  // goes back to sleep with an open issue sitting there.
  //
  // OFF BY DEFAULT because it is a standing network call against somebody
  // else's service, and because what it leads to is a supervisor deciding
  // there is work. Switching it on is saying "watch my repositories and act
  // on what turns up", which is a sentence somebody should say out loud.
  //
  // It is slow on purpose -- minutes, not seconds. See LOOK_EVERY in
  // tasks/queue.js and the note at the top of repos/watching.js for why this
  // is not the "never on a timer" rule being quietly broken.
  watchGitHub: false,

  // WHICH SIGN-IN THE SUPERVISOR USES, by name, until somebody switches it.
  //
  // A supervisor holds one identity for as long as it is up, and this host can
  // keep several. Picking "whichever is free" is fine with one and is a guess
  // the moment there are two — and the wrong guess is not a small thing: it is
  // which account the deciding gets billed to, and which one appears in
  // whatever a supervisor touches. That is a choice with a person's name on it,
  // so it is made once, in the window, and stuck to.
  //
  // Null means "the only one there is". A host with a single supervisor sign-in
  // needs no ceremony, and the choice starts mattering exactly when a second
  // one exists.
  supervisorKey: null
}

// ---------------------------------------------------------------------------
// THE SETTINGS THAT ARE A PERSON'S, AND IT IS THE WHOLE GATE RATHER THAN ITS
// SWITCH.
//
// settingSet guarded one key, `testsEnabled`, and that was not enough. The
// predicate below is `testsEnabled && testsFor === the folder open now` — two
// settings, both writable, and only one of them refused.
//
// SO THE WAY ROUND IT WAS TO MOVE THE FOLDER INSTEAD OF THE SWITCH. Leave
// `testsEnabled` alone, which is very often already true — turned on last week
// against the scaffolding, never turned off — and write `testsFor` to whatever
// is open now. The guarded key is never touched, nothing refuses, and
// testsAllowed comes back true against somebody's real work. That is the exact
// state `testsFor` exists to make safe, defeated by the setter for `testsFor`.
//
// `testsAsked` is here for a smaller reason: forging a raised hand changes
// nothing on its own, but it is a sentence that appears in a dialog somebody is
// about to read and trust, attributed to a request that was never made. testsAsk
// is the door — it takes a reason and stamps the folder itself.
//
// WRITTEN AS A LIST rather than as a check inside one branch, so the next
// setting that joins this gate is a name added here rather than a second `if`
// somebody has to remember.
const ATTHEWINDOW = ['testsEnabled', 'testsFor', 'testsAsked']

const truth = v => v === true || v === 'true' || v === 1 || v === '1' || v === 'on' || v === 'yes'

// A VALUE ARRIVES AS A STRING AND HAS TO BE PUT BACK INTO THE SHAPE ITS DEFAULT
// DECLARES.
//
// A command line has no types. `okc.js settingSet --name watchGitHub --value
// false` hands over the STRING "false", which is truthy — so the one command
// anybody would type to turn OFF a standing network call against somebody else's
// service TURNS IT ON, silently, answering "Saved."
//
// An object is left alone: it has already said what it means, and String({...})
// is "[object Object]", which for `testsAsked` would be a corrupt request that
// still renders.
function shaped (key, v) {
  if (typeof DEFAULTS[key] === 'boolean') return truth(v)
  if (v === null || v === undefined) return null
  if (typeof v === 'object') return v
  const s = String(v).trim()
  return s === '' ? null : s
}

function read () {
  let kept = {}
  try {
    kept = JSON.parse(fs.readFileSync(FILE(), 'utf8').replace(/^﻿/, '')) || {}
  } catch { /* nothing set yet, or a file worth ignoring rather than failing on */ }
  // Only what is declared above. A key left over from a setting that has since
  // been removed is not carried forward as though it still meant something.
  const out = {}
  for (const k of Object.keys(DEFAULTS)) out[k] = k in kept ? kept[k] : DEFAULTS[k]
  return out
}

function write (patch) {
  const now = { ...read(), ...patch }
  for (const k of Object.keys(now)) {
    if (!(k in DEFAULTS)) throw new Error(`"${k}" is not a setting. See DEFAULTS in core/settings.js — a setting that is not declared cannot be listed or explained.`)
  }
  try {
    fs.mkdirSync(data.state(), { recursive: true })
    fs.writeFileSync(FILE(), JSON.stringify(now, null, 2))
  } catch (e) {
    throw new Error(`could not keep that setting: ${e.message}`)
  }
  return now
}

// The one question the rest of the app asks, rather than reading two fields and
// comparing them in four places.
//
// Both halves are required. Enabled but for a different folder is not enabled —
// it is the state somebody left behind on Tuesday, pointed at work they care
// about today.
function testsAllowed (openDir) {
  const s = read()
  if (!s.testsEnabled) return { allowed: false, why: 'The drills are switched off. They drive this app for real — they write a task, and one of them takes a credential off a machine — so they are off until somebody turns them on for a workspace they do not mind that happening to.' }
  if (!openDir) return { allowed: false, why: 'No workspace is open, so there is nothing for the drills to run against.' }
  if (s.testsFor !== openDir) {
    return {
      allowed: false,
      why: `The drills were turned on for ${s.testsFor || 'another folder'}, and the folder open now is ${openDir}. Switching workspace switches them off — turn them on again here if this is a folder you do not mind them touching.`
    }
  }
  return { allowed: true, why: null }
}

module.exports = { read, write, testsAllowed, DEFAULTS, FILE, ATTHEWINDOW, shaped, truth }
