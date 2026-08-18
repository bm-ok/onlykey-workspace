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
// AND NEITHER MAY BE WRITTEN OVER THE WIRE. A supervisor that can edit its own
// instructions is not supervised, and that is the whole of the argument. Reading
// is open — it is already told all of this.

const fs = require('node:fs')
const path = require('node:path')
const s = require('./shared')
const { log, scripts, supervisor } = s

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

  skillSave: {
    about: 'Rewrite a skill. Done in the window, by a person — a supervisor may not edit its own instructions',
    takes: ['which', 'text'],
    run: ({ which = 'supervisor', text, _overTheWire, _driven }) => {
      if (_overTheWire || _driven) {
        throw new Error('A skill is edited in the window, by a person. Something that can rewrite its own instructions is not being supervised — which is the whole of the argument, and it applies to the command line as well as to the supervisor.')
      }

      const one = fileOf(which)
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

      log.on('supervisor').good(`${one.title} was rewritten — ${was.length} to ${body.length} characters`)
      return {
        which: String(which),
        saved: true,
        was: was.length,
        characters: body.length,
        note: 'Saved. The next waking fetches it — nothing needs restarting, and no machine is touched.'
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
