'use strict'

// WHAT THE SUPERVISOR IS IN THE MIDDLE OF, and what has happened to it since.
//
// See core/triage.js for why a notebook exists at all: work here has stages, a
// supervisor is woken between them, and the only thing it otherwise carries
// across a waking is a bookmark.
//
// THE NOTEBOOK HOLDS THE INTENT; THE STORES HOLD THE TRUTH. An entry says "I
// asked J5 to check this and I am waiting"; whether J5 has finished is a fact
// about the judgement, read from the judgement. Writing "waiting" and then
// believing it later is how a supervisor waits for something that finished an
// hour ago — so every entry is resolved against what is actually there, and the
// answer says which of them have landed.
//
// THAT IS THE MOST USEFUL THING THIS DOES. "You assigned it and it is still
// running" and "you assigned it and the answer is sitting there" are the two
// states a supervisor cannot tell apart from its own notes, and they want
// opposite responses.

const s = require('./shared')
const { log, triage, tasks, judging } = s

// What an entry is about, resolved against the records. `#131` is a task, `J5`
// is a judgement — the same two labels used everywhere else, so a supervisor
// writes down what it already says out loud.
function whereIsIt (about) {
  const what = String(about || '').trim()

  const asJudgement = /^J\d+$/i.test(what)
  if (asJudgement) {
    try {
      const j = judging.get(what)
      return {
        kind: 'judgement',
        state: j.state,
        // FINISHED IS THE ONE THAT MATTERS. It is the moment the thing being
        // waited on became an answer, and the moment a supervisor should stop
        // waiting and go and read it.
        landed: j.state === 'done',
        concluded: j.concluded || j.verdict || null,
        reads: j.subject && j.subject.name,
        how: j.state === 'done'
          ? `${j.ref} has finished — read it with judgementFindings`
          : `${j.ref} is ${j.state}`
      }
    } catch { return { kind: 'judgement', state: 'gone', landed: false, how: `${what} is not on this host any more` } }
  }

  const asTask = /^#?\d+$/.test(what)
  if (asTask) {
    try {
      const t = tasks.get(what.replace(/^#/, ''))
      return {
        kind: 'task',
        state: t.state,
        landed: t.state === 'done',
        how: t.state === 'done'
          // NOT "IT WORKED". A task finishing means the machine stopped, and
          // whether anything was actually done is a judge's answer.
          ? `#${t.number} has finished — judge the line to find out whether it did what was asked`
          : `#${t.number} is ${t.state}`
      }
    } catch { return { kind: 'task', state: 'gone', landed: false, how: `${what} is not on the board any more` } }
  }

  // An issue, a line, a repository, a sentence. Nothing to resolve it against,
  // and that is fine: it is the supervisor's own note about its own thinking.
  return { kind: 'note', state: null, landed: false, how: null }
}

module.exports = {
  triage: {
    about: 'What the supervisor is in the middle of, and which of those things have finished since',
    takes: ['about'],
    run: ({ about } = {}) => {
      const rows = triage.all()
        .filter(r => !about || r.about === String(about).trim())
        .map(r => ({ ...r, now: whereIsIt(r.about) }))

      // WHAT YOU WERE WAITING FOR AND IS NOW READY, pulled out rather than left
      // to be spotted. This is the whole reason the notebook is resolved against
      // the stores instead of being believed.
      const ready = rows.filter(r => r.now.landed && /wait/i.test(r.state || ''))

      return {
        carrying: rows,
        ready: ready.map(r => ({ about: r.about, was: r.state, now: r.now.how })),
        note: rows.length
          ? (ready.length
            ? `${ready.length} of ${rows.length} finished while you were away — read those first, then say what you are doing about them.`
            : `${rows.length} thing(s) in hand, none of them finished since.`)
          : 'Nothing in hand. Write one down when you ask for something and will not get the answer in this waking.',
        states: triage.USUAL
      }
    }
  },

  triageSet: {
    about: 'Write down what you are in the middle of: what it is about, what state it is in, and why',
    takes: ['about', 'state', 'note'],
    run: ({ about, state, note, _fromMachine, _overTheWire, _fromTest }) => {
      const row = triage.set({
        about,
        state,
        note,
        // WHO IS CARRYING IT. Almost always the supervisor, and worth recording
        // because a person can write one too — and an entry with no author reads
        // as the app's own opinion, which it never is.
        by: _fromMachine || (_overTheWire ? 'the command line' : _fromTest ? 'a drill' : 'the window')
      })
      log.on('supervisor').info(`triage: ${row.about} — ${row.state}`)
      return { ...row, now: whereIsIt(row.about) }
    }
  },

  triageForget: {
    about: 'Stop carrying something. Nothing about the task or judgement itself is touched',
    takes: ['about'],
    run: ({ about }) => triage.forget(about)
  }
}
