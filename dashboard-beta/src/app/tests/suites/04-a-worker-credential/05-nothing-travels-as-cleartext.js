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
// open it. See core/handover.js, and provision/okc-credential.js for the half
// that runs over there.
//
// TWO CHECKS, AND THE SECOND IS WHAT MAKES IT A CHECK RATHER THAN A RULE ABOUT
// STRINGS. Anybody can send nothing and pass the first one. What is asked here is
// that NOTHING SENT CARRIES THE VALUE and the machine ends up holding exactly it
// — measured on the machine, by hashing what actually landed on its disk.
//
// IT WATCHES THE REAL PATH RUN. The commands are not composed here: `deliver` is
// handed a runner that records what it is asked to send and then sends it through
// `vmRun`, so what is examined is what the shipping code produced.

const { it, cleanup, requires } = require('../../harness')
const { aConnectedMachine } = require('../../helpers')
const handover = require('../../../core/handover')

requires('the machines are built')

const NAME = 'drill-sealed-handover'

// A value with nothing else like it anywhere, so "does this appear in what was
// sent" cannot be answered accidentally. Shaped like the real thing because the
// real thing is JSON and a handover that only works on short strings is a
// handover that has not been tested.
const MADE_UP = JSON.stringify({
  claudeAiOauth: {
    accessToken: 'okc-drill-NEVER-IN-A-COMMAND-LINE-3f9c1a77',
    refreshToken: 'okc-drill-NOR-THIS-ONE-b41e0dd2',
    expiresAt: 4102444800000,
    scopes: ['user:inference']
  }
})

// Every run of six or more characters in the credential, so a check cannot be
// passed by chopping it up: a fragment in a command line is a leak too.
const piecesOf = text => {
  const out = new Set()
  for (const word of text.match(/[A-Za-z0-9_-]{6,}/g) || []) out.add(word)
  return [...out]
}

// AND EVERYTHING THE COMMAND ENCODES, not just what it spells.
//
// This matters more than the search itself, and the first version of this file
// got it wrong: the way the credential used to travel was BASE64 in a command
// line, so a plain string search of what was sent would have found nothing and
// this drill would have passed against the very code it was written to condemn.
// Base64 is not encryption and a check that cannot tell the difference is worse
// than no check.
//
// So every quoted base64 run in the command is decoded and searched as well.
const alsoDecoded = command => {
  let out = command
  for (const chunk of command.match(/[A-Za-z0-9+/=]{40,}/g) || []) {
    try { out += '\n' + Buffer.from(chunk, 'base64').toString('utf8') } catch { /* not base64 after all */ }
  }
  return out
}

it('a machine is dialled in, and this host has something to hand it', async ({ okc, assert, state, log }) => {
  const machine = await aConnectedMachine(okc, assert, 'no machine from the test pool is dialled in to hand a credential to')
  state.machine = machine.name

  // A THROWAWAY IDENTITY, because this asks how a value travels rather than
  // whether it authenticates — that question is this suite's first check and it
  // needs a person at a login page.
  try { await okc('guestForget', { name: NAME }) } catch { /* left over from a run that was interrupted */ }
  const made = await okc('guestAdd', { name: NAME, token: MADE_UP, note: 'made by a drill; thrown away at the end of it' })
  state.made = true

  // THE LIST KEPT WHAT IT WAS GIVEN, asked before anything is sent. A guestAdd
  // that mangles the token would make every comparison below agree about the
  // wrong bytes — which is exactly what happened when this was written, with an
  // object arriving from the command line and being sealed as the words "[object
  // Object]". The handover was faithful and delivered the mangling.
  assert.equal(made.fingerprint, handover.fingerprint(MADE_UP),
    `this host sealed something that is not what it was handed — ${made.fingerprint} where the token given is ${handover.fingerprint(MADE_UP)}`)
  log(`${state.machine} is up; "${NAME}" is here as ${made.fingerprint}`)
// A GATE, because everything below needs the machine this went and got. Without
// it, a host with nothing dialled in reported this honestly as "could not run"
// and then FAILED every check after it with `"undefined" is not a virtual
// machine this app made` — which reads as a broken app rather than as a machine
// nobody had started.
}, { minutes: 6, gate: true })

it('and nothing sent to the machine carries any part of it', async ({ okc, assert, state, log }) => {
  // THE SHIPPING CODE, WATCHED. The runner records and forwards; nothing about
  // the commands is composed by this drill, so what is examined below is what
  // actions/credentials.js and actions/guests.js both send.
  const sent = []
  const done = await handover.deliver({
    run: async (command, opts) => {
      sent.push(command)
      return okc('vmRun', { name: state.machine, command, what: (opts && opts.what) || 'a drill handing a credential over' })
    },
    text: MADE_UP,
    what: 'a drill asking for a key to seal a credential to'
  })
  state.placed = true

  assert.equal(sent.length, 2, `a sealed handover is the machine speaking first and this host answering — ${sent.length} commands is not that shape`)

  const all = sent.map(alsoDecoded).join('\n')
  const leaked = piecesOf(MADE_UP).filter(p => all.includes(p))
  assert.equal(leaked.length, 0,
    `${leaked.length} piece(s) of the credential are in what was sent to ${state.machine}: ${leaked.slice(0, 3).join(', ')}. A shell argument is visible in \`ps\` to every user on that machine and is kept in its history — and base64 is not encryption, so it counts as sent either way`)

  // AND SOMETHING SEALED WAS ACTUALLY SENT. A handover that sent nothing at all
  // would pass the line above, which is why this asks for the envelope by name —
  // found in the DECODED payload, since that is where it lives.
  assert.ok(all.includes(handover.VERSION), `nothing sealed with ${handover.VERSION} was sent, so the check above passed by there being nothing to find`)
  log(`${sent.length} commands, ${all.length} characters once every base64 in them is decoded, and none of it the credential`)
}, { minutes: 6 })

it('and the machine ends up holding exactly it', async ({ okc, assert, state, log }) => {
  // MEASURED ON THE MACHINE, from the bytes on its disk — not from what this host
  // believes it sent. sha256 cut to sixteen characters is what the guest list
  // records and what every other drill here compares by.
  const said = await okc('vmRun', {
    name: state.machine,
    command: 'sha256sum "$HOME/.claude/.credentials.json" | cut -c1-16',
    what: 'fingerprinting what actually landed'
  })
  const onIt = String(said.output || '').trim().split('\n').pop().trim()

  assert.equal(onIt, handover.fingerprint(MADE_UP),
    `${state.machine} is holding ${onIt} where the credential sealed to it is ${handover.fingerprint(MADE_UP)}. It arrived, and it arrived changed`)
  log(`${state.machine} holds ${onIt}, byte for byte what was sealed to it`)
}, { gate: true })

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
  if (state.placed && state.machine) {
    try {
      await okc('vmRun', { name: state.machine, command: 'rm -f "$HOME/.claude/.credentials.json"', what: 'clearing what a drill handed over' })
    } catch { /* it may be off by now; the rollback takes it either way */ }
  }
  if (state.made) { try { await okc('guestForget', { name: NAME }) } catch { /* never made */ } }
})
