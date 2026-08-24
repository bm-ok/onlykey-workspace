'use strict'

// the credential is sealed to the machine that asked for it
//
// WHAT THIS REPLACED, and it was a draft in this suite for months: the credential
// was opened here, base64'd, and sent as
//
//     printf '%s' '<the whole credential>' | base64 -d > ~/.claude/.credentials.json
//
// Base64 is not encryption. The channel was never the hole — that is TLS and ssh
// — and the file at rest was never the hole either, that is core/secret.js. The
// hole was the middle: a shell ARGUMENT, which is `ps` output to every user on
// that machine and a line in its history.
//
// SO THE MACHINE SPEAKS FIRST. It makes a keypair, keeps the private half, and
// publishes the public one; this host derives a shared key from it and sends
// ciphertext. The thing that asked for the credential is the only thing that can
// open it. See vms/sealed/, and vms/provision/ for the half that runs over there.
//
// ---- what this asks, and what it stopped asking --------------------------
//
// IT USED TO DRIVE `deliver` DIRECTLY, handing it a runner that recorded each
// command and forwarded it — so it could read what the shipping code produced
// and search it for the credential. That was a good idea in the wrong place, and
// it was wrong twice.
//
// A DRILL CANNOT REACH THE APP'S INSIDES. These files are copied into
// `dist/suites` and run from there with only the harness beside them, so
// `require('../../../core/handover')` was not merely renamed by the port — it
// was unreachable. That is why this suite read `will not load`.
//
// AND `deliver` TAKES ITS RUNNER AS AN ARGUMENT, which means the whole
// watch-what-was-sent idea needs no machine and no credential at all. It belongs
// where it can run every time. `test/vms/sealed-deliver.test.js` asks it against
// the same shipping function: nothing sent carries the value, nor its base64,
// nor any run of six or more characters of it, nor anything the command encodes;
// the guest speaks first; the sealed reply goes on STDIN and not in argv; a
// machine that publishes no key is told so and nothing is sent.
//
// TAKING IT THERE IS WHAT FOUND THE HOLE IN IT. The piece-by-piece search here
// was written `{6 }` — a space inside the quantifier — which is not a quantifier
// at all, so it matched nothing, so the list of pieces was always empty and the
// assertion always passed. This file could not load, so the check that could not
// fail never ran either. It is asked properly over there now, with a floor under
// it.
//
// ---- and what is left, which is the part that needs a machine ------------
//
// EVERYTHING ABOVE IS ABOUT WHAT THIS HOST SENDS. What no unit test can say is
// what is TRUE ON THE MACHINE AFTERWARDS, because the guest half is a real
// script run by a real shell over a real ssh channel, and the questions are
// answered by looking at its disk:
//
//     it holds exactly the credential      hashed on the machine, from the bytes
//                                          that landed — not from what this host
//                                          believes it sent
//     and the key that opened it is gone   one pair per handover; a private half
//                                          left behind makes that machine a
//                                          place where every credential it is
//                                          ever handed can be decrypted
//
// THROUGH THE REAL DOOR, with no runner of its own: `guestLend` is what the queue
// calls on every run, so what is exercised is the path that actually hands
// machines their sign-ins.
//
// ON A CREDENTIAL THIS FILE INVENTS. It asks how a value travels, not whether it
// authenticates — that question is this suite's first check and it needs a person
// at a login page. So nothing real is read, sent or risked, and the machine is
// left without it.

const { it, cleanup, requires } = require('../../harness')
const { aConnectedMachine, roleFor } = require('../../helpers')
const crypto = require('node:crypto')

requires('the machines are built')

const NAME = 'drill-sealed-handover'

// A value with nothing else like it anywhere, so a search for it cannot be
// answered accidentally. Shaped like the real thing because the real thing is
// JSON and a handover that only works on short strings is one that has not been
// tested.
const MADE_UP = JSON.stringify({
  claudeAiOauth: {
    accessToken: 'okc-drill-NEVER-IN-A-COMMAND-LINE-3f9c1a77',
    refreshToken: 'okc-drill-NOR-THIS-ONE-b41e0dd2',
    expiresAt: 4102444800000,
    scopes: ['user:inference']
  }
})

// THE SAME SUM BOTH SIDES TAKE, written out rather than imported — a drill
// cannot reach the app's copy, and here that is a gift: a file that fingerprints
// with the code being tested agrees with itself whatever was stored. `sha256sum`
// on the machine gives the same hex, which is what makes the two comparable at
// all.
const printOf = (text) => crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 16)

