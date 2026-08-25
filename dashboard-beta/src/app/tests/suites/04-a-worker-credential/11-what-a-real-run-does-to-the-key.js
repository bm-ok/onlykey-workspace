'use strict'

// what a real run does to the key — the round trip, measured on both sides
//
// EVERYTHING ELSE IN THIS SUITE IS ARITHMETIC, and deliberately: the rules about
// credentials are functions of a string and can be asked in milliseconds, which
// is why they are. This one costs a machine and a real Claude run, because the
// thing it is about only happens on a machine.
//
// WHAT IT IS ABOUT. The Claude CLI refreshes its token as a worker runs, so what
// is on the disk at the end can be NEWER than what went on. Reading it back is
// the only way that ever reaches this host — and the same path, reading back
// whatever it finds, is what destroyed a sign-in here on 19 August: a run failed
// to authenticate, the CLI cleared its own credential file, and 280 bytes of
// empty were written over the 508 that worked.
//
// So the round trip has to do two opposite things at once, and this is the only
// check that watches it do them with a real worker at the other end:
//
//     keep a rotation      or the token here ages out while a good one is
//                          thrown away with the machine every night
//     keep NOTHING ELSE    or a failed run takes the credential with it
//
// WHAT IT DOES NOT CLAIM. It cannot force a rotation — whether the CLI refreshes
// during any given run is Anthropic's business and not this host's — so it
// asserts what must be true EITHER WAY and reports which happened. A drill that
// demanded a rotation would fail on a healthy host with a fresh token, which is
// the most common host there is.

const { it, cleanup } = require('../../harness')
const { scratch, aLine } = require('../../helpers')

// A job that actually calls Claude. `api-tour` exercises the job API and never
// starts a worker, so it would prove the machine round trip and nothing at all
// about the credential — which is the only thing this drill is for.
const JOB = 'ask-a-worker'
const POOL = 'test'

it('this host can sign a worker in, and has a machine to do it on', async ({ okc, assert, state, log }) => {
  // THE DOOR. Everything below spends a machine and real money, so it is checked
  // first and stops the series rather than failing halfway through a run.
  // ASKED OF THE QUEUE, which is what will actually have to find a sign-in for
  // the task this queues below. `plan.signIns` is the queue's own reading — the
  // same call a tick dispatches by — so the door this drill stops at is the door
  // the work would stop at.
  const { plan } = await okc('queueState')
  const worker = ((plan && plan.signIns && plan.signIns.worker) || { free: 0, paused: [] })

  assert.needs(worker.free, `no worker sign-in here can be given to a machine${
    worker.paused.length ? ` — ${worker.paused.map((n) => `"${n}"`).join(', ')} ${worker.paused.length === 1 ? 'is' : 'are'} paused` : ''}. This drill measures what a real run does to a key, so it needs one that works`)

  const { vms } = await okc('vmList')
  const able = vms.filter(v => (v.kinds || []).includes('worker') &&
    (v.tags || []).some(t => String(t).toLowerCase() === POOL) &&
    !v.branch && !v.borrowed && !v.holdsCredential)
  assert.needs(able.length, `no machine tagged "${POOL}" can take worker work — this needs one to run on`)

  const { jobs } = await okc('jobs')
  const job = (jobs || []).find(j => j.id === JOB && j.approved)
  assert.needs(job, `the job "${JOB}" is not approved here, and only an approved job runs on a machine`)

  state.pool = POOL
  log(`${worker.free} worker sign-in(s) can be lent; ${able.map(v => v.name).join(', ')} can take it; the job is "${job.name}"`)
}, { gate: true })

