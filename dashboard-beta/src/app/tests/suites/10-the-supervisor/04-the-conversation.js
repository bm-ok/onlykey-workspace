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
  const may = new Set(Object.keys(require('../../../core/supervisor').MAY))
  assert.ok(!may.has('chatSay'), 'a supervisor may call chatSay, which is the person\'s half of the conversation — it could then write a line as you')
  assert.ok(!may.has('chatClear'), 'a supervisor may throw the conversation away')
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
