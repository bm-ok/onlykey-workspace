'use strict'

// a machine lets this app in — the door that ssh uses, which is not the channel
//
// TWO WAYS IN, AND ONLY ONE OF THEM WAS EVER CHECKED. The channel is how this
// app talks to a machine: an agent dials in, and everything the app does goes
// down that. ssh is how a PERSON gets to one — the Terminal tab, VS Code, and
// the back door for when the agent has stopped answering.
//
// A machine built before this app had an ssh key of its own has an EMPTY
// authorized_keys, so the second way in does not exist for it. On this host that
// was three machines out of five, including the supervisor, and nothing said so:
// it reads as "Too many authentication failures", which sounds like a key being
// rejected and is really a machine with no keys to reject. Everything the app
// itself does kept working, which is exactly why it went unnoticed.
//
// THE NOTE ON `sshKey` SAID IT COULD NOT BE FIXED — "nothing here can change
// that without being able to get in, which is the thing at issue". True of ssh
// and false of this app: the agent is already there and already runs what it is
// sent. So the key goes over the channel, and this checks that it does.

const { it, requires } = require('../../harness')
const { aConnectedMachine } = require('../../helpers')

requires('the machines are built')

it('this app has a key of its own, and knows which machines take it', async ({ okc, assert, log }) => {
  const key = await okc('sshKey')
  assert.asksYou(key.publicKey, 'this app has no ssh key yet. Make one with sshKeyMake — without it nothing can open a terminal on a machine, and VS Code cannot connect either')

  // WHICH MACHINES WOULD ACTUALLY ACCEPT IT is a different question from whether
  // the key exists, and reporting only the second is how three machines sat
  // unreachable while the Keys tab looked healthy.
  assert.ok(Array.isArray(key.machines), 'nothing says which machines accept this key')
  const shut = (key.machines || []).filter(m => !m.authorised)
  log(`${(key.machines || []).length - shut.length} of ${(key.machines || []).length} machines take this app's key`)
  if (shut.length) log(`not: ${shut.map(m => m.name).join(', ')} — vmAuthorizeKey puts it there over the channel`)
})

it('and a machine that is dialled in can be given it', async ({ okc, assert, state, log }) => {
  const machine = await aConnectedMachine(okc, assert, 'no machine is dialled in, and the key is placed by the agent rather than by ssh')
  state.machine = machine.name

  const done = await okc('vmAuthorizeKey', { name: machine.name })
  assert.ok(done.keys >= 1, `${machine.name} reports ${done.keys} authorised keys after being given one`)
  log(done.note)

  // AND THE RECORD LEARNS IT, which is the half that decides whether ssh is even
  // offered the key. A machine that accepts it while the registry says otherwise
  // gets the same try-everything ssh that failed before, so the repair would be
  // invisible.
  const key = await okc('sshKey')
  const mine = (key.machines || []).find(m => m.name === machine.name)
  assert.ok(mine && mine.authorised, `${machine.name} was given the key and the registry still does not say so`)

  const where = await okc('vmShell', { name: machine.name })
  assert.ok(where.identity, `${machine.name} accepts this app's key and vmShell does not offer it, so ssh will try everything it has instead`)

// NOT A GATE, deliberately, though the check after it depends on this one. A
// gate closes the REST of the file, and the last check here needs no machine at
// all — it is about a machine that is switched off. What the middle check needs
// it says for itself, with `needs`, which reports "could not run" without
// taking anything else down with it.
})

it('and giving it twice does not write it twice', async ({ okc, assert, state }) => {
  assert.needs(state.machine, 'the check before this one did not reach a machine')

  // A file that grows by a line every time somebody presses a button is a file
  // nobody can read later — and this is reachable from a warning with a button
  // on it, so pressing it twice is the ordinary case rather than the odd one.
  const again = await okc('vmAuthorizeKey', { name: state.machine })
  assert.equal(again.added, false, 'the key was written a second time')
  assert.equal(again.keys, 1, `${state.machine} now has ${again.keys} authorised keys, and one was placed twice`)
})

it('and a machine that is not dialled in is refused, rather than half-done', async ({ okc, assert }) => {
  const { vms } = await okc('vmList')
  const off = (vms || []).find(v => !v.connected)
  assert.needs(off, 'every machine here is dialled in, so there is nothing to be refused about')

  // The agent is what does this. Refusing early says so; the alternative is a
  // failure some minutes later that reads as a key problem.
  await assert.refuses(
    () => okc('vmAuthorizeKey', { name: off.name }),
    'not dialled in|start it',
    'a key was placed on a machine that is not there'
  )
})
