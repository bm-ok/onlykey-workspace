'use strict'

// two machines, two identities — and neither is ever handed the other's
//
// THE DRAFT THIS REPLACES WAS THE POINT OF THE WHOLE LIST. There was one
// credential at credentials/claude.json, lent to whoever was working, and the
// question it left open was: can two machines work at once? Not as a matter of
// throughput — as a matter of correctness. The Claude CLI refreshes its token as
// a worker runs, so two machines sharing one sign-in are two workers rotating the
// same credential underneath each other, and the loser finds out by being signed
// out mid-run.
//
// WHAT IT ASKED FOR AND WHY IT IS NOT WHAT IS CHECKED HERE. The draft said:
// dispatch two tasks at once, both run, and the two machines report different
// credentials. That would prove this AND a dozen other things, would take two
// worker runs, and would turn on whether the queue happened to overlap them —
// machines start one at a time on this host, so a short job can finish before the
// second machine has booted, and the drill would pass while proving nothing.
//
// SO IT IS ASKED AT THE CREDENTIAL LEVEL, where it is deterministic: two
// identities out on two machines at the same moment, each machine holding its
// own, and every way of getting the same one onto both refused.
//
// A THROWAWAY FOR THE SECOND, and this is the honest limitation: getting a second
// REAL Claude sign-in needs a person at a login page — see the sign-in desk. The
// second identity here is a made-up token, which is enough for every question
// this file asks, because none of them is "can it authenticate". That one is the
// suite's first check and has always needed a person.

const { it, cleanup, requires } = require('../../harness')

requires('the machines are built')

const A = 'drill-two-a'
const B = 'drill-two-b'

it('two machines are up, and this host holds two identities', async ({ okc, assert, state, log }) => {
  const machines = (await okc('vmList')).vms || []
  const kit = machines.filter(m => !m.supervisor && m.connected && (m.tags || []).includes('test'))
  assert.needs(kit.length >= 2, 'this needs two machines from the test pool dialled in — it is about two of them holding different credentials at the same moment')
  state.one = kit[0].name
  state.two = kit[1].name

  for (const name of [A, B]) { try { await okc('guestForget', { name }) } catch { /* left over */ } }
  const a = await okc('guestAdd', { name: A, token: '{"drill":"identity A"}', note: 'made by a drill; thrown away at the end of it' })
  const b = await okc('guestAdd', { name: B, token: '{"drill":"identity B"}', note: 'made by a drill; thrown away at the end of it' })
  state.made = [A, B]
  assert.notEqual(a.fingerprint, b.fingerprint, 'two different tokens were kept with the same fingerprint, which would make every comparison below meaningless')
  state.prints = { [A]: a.fingerprint, [B]: b.fingerprint }
  log(`${state.one} and ${state.two} are up; ${A} (${a.fingerprint}) and ${B} (${b.fingerprint}) are here`)
}, { gate: true })

it('and each machine can hold its own at the same time', async ({ okc, assert, state, log }) => {
  // AT THE SAME MOMENT, which is the whole claim. One after the other would be
  // true of the single credential this replaced.
  await okc('guestLend', { name: A, machine: state.one })
  await okc('guestLend', { name: B, machine: state.two })
  state.lent = [[A, state.one], [B, state.two]]

  const held = (await okc('guests')).guests || []
  assert.equal(held.find(g => g.name === A).holder, state.one, `${A} is not recorded as being on ${state.one}`)
  assert.equal(held.find(g => g.name === B).holder, state.two, `${B} is not recorded as being on ${state.two}`)

  // AND THE MACHINES AGREE, by fingerprint rather than by value — the record
  // saying so is this app agreeing with itself.
  const sum = 'sha256sum "$HOME/.claude/.credentials.json" | cut -c1-16'
  const onOne = String((await okc('vmRun', { name: state.one, command: sum, what: 'fingerprinting what it holds' })).output || '').trim().split('\n').pop().trim()
  const onTwo = String((await okc('vmRun', { name: state.two, command: sum, what: 'fingerprinting what it holds' })).output || '').trim().split('\n').pop().trim()

  assert.notEqual(onOne, onTwo,
    `${state.one} and ${state.two} are holding the SAME credential at the same time (${onOne}). That is two workers rotating one token underneath each other, which is how a working sign-in dies`)
  log(`${state.one} holds ${onOne}, ${state.two} holds ${onTwo} — at the same moment, and they differ`)
})

it('and one identity cannot be on two machines', async ({ okc, assert, state, log }) => {
  // THE LOCK, which was its own draft and is the other half of the same idea. It
  // would have failed on the day it was written: there was one file and nothing
  // recorded who had it.
  const refusal = await assert.refuses(
    () => okc('guestLend', { name: A, machine: state.two }),
    `is on ${state.one}`,
    `"${A}" is already on ${state.one} and was lent to ${state.two} as well — the two machines would then be one worker, refreshing the same token`)
  log(refusal.message.slice(0, 140))
})

it('and a machine with nothing free to hand it is refused, not given somebody else\'s', async ({ okc, assert, state, log }) => {
  // WAITING RATHER THAN BORROWING is the rule that makes the two above worth
  // having. A third machine asking while every identity is out must be told so —
  // handing it one that is already on another machine is exactly the fault the
  // list was built to end.
  //
  // Asked of the real path a dispatch takes, not of guestLend: vmCredentialsPut
  // is what the queue calls before it hands a machine work.
  const machines = (await okc('vmList')).vms || []
  const third = machines.find(m => !m.supervisor && m.connected && ![state.one, state.two].includes(m.name))
  if (!third) {
    // Not a failure: this host has two machines from the pool and both are in
    // use by the checks above. Said rather than silently skipped.
    log('no third machine is up to ask with — the refusal is asked for by the credential suite when there is one')
    return
  }

  await assert.refuses(
    () => okc('vmCredentialsPut', { name: third.name }),
    'is out on',
    `${third.name} was handed a credential while every identity was already on another machine`)
  log(`${third.name} was refused rather than handed one that is out`)
})

cleanup(async ({ okc, state }) => {
  for (const [name, machine] of state.lent || []) {
    try { await okc('guestBack', { name, machine }) } catch { /* never lent */ }
  }
  for (const name of state.made || []) {
    try { await okc('guestForget', { name }) } catch { /* never made */ }
  }
})
