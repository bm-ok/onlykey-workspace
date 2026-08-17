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
// The Claude identities this host holds — a supervisor is ready only when it is
// holding one, which is the state that looks identical to working from outside.
const guests = require('../core/guests')
const actions = require('./table')
// What a supervisor may ask for, and how many times it has asked — see the
// wake below, which uses the count to tell a turn that did something from one
// that could not run at all.
const supervisor = require('../core/supervisor')
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

// AND WHAT HAPPENED WHILE IT WAS THINKING IS NOT DROPPED.
//
// Two turns at once are refused, which is right and was the whole of it — so
// anything that happened mid-turn was simply lost: a task finishing thirty
// seconds into a turn woke nothing, and the supervisor found out about it
// whenever somebody next spoke to it. That is the difference between a
// supervisor that watches and one that is polled by hand.
//
// ONE PENDING WAKE, NOT A QUEUE OF THEM. Waking is "go and read what changed",
// and three of those in a row would read the same thing three times: what is
// worth keeping is THAT something happened, not how many times. The reasons are
// collected so the log can say what it was catching up on.
let pending = null
const alsoWake = why => {
  pending = pending ? `${pending}; ${why}` : why
}

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
        // KEPT, NOT DROPPED. It will go again when this turn ends, once, however
        // many things happened while it was busy — see alsoWake.
        alsoWake(why || 'something happened while it was thinking')
        return { woke: false, pending: true, why: 'it is already thinking. One turn at a time — two would be two things deciding, which is the thing the one-supervisor rule exists to prevent. It will look again when this turn ends.' }
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
        // Taken before the turn starts, so what is compared afterwards is what
        // THIS turn asked for. A count rather than a flag, because two turns can
        // overlap on a busy host and a flag would be reset by whichever finished
        // first.
        const askedBefore = supervisor.asksSoFar()

        const b64 = Buffer.from(WAKE, 'utf8').toString('base64')

        // THE SKILL IS RE-FETCHED EVERY TIME IT WAKES, and that is not tidiness.
        //
        // The skill on the machine is what knows the loop — this file says so a
        // few lines up, and repeating it in the wake prompt would be a second
        // copy that goes stale. The consequence was left unhandled: the skill is
        // fetched once, during provisioning, so a machine built before the loop
        // changed goes on supervising by the old one for ever. The day judging
        // arrived, the supervisor on this host was still being told to read
        // `repoOverview` — an action it is no longer allowed to call.
        //
        // It is six kilobytes over a connection that is already open, once per
        // waking, and it makes "the supervisor is running last month's rules"
        // impossible rather than unlikely. `|| true` because a supervisor that
        // cannot refresh its skill should still take its turn with the one it
        // has — losing the turn entirely is worse than running a version behind,
        // and the line above says which happened.
        // WHERE THIS HOST LISTENS COMES FROM THIS HOST. The first version of
        // this read `$OKC_BASE` out of the agent's env file, which holds the
        // machine's name, its token and the authority — and not the base. The
        // fetch failed with "URL rejected: No host part in the URL", which is
        // the guest reporting an empty variable, and it would have failed
        // silently for ever behind the `|| true` this deliberately has.
        let where = null
        try {
          const at = await s.vbox.hostAddress()
          if (at) where = `https://${at}:${s.net.port}`
        } catch { /* no address means no refresh, and the turn still happens */ }

        const refresh = where
          ? 'mkdir -p "$HOME/.claude/skills/supervising" && ' +
            'eval "$(sudo -n cat /etc/okc-agent.env | grep -E \'^OKC_(VM|TOKEN|CA)=\')" && ' +
            'curl -fsS --cacert "$OKC_CA" -u "$OKC_VM:$OKC_TOKEN" ' +
            '-o "$HOME/.claude/skills/supervising/SKILL.md" ' +
            `"${where}/provision/supervisor-skill.md?vm=$OKC_VM" ` +
            '&& echo okc-skill-refreshed || echo okc-skill-stale'
          : 'echo okc-skill-stale'

        const said = await channel.run(on,
          `cd ~ && ${refresh}; printf %s '${b64}' | base64 -d > /tmp/okc-wake.txt && timeout 600 bash -lc 'okc-supervisor -p "$(cat /tmp/okc-wake.txt)"'; rm -f /tmp/okc-wake.txt`,
          { what: 'one turn of the supervisor', timeout: 660000 })

        if (/okc-skill-stale/.test(said.output || '')) {
          log.on('supervisor', on).warn('it could not refresh the supervising skill, so it took its turn on whatever copy it already had')
        }

        const took = Math.round((Date.now() - began) / 1000)

        // ---- DID ANYTHING ACTUALLY HAPPEN? ---------------------------------
        //
        // A turn that ends normally having asked this host for nothing did
        // nothing, whatever it printed. The commonest cause is a machine that
        // cannot run a worker at all — no credential, a launcher that is gone,
        // a machine that came up wrong — and every one of those ends in seconds
        // and leaves every panel looking exactly as it did.
        //
        // THAT IS THE FAULT THIS FIXES. A wake fired, Claude exited in three
        // seconds for want of a credential, and the person watching the Chat tab
        // saw their message sit unread with nothing anywhere saying why. The host
        // knew: it had logged a three-second turn and not one request.
        //
        // SAID IN THE CHAT, not only in the log, because the chat is where
        // somebody is waiting. A message that is never answered is the exact
        // shape of this failure, so the answer goes where the question is.
        const used = supervisor.asksSoFar() - askedBefore
        if (!used) {
          log.on('supervisor', on).bad(`it woke and asked for nothing in ${took}s — it cannot use this app, so nothing was done`)
          try {
            chat.say({
              who: 'supervisor',
              from: on,
              via: 'wire',
              about: 'it could not run',
              text: `I woke and stopped after ${took}s without asking this host for anything, so nothing was done.\n\n` +
                'That usually means the machine cannot run a worker at all — most often it is holding no credential ' +
                '(Runners → Claude supervisor), and sometimes the launcher or the tool server is missing. ' +
                'Nothing about your message was lost; wake me again once it can run.'
            })
          } catch (e) {
            log.on('supervisor', on).warn(`could not say that it failed to run: ${e.message}`)
          }
        } else {
          log.on('supervisor', on).good(`it thought for ${took}s`)
        }

        return {
          woke: true,
          name: on,
          seconds: took,
          // WHETHER IT USED THIS APP AT ALL, on the answer as well as in the
          // chat, so a caller at the command line sees it without reading a log.
          asked: used,
          ranProperly: used > 0,
          // What it printed, which is its own summary rather than what it said to
          // the person — that went through supervisorSays and is in the chat.
          said: String(said.output || '').split('\n').slice(1).join('\n').trim().slice(-2000),
          note: `${on} took a turn. What it said to you is on the Chat tab.`
        }
      } finally {
        thinking = false

        // AND THEN CATCH UP, if anything happened while it was busy. Not awaited
        // and not recursive in any way that matters: it starts one more turn and
        // returns, and that turn clears the flag the same way.
        const again = pending
        pending = null
        if (again) {
          log.on('supervisor', on).info(`going again — ${again}`)
          setTimeout(() => {
            actions.supervisorWake.run({ name: on, why: again })
              .catch(e => log.on('supervisor').warn(`the catch-up turn did not run: ${e.message}`))
          }, 1000)
        }
      }
    }
  },

  // ---- IS IT READY, AND WHAT IS MISSING ------------------------------------
  //
  // One question, asked in one place, because the answer has four parts and
  // getting any of them wrong looks identical from outside: a supervisor that is
  // off, one that is up but holds no credential, one that is up and signed in,
  // and one that has no chain approved to judge with.
  //
  // THE CREDENTIAL IS THE ONE THAT BIT. A supervisor machine that is running and
  // dialled in and holding nothing looks exactly like a working one from every
  // panel in this window — until it is woken, exits in three seconds, and does
  // nothing. That is the state this makes visible before it costs somebody an
  // afternoon.
  supervisorState: {
    about: 'The supervisor machine: whether it is up, signed in, and able to run',
    run: async () => {
      const all = vms.read()
      const mine = all.filter(v => (v.tags || []).some(x => String(x).toLowerCase() === vms.SUPERVISOR))
      if (!mine.length) {
        return { there: false, note: 'This host has no supervisor machine. Make one on the Runners tab — tick "supervisor machine?" when you create it.' }
      }

      // ONE IS THE ORDINARY CASE and more than one is refused from running
      // together — see vmStart. Reported as a list so a host with two says so
      // rather than picking one quietly.
      const rows = await Promise.all(mine.map(async v => {
        const live = (await actions.vmList.run({})).vms.find(x => x.name === v.name) || v
        const held = guests.all().find(g => g.holder === v.name) || null
        const why = []
        if (live.state !== 'running') why.push('it is switched off')
        else if (!live.connected) why.push('it is starting up — it has not dialled in yet')
        if (!held) why.push('it is holding no credential, so a worker on it cannot authenticate')
        return {
          name: v.name,
          state: live.state,
          connected: !!live.connected,
          // WHICH SIGN-IN, by name and fingerprint, never a value. Same rule as
          // the Keys tab: a model may know something is there without knowing
          // what it is.
          signedInAs: held ? held.name : null,
          fingerprint: held ? held.fingerprint : null,
          ready: !why.length,
          why: why.length ? why.join(', and ') : null
        }
      }))

      const up = rows.find(r => r.ready) || null
      return {
        there: true,
        supervisors: rows,
        ready: !!up,
        name: up ? up.name : rows[0].name,
        thinking,
        note: up
          ? `${up.name} is up and signed in as "${up.signedInAs}". It answers when you say something, if that is switched on.`
          : `${rows[0].name} cannot run: ${rows[0].why}.`
      }
    }
  },

  // ---- ONE PRESS TO START IT ------------------------------------------------
  //
  // Two steps that must both happen and must happen in this order, and doing
  // them by hand is how a supervisor ends up running with nothing to
  // authenticate with. That happened on this host: the credential was taken back
  // to fix something, the machine was started again later, and the sign-in was
  // never given back — so every wake for the rest of the day did nothing.
  //
  // THROUGH THE ACTIONS THAT ALREADY DO EACH PART, because each carries its own
  // refusals: vmStart refuses a second supervisor running at once, and guestLend
  // refuses a sign-in whose role does not match the machine.
  supervisorUp: {
    about: 'Start the supervisor and sign it in, in one press',
    run: async () => {
      const state = await actions.supervisorState.run({})
      if (!state.there) throw new Error(state.note)
      const name = state.name

      const started = []
      // FROM THE LIVE STATE, WHICH IS THE ONLY ONE THERE IS. The stored record
      // has no `state` field at all — whether a machine is running is asked of
      // VirtualBox every time, deliberately, because a second opinion about it
      // is the bug this app's machine layer exists to prevent. Reading
      // `vms.read().state` gets `undefined`, and every comparison against it is
      // quietly wrong: this said "not running" about a running machine, and its
      // opposite number below said "not running" about one that was, so
      // supervisorDown never stopped anything.
      //
      // supervisorState already asked, up there. Use its answer.
      const was = (state.supervisors || []).find(r => r.name === name) || {}
      if (was.state !== 'running') {
        // supervisorMachine starts it AND waits for it to dial in, which is
        // the part a person doing this by hand forgets — a credential cannot be
        // put on a machine that is not talking yet.
        await s.supervisorMachine(name)
        started.push('started it')
      }

      // WHATEVER IT IS ALREADY HOLDING IS LEFT ALONE. Lending a second sign-in
      // over the top would be two identities on one machine, and taking one back
      // to put the same one on again would rotate a token for nothing.
      const held = guests.all().find(g => g.holder === name) || null
      if (!held) {
        const free = guests.all().find(g => g.role === 'supervisor' && g.has && !g.holder)
        if (!free) {
          throw new Error('There is no supervisor sign-in free to give it. Add one under Runners → Claude supervisor, or take the one that is out back from whatever is holding it.')
        }
        await actions.guestLend.run({ name: free.name, machine: name })
        started.push(`signed it in as "${free.name}"`)
      }

      const now = await actions.supervisorState.run({})
      return {
        ...now,
        did: started.length ? started.join(', and ') : 'it was already up and signed in',
        note: now.ready
          ? `${name} is ready — ${started.length ? started.join(', and ') : 'it was already up'}.`
          : `${name} is still not ready: ${(now.supervisors[0] || {}).why}`
      }
    }
  },

  // ---- AND ONE PRESS TO PUT IT AWAY ----------------------------------------
  //
  // The credential comes off BEFORE the machine stops, and that order is the
  // whole point of this being one press. Stopping it first leaves a sign-in on a
  // powered-off disk with nothing on this host recording it as out — which is
  // exactly what a host restart does, and what somebody then has to notice and
  // unpick by hand.
  //
  // AND WHAT THE WORKER REFRESHED COMES BACK WITH IT. guestBack reads the
  // credential off the machine first: a supervisor session rotates its token,
  // and stopping without reading throws the newer one away.
  supervisorDown: {
    about: 'Take the credential back and stop the supervisor, in that order',
    run: async () => {
      const state = await actions.supervisorState.run({})
      if (!state.there) throw new Error(state.note)
      const name = state.name
      const did = []

      const held = guests.all().find(g => g.holder === name) || null
      if (held) {
        const back = await actions.guestBack.run({ name: held.name, machine: name })
        did.push(back.rotated
          ? `took "${held.name}" back, refreshed — ${back.fingerprint}`
          : `took "${held.name}" back unchanged`)
      }

      // THE LIVE STATE, as above. This is the half that failed silently: it
      // took the credential back, said so, and left the machine running —
      // reporting success for half a job.
      const was = (state.supervisors || []).find(r => r.name === name) || {}
      if (was.state === 'running') {
        await actions.vmStop.run({ name })
        did.push('stopped it')
      }

      return {
        name,
        did: did.length ? did.join(', and ') : 'it was already off and holding nothing',
        note: `${name}: ${did.length ? did.join(', and ') : 'nothing to do — it was already away'}.`
      }
    }
  },

  supervisorThinking: {
    about: 'Whether the supervisor is mid-turn right now',
    run: () => ({ thinking: busyThinking(), wakes: settings.read().supervisorWakes === true })
  }
}
