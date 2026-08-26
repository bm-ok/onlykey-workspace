'use strict'

// the conversation — what was asked for, who said it, and when it was read
//
// Everything else in this app records what was DONE. The Chat tab is the other
// half: what was asked for, and what the thing doing the deciding said about it.
// It is where work comes from now, which makes "who said this" a question this
// record has to answer six weeks later.
//
// THREE CLAIMS, AND THEY ARE ALL ABOUT TRUST:
//
//   who said it     is stamped from the call, never taken from the message. A
//                   supervisor cannot sign a line as a person, and the surface
//                   it reaches this host over does not name the person's verb at
//                   all.
//   what was read   is a receipt written when the words are HANDED OVER, not
//                   when they are stored and not when a reply arrives. A
//                   supervisor that reads something and decides to do nothing has
//                   still read it.
//   one at a time   two supervisors deciding is the failure the whole idea
//                   guards against, and the door that brings a machine up is
//                   where it is refused.
//
// NEEDS NO MODEL AND ALMOST NO MACHINE. Everything here is this host's own
// records, except the last check, which makes a second supervisor machine
// definition and throws it away again.

const { it, cleanup, requires } = require('../../harness')

requires('the machines are built')

// NO "drill:" PREFIX ANY MORE. A drill's calls are marked as a drill by the
// harness — every message it writes is recorded as coming from `test`, and the
// window says so beside it — so the text can be an ordinary sentence. Which is
// what it should be: this record is read by a person, and a convention living in
// the words is one somebody's real message eventually starts with by accident.
const MARK = `a line from the conversation suite at ${new Date().toISOString().slice(11, 19)}`

it('a person can say something, and it is recorded as a person saying it', async ({ okc, assert, state, log }) => {
  const before = (await okc('chat')).messages || []
  const said = await okc('chatSay', { text: MARK, about: 'a drill' })

  assert.ok(said.n > 0, 'a message came back with no number, and the number is the whole protocol')
  assert.equal(said.who, 'person', `a message from the window was recorded as "${said.who}"`)
  state.n = said.n

  const now = (await okc('chat')).messages || []
  assert.equal(now.length, before.length + 1, 'the conversation did not grow by exactly one')
  const mine = now.find(m => m.n === said.n)
  assert.ok(mine && mine.text === MARK, 'what came back is not what was said')
  log(`#${said.n} recorded as "${said.who}"`)
})

it('and the supervisor cannot say something as you', async ({ okc, assert, log }) => {
  // THE ONE THING THIS RECORD MUST NOT ALLOW. If a machine could write a line as
  // the person, then "who asked for this work" has no answer — and that is the
  // question the whole conversation exists to answer.
  //
  // Asked of the LIST rather than of a machine, because that is where it is
  // decided: the person's verb is not on a supervisor's allowlist, so from over
  // the wire it does not exist. See core/supervisor.js.
  // ASKED OF THE RUNNING APP, not required out of a module. This said
  // `require('../../../core/supervisor')` — the app being ported from's path,
  // which is not here — and a drill is a PAYLOAD beside the server bundle with
  // no `src/app` next to it, so no relative require would have reached the list
  // whatever it named. It threw rather than failing, and a check that throws
  // proves nothing about a list; the six checks under it were unrunnable behind
  // it the whole time.
  const may = new Set(((await okc('supervisorMay')).may || []).map(m => m.action))
  assert.ok(!may.has('chatSay'), 'a supervisor may call chatSay, which is the person\'s half of the conversation — it could then write a line as you')
  assert.ok(!may.has('chatClear'), 'a supervisor may throw the conversation away')
  // AND IT MAY NOT MOVE WHERE THE PERSON IS READING FROM. `chatFrom` deletes
  // nothing, which is exactly what would make it a quiet one to hold: a machine
  // that can push the bookmark past its own answers is one that can hide what it
  // said from the person it said it to.
  assert.ok(!may.has('chatFrom'), 'a supervisor may move the bookmark the person reads from, and could hide its own answers behind it')
  assert.ok(may.has('supervisorSays'), 'a supervisor cannot say anything at all, which makes it a machine that cannot answer')
  log('the person\'s half of the conversation is not on the supervisor\'s list; its own half is')
})

