'use strict'

// WHAT THE SUPERVISOR IS TOLD, AND WHAT IT IS ALLOWED TO DO.
//
// Two halves of the same question and they are not the same kind of thing, so
// they are not editable in the same way.
//
// THE SKILL IS A DOCUMENT. It is fetched from this host at the head of every
// turn and written to ~/.claude/skills/supervising/SKILL.md on the machine, so
// editing it here changes the next waking and nothing else — no restart, no
// reinstall, no machine work. That is why it is worth having in the window: the
// loop, the rules and the vocabulary a supervisor works to are the actual
// control surface, and until now they were a file only somebody with a checkout
// could change.
//
// THE ALLOWLIST IS CODE. `MAY` in core/supervisor.js is a list of action names
// with the reason each one is on it, and the reasons are shown to the supervisor
// when it asks what it may do. It is read here and NOT written: a permission
// list that can be edited by anything that can reach this app is not a
// permission list, and the reasons are prose somebody has to write. It changes
// in a checkout, in a commit, with a message.
//
// THE SUPERVISOR MAY WRITE NEITHER, and the thing that stops it is its
// allowlist: neither `skillSave` nor anything else here is on it, so it cannot
// call them at all. That is where "it may not rewrite its own instructions"
// lives. This file used to carry a second copy of that rule as "refused over the
// wire", which caught the command line — a person with a checkout who can
// already edit the file directly — and never caught the supervisor, which was
// never coming through this door. Reading is open to everything; it is already
// told all of this.
//
// WHAT IS REFUSED HERE INSTEAD is overwriting somebody mid-sentence. See
// skillHolding below.

const fs = require('node:fs')
const path = require('node:path')
const s = require('./shared')
const { log, scripts, supervisor } = s

// WHICH SKILLS THE WINDOW IS HOLDING UNSAVED EDITS IN.
//
// In memory on purpose. A restart means no window is open and nothing is being
// held, and a file kept on disk would go on claiming otherwise.
const held = new Map()

// The two documents this app will show and edit. Named rather than "any file in
// provision/", because the point of this pane is the supervisor's instructions
// and a general file editor pointed at the provisioning directory is a
// different and much larger thing.
const WHICH = {
  supervisor: {
    stage: 'skill',
    title: 'the supervisor\'s skill',
    about: 'How the supervisor works: the loop, what it may propose, what it may never do. Fetched fresh at the head of every turn.'
  },
  worker: {
    stage: 'workerSkill',
    title: 'a worker\'s skill',
    about: 'What a worker is told when it runs a job on a machine that will be rolled back underneath it.'
  }
}

const fileOf = which => {
  const one = WHICH[String(which || 'supervisor')]
  if (!one) throw new Error(`"${which}" is not a skill this app keeps. One of: ${Object.keys(WHICH).join(', ')}.`)
  return { ...one, path: path.join(scripts.DIR, scripts.STAGES[one.stage]) }
}