it('and what it holds before the run is written down', async ({ okc, assert, state, log }) => {
  // BOTH SIDES OF THE ROUND TRIP, MEASURED. Without the "before" this drill can
  // only say the token is usable afterwards, which was true of the destroyed one
  // right up until it was not.
  //
  // BY FINGERPRINT, NEVER BY VALUE, and this file used to say exactly that and
  // then do the opposite: `guests.usable(guests.token(name))` reads the
  // credential. It is the one door the store keeps shut from outside — the rule
  // for the keys is that you can tell something was done in there and not what —
  // and reaching through it was possible only because this drill was reaching
  // past the actions altogether.
  //
  // SO USABILITY IS ASKED THE WAY EVERYTHING ELSE ASKS IT: a sign-in the queue
  // would hand out. `has` says there is a sealed token behind the name, and the
  // queue's own answer says none of them is paused. Neither requires anybody to
  // look at the secret.
  const rows = ((await okc('guests', { role: 'worker' })).guests || [])
  const { plan } = await okc('queueState')
  const paused = ((plan && plan.signIns && plan.signIns.worker) || {}).paused || []

  const before = rows
    .filter((g) => !g.holder && g.has && !paused.includes(g.name))
    .map((g) => ({ name: g.name, fingerprint: g.fingerprint, refreshed: g.refreshed || null }))

  assert.ok(before.length,
    `no worker sign-in here is free with a token behind it${paused.length ? ` — ${paused.map((n) => `"${n}"`).join(', ')} paused` : ''}, so there is nothing to measure a round trip against`)

  for (const g of before) {
    assert.ok(g.fingerprint,
      `"${g.name}" is offered to machines and this host records no fingerprint for it, so nothing afterwards can be compared to anything`)
  }

  state.before = before
  log(before.map((g) => `${g.name} ${g.fingerprint}${g.refreshed ? ` (last changed ${String(g.refreshed).slice(0, 10)})` : ' (never changed)'}`).join('; '))
})

it('a task is written and queued, and nothing here touches it again', async ({ okc, assert, state, log }) => {
  state.line = await aLine(okc, assert)
  state.branch = scratch('key-round-trip')
  await okc('branchCreate', { branch: state.branch, reason: 'a drill measuring what a real run does to the credential', group: state.line })

  const { contracts } = await okc('contracts')
  const contract = (contracts || []).find(c => c.approved)
  assert.needs(contract, 'no contract is approved, and a task carries the rules a worker is held to')

  const made = await okc('taskCreate', {
    task: {
      title: 'drill: what a real run does to the key',
      brief: 'Say hello and stop. The work does not matter — what is being measured is the credential this machine was lent, before and after.',
      branch: state.branch,
      job: JOB,
      contractId: contract.id,
      tag: state.pool
    }
  })
  state.task = made.id
  await okc('taskQueue', { id: made.id })
  log(`#${made.number} queued on "${state.branch}", tagged "${state.pool}" — the queue picks the machine and the sign-in from here`)
})

it('the queue runs it, and gives the sign-in back', async ({ okc, assert, state, log }) => {
  // WAITED FOR RATHER THAN DRIVEN. The queue lends the identity, runs the work
  // and takes the credential back in a `finally` — and it is that `finally`,
  // running after a real worker has touched the file, that this drill is about.
  let done = null
  for (let i = 0; i < 90; i++) {
    await new Promise(r => setTimeout(r, 5000))
    const mine = (await okc('tasks')).tasks.find(t => t.id === state.task)
    if (mine && ['done', 'accepted', 'rejected', 'failed'].includes(mine.state)) { done = mine; break }
  }
  // WHY IT DID NOT FINISH, NOT MERELY THAT IT DID NOT. "Never finished within
  // seven minutes" is true of a slow run, a wedged machine and a host with no
  // usable sign-in, and only the last of those is not a fault to go looking for.
  // It happened: both worker sign-ins were dead, the queue correctly refused to
  // spend a machine on work it could give no identity, and this reported a
  // timeout — sending somebody to look at machines when the answer was on the
  // Keys tab.
  if (!done) {
    const held = await okc('credentialsHeld')
    const workers = (held.guests || []).filter(g => g.role === 'worker')
    const usable = workers.filter(g => g.lastCheck ? g.lastCheck.ready !== false : true)
    assert.ok(usable.length,
      `no worker sign-in on this host can authenticate — ${workers.map(g => `"${g.name}"`).join(', ') || 'there are none at all'}. ` +
      'The queue is right to leave the task queued and spend no machine on it; there is nothing wrong with the machines. Sign a worker in again on the Keys tab and run this once more.')
  }
  assert.ok(done, 'the task never finished within seven minutes, and a worker sign-in was available the whole time — so this is the machines or the run, not the key')
  state.machine = done.machine || null
  assert.ok((done.attempts || []).length, `#${done.number} finished having never been given a machine, so no worker ever held the credential`)

  // AND THE MACHINE IS HOLDING NOTHING. A credential left on a disk is the state
  // this whole app is arranged to avoid, and it is also the state that would
  // make the comparison below meaningless.
  const vm = ((await okc('vmList')).vms || []).find(v => v.name === state.machine)
  assert.ok(vm && !vm.holdsCredential, `${state.machine} still holds a sign-in after the run ended`)
  log(`#${done.number} ran on ${state.machine} and the machine holds nothing`)
}, { minutes: 9 })