it('and what it says is signed with the machine that said it', async ({ okc, assert, state, log }) => {
  // The route stamps the machine on every call it forwards, after stripping
  // anything the machine sent under an underscore — see server.js. Here that is
  // exercised through the action directly, which is the half this host owns: a
  // message with no machine named is a message nothing can be traced to.
  const said = await okc('supervisorSays', { text: 'a line from the supervisor side', about: 'a drill', _fromMachine: 'drill-machine' })
  state.theirs = said.n
  assert.equal(said.who, 'supervisor', `it was recorded as "${said.who}"`)
  assert.equal(said.from, 'drill-machine', `it was recorded as coming from "${said.from}"`)
  log(`#${said.n} recorded as the supervisor, from ${said.from}`)
})

it('and a message is not read until it has been handed over', async ({ okc, assert, state, log }) => {
  // A MESSAGE WRITTEN DOWN IS NOT A MESSAGE DELIVERED. The supervisor is switched
  // off most of the time, so a line may have been read a second ago or may be
  // waiting for a machine to boot — and from the person's side those look
  // identical, which is what the receipt is for.
  const said = await okc('chatSay', { text: 'this one should be unread until it is fetched', about: 'a drill' })
  const mark = (await okc('chat')).read || {}
  assert.ok(Number(mark.n) < said.n,
    `a message was marked read the moment it was stored (read up to ${mark.n}, message ${said.n}). Stored is not delivered, and saying otherwise makes the receipt worthless`)

  // whatsNew is the moment the words arrive.
  const got = await okc('whatsNew', { since: 0, events: false, _fromMachine: 'drill-machine' })
  assert.ok(got.bookmark >= said.n, `it was handed the conversation and the bookmark stopped at ${got.bookmark}`)

  const after = (await okc('chat')).read || {}
  assert.ok(Number(after.n) >= said.n, `the words were handed over and the receipt still reads ${after.n}`)
  assert.equal(after.by, 'drill-machine', `the receipt does not say who read it: ${JSON.stringify(after)}`)
  state.readTo = Number(after.n)
  log(`unread at ${mark.n}, handed over, read to ${after.n} by ${after.by}`)
})

it('and a receipt never goes backwards', async ({ okc, assert, state, log }) => {
  // A supervisor asking with an old bookmark is RE-READING, not un-reading. A
  // receipt that flickers off is worse than none: it would say "not read yet"
  // about something that has been read, which is the one thing it is for.
  await okc('whatsNew', { since: 0, events: false, _fromMachine: 'drill-machine' })
  const now = (await okc('chat')).read || {}
  assert.ok(Number(now.n) >= state.readTo, `the receipt moved backwards, from ${state.readTo} to ${now.n}`)
  log(`it re-read from the beginning and the receipt stayed at ${now.n}`)
})

it('and asking twice in one turn gives the same answer twice', async ({ okc, assert, log }) => {
  // THE READ MUST NOT ERASE WHAT IT RETURNED, and for a long time it did.
  //
  // `whatsNew` writes the receipt on the way out, and the supervisor's skill
  // tells it to keep the bookmark and pass it. It calls `whatsNew` two to four
  // times in a single turn — so the first call returned the message and moved
  // the mark, and the second, made with that fresh bookmark, was handed an empty
  // conversation. Whichever look it happened to compose its answer from decided
  // whether the person had said anything at all.
  //
  // FOUR MESSAGES WENT THIS WAY, each delivered, each marked read, each answered
  // with "nothing to do" — including one that said "you have twice not answered
  // me, tell me which it was". From outside it was indistinguishable from a model
  // ignoring somebody, and two hours went into the wrong explanation.
  //
  // The floor is now the last thing the supervisor itself SAID: everything after
  // that is by definition unanswered, and no bookmark it can pass will hide it.
  // This is the check that would have caught it, and it needs no machine.
  const said = await okc('chatSay', { text: 'asked once, and it must still be here on the second look', about: 'a drill' })

  const first = await okc('whatsNew', { since: 0, events: false, _fromMachine: 'drill-machine' })
  const sawIt = (first.said || []).some(m => Number(m.n) === Number(said.n))
  assert.ok(sawIt, `the first look did not include the message that was just said (n${said.n})`)

  // Exactly what a supervisor does next: pass back the bookmark it was handed.
  const again = await okc('whatsNew', { since: first.bookmark, events: false, _fromMachine: 'drill-machine' })
  const stillThere = (again.said || []).some(m => Number(m.n) === Number(said.n))
  assert.ok(stillThere,
    `the second look in the same turn lost it. Asked with the bookmark the first look handed back (${first.bookmark}) and the conversation came back with ${(again.said || []).length} message(s) — this is the bug that made four messages in a row read as "nothing to do"`)

  log(`n${said.n} survived a second look asked with bookmark ${first.bookmark}`)
})

