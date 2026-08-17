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
const actions = require('./table')
const s = require('./shared')
const { log, events, tasks, vms, landings, channel, settings } = s

// ---- waking it ------------------------------------------------------------
//
// ONE TURN AT A TIME, ACROSS EVERYTHING THAT MIGHT ASK. A chat message, a task
// finishing and somebody pressing the button are three doors into the same
// model, and two turns at once on one machine is two things deciding — the fault
// the one-supervisor rule exists to prevent, arriving from inside instead.
//
// A flag in memory rather than on disk, deliberately: it is about this process
// having a child running, and a restart genuinely does end that.
let thinking = false
const busyThinking = () => thinking

// What it is told when it wakes. Deliberately short: the skill on the machine is
// what knows the loop, and repeating it here would be a second copy that goes
// stale — see provision/supervisor-skill.md.
const WAKE = 'Wake. Use the supervising skill: call whatsNew, read what changed, ' +
  'do what needs doing if anything does, and reply to the person with supervisorSays. ' +
  'One message, two or three sentences. If there is nothing to do, say that instead.'

module.exports = {
  chat: {
    about: 'The conversation with the supervisor: what was asked for, and what it said',
    takes: ['since'],
    run: ({ since = null } = {}) => {
      const rows = since == null ? { messages: chat.all(), bookmark: chat.lastNumber(), missed: 0 } : chat.since(since)
      // HOW FAR THE SUPERVISOR HAS READ, so the window can show which of your
      // messages have actually reached it. One number rather than a field per
      // message — see core/chat.js.
      const read = chat.readMark()
      return {
        ...rows,
        read,
        note: rows.messages.length
          ? `${rows.messages.length} message(s)${rows.missed ? `, and ${rows.missed} older ones not shown` : ''}.`
          : 'Nothing has been said yet. Type something and the supervisor will read it next time it looks.'
      }
    }
  },

  chatSay: {
    about: 'Say something to the supervisor. It reads this when it next asks what is new',
    takes: ['text', 'about'],
    run: ({ text, about = null, _overTheWire, _driven, _fromTest }) => {
      // HOW IT ARRIVED, from the same flags every other action uses to tell the
      // window from the command line — see whoAsked in actions/shared.js — plus
      // the one the drills set on every call they make.
      //
      // Taken from the call rather than from an argument anybody could pass: a
      // message that could claim to be from the window would make the label
      // worth nothing, which is the same rule the supervisor's half follows.
      const via = _fromTest ? 'test' : (_overTheWire || _driven) ? 'cli' : 'window'
      const said = chat.say({ who: 'person', text, about, via })
      // KEPT, because this is where work comes from now. A task nobody wrote by
      // hand was asked for in here, and six weeks later this line is the answer
      // to "why did it do that".
      log.on('supervisor').info(`${said.via === 'window' ? 'you' : said.via} said: ${said.text.slice(0, 120)}${said.text.length > 120 ? '…' : ''}`)

      // AND IT WAKES, IF IT HAS BEEN TOLD TO. This is what "no response" was:
      // the message was written down, correctly, and nothing on this host had
      // any reason to read it.
      //
      // NOT AWAITED. A turn is the better part of a minute — a machine may have
      // to start first — and the person who typed a sentence should not be
      // watching a spinner for it. What it says arrives in the conversation, and
      // the conversation is on screen.
      //
      // Off by default, because a sentence typed here would otherwise start a
      // machine and spend a model's time. See `supervisorWakes` in core/settings.
      const wakes = settings.read().supervisorWakes === true
      if (wakes && !busyThinking()) {
        actions.supervisorWake.run({ why: 'you said something' })
          .catch(e => log.on('supervisor').warn(`it could not be woken: ${e.message}`))
      }

      return {
        ...said,
        woke: wakes && !busyThinking(),
        note: wakes
          ? 'Said, and it is waking to read it. What it says back appears here.'
          : 'Said. It reads this when it next wakes — press "Wake it" to do that now, or switch on "Answers by itself".'
      }
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
      const said = chat.say({ who: 'supervisor', text, about, from: _fromMachine, via: 'wire' })
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
    run: ({ since = null, events: wantEvents = true, _fromMachine = null } = {}) => {
      const talk = chat.since(since == null ? 0 : since)

      // THE RECEIPT, WRITTEN HERE BECAUSE HERE IS WHERE THE WORDS ARRIVE. Not
      // when the message was stored, which says only that this host took it, and
      // not when the supervisor replies, which may never happen — a supervisor
      // that reads something and decides to do nothing has still read it.
      //
      // Everything up to the bookmark it was just handed, stamped with the
      // machine that asked. From the person's side this is the difference
      // between "it has not looked yet" and "it looked and said nothing", which
      // are the same silence and very different situations.
      if (talk.messages.length) chat.markRead(talk.bookmark, _fromMachine)

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
,

  // ---- waking the supervisor ------------------------------------------------
  //
  // This is what was missing, and the way it was missing is the reason it needs
  // saying: a message was left on the Chat tab, nothing read it, and the tab
  // looked exactly like a chat where the other end is ignoring you.
  //
  // WHAT A WAKE IS: the machine is started if it is down, one turn of its model
  // runs with the supervising skill, and whatever it says arrives in the
  // conversation through supervisorSays. Not a session, not a loop — one turn,
  // because a supervisor that runs continuously is a supervisor spending money
  // to discover that nothing has changed.
  supervisorWake: {
    about: 'Wake the supervisor: one turn of its model, reading what changed and answering',
    takes: ['name', 'why'],
    run: async ({ name, why = null }) => {
      if (busyThinking()) {
        return { woke: false, why: 'it is already thinking. One turn at a time — two would be two things deciding, which is the thing the one-supervisor rule exists to prevent.' }
      }

      // The same machine the sign-in desk uses, started if it is off — one
      // function in actions/shared.js, because "start it if it is down" is a
      // decision and two copies of a decision drift.
      const on = await s.supervisorMachine(name)

      thinking = true
      const began = Date.now()
      log.on('supervisor', on).info(why ? `waking it — ${why}` : 'waking it')
      try {
        // THE PROMPT GOES OVER AS BASE64. It is prose with apostrophes in it,
        // heading for a bash -c inside an ssh command, and this file has already
        // watched quoting eat a regular expression today.
        const b64 = Buffer.from(WAKE, 'utf8').toString('base64')
        const said = await channel.run(on,
          `cd ~ && printf %s '${b64}' | base64 -d > /tmp/okc-wake.txt && timeout 600 bash -lc 'okc-supervisor -p "$(cat /tmp/okc-wake.txt)"'; rm -f /tmp/okc-wake.txt`,
          { what: 'one turn of the supervisor', timeout: 660000 })

        const took = Math.round((Date.now() - began) / 1000)
        log.on('supervisor', on).good(`it thought for ${took}s`)
        return {
          woke: true,
          name: on,
          seconds: took,
          // What it printed, which is its own summary rather than what it said to
          // the person — that went through supervisorSays and is in the chat.
          said: String(said.output || '').split('\n').slice(1).join('\n').trim().slice(-2000),
          note: `${on} took a turn. What it said to you is on the Chat tab.`
        }
      } finally {
        thinking = false
      }
    }
  },

  supervisorThinking: {
    about: 'Whether the supervisor is mid-turn right now',
    run: () => ({ thinking: busyThinking(), wakes: settings.read().supervisorWakes === true })
  }
}