module.exports = {
  skills: {
    about: 'The instructions a supervisor and a worker are given: read one in full, or list what there is',
    takes: ['which'],
    run: ({ which = null }) => {
      if (!which) {
        return {
          skills: Object.entries(WHICH).map(([key, one]) => {
            const at = path.join(scripts.DIR, scripts.STAGES[one.stage])
            let bytes = null
            let edited = null
            try {
              const stat = fs.statSync(at)
              bytes = stat.size
              edited = stat.mtime.toISOString()
            } catch { /* not on disk, which the row says by carrying nulls */ }
            return { which: key, title: one.title, about: one.about, bytes, edited, there: bytes !== null }
          }),
          note: 'Editing one changes the next waking. It is fetched from this host at the head of every turn — nothing is installed on a machine.'
        }
      }

      const one = fileOf(which)
      let text = ''
      try { text = fs.readFileSync(one.path, 'utf8') } catch (e) { throw new Error(`Could not read ${one.title}: ${e.message}`) }
      const stat = (() => { try { return fs.statSync(one.path) } catch { return null } })()

      return {
        which: String(which),
        title: one.title,
        about: one.about,
        text,
        characters: text.length,
        lines: text.split('\n').length,
        edited: stat ? stat.mtime.toISOString() : null,
        where: one.path
      }
    }
  },

  // WHICH SKILL SOMEBODY HAS OPEN AND HAS TYPED IN, and nothing more than that.
  //
  // Held in memory rather than on disk, deliberately: a restart means no window
  // is open, so nothing is being held, and a file left behind would claim
  // otherwise for ever. The window sets this when the editor stops matching the
  // file and clears it when they match again.
  skillHolding: {
    about: 'Say that a skill is open in the window with unsaved edits, so a save from elsewhere does not quietly overwrite them',
    takes: ['which', 'holding'],
    run: ({ which = 'supervisor', holding = false, _overTheWire, _driven }) => {
      if (_overTheWire || _driven) {
        throw new Error('Only the window can say what the window is holding.')
      }
      const key = String(which)
      if (holding === false || holding === 'false') held.delete(key)
      else held.set(key, new Date().toISOString())
      return { which: key, holding: held.has(key) }
    }
  },

  skillSave: {
    about: 'Rewrite a skill. Refused while the window has unsaved edits in it, unless force is passed',
    takes: ['which', 'text', 'from', 'force'],
    run: ({ which = 'supervisor', text, from = null, force = false, _overTheWire, _driven }) => {
      const one = fileOf(which)

      // FROM A FILE, BECAUSE A SKILL DOES NOT FIT ON A COMMAND LINE.
      //
      // Two reasons, and the second is the one that actually bit. A skill is
      // twenty-six thousand characters, which is a silly thing to pass as an
      // argument. And it STARTS WITH `---`: the CLI reads that as the beginning
      // of a flag, so `--text` arrived empty and the save was refused for having
      // no frontmatter — an error about the content of a file that had never
      // been read.
      //
      // The window still passes `text`, because it has the string in hand and
      // no shell between them.
      if (from && (text == null || text === '')) {
        try { text = fs.readFileSync(String(from), 'utf8') } catch (e) {
          throw new Error(`Could not read "${from}": ${e.message}`)
        }
      }

      // NOT REFUSED FOR BEING THE COMMAND LINE, which it used to be, and which
      // protected nothing: this file is an ordinary file in a checkout and
      // anything with a shell can already write it. The refusal made the action
      // useless to the one caller that could not reach around it, and left the
      // real one untouched.
      //
      // THE SUPERVISOR IS STILL SHUT OUT, by the thing that actually shuts it
      // out: `skillSave` is not on its allowlist, so it cannot call this at all.
      // That is where "it may not rewrite its own instructions" lives, and it
      // does not need a second copy here that catches the wrong callers.
      //
      // WHAT IS WORTH REFUSING is overwriting somebody mid-sentence. The window
      // says when it is holding unsaved edits; a save from anywhere else is
      // then refused until whoever is typing decides, or until somebody passes
      // force having decided for them.
      const holding = held.get(String(which))
      if (holding && !(force === true || force === 'true')) {
        throw new Error(`The window has "${one.title}" open with unsaved edits (since ${holding}). Saving now would overwrite them without them ever being seen. Save or undo in the window, or pass force to overwrite anyway — the window will reload and say that its edits were dropped.`)
      }
      const body = String(text == null ? '' : text)
      if (!body.trim()) throw new Error('A skill with nothing in it would leave the next waking with no instructions at all. To stop using one, empty its content deliberately in a checkout.')

      // THE FRONTMATTER IS WHAT MAKES IT A SKILL. Without a name and a
      // description the CLI does not load it, and a supervisor then works from
      // the wake brief alone — which looks exactly like a model that has
      // stopped following instructions, and is the most expensive way to
      // discover a missing header.
      if (!/^---\s*\n[\s\S]*?\bname:\s*\S/.test(body) || !/\bdescription:\s*\S/.test(body)) {
        throw new Error('A skill starts with frontmatter carrying "name:" and "description:" — without both, the CLI never loads it and the machine works from the wake brief alone, which reads as a model that has stopped following instructions.')
      }

      let was = ''
      try { was = fs.readFileSync(one.path, 'utf8') } catch { /* new, which is allowed */ }
      if (was === body) return { which: String(which), saved: false, characters: body.length, note: 'Nothing changed, so nothing was written.' }

      try {
        fs.writeFileSync(one.path, body)
      } catch (e) {
        throw new Error(`Could not write ${one.title}: ${e.message}`)
      }

      // FORCED OVER SOMEBODY'S EDITS IS A DIFFERENT EVENT, and is recorded as
      // one. The window drops what it was holding when it notices the file
      // moved, so this line is the only place that says what was lost.
      const trampled = !!holding
      held.delete(String(which))
      log.on('supervisor')[trampled ? 'warn' : 'good'](
        `${one.title} was rewritten — ${was.length} to ${body.length} characters${trampled ? ', forced over unsaved edits open in the window' : ''}`)
      return {
        which: String(which),
        saved: true,
        was: was.length,
        characters: body.length,
        forced: trampled,
        note: trampled
          ? 'Saved, over unsaved edits that were open in the window. Those are gone, and the window will reload and say so. The next waking fetches this — nothing needs restarting.'
          : 'Saved. The next waking fetches it — nothing needs restarting, and no machine is touched.'
      }
    }
  },

  supervisorMay: {
    about: 'Every action the supervisor may call, and the reason each one is on the list',
    run: () => {
      const may = supervisor.MAY || {}
      const rows = Object.entries(may).map(([action, why]) => ({ action, why }))
      return {
        may: rows,
        count: rows.length,
        // READ AND NOT WRITTEN, and the answer says so rather than leaving
        // somebody looking for the button.
        where: 'core/supervisor.js',
        note: 'Read only. A permission list that anything reaching this app could edit is not a permission list — this changes in a checkout, in a commit, with a message. The reasons are shown to the supervisor when it asks what it may do.'
      }
    }
  }
}