it('and the receipt is still written, which is a different thing', async ({ okc, assert, log }) => {
  // The fix above must not have been made by moving the receipt. "It looked and
  // said nothing" has to stay different from "it has not looked yet" — that
  // distinction is what the Chat tab shows a person, and it is the reason the
  // receipt is written when words are HANDED OVER rather than when a reply
  // arrives. A reply may never arrive.
  const said = await okc('chatSay', { text: 'read me and do not reply', about: 'a drill' })
  await okc('whatsNew', { since: 0, events: false, _fromMachine: 'drill-machine' })
  const mark = (await okc('chat')).read || {}
  assert.ok(Number(mark.n) >= Number(said.n),
    `it was handed over and the receipt reads ${mark.n}, behind n${said.n} — the idempotent read must not have cost the receipt`)
  log(`handed over and marked read to ${mark.n} without any reply being written`)
})

it('and tidying the screen hides the conversation without deleting any of it', async ({ okc, assert, log }) => {
  // WHAT "CLEAR" IS. A conversation with a supervisor is the record of why work
  // exists — what was asked for, what it decided, what it was told. The button
  // beside it says Clear because that is what somebody reaches for when a screen
  // is long, and what it must do is move a bookmark: everything before it stays
  // exactly where it is and stops being drawn.
  //
  // THE FAILURE THIS IS BUILT AROUND is not a bad press — it is a MISSING
  // ACTION. This app had no `chatFrom`, and the window's Clear called
  // `chatClear`, which is not defined here either. An action this app does not
  // have is not refused: it is relayed to the app being ported from. So the one
  // conversation that press could reach was the real one, in the one app nothing
  // here may write to, and every check in this file would have stayed green.
  const before = (await okc('chat')).messages || []
  assert.ok(before.length >= 2, 'there is not enough conversation here to hide half of')
  const last = Number(before[before.length - 1].n)

  const set = await okc('chatFrom', {})
  assert.equal(Number(set.n), last, `it bookmarked ${set.n} rather than the last message, ${last}`)

  const hidden = await okc('chat')
  assert.equal(Number(hidden.from && hidden.from.n), last, 'the bookmark is not on the answer, so the window cannot hide anything')
  // NOTHING WAS DELIVERED ANYWHERE ELSE, and nothing was lost: the messages are
  // all still handed over, and the hiding is the window's to do.
  assert.equal((hidden.messages || []).length, before.length,
    `${before.length - (hidden.messages || []).length} message(s) went missing — this hides, it does not delete`)

  const back = await okc('chatFrom', { n: 0 })
  assert.equal(Number(back.n), 0, 'zero did not take the bookmark back, so there is no way to see the whole thing again')
  const whole = await okc('chat')
  assert.equal(Number(whole.from && whole.from.n), 0, 'the bookmark is still set after being taken back')
  assert.equal((whole.messages || []).length, before.length, 'the conversation did not come back whole')

  log(`bookmarked at ${last}, all ${before.length} still there, and taken back to 0`)
})