it('a machine is dialled in, and this host has something to hand it', async ({ okc, assert, state, log }) => {
  const machine = await aConnectedMachine(okc, assert, 'no machine from the test pool is dialled in to hand a credential to')
  state.machine = machine.name

  // WHICH KIND THE MACHINE WILL ACCEPT. A sign-in is lent for a ROLE, and a
  // machine tagged for one kind refuses the other — correctly. Asking the helper
  // rather than assuming "worker" is what lets this run on whichever machine the
  // kit has up.
  state.role = roleFor(machine) || 'worker'

  try { await okc('guestForget', { name: NAME }) } catch { /* left over from a run that was interrupted */ }
  const made = await okc('guestAdd', {
    name: NAME, token: MADE_UP, role: state.role, note: 'made by a drill; thrown away at the end of it'
  })
  state.made = true

  // THE LIST KEPT WHAT IT WAS GIVEN, asked before anything is sent. A guestAdd
  // that mangled the token would make every comparison below agree about the
  // wrong bytes — which has happened here, with a credential arriving from the
  // command line as an object and being sealed as the words "[object Object]".
  // The handover was faithful and delivered the mangling.
  assert.equal(made.fingerprint, printOf(MADE_UP),
    `this host sealed something that is not what it was handed — ${made.fingerprint} where the token given is ${printOf(MADE_UP)}`)

  state.print = made.fingerprint
  log(`${state.machine} is up and takes a ${state.role}; "${NAME}" is here as ${made.fingerprint}`)
// A GATE, because everything below needs the machine this went and got. Without
// it, a host with nothing dialled in reported this honestly as "could not run"
// and then FAILED every check after it with `"undefined" is not a virtual
// machine this app made` — which reads as a broken app rather than as a machine
// nobody had started.
}, { minutes: 6, gate: true })

it('and the machine ends up holding exactly it', async ({ okc, assert, state, log }) => {
  // THE REAL DOOR. `guestLend` is what the queue calls on every run — the
  // choosing and then the sealed handover — so this exercises the path machines
  // are actually given their sign-ins by, rather than a runner assembled here.
  await okc('guestLend', { name: NAME, machine: state.machine })
  state.placed = true

  // MEASURED ON THE MACHINE, from the bytes on its disk — not from what this
  // host believes it sent, and not from what it reported back. sha256 cut to
  // sixteen characters is what the guest list records and what every other drill
  // here compares by.
  const said = await okc('vmRun', {
    name: state.machine,
    command: 'sha256sum "$HOME/.claude/.credentials.json" | cut -c1-16',
    what: 'fingerprinting what actually landed'
  })
  const onIt = String(said.output || '').trim().split('\n').pop().trim()

  assert.equal(onIt, state.print,
    `${state.machine} is holding ${onIt} where the credential sealed to it is ${state.print}. It arrived, and it arrived changed`)
  log(`${state.machine} holds ${onIt}, byte for byte what was sealed to it`)
}, { minutes: 6, gate: true })

it('and the key that could open it does not outlive the handover', async ({ okc, assert, state, log }) => {
  // ONE PAIR PER HANDOVER. If the private half stayed on the machine, a recording
  // of the exchange would be openable by anything that later reached that disk —
  // and the machine would be a place where every credential it is ever handed can
  // be decrypted. It is removed whether the decryption worked or not.
  const said = await okc('vmRun', {
    name: state.machine,
    command: 'ls "$HOME/.okc-handover" 2>&1 | tail -1; echo "---"; ls "$HOME/.okc/credential.js" 2>&1 | tail -1',
    what: 'looking for the key it opened the credential with'
  })
  const out = String(said.output || '')
  const [key] = out.split('---')

  assert.ok(/No such file|cannot access/.test(key),
    `the private key ${state.machine} opened the credential with is still on it: ${key.trim().slice(-200)}`)

  // The guest half itself is expected to still be there, and is not a secret —
  // said out loud so nobody reads the check above as "nothing is left behind".
  log('the private half is gone; the script that used it stays, and is not a secret')
})

cleanup(async ({ okc, state }) => {
  // TAKEN BACK OFF THE MACHINE FIRST, through the door that does it, so the list
  // does not go on believing a machine is holding something after this has
  // removed the file underneath it.
  if (state.placed && state.machine) {
    try { await okc('guestBack', { name: NAME, machine: state.machine }) } catch { /* it may be off by now */ }
    try {
      await okc('vmRun', {
        name: state.machine,
        command: 'rm -f "$HOME/.claude/.credentials.json"',
        what: 'clearing what a drill handed over'
      })
    } catch { /* it may be off by now; the rollback takes it either way */ }
  }
  if (state.made) { try { await okc('guestForget', { name: NAME }) } catch { /* never made */ } }
})
