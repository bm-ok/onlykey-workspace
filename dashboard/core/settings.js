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
  supervisorWakes: false
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

module.exports = { read, write, testsAllowed, DEFAULTS, FILE }