it('and the destructive one is refused from out here, rather than travelling', async ({ okc, assert, log }) => {
  // THE SAME HOLE, ONE DOOR OVER. `chatClear` was not defined in this app
  // either, so asking for it did not fail — it was relayed to the app being
  // ported from and emptied the real conversation there. This check is what
  // stands between "it is not ported yet" and "it deleted somebody's record":
  // it must REFUSE, and refusing is only possible if it exists here.
  //
  // A drill is over the wire like the command line is, so this is the same door
  // a person at a terminal comes through.
  await assert.refuses(
    () => okc('chatClear', {}),
    'chatFrom',
    'chatClear was not refused from out here — and if it is not defined in this app at all, what it '
      + 'just emptied is the conversation in the app being ported from')

  const still = (await okc('chat')).messages || []
  assert.ok(still.length > 0, 'the conversation is empty after a refusal, so something was cleared anyway')
  log(`refused, and all ${still.length} message(s) are still here`)
})

// WHAT THE SWITCH WAS BEFORE ANY OF THIS TOUCHED IT, recorded by whichever check
// gets there first and never overwritten.
//
// IT WAS ONLY IN THE FIRST OF THE TWO, and a check can be run on its own —
// `suiteRun --check` does exactly that. Run alone, the one below turned
// "Answers by itself" ON and the cleanup skipped, because the value it restores
// was never recorded. That leaves the one setting on this host that spends a
// model's time on somebody's next sentence armed, by a drill, silently. Caught
// by running exactly that.
async function remember (okc, state) {
  const now = (await okc('settings')).settings.supervisorWakes === true
  if (state.wakes === undefined) state.wakes = now
  return now
}

it('and saying something says what would make it read it', async ({ okc, assert, state, log }) => {
  // "I SENT A MESSAGE AND IT NEVER GOT READ", which is what this looked like
  // from outside and was not a receipt fault at all: the message was written
  // down correctly, "Answers by itself" was off, and nothing on this host had
  // any reason to read it. That is the right behaviour — the switch is off by
  // default because a sentence typed here otherwise starts a machine and spends
  // a model's time — and the note is the entire difference between it and a
  // conversation being ignored.
  //
  // THE NOTE SAID "It reads this when it next wakes." and stopped, which is true
  // and leaves somebody watching an unread message with nothing saying what
  // would change that. Both ways out have to be named.
  const was = await remember(okc, state)
  if (was) await okc('settingSet', { name: 'supervisorWakes', value: false })

  const said = await okc('chatSay', { text: 'nothing should wake for this one', about: 'a drill' })
  assert.equal(said.woke, false, 'it woke with "Answers by itself" off, which starts a machine nobody asked to start')
  assert.ok(/Wake it/.test(said.note),
    `the note does not say what to press: "${said.note}"`)
  assert.ok(/Answers by itself/.test(said.note),
    `the note does not mention the switch that would do it every time: "${said.note}"`)
  log('with the switch off it does not wake, and the note names both ways out')
})

