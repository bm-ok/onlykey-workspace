'use strict'

// a worker credential — held here, and a machine can really use it
//
// See the README beside this file for why this is here rather than beside the
// GitHub token, and why it never reads a value.

const { it, requires } = require('../../../tasks/harness')
const { aMachine } = require('../../helpers')

// It hands the credential to a machine to find out whether it works, so it
// stands on machines existing and coming up. That is the whole reason it sits
// after them rather than with the other keys.
requires('the machines are built')

it('this host holds a worker credential', async ({ okc, assert, state, log }) => {
  const held = await okc('credentialsHeld')
  assert.asksYou(held && held.held,
    'this host holds no worker credential, so no task can be given to a machine. Sign a worker in — the Keys tab starts it on a clean machine and keeps the credential here — and run this again.')
  state.held = held

  // WHAT IT SAYS ABOUT IT, AND WHAT IT DOES NOT. A plan, a scope count, where it
  // came from and when. Never the credential: the rule for this app is that a
  // model may know something was done in the Keys tab without knowing what, and
  // a check that printed a value would put it in the log, the result and the
  // transcript at once.
  const life = held.life || {}
  log(`a worker credential is held, taken from ${held.from || 'somewhere'} on ${String(held.taken || '').slice(0, 10)}`)
  if (life.plan) log(`plan "${life.plan}", ${life.scopes} scope(s)`)
}, { gate: true })

it('and it has not expired past refreshing', async ({ assert, state, log }) => {
  // TWO CLOCKS, AND ONLY ONE OF THEM MATTERS HERE. The access half expires in
  // hours and is refreshed when it is used — an expired one is the ordinary
  // resting state and says nothing is wrong. The refresh half is the one that
  // ends the credential: past that, no amount of running will fix it and
  // somebody has to sign a worker in again.
  const life = state.held.life || {}
  if (!life.readable) {
    log('the credential is sealed and its life cannot be read from here — whether it works is the next check')
    return
  }
  assert.asksYou(!(life.refresh && life.refresh.expired),
    'the worker credential here has expired past refreshing, so no machine can authenticate with it. Sign a worker in again on the Keys tab, and run this again.')

  const left = life.refresh && life.refresh.at ? String(life.refresh.at).slice(0, 10) : 'unknown'
  log(`its access half ${life.access && life.access.expired ? 'has expired, which is ordinary — it is refreshed when it is used' : 'is current'}`)
  log(`its refresh half runs to ${left}, which is the date that ends it`)
})

it('and a machine can really sign in with it', async ({ okc, assert, state, log }) => {
  // THE ONLY CHECK THAT SETTLES IT. Everything above is this host reading its
  // own files: a credential that is present, unexpired and no longer accepted
  // looks identical from here, and fails at the far end of the flow — after a
  // branch is cut, a machine is up and a job has started.
  //
  // `credentialsTest` borrows a machine, hands it the credential, asks, takes it
  // back and puts the machine away. It is the machine half of this app doing
  // exactly what it does for a real task, which is why this suite waited for
  // machines to exist.
  const free = await aMachine(okc, assert, 'no machine is free to try it on — this hands the credential to a real machine, because holding a file proves nothing about whether a worker is accepted')

  const tried = await okc('credentialsTest', { name: free.name })
  assert.ok(tried.ready === true,
    `${tried.on || free.name} was handed the stored credential and the worker did not authenticate: ${tried.note || 'no reason given'}. It is present and no longer accepted, which is the case that fails at the far end of a real job.`)
  log(`${tried.on} was handed the credential and the worker authenticated`)
  log('and it was taken back — a machine is never left holding one')
}, { minutes: 12 })
