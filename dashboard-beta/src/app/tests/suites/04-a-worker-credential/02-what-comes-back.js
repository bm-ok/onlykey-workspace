'use strict'

// what comes back — a credential that changed on a machine is the one kept here
//
// THE FAULT THIS WATCHES FOR HAS ALREADY HAPPENED ONCE. The Claude CLI refreshes
// its token as a worker runs, and the end of a run used to be:
//
//     rm -f "$HOME/.claude/.credentials.json"
//
// so every rotation was deleted and this host went on handing out a token one or
// more refreshes behind. Nothing failed loudly: the panel read "valid until
// September" while a worker answered "OAuth session expired and could not be
// refreshed".
//
// It is fixed — a machine holding a guest is READ before it is cleared, and what
// comes back is kept when it differs. This is the check that says so, and it was
// a draft until now because proving it seemed to need a worker run and a real
// rotation.
//
// IT NEEDS NEITHER. What has to be true is that a CHANGE on the machine arrives
// here: the mechanism, not the CLI's decision to rotate. So a throwaway identity
// is lent out, changed on the machine the way a refresh would change it, and
// taken back — and the fingerprint this host holds has to have moved.
//
// A THROWAWAY, NOT THE REAL ONE. Overwriting the credential this host actually
// works with, to prove that overwriting works, is the sort of drill that costs
// somebody an afternoon. Nothing here touches an identity anybody uses.

const { it, cleanup, requires } = require('../../harness')
const { aConnectedMachine } = require('../../helpers')

requires('the machines are built')

const GUEST = 'drill-what-comes-back'
const BEFORE = '{"drill":"the token as it went out"}'
const AFTER = '{"drill":"the token as the machine left it, which is what must come back"}'

it('a throwaway identity can be lent to a machine', async ({ okc, assert, state, log }) => {
  const machine = await aConnectedMachine(okc, assert,
    'no ordinary machine is dialled in — this lends a credential to one, so it needs one up')
  state.machine = machine.name

  try { await okc('guestForget', { name: GUEST }) } catch { /* left over from a stopped run */ }
  const made = await okc('guestAdd', { name: GUEST, token: BEFORE, note: 'made by a drill; thrown away at the end of it' })
  state.guest = GUEST
  state.before = made.fingerprint
  assert.ok(/^[0-9a-f]{16}$/.test(String(made.fingerprint)), `it was kept with no fingerprint: ${JSON.stringify(made)}`)

  const lent = await okc('guestLend', { name: GUEST, machine: machine.name })
  state.lent = true
  assert.equal(lent.machine, machine.name, 'it was lent somewhere else')

  // ON THE MACHINE, AS THE FILE THE CLI WOULD REFRESH. Compared by fingerprint
  // rather than by reading it back — this app may know a credential changed
  // without knowing what it is, and a drill is not an exception to that.
  const sum = await okc('vmRun', {
    name: machine.name,
    command: 'sha256sum "$HOME/.claude/.credentials.json" | cut -c1-16',
    what: 'fingerprinting what it was lent'
  })
  const onIt = String(sum.output || '').trim().split('\n').pop().trim()
  assert.ok(/^[0-9a-f]{16}$/.test(onIt), `the machine has no credential to fingerprint: ${JSON.stringify(sum).slice(0, 200)}`)
  log(`${GUEST} (${made.fingerprint}) is on ${machine.name}`)
}, { gate: true })

it('and a change made on the machine is what comes back', async ({ okc, assert, state, log }) => {
  // WHAT A REFRESH LOOKS LIKE FROM HERE: the file on the machine is different
  // from the one that went out. Whether the CLI did it or a drill did it is not
  // the thing being checked — what is checked is that this host ends up holding
  // the newer one rather than its own copy of the older.
  await okc('vmRun', {
    name: state.machine,
    command: `printf '%s' ${JSON.stringify(AFTER)} > "$HOME/.claude/.credentials.json" && echo okc-changed`,
    what: 'changing it on the machine, the way a refresh would'
  })

  const back = await okc('guestBack', { name: GUEST, machine: state.machine })
  state.lent = false
  assert.ok(back.rotated, `it came back reported unchanged. This is the failure that cost a working credential: what the machine finished with was thrown away and this host kept its own older copy. Fingerprint here ${back.fingerprint}, and it went out as ${state.before}`)
  assert.notEqual(back.fingerprint, state.before, `the fingerprint did not move: still ${back.fingerprint}`)

  const held = ((await okc('guests')).guests || []).find(g => g.name === GUEST)
  assert.equal(held.fingerprint, back.fingerprint, 'the list and the answer disagree about what is held')
  assert.ok(!held.holder, `it was taken back and the list still says it is on ${held.holder}`)
  log(`went out as ${state.before}, came back as ${back.fingerprint} — the change made it here`)
})

it('and nothing is left on the machine', async ({ okc, assert, state, log }) => {
  // THE OTHER HALF OF TAKING IT BACK. A credential left on a disk is the state
  // this whole app is arranged to avoid: it outlives the task in a snapshot, and
  // the machine is out of service for its next base snapshot until somebody
  // notices.
  const said = await okc('vmRun', {
    name: state.machine,
    command: 'ls "$HOME/.claude/.credentials.json" 2>&1 || echo okc-none',
    what: 'checking the credential is gone'
  })
  assert.ok(/okc-none|No such file/.test(String(said.output || '')),
    `${state.machine} is still holding a credential after it was taken back: ${String(said.output || '').slice(0, 200)}`)

  const machine = ((await okc('vmList')).vms || []).find(v => v.name === state.machine)
  assert.ok(!machine.holdsCredential, `the register still says ${state.machine} holds one`)
  log(`${state.machine} holds nothing, and the register agrees`)
})

cleanup(async ({ okc, state }) => {
  if (state.lent) { try { await okc('guestBack', { name: GUEST, machine: state.machine }) } catch { /* never lent */ } }
  if (state.guest) { try { await okc('guestForget', { name: GUEST }) } catch { /* never made */ } }
})