it('and the switch on the tab is the one that sets it', async ({ okc, assert, state, log }) => {
  // A TICK THAT WOULD NOT STAY. The pane read `conf.state.supervisorWakes` and
  // the `settings` answer nests it — `{ settings: {...}, tests: {...} }` — so it
  // was always undefined and the box was drawn UNTICKED whatever the setting
  // said. A controlled checkbox draws from that, so React forced it back off
  // after every press: a click sent "on", the setting turned on, the tick
  // vanished, and there was no way to turn it OFF from the window at all.
  //
  // Nothing failed. The setting changed, the note appeared, and the only sign
  // was a box that would not stay ticked.
  //
  // THE CHECKBOX IS ONLY THERE WHILE ONE IS RUNNING, which is the pane's own
  // rule — the control row is empty while choosing — so this needs a supervisor
  // up. It costs no model turn: it presses a checkbox and reads a setting.
  const st = await okc('supervisorState')
  assert.needs(st.ready, 'no supervisor is up, and the switch is only on the tab while one is running')

  await remember(okc, state)
  await okc('show', { tab: 'Supervisor', pane: 'Chat' })

  const tick = async () => {
    const f = ((await okc('windowControls')).fields || []).find(x => x.label === 'Answers by itself')
    assert.ok(f, 'there is no "Answers by itself" on the tab, and a supervisor is running')
    return f.value === true
  }
  const setting = async () => (await okc('settings')).settings.supervisorWakes === true

  // THE BOX FOLLOWS THE SETTING, AND NOT IN THE SAME BREATH. The press writes
  // the setting and then asks for the settings again; the draw that ticks the
  // box is the one after that answer lands. Asserting the instant `windowFill`
  // returns is asserting on a race, and it fails on the correct behaviour.
  //
  // BOUNDED, at five seconds, because a wait that never settles hangs instead of
  // failing and a hang cannot be reported.
  const tickBecomes = async (want) => {
    for (let i = 0; i < 48; i++) {
      if (await tick() === want) return true
      await new Promise(r => setTimeout(r, 250))
    }
    return false
  }

  // BOTH DIRECTIONS, because only one of them was ever possible. Whichever way
  // it starts, press it and it must land the other way — in the setting AND on
  // the box, which is the half that was wrong.
  const from = await setting()

  // THE BOX AGREES WITH THE SETTING BEFORE ANYTHING IS PRESSED, which is the
  // claim rather than a precondition. It is also what makes the presses below
  // mean anything: `windowFill` decides whether to click by looking at the BOX,
  // so with the two out of step it skips the press and reports success, and the
  // check that follows fails on the wrong sentence. That happened here.
  assert.ok(await tickBecomes(from),
    `the setting is ${from} and the box does not show it — a tick that does not track what it sets`)

  await okc('windowFill', { label: 'Answers by itself', value: !from })
  assert.equal(await setting(), !from, `pressing it did not change the setting from ${from}`)
  assert.ok(await tickBecomes(!from), 'the setting changed and the box never followed it — a tick that will not stay')

  await okc('windowFill', { label: 'Answers by itself', value: from })
  assert.equal(await setting(), from, 'it could be pressed one way and not the other')
  assert.ok(await tickBecomes(from), 'the box never followed it back')
  log(`pressed it to ${!from} and back to ${from}, and the tick followed both times`)
})

it('and with the switch on it wakes by itself', async ({ okc, assert, state, log }) => {
  // THE HALF THAT WAS MISSING ENTIRELY. `chatSay` returned a hard-coded
  // `woke: false` under a comment saying wake had not been ported — and it had:
  // `supervisorWake` is defined a few hundred lines below it, and the queue
  // already honoured this flag when a task finished. So the ONE place the switch
  // was not honoured was the one a person uses, and the control offering it sat
  // on the pane doing nothing.
  //
  // ONLY AGAINST A SUPERVISOR THAT IS ALREADY UP. Waking one that is down starts
  // the machine — a minute or two of VirtualBox — and that is not a cost a drill
  // gets to impose without being asked. Up, it is one turn of a model, which is
  // what this suite is for.
  const st = await okc('supervisorState')
  assert.needs(st.ready, 'no supervisor is up and signed in, and waking a stopped one would boot a machine')

  await remember(okc, state)
  await okc('settingSet', { name: 'supervisorWakes', value: true })
  const said = await okc('chatSay', { text: 'wake on this one and say anything at all', about: 'a drill' })
  assert.equal(said.woke, true, 'the switch is on and saying something did not wake it')
  assert.ok(/waking/.test(said.note), `the note does not say it is waking: "${said.note}"`)

  // AND THE RECEIPT ACTUALLY MOVES, which is the claim rather than the flag. A
  // `woke: true` that nothing acts on is the same bug wearing a different value.
  //
  // BOUNDED, because an unsettled wait hangs instead of failing and a hang
  // cannot be reported. Four minutes: a turn is usually under a minute.
  // AND WHILE IT IS IN FLIGHT, THIS HOST SAYS SO. Checked in the same wait
  // rather than in a check of its own, because the expensive thing here is the
  // turn and there is one going past already.
  //
  // `supervisorState.thinking` WAS HARD-CODED `false`, under a comment saying
  // wake had not been ported — and it is defined in that same file and keeps
  // that very flag. So the badge that reads "thinking" could never show it and
  // neither could the Wake button, which relabels and disables itself off it.
  // Two controls, on the one screen whose subject is whether the far end is
  // doing anything, wired to a literal.
  let readTo = 0;
  let sawThinking = false
  for (let i = 0; i < 48; i++) {
    if (!sawThinking && (await okc('supervisorState')).thinking === true) sawThinking = true
    readTo = Number(((await okc('chat')).read || {}).n) || 0
    if (readTo >= Number(said.n)) break
    await new Promise(r => setTimeout(r, 5000))
  }
  assert.ok(readTo >= Number(said.n),
    `it said it was waking and four minutes later the receipt is still at ${readTo}, behind n${said.n}`)
  assert.ok(sawThinking,
    'a whole turn went past and this host never once reported `thinking` — the badge and the Wake button both read that field')
  log(`said n${said.n} with nobody pressing anything, it reported thinking, and it read up to ${readTo}`)
}, { minutes: 6 })

