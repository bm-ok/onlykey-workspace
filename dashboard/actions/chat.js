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
// What arrived on GitHub at the last look — see repos/watching.js.
const watching = require('../repos/watching')
// The Claude identities this host holds — a supervisor is ready only when it is
// holding one, which is the state that looks identical to working from outside.
const guests = require('../core/guests')
const actions = require('./table')
// What a supervisor may ask for, and how many times it has asked — see the
// wake below, which uses the count to tell a turn that did something from one
// that could not run at all.
const supervisor = require('../core/supervisor')
const s = require('./shared')
const { log, events, tasks, vms, landings, drafts, channel, settings, meter } = s

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
      // WHERE THE PERSON IS READING FROM, which is not where the supervisor has
      // read TO. Both are pointers into this list and they mean opposite things
      // — see core/chat.js.
      const from = chat.fromMark()

      // WHAT THE SUPERVISOR WOULD NOT SEE IF IT WOKE NOW.
      //
      // `missed` on this answer is always zero and always will be: the window
      // asks with no bookmark and is handed everything, so the field describes
      // the window's own reading rather than anybody's problem.
      //
      // The number worth showing is the OTHER end's. A supervisor reads with
      // `whatsNew`, which trims to the most recent 200 and reports how many it
      // dropped — and nothing has ever surfaced that, so the moment a
      // conversation passes that length the far end silently stops being able
      // to see the beginning of it. Asked here the same way it will be asked
      // there, from the same bookmark, so this is a rehearsal rather than an
      // estimate.
      const beyond = chat.since(Number(read && read.n) || 0).missed || 0

      return {
        ...rows,
        read,
        from,
        beyondReach: beyond,
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

  // ---- START READING FROM HERE ---------------------------------------------
  //
  // What "Clear" should have been. Nothing is deleted: the bookmark moves and
  // everything before it stops being drawn. Pass 0 to take it back and see the
  // whole conversation again.
  //
  // A CONVERSATION WITH A SUPERVISOR IS THE RECORD OF WHY WORK EXISTS — what was
  // asked for, what it decided, what it was told. Throwing that away to tidy a
  // screen is a trade nobody would make twice, and it cannot be undone.
  chatFrom: {
    about: 'Start reading from here: hide what came before without deleting any of it',
    takes: ['n'],
    run: ({ n, _fromMachine, _overTheWire, _fromTest }) => {
      // No argument means "from now" — the ordinary press.
      const at = n === undefined || n === null || n === '' ? chat.lastNumber() : Number(n)
      const set = chat.markFrom(at, _fromMachine || (_overTheWire ? 'the command line' : _fromTest ? 'a drill' : 'the window'))
      return {
        ...set,
        of: chat.lastNumber(),
        note: set.n
          ? `Reading from message ${set.n + 1} on. Nothing was deleted — ask for chatFrom with n 0 to see all of it again.`
          : 'Showing the whole conversation again.'
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
      // NEVER LESS THAN WHAT HAS NOT BEEN ANSWERED, whatever bookmark is passed.
      //
      // THIS ACTION USED TO ERASE WHAT IT RETURNED. It marks read on the way
      // out, and the skill tells a supervisor to keep the bookmark and pass it
      // — so the FIRST call in a turn returned the message and moved the mark,
      // and the SECOND call, made with that fresh bookmark, returned an empty
      // conversation. It calls this two to four times a turn, every turn.
      //
      // Four messages in a row were read and answered with "nothing to do",
      // including one that said "you have twice not answered me". The bookmark
      // proved they were delivered; the second look is what decided the reply.
      // From the outside it was indistinguishable from a model ignoring
      // somebody, which is where two hours went.
      //
      // So the floor is the last thing the supervisor ITSELF said. Everything
      // after that is, by definition, something it has not replied to, and no
      // bookmark it can pass will hide it. Asking twice in one turn now gives
      // the same answer twice, which is what "what is new" has to mean if a
      // model is allowed to ask it more than once.
      //
      // THE RECEIPT IS UNCHANGED and is still written below. "It looked and
      // said nothing" stays different from "it has not looked yet" — see the
      // note there, which is right and is not what this is about.
      const spoke = chat.all().filter(m => m.who === 'supervisor').map(m => Number(m.n))
      const lastSaid = spoke.length ? Math.max(...spoke) : 0
      const asked = since == null ? 0 : Number(since) || 0
      // A BUDGET, BECAUSE THE READING END HAS ONE. `whatsNew` is answered into a
      // tool result on a machine, and an answer too large to accept is an answer
      // that does not arrive -- which is not a smaller version of arriving, it is
      // the supervisor going blind to everything said to it. The chat was 81% of
      // a 102,000-character reply; the rest of this answer is small and must not
      // be crowded out by it.
      const talk = chat.since(Math.min(asked, lastSaid), { bytes: 20000 })

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
        // HOW MANY WERE NOT SENT, which was already here and now has a second
        // reason to be non-zero: too much text rather than too many messages.
        // Either way it is the difference between "nobody said anything" and
        // "you were not shown it", and only one of those is a reason to ask.
        missed: talk.missed,
        saidNote: talk.missed
          ? `${talk.missed} earlier message(s) are not in this answer — the newest that fit are. Ask "chat" for the whole conversation if what you need is older than this.`
          : null,
        tasks: {
          queued: waiting.map(t => ({ id: t.id, number: t.number, title: t.title, branch: t.branch, tag: t.tag || null })),
          running: working.map(t => ({ id: t.id, number: t.number, title: t.title, machine: t.machine })),
          // The ones worth its attention: finished, and nobody has judged them.
          waitingOnAVerdict: finished.map(t => ({ id: t.id, number: t.number, title: t.title, branch: t.branch }))
        },
        machines: vms.read().map(v => v.name).length,
        cuts: Object.values(landings.all() || {}).length,

        // ---- AND WHAT IT HAS WRITTEN AND NOT SENT --------------------------
        //
        // A DRAFT IS ITS OWN UNFINISHED WORK, and it could not see it. Writing
        // one is on its list and reading them back was not, so a supervisor that
        // wrote a draft, went to sleep and woke up had no way of learning it had
        // one -- `cuts` is a count of what has ALREADY gone, which is the half
        // that needs nothing from anybody.
        //
        // The consequence was a change sitting drafted and unsent with nothing
        // wrong with it. Cutting is the supervisor's own act -- its skill says so
        // in as many words, "do not stop at the draft and ask" -- and an act it
        // cannot see the input to is one it will not take.
        //
        // NOT ONE THAT HAS ALREADY BEEN CUT. The text was written for that cut
        // and the cut exists; listing it as outstanding is asking for the same
        // thing twice. Same rule as the window's own count, deliberately: two
        // answers to "what is waiting" that can disagree is worse than either.
        unsent: (() => {
          const already = new Set(Object.values(landings.all() || {}).map(c => `${c.source} -> ${c.target}`))
          return Object.values(drafts.all() || {})
            .filter(d => !already.has(`${d.source} -> ${d.target}`))
            .map(d => ({ source: d.source, target: d.target, title: d.title || null, at: d.at || d.touched || null }))
        })(),

        // WHAT ARRIVED FROM OUTSIDE, which is the only thing here that nobody
        // wrote down first. An issue somebody filed and a pull request somebody
        // proposed are the two things that turn up on their own -- and this had
        // no way of saying so, so a supervisor woke, saw nothing new, and went
        // back to sleep with an open issue sitting there. It could ASK (issues
        // and pulls are on its list) and was never told there was anything to
        // ask about.
        //
        // FROM THE LAST LOOK, NOT FROM GITHUB. This runs inside a wake, and a
        // wake is not the moment to spend a round trip per repository; the
        // watcher looks on its own slow cadence and this reports what it found.
        // The time of that look is carried, because a list with no age is one
        // whose staleness cannot be judged -- and it is null when nothing has
        // ever looked, which is different from nothing being there.
        arrived: (() => {
          const seen = watching.lastLook()
          return {
            lookedAt: seen.at,
            watching: settings.read().watchGitHub === true,
            issues: seen.issues.map(o => ({ on: o.on, number: o.number, title: o.title, url: o.url, by: o.by, firstSeen: o.first })),
            pulls: seen.pulls.map(o => ({ on: o.on, number: o.number, title: o.title, url: o.url, by: o.by, head: o.head, firstSeen: o.first }))
          }
        })()
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

      // AND IT CAN ACTUALLY THINK BEFORE IT IS ASKED TO.
      //
      // Dialling in signs a supervisor in, which covers every ordinary route --
      // but a wake that STARTED the machine is racing that, and a wake that
      // found it already up has no dial-in to have caught it. Both end the same
      // way without this: `okc-supervisor -p` runs, hits a sign-in menu, exits
      // in three seconds, and the record says it asked for nothing. That has
      // happened here and reads as a supervisor with nothing to say.
      //
      // Not fatal. If there is no sign-in to give, the turn still runs and
      // still fails -- and it fails saying so, in the transcript, which is
      // better than this refusing on its behalf.
      try {
        const put = await actions.supervisorSignIn.run({ name: on })
        if (put.did) log.on('supervisor', on).info('it had no sign-in when it was woken — given one before the turn')
      } catch (e) {
        log.on('supervisor', on).warn(`could not check its sign-in before waking it: ${e.message}`)
      }

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

        // ---- AND IT CAN BE WATCHED WHILE IT THINKS -------------------------
        //
        // A turn is a command over the channel, which hands back everything at
        // the end -- so a supervisor thinking for four minutes was a spinner and
        // nothing else, exactly as a worker's run was until dispatch started
        // asking for `stream-json`. This is the same fix in the other half of
        // the app: the turn writes one event per line to a file on the machine,
        // and `okc-watch` there follows it.
        //
        // THE FILE IS WHERE THE OUTPUT GOES, not a copy of it. `said.output`
        // carried the whole turn as prose and exactly one thing read it -- the
        // skill-refresh marker, which is echoed before any of this and still
        // arrives. What a turn actually PRODUCES reaches this host through the
        // supervisor API, not through stdout, so nothing downstream loses
        // anything by the transcript going to a file instead. What is gained is
        // that it is a file: a supervisor is never rolled back, so a turn that
        // went wrong is still readable tomorrow.
        //
        // ONE PER TURN, AND A NAME THAT DOES NOT MOVE. `current.log` is
        // relinked at the start of each turn, so a terminal left running
        // `tail -F` on it shows every wake as it happens rather than one and
        // then silence -- which is the way somebody actually watches this.
        // BUILT IN machines/, checked in machines/. What reaches a machine is
        // shell, and shell assembled in an action is shell nothing can render
        // without waking a supervisor to see it -- which is how a `continue`
        // outside a loop and a self-matching `pkill` both got as far as a guest
        // in this project. `supervisorTurn` hands back the text, and the suite
        // runs `bash -n` over it.
        const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')
        const said = await channel.run(on,
          s.dispatch.supervisorTurn({ stamp, brief: b64, refresh }),
          { what: 'one turn of the supervisor', timeout: 660000 })

        if (/okc-skill-stale/.test(said.output || '')) {
          log.on('supervisor', on).warn('it could not refresh the supervising skill, so it took its turn on whatever copy it already had')
        }

        const took = Math.round((Date.now() - began) / 1000)

        // ---- WHAT IT COST, WHILE THE TURN'S LOG IS STILL THERE -------------
        //
        // The CLI ends a run with a `result` line carrying the turns, the
        // duration, the tokens and what it cost. For a WORKER that line is read
        // by machines/job-api.js; for a supervisor nothing read it at all, so a
        // waking left "it thought for 38s" in the log and no record anywhere of
        // what had been spent doing it.
        //
        // ATTRIBUTED TO THE SIGN-IN, which is the question worth answering. This
        // host can hold several and the supervisor's is chosen deliberately —
        // "which account is this billed to" is the reason that choice exists,
        // and it could not be answered afterwards.
        //
        // BEST EFFORT, AND NEVER FATAL. A turn that happened and was not metered
        // is a gap in a total; a turn that FAILED because the metering did is a
        // supervisor this host cannot use. The first is worth having, the second
        // is not, so every part of this is inside one catch and the turn's own
        // result is untouched by it.
        try {
          const tail = await channel.run(on,
            `tail -c 4000 ${s.dispatch.SUPERVISOR}/current.log 2>/dev/null || true`,
            { what: 'reading what the turn cost', timeout: 20000, quiet: true })

          // THE LAST `result` LINE, because a turn can print more than one and
          // the last is the one that is about the whole of it. Read line by line
          // rather than with a regex over the file: these are whole JSON objects
          // and half-parsing somebody else's format is how a number silently
          // becomes the wrong number.
          let last = null
          for (const line of String(tail.output || '').split('\n')) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('{') || !trimmed.includes('"result"')) continue
            try {
              const e = JSON.parse(trimmed)
              if (e && e.type === 'result') last = e
            } catch { /* a line cut in half by the tail, which is expected */ }
          }

          if (last) {
            // WHICH SIGN-IN IS ON THAT MACHINE, asked of the guests store rather
            // than assumed from the setting: the setting says which one SHOULD
            // be used and the holder is which one actually is, and a turn is
            // billed to the one that ran it.
            const holder = guests.all().find(g => g.holder === on)
            meter.record({
              key: holder ? holder.name : null,
              machine: on,
              kind: 'supervisor',
              about: 'a waking',
              ref: stamp,
              ...meter.fromResult(last)
            })
          }
        } catch (e) {
          log.on('supervisor', on).warn(`could not read what that turn cost: ${e.message}`)
        }

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

          // AND WHAT IT SAID BEFORE IT STOPPED, which used to be nowhere.
          //
          // The turn's transcript is a file on the machine now, and this is the
          // moment it is worth reading: a turn that asked for nothing has a
          // reason, and the reason is in there. It was previously in `output`
          // and was not looked at, then briefly nowhere at all.
          //
          // Best effort and short. The failure being diagnosed may well be the
          // machine itself, so this must not become a second thing that hangs;
          // the whole file is still on the machine for anybody who wants it.
          try {
            const tail = await channel.run(on,
              `tail -c 1200 ${s.dispatch.SUPERVISOR}/current.log 2>/dev/null || true`,
              { what: 'reading why the turn did nothing', timeout: 20000, quiet: true })
            const words = String(tail.output || '').trim()
            if (words) log.on('supervisor', on).info(`the end of its transcript: ${words.slice(-600)}`)
          } catch (e) {
            log.on('supervisor', on).warn(`could not read its transcript: ${e.message}`)
          }
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

  // ---- AND NO PRESS AT ALL, WHICH IS THE ORDINARY CASE ----------------------
  //
  // A SUPERVISOR THAT IS UP SHOULD BE SIGNED IN, FULL STOP. There was a button
  // for it and a banner explaining when to press it, which is a tool asking
  // somebody to perform a step that has exactly one right answer: a supervisor
  // is not handed an identity per task the way a runner is -- it holds one for
  // as long as it is up, it is useless without one, and there is nothing else
  // this host would rather do with a supervisor sign-in.
  //
  // WHY IT KEPT NOT HAPPENING. Every path that starts the machine is a path
  // somebody wrote for another reason: a host restart brings it up, `vmStart`
  // brings it up, a person at the window brings it up. Only `supervisorUp` also
  // signed it in, so the machine came up able to do nothing rather more often
  // than it came up ready -- and the failure is silent, because a wake with no
  // credential runs, exits in three seconds and reports that it asked for
  // nothing.
  //
  // IDEMPOTENT AND QUIET. It is called when a machine dials in and again before
  // every wake, so it must be safe to call constantly: holding one already is
  // the ordinary answer and says nothing to the log. It never takes a sign-in
  // off anything -- one that is out on another machine is a person's decision
  // and stays that way.
  //
  // IF YOU WANT IT SIGNED OUT, STOP IT. `supervisorDown` takes the credential
  // back and then stops the machine, in that order, and this only ever acts on
  // a machine that is up -- so the deliberate way to have a signed-out
  // supervisor is the same one press it always was, and this cannot undo it.
  supervisorSignIn: {
    about: 'Make sure a supervisor that is up is holding its sign-in. Does nothing if it already is',
    takes: ['name'],
    run: async ({ name = null }) => {
      const is = v => (v.tags || []).some(t => String(t).toLowerCase() === vms.SUPERVISOR)
      const all = vms.read().filter(is).filter(v => !name || v.name === name)
      if (!all.length) return { did: null, why: name ? `"${name}" is not a supervisor machine` : 'there is no supervisor machine on this host' }

      // ONLY WHAT IS UP. Starting a machine is a decision with a cost and this
      // is not the thing that gets to make it -- a supervisor that is off is
      // off on purpose, and `supervisorUp` is how somebody changes their mind.
      const up = all.filter(v => channel.connected(v.name))
      if (!up.length) return { did: null, why: 'it is not up' }

      const done = []
      for (const v of up) {
        if (guests.all().some(g => g.holder === v.name)) continue   // it has one
        // THE ONE THAT WAS CHOSEN, not whichever is free. See `whichKey`.
        const use = guests.supervisorKey()
        if (!use.key) {
          // Said once per call and never as an error. Having no sign-in to give
          // is a real state with a real repair, and the repair is a person --
          // at a browser, or at the pane where the one to use is chosen.
          // Throwing here would turn every dial-in and every wake into a
          // failure.
          return { did: null, why: use.why }
        }
        await actions.guestLend.run({ name: use.key.name, machine: v.name })
        log.on('supervisor', v.name).good(`signed it in as "${use.key.name}" — a supervisor that is up holds its sign-in`)
        done.push(`${v.name} signed in as "${use.key.name}"`)
      }
      return { did: done.length ? done.join(', ') : null, why: done.length ? null : 'it was already signed in' }
    }
  },

  // ---- AND WHICH SIGN-IN IT USES IS A CHOICE, MADE ONCE ---------------------
  //
  // Pass a name to choose one; pass nothing to read what is chosen and what
  // there is to choose from.
  //
  // SWITCHING TAKES EFFECT, rather than being a preference that applies next
  // time. A setting that describes the future and not the present is one
  // somebody has to work out the consequences of -- and the consequence here is
  // "which account is this machine spending" -- so choosing a different sign-in
  // while the supervisor is up takes the old one back and hands the new one
  // over, in that order, and says so.
  //
  // WHAT THE WORKER REFRESHED COMES HOME. Taking one back is guestBack rather
  // than forgetting it: a token that rotated on the machine is the live one, and
  // dropping it would leave this host holding a superseded copy of an identity
  // it still thinks it has.
  supervisorKey: {
    about: 'Which supervisor sign-in this host uses, and switching it. Pass nothing to read it',
    takes: ['name'],
    run: async ({ name = null }) => {
      const sups = guests.all().filter(g => g.role === 'supervisor')
      const chosen = settings.read().supervisorKey

      // Reading. Names, fingerprints and holders -- never anything a credential
      // says, which is the rule this whole surface is built to.
      if (!name) {
        const now = guests.supervisorKey()
        return {
          chosen,
          // WHAT IS ACTUALLY BEING USED, which is the one on a machine if there
          // is one and otherwise the one that would be handed over next. Read
          // off `key` alone this said "none" at the exact moment a supervisor
          // was signed in and working — because `key` means "free to give",
          // and a sign-in in use is not free.
          using: now.inUse ? now.inUse.name : (now.key ? now.key.name : null),
          why: now.why,
          keys: sups.map(g => ({
            name: g.name,
            has: g.has,
            fingerprint: g.fingerprint || null,
            holder: g.holder || null,
            chosen: g.name === chosen,
            // True when nothing is chosen and there is only one: it IS what
            // gets used, and a pane that showed nothing selected would be
            // describing a choice the app is not making.
            byDefault: !chosen && sups.length === 1
          })),
          note: sups.length ? null : 'this host has no supervisor sign-in at all'
        }
      }

      const one = sups.find(g => g.name === name)
      if (!one) throw new Error(`There is no supervisor sign-in called "${name}". Runners → Claude supervisor lists them.`)
      if (!one.has) throw new Error(`"${name}" has no token file kept here, so it cannot be used. Sign it in again at the desk.`)

      const before = sups.find(g => g.holder) || null
      settings.write({ supervisorKey: name })
      log.on('supervisor').info(`the supervisor sign-in is now "${name}"`)

      // Already the one in use. Nothing to move, and saying so is better than a
      // sentence describing a swap that did not happen.
      if (before && before.name === name) {
        return { chosen: name, did: `"${name}" was already the one in use, on ${before.holder}`, on: before.holder }
      }

      const did = [`"${name}" is the supervisor sign-in from now on`]
      // Only when something is actually holding the old one. A choice made with
      // the machine off is just a choice, and it applies when it next comes up.
      if (before) {
        const machine = before.holder
        await actions.vmCredentialsForget.run({ name: machine })
        did.push(`took "${before.name}" back off ${machine}`)
        const put = await actions.supervisorSignIn.run({ name: machine })
        did.push(put.did || `could not sign ${machine} in: ${put.why}`)
      }
      return { chosen: name, did: did.join(', ') }
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