it('and the key came home whole — rotated or not', async ({ okc, assert, state, log }) => {
  // ---- THE CLAIM, AND IT IS AN "EITHER WAY" ----------------------------
  //
  // A rotation cannot be forced, so this asserts what must hold in both cases
  // and says which one happened. What must NEVER hold is the third case: a token
  // that came back damaged. That one has happened, cost a sign-in, and is the
  // reason this drill exists.
  assert.needs(state.before, 'nothing was written down before the run')

  // READ ONCE FOR THE WHOLE COMPARISON, so every name below is being judged
  // against the same moment rather than against a list that moved between them.
  const after = ((await okc('guests', { role: 'worker' })).guests || [])
  const { plan } = await okc('queueState')
  const nowPaused = ((plan && plan.signIns && plan.signIns.worker) || {}).paused || []

  const moved = []
  for (const was of state.before) {
    const now = after.filter((g) => g.name === was.name)[0]
    assert.ok(now, `"${was.name}" is gone from this host since the run started`)

    // FIRST, ALWAYS: whatever else changed, there is still a credential behind
    // the name, and it is still one the queue would hand out.
    //
    // ASKED WITHOUT READING IT. `has` is the sealed file being there and the
    // queue's own list is whether it would be lent — which is exactly what the
    // destroyed one stopped being. The value itself is nobody's business out
    // here, including this drill's.
    assert.ok(now.has,
      `"${was.name}" has no sealed token behind it after a run touched it — the round trip removed the credential`)
    assert.ok(!nowPaused.includes(was.name),
      `"${was.name}" was lent to a machine and came back paused, which is this host saying the credential it got back cannot authenticate — the round trip stored something worse than it lent`)

    if (now.fingerprint === was.fingerprint) {
      // NO ROTATION. Then nothing about it may have moved: a date that ticks on
      // an unchanged token is a "last seen" stamp wearing the name of something
      // more useful, and the card would say the secret is newer than it is.
      assert.equal(now.refreshed || null, was.refreshed,
        `"${was.name}" came back with the same fingerprint and a new date, so the date is not about the token changing`)
    } else {
      // A ROTATION. Then it must be dated, and dated LATER than before —
      // otherwise nothing can tell how old this secret is, which is the only
      // question the date exists to answer.
      moved.push(was.name)
      assert.ok(now.refreshed, `"${was.name}" changed and nothing recorded when`)
      assert.ok(!was.refreshed || String(now.refreshed) > String(was.refreshed),
        `"${was.name}" changed and its date did not move forward: was ${was.refreshed}, now ${now.refreshed}`)
    }
  }

  log(moved.length
    ? `${moved.join(', ')} rotated during the run and the newer token is what this host now holds — which is the whole reason the read-back exists`
    : 'nothing rotated during this run, and nothing moved that should not have: same fingerprint, same date, still usable')
})

cleanup(async ({ okc, state }) => {
  // The task and its branch. The sign-in is not this drill's to tidy — it was
  // lent and given back by the queue, which is the thing under test.
  if (state.task) {
    await okc('taskUnqueue', { id: state.task }).catch(() => {})
    await okc('taskRemove', { id: state.task }).catch(() => {})
    state.task = null
  }
  if (state.branch) {
    await okc('branchDelete', { branch: state.branch, force: true }).catch(() => {})
    state.branch = null
  }
})