it('and the tab offers one decision at a time while nothing is running', async ({ okc, assert, log }) => {
  // THREE STATES, ONE SCREEN, and the whole design of this tab is that they do
  // not overlap. What went wrong here was not a broken control — it was the
  // SAME control offered twice: the header's state line kept its "Start it"
  // while the body was already asking which machine to start, so a screen whose
  // point is one decision showed two, six pixels of small type apart.
  //
  // Nothing fails when that happens, which is why it needs a check rather than
  // an eye. Driven through the window the way a person presses it, because the
  // states live in the window and no action can be asked what is on screen.
  const st = await okc('supervisorState')
  assert.needs(!st.ready, 'a supervisor is running, so this is the running state and not the two being checked')
  assert.needs(st.there, 'this host has no supervisor machine, so there is nothing to choose to start')

  const on = async () => {
    const w = await okc('windowControls')
    assert.equal(w.broke, null, `the pane threw: ${w.broke}`)
    return (w.buttons || []).filter(b => !b.nav).map(b => b.label)
  }

  await okc('show', { tab: 'Supervisor', pane: 'Chat' })

  // WHICH OF THE TWO OFF-BODIES IS SHOWING IS REMEMBERED, deliberately — across
  // draws and across leaving the tab, though not across sessions. So this starts
  // by putting it back on the decision rather than assuming it is there; a drill
  // that only passes when somebody left the window a particular way is a drill
  // that fails for reasons that have nothing to do with what it checks.
  if ((await on()).includes('Close')) await okc('windowClick', { text: 'Close' })

  // AND THE WINDOW GETS THE SAME VETO THE STATE DID. `supervisorState` was asked
  // a moment ago; a supervisor going down between that answer and this draw
  // leaves the pane in the running state while the check believes it is not, and
  // it fails on a mismatch that is nobody's bug. Seen once, stopping a machine
  // while this ran.
  assert.needs(!(await on()).includes('Wake it'),
    'the pane is in its running state, so a supervisor came up or went down while this was running')

  // CHOOSING: the decision is in the middle of the body and the header row is
  // empty. Not "mostly empty" — a second Start, a Clear that would clear
  // nothing, a Wake that cannot wake, are each a control offered where it does
  // nothing.
  const choosing = await on()
  assert.ok(choosing.includes(`Start ${st.name}`), `the body is not offering to start ${st.name}: ${choosing.join(' | ')}`)
  assert.ok(choosing.includes('Read what was said'), `there is no way to read the conversation: ${choosing.join(' | ')}`)
  for (const gone of ['Start it', 'Close', 'Wake it', 'Clear']) {
    assert.ok(!choosing.includes(gone),
      `"${gone}" is on screen while choosing which supervisor to start — that state offers one decision, in the body`)
  }

  // READING: the body IS the conversation, so the header comes back to say why
  // there is nowhere to type, and Close is the one way out.
  await okc('windowClick', { text: 'Read what was said' })
  const reading = await on()
  assert.ok(reading.includes('Close'), `there is no way back out of the conversation: ${reading.join(' | ')}`)
  assert.ok(reading.includes('Start it'), 'the state line is gone while reading, so nothing on screen says why there is nowhere to type')
  assert.ok(!reading.includes('Read what was said'), 'the body is still offering to read what is already being read')

  await okc('windowClick', { text: 'Close' })
  const back = await on()
  assert.ok(back.includes('Read what was said'), `Close did not come back to the decision: ${back.join(' | ')}`)
  log('choosing offers the body only; reading brings the state line back with one way out')
})

