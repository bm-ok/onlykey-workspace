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

const { it } = require('../../../tasks/harness')
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

it('and neither tag can be granted or taken away afterwards', async ({ okc, assert, log }) => {
  // A TAG SOMEBODY CAN ADD IS A BOUNDARY THEY CAN GRANT THEMSELVES, and one they
  // can remove is worse: a machine mid-judgement would become an ordinary
  // runner, and the next thing lent to it would be a worker's sign-in.
  const here = ((await okc('vmList')).vms || [])
  const runner = here.find(v => v.kind === 'worker')
  assert.needs(runner, 'this host has no ordinary runner to try adding the tag to')

  const was = (runner.tags || []).join(',')
  await assert.refuses(
    () => okc('vmTags', { name: runner.name, tags: `${was},${vms.JUDGE}` }),
    'not a tag you can add',
    `"${vms.JUDGE}" could be added to ${runner.name} after it was made, which is a machine granting itself the right to be lent a judge's identity`)

  // AND IT WAS NOT HALF-APPLIED. A refusal that wrote some of what it refused is
  // worse than one that let it through, because nothing says so.
  const after = ((await okc('vmList')).vms || []).find(v => v.name === runner.name)
  assert.equal((after.tags || []).join(','), was, `${runner.name}'s tags changed despite the refusal`)

  const sup = here.find(v => v.kind === 'supervisor')
  if (sup) {
    await assert.refuses(
      () => okc('vmTags', { name: sup.name, tags: 'test' }),
      'keeps the',
      `the "${vms.SUPERVISOR}" tag could be taken off ${sup.name}, which would put it in the queue's pool`)
  }

  log(`${runner.name} cannot be given "${vms.JUDGE}"${sup ? `, and ${sup.name} cannot lose "${vms.SUPERVISOR}"` : ''}`)
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
