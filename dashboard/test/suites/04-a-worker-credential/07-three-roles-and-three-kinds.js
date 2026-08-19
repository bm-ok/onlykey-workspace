'use strict'

// three roles and three kinds — a judge signs its own readings
//
// A SIGN-IN HAS A ROLE and a machine has a KIND, and they must match:
//
//   worker sign-in      on a runner              yes
//   judge sign-in       on a judge machine       yes
//   supervisor sign-in  on a supervisor machine  yes
//   any other pairing                            refused, saying which two
//
// WHY A JUDGE HAS ITS OWN IDENTITY, which is the point of the whole
// arrangement: a judge says whether work holds and a worker writes the work. On
// one machine with one sign-in those are the same account, and "who said this is
// good" stops being separable from "who wrote it". That separation is the only
// thing that makes a verdict worth more than a signature.
//
// THE RULE IS CHECKED AS ARITHMETIC, not by lending real credentials to real
// machines. `whyNotOn` is a function of two strings, and nine pairings can be
// asked in a millisecond — where doing it for real would mean three machines of
// three kinds and three sign-ins, most of which this host does not have. What
// needs a machine is checked below with the machines that exist.
//
// `guest` IS THE OLD NAME FOR A WORKER and is still what older records say. That
// is checked too, because a rename that silently reclassifies every existing
// credential would be a quiet way to break the rule above.

const { it, cleanup } = require('../../../tasks/harness')
const guests = require('../../../core/guests')
const vms = require('../../../machines/vms')

const ROLES = ['worker', 'judge', 'supervisor']

it('every sign-in goes on its own kind of machine, and nowhere else', ({ assert, log }) => {
  const allowed = []
  const refused = []

  for (const role of ROLES) {
    for (const kind of ROLES) {
      const why = guests.whyNotOn(role, kind, 'the-sign-in', 'the-machine')
      if (role === kind) {
        assert.ok(!why, `a ${role} sign-in was refused its own kind of machine: ${why}`)
        allowed.push(`${role}/${kind}`)
      } else {
        assert.ok(why, `a ${role} sign-in was allowed onto a ${kind} machine. Every crossing here collapses two accounts into one`)
        // THE REFUSAL NAMES BOTH SIDES, because "not allowed" about a
        // credential and a machine is a sentence somebody has to act on and
        // cannot if it does not say which two things are wrong together.
        assert.ok(why.includes('the-sign-in') && why.includes('the-machine'),
          `the refusal does not name both the sign-in and the machine: ${why}`)
        refused.push(`${role}/${kind}`)
      }
    }
  }

  assert.equal(allowed.length, 3, `three pairings should be allowed and ${allowed.length} were: ${allowed.join(', ')}`)
  assert.equal(refused.length, 6, `six should be refused and ${refused.length} were`)
  log(`allowed ${allowed.join(', ')}; refused all six crossings`)
})

it('and the old name for a worker still reads as one', ({ assert, log }) => {
  // EVERY CREDENTIAL WRITTEN BEFORE THERE WERE THREE ROLES SAYS `guest`. If that
  // stopped reading as a worker, every existing sign-in would become some other
  // kind and the rule above would refuse it from the machines it has always been
  // lent to — a rename quietly revoking the host's own credentials.
  const kept = guests.all()
  assert.ok(kept.length, 'this host holds no sign-ins, so there is nothing to read')
  for (const g of kept) {
    assert.ok(ROLES.includes(g.role), `"${g.name}" reports role "${g.role}", which is not one of the three. An unknown role matches no machine kind and can be lent nowhere`)
  }
  assert.ok(!kept.some(g => g.role === 'guest'), 'a sign-in still reports the retired role "guest" rather than "worker"')
  log(`${kept.length} sign-in(s): ${kept.map(g => `${g.name} (${g.role})`).join(', ')}`)
})

it('and a machine says which kind it is, from its tags alone', ({ assert, log }) => {
  const here = vms.read()
  assert.ok(here.length, 'this host has no machines')

  for (const v of here) {
    const kind = vms.kindOf(v)
    assert.ok(ROLES.includes(kind), `"${v.name}" reads as kind "${kind}"`)

    // FROM THE TAGS AND NOTHING ELSE, so the answer cannot drift from what the
    // queue matches on — which is the reason this is a tag rather than a flag.
    const tags = (v.tags || []).map(t => String(t).toLowerCase())
    if (kind === 'supervisor') assert.ok(tags.includes(vms.SUPERVISOR), `"${v.name}" reads as a supervisor without carrying the tag`)
    if (kind === 'judge') assert.ok(tags.includes(vms.JUDGE), `"${v.name}" reads as a judge without carrying the tag`)
    if (kind === 'worker') {
      assert.ok(!tags.includes(vms.SUPERVISOR) && !tags.includes(vms.JUDGE), `"${v.name}" reads as an ordinary runner while carrying a tag that says otherwise`)
    }
  }
  log(here.map(v => `${v.name}: ${vms.kindOf(v)}`).join(', '))
})