it('and two supervisors are never running at once', async ({ okc, assert, state, log }) => {
  // TWO OF THEM DECIDE WHAT WORK THERE IS WITH NO IDEA OF EACH OTHER: the same
  // issue picked up twice, two branches cut for one piece of work, two tasks
  // queued against each other. Nothing fails — the board fills with work nobody
  // asked for twice.
  //
  // Refused at the door that brings a machine up, so this makes a second
  // supervisor DEFINITION, tries to start it, and throws it away. No install: a
  // machine with no operating system is refused just as firmly, and by the same
  // check, which is what is being tested.
  const machines = (await okc('vmList')).vms || []
  const up = machines.find(m => m.supervisor && m.state === 'running')
  assert.needs(up, 'no supervisor machine is running, so there is nothing for a second one to collide with')

  const second = 'drill-supervisor-2'
  state.second = second
  await okc('vmCreate', { vm: { name: second, supervisor: true, desktop: false, memoryMB: 1024, cpus: 1, diskMB: 8192 } })

  await assert.refuses(
    () => okc('vmStart', { name: second }),
    'one supervisor runs at a time',
    `a second supervisor machine was started while ${up.name} was running`)

  log(`${up.name} is up, and starting a second supervisor is refused`)
}, { minutes: 5 })

cleanup(async ({ okc, state }) => {
  if (state.second) { try { await okc('vmRemove', { name: state.second }) } catch { /* never made */ } }

  // AND THE SWITCH GOES BACK TO WHATEVER IT WAS. Two checks above turn it on and
  // off, and leaving it ON is the one setting on this host that spends a model's
  // time on somebody's next sentence — a drill that quietly arms that has done
  // more than it was asked to. `state.wakes` is only set once the first of them
  // has read it, so this restores nothing it never touched.
  if (state.wakes !== undefined) {
    try { await okc('settingSet', { name: 'supervisorWakes', value: state.wakes }) } catch { /* said in the log */ }
  }
})

// ---- WHAT IT SAW ----------------------------------------------------------
//
// 17 August 2026, with supervisor-1 running. Six checks, five seconds — the last
// one makes a second supervisor machine and throws it away.
//
//     #10 recorded as "person"
//     PASS a person can say something, and it is recorded as a person saying it
//
//     the person's half of the conversation is not on the supervisor's list;
//     its own half is
//     PASS and the supervisor cannot say something as you
//
//     #11 recorded as the supervisor, from drill-machine
//     PASS and what it says is signed with the machine that said it
//
//     unread at 9, handed over, read to 12 by drill-machine
//     PASS and a message is not read until it has been handed over
//
//     it re-read from the beginning and the receipt stayed at 12
//     PASS and a receipt never goes backwards
//
//     supervisor-1 is up, and starting a second supervisor is refused
//     PASS and two supervisors are never running at once
//
// THE REFUSAL, IN ITS OWN WORDS:
//
//     "supervisor-1" is already running, and one supervisor runs at a time. Two
//     of them decide what work there is with no idea of each other — the same
//     issue picked up twice, two branches cut for one piece of work. Stop
//     "supervisor-1" first.
//
// WHAT IT LEAVES BEHIND, SAID PLAINLY: three lines in the conversation, each
// marked `test` by the window, because the harness stamps every call a drill
// makes. There is no cleanup for them and that is deliberate — the only way to
// remove a message is chatClear, which throws away the WHOLE conversation
// including everything a person said. A drill that tidied up after itself by
// deleting somebody's messages would be worse than three labelled lines.
//
// AND NOT BY MOVING THE BOOKMARK EITHER, now that there is one. `chatFrom` would
// hide these lines and delete nothing, which is exactly why it must not be used
// that way: it is the PERSON's reading position, and a drill that quietly pushes
// it forward hides whatever they had not read yet along with its own noise. The
// check above moves it and puts it back at zero in the same breath.
