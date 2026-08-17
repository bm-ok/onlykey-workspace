'use strict'

// Talking to the supervisor, and it talking back.
//
// Part of the one table every caller reaches: see actions/table.js for why these
// are in separate files and still one surface.
//
// TWO ENDS, AND NEITHER GETS TO SAY WHICH IT IS. `chatSay` is the person's — it
// is what the window calls, and a supervisor cannot reach it, because the
// supervisor's allowlist does not name it. `supervisorSays` is the machine's, and
// it records the machine that asked rather than anything the message claims. The
// one question this record has to answer later is who asked for a thing, and an
// answer either end could forge is not an answer.
//
// WHAT IS NEW, AS ONE QUESTION. A supervisor coming back from thinking wants to
// know what happened while it was away: what was said to it, what finished, what
// arrived. That is one call — see `whatsNew` — rather than four, because four
// means four bookmarks and a model keeping three of them correctly.

const chat = require('../core/chat')
const s = require('./shared')
const { log, events, tasks, vms, landings } = s

module.exports = {
  chat: {
    about: 'The conversation with the supervisor: what was asked for, and what it said',
    takes: ['since'],
    run: ({ since = null } = {}) => {
      const rows = since == null ? { messages: chat.all(), bookmark: chat.lastNumber(), missed: 0 } : chat.since(since)
      return {
        ...rows,
        note: rows.messages.length
          ? `${rows.messages.length} message(s)${rows.missed ? `, and ${rows.missed} older ones not shown` : ''}.`
          : 'Nothing has been said yet. Type something and the supervisor will read it next time it looks.'
      }
    }
  },

  chatSay: {
    about: 'Say something to the supervisor. It reads this when it next asks what is new',
    takes: ['text', 'about'],
    run: ({ text, about = null }) => {
      const said = chat.say({ who: 'person', text, about })
      // KEPT, because this is where work comes from now. A task nobody wrote by
      // hand was asked for in here, and six weeks later this line is the answer
      // to "why did it do that".
      log.on('supervisor').info(`you said: ${said.text.slice(0, 120)}${said.text.length > 120 ? '…' : ''}`)
      return { ...said, note: 'Said. The supervisor reads it when it next asks what is new — which is when it finishes what it is doing, not this second.' }
    }
  },

  chatClear: {
    about: 'Throw the whole conversation away',
    run: () => {
      const gone = chat.clear()
      log.on('supervisor').warn('the conversation was thrown away')
      return { ...gone, note: 'Gone. What was DONE is still in the event stream; this was only what was said about it.' }
    }
  },

  // ---- the supervisor's end -------------------------------------------------
  //
  // Both of these are on the supervisor's allowlist and neither is any use to
  // anybody else, which is the shape the whole surface has: named, few, and about
  // one job.

  supervisorSays: {
    about: 'The supervisor saying something to the person',
    takes: ['text', 'about'],
    run: ({ text, about = null, _fromMachine = null }) => {
      // WHICH MACHINE, TAKEN FROM THE CALL RATHER THAN FROM THE MESSAGE. The
      // supervisor route puts the machine's name on every call it forwards — see
      // server.js — and it is stripped from anything the machine sent, so a
      // supervisor cannot sign a message as somebody else, or as a person.
      const said = chat.say({ who: 'supervisor', text, about, from: _fromMachine })
      log.on('supervisor', _fromMachine || undefined).info(`it said: ${said.text.slice(0, 120)}${said.text.length > 120 ? '…' : ''}`)
      return { ...said, note: 'Said. It is on the Chat tab now.' }
    }
  },

  // WHAT HAPPENED WHILE IT WAS AWAY, in one call.
  //
  // A supervisor thinks in bursts: it wakes, reads, decides, does something, and
  // stops. Everything it needs on waking is "what is different since last time",
  // and that spans four different records — what was said to it, what the queue
  // finished, what arrived on GitHub, what this host did.
  //
  // ONE BOOKMARK, WHICH IS THE POINT. Four calls would mean four bookmarks and a
  // model keeping all four correctly across a restart; this takes one number and
  // hands back the next one. Everything in the answer is a fact this host already
  // had — nothing here goes to the network.
  whatsNew: {
    about: 'Everything that changed since a bookmark: what was said, what finished, what is waiting',
    takes: ['since', 'events'],
    run: ({ since = null, events: wantEvents = true } = {}) => {
      const talk = chat.since(since == null ? 0 : since)

      // The board as it stands, rather than a diff of it. A supervisor deciding
      // what to do next needs the state, and the state is small.
      const board = tasks.read()
      const waiting = board.filter(t => t.state === 'queued')
      const working = board.filter(t => t.state === 'given')
      const finished = board.filter(t => t.state === 'done' && !t.verdict)

      const out = {
        said: talk.messages,
        bookmark: talk.bookmark,
        missed: talk.missed,
        tasks: {
          queued: waiting.map(t => ({ id: t.id, number: t.number, title: t.title, branch: t.branch, tag: t.tag || null })),
          running: working.map(t => ({ id: t.id, number: t.number, title: t.title, machine: t.machine })),
          // The ones worth its attention: finished, and nobody has judged them.
          waitingOnAVerdict: finished.map(t => ({ id: t.id, number: t.number, title: t.title, branch: t.branch }))
        },
        machines: vms.read().map(v => v.name).length,
        cuts: Object.values(landings.all() || {}).length
      }

      // AND WHAT THIS HOST DID, when asked for. Off by default because it is the
      // long half — every branch, every start and stop — and a supervisor mostly
      // wants the short one. `events --since` is the same bookmark shape, so this
      // is the same question asked of the durable record.
      if (wantEvents !== false && wantEvents !== 'false') {
        out.happened = (events.all({ limit: 60 }) || []).map(e => ({ at: e.at, level: e.level, tags: e.tags, text: e.text }))
      }

      out.note = talk.messages.length
        ? `${talk.messages.length} thing(s) said to you. Ask again with since=${out.bookmark}.`
        : `Nothing said since ${since == null ? 'ever' : since}. Ask again with since=${out.bookmark}.`
      return out
    }
  }
}