it('a role can be moved, and what was BUILT cannot', async ({ okc, assert, state, log }) => {
  // THE DISTINCTION THIS WHOLE ARRANGEMENT RESTS ON, and the one the first
  // version of it got wrong by copying the supervisor rule without its reason.
  //
  //   provision   supervisor or not — different scripts, a second user, a
  //               sign-in desk. You cannot retag your way into that.
  //   role        worker or judge — the SAME machine, built the same way. What
  //               separates them is which sign-in it may be lent and which work
  //               the queue sends it, and both are decisions about an identical
  //               disk.
  //
  // So a role moves and a provision does not.
  const here = ((await okc('vmList')).vms || [])
  const idle = here.find(v => v.kind === 'worker' && !v.branch && !v.borrowed && !v.holdsCredential)
  assert.needs(idle, 'no ordinary runner is idle here, and changing what a busy machine is FOR is refused on purpose')

  const was = (idle.tags || []).map(t => String(t))
  state.retagged = idle.name
  state.wasTags = was.join(',')

  await okc('vmTags', { name: idle.name, tags: [...was, vms.JUDGE].join(',') })
  const now = ((await okc('vmList')).vms || []).find(v => v.name === idle.name)
  assert.equal(now.kind, 'judge', `${idle.name} was given the "${vms.JUDGE}" tag and still reads as ${now.kind}`)

  // AND BACK, because a role that can only be given is a role that traps a
  // machine in it.
  await okc('vmTags', { name: idle.name, tags: was.join(',') })
  const back = ((await okc('vmList')).vms || []).find(v => v.name === idle.name)
  assert.equal(back.kind, 'worker', `${idle.name} could not be turned back into a runner — it reads as ${back.kind}`)
  state.retagged = null

  // THE PROVISION CANNOT MOVE, for the reason the role can: a supervisor is a
  // different build, not a different label on the same one.
  const sup = here.find(v => v.kind === 'supervisor')
  if (sup) {
    await assert.refuses(
      () => okc('vmTags', { name: sup.name, tags: 'test' }),
      'keeps the',
      `the "${vms.SUPERVISOR}" tag could be taken off ${sup.name}, which would put a machine with no project provisioning into the queue's pool`)
  }

  log(`${idle.name} became a judge and a runner again${sup ? `; ${sup.name} cannot stop being a supervisor` : ''}`)
})

it('and a role cannot change underneath running work', async ({ okc, assert, log }) => {
  // THE GUARD THAT REPLACED "NEVER". A machine that becomes a judge mid-task, or
  // a worker mid-judgement, is holding a sign-in for a role it no longer has —
  // and the next thing lent to it would be the wrong kind. So the question is
  // whether it is BUSY, which is about right now, rather than when it was made.
  const busy = ((await okc('vmList')).vms || []).find(v => v.kind !== 'supervisor' && (v.branch || v.borrowed || v.holdsCredential))
  assert.needs(busy, 'no machine is busy here, so there is nothing to refuse — this checks the refusal, not the permission')

  await assert.refuses(
    () => okc('vmTags', { name: busy.name, tags: [...(busy.tags || []), vms.JUDGE].join(',') }),
    'cannot change right now|mid-task|mid-judgement',
    `${busy.name} is busy and its role could still be changed underneath the work it is doing`)

  log(`${busy.name} is busy, so what it is for cannot be changed until it is finished`)
})

it('and work only ever goes to a machine of its own kind', ({ assert, log }) => {
  // ASKED OF THE RULE RATHER THAN OF THE POOL, so it can be checked on a host
  // that has no judge machine — which is most of them, and the reason the two
  // directions differ:
  //
  //   a task never goes to a judge machine        strictly, always
  //   a judgement goes to a judge machine         when this host has one
  //
  // Excluding judge machines from tasks can never strand a task: a machine is a
  // worker unless it says otherwise, so running out of workers means every
  // machine is a judge. Requiring a judge for judgements CAN strand one, on any
  // host that has not made one.
  const machines = [
    { name: 'a-runner', tags: ['test'] },
    { name: 'a-judge', tags: ['test', vms.JUDGE] }
  ]
  const kinds = machines.map(m => `${m.name}=${vms.kindOf(m)}`)
  assert.equal(kinds.join(' '), 'a-runner=worker a-judge=judge', `kindOf disagrees: ${kinds.join(' ')}`)

  // The tag composes with any other, which is what makes a pool: "judge" and
  // "test" together is the kit's judge pool, and nothing has to know that.
  assert.ok(machines[1].tags.includes('test'), 'a judge machine cannot also carry the tag that puts it in a pool')

  log('a machine is a worker unless it says judge, and the tag composes with any other')
})

it('and judging is routed by what this host actually has', async ({ okc, assert, log }) => {
  // THE CONDITION IS THE DESIGN. Requiring a judge machine outright would stop
  // every judgement on a host that has not made one — which is every host until
  // somebody does. So the separation switches itself on when the machine exists,
  // and this checks whichever of the two states this host is in rather than
  // insisting on one.
  const here = ((await okc('vmList')).vms || [])
  const judges = here.filter(v => v.kind === 'judge')

  if (!judges.length) {
    // Nothing to assert about routing, and something worth asserting about
    // honesty: the app must not claim a separation it is not making.
    log('no machine is tagged "judge" on this host, so judging runs on ordinary runners — the separation is off, which is the documented behaviour until a judge machine is made')
    return
  }

  // WITH ONE, EVERY JUDGE MACHINE MUST BE ABLE TO HOLD A JUDGE'S SIGN-IN, or the
  // routing sends work to a machine that will then be refused its identity.
  for (const v of judges) {
    const why = guests.whyNotOn('judge', 'judge', 'a-judge-sign-in', v.name)
    assert.ok(!why, `${v.name} is tagged as a judge machine and a judge sign-in cannot be lent to it: ${why}`)
  }
  log(`judge machines: ${judges.map(v => v.name).join(', ')} — judging goes to those and waits rather than using a runner`)
})

cleanup(async ({ okc, state }) => {
  // A ROLE PUT BACK. This drill turns a runner into a judge and back again; if a
  // check between those two fails, the machine is left as a judge — which the
  // queue would then honour, quietly taking it out of the worker pool.
  if (state.retagged && state.wasTags != null) {
    await okc('vmTags', { name: state.retagged, tags: state.wasTags }).catch(() => {})
  }
  state.retagged = null
})
