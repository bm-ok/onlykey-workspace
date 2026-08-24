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
// ---- what this asks, and what it stopped asking --------------------------
//
// THE RULE ITSELF IS ARITHMETIC AND IS ASKED WHERE ARITHMETIC BELONGS. It used
// to be asked here — `whyNotOn` over nine pairings, `kindOf` over three made-up
// machines, `takesQueuedWork` over the same — with rows this file invented, on
// functions it reached for by `require`. A drill runs from `dist/suites` with
// only the harness beside it and cannot reach the app's insides, which is why
// this suite read `will not load`; but the rows say the rest, since a check that
// makes up its own machines is not asking anything about this host.
//
// They are asked, and asked harder, in:
//
//   test/runners/guests-lending.js   whyNotOn, every pairing, and what the
//                                    refusal says to do about it
//   test/runners/guests-shape.js     roleFrom — "guest" is the old name for a
//                                    worker and still reads as one, so a rename
//                                    cannot quietly reclassify every existing
//                                    credential
//   test/vms/ours-roles.js           kindOf, kindsOf and takesQueuedWork: an
//                                    unlabelled machine is sent nothing, because
//                                    nothing knows which sign-in to hand it, and
//                                    "default" is a POOL rather than a role
//
// WHAT IS LEFT IS ABOUT THE MACHINES THAT ARE ACTUALLY HERE, which is the only
// part a made-up row cannot stand in for:
//
//     every machine reads as what its tags say   on this host, not in a fixture
//     a role can be moved                        worker and judge are the same
//                                                disk; what separates them is
//                                                which sign-in may be lent to it
//     and a provision cannot                     a supervisor is a different
//                                                build — different scripts, a
//                                                second user, a sign-in desk —
//                                                and you cannot retag your way
//                                                into that
//     and neither may move under running work    a machine that becomes a judge
//                                                mid-task holds a sign-in for a
//                                                role it no longer has

const { it, cleanup } = require('../../harness')

// THE TAG WORDS, WRITTEN OUT. They are protocol: they appear on the machine, in
// the pane, and on the command line, and vms/ours/roles.js is where they are
// defined. A drill cannot import them, and writing them out is the same thing a
// person typing `--tags judge` does — which is the surface this is about.
const JUDGE = 'judge'
const WORKER = 'worker'
const SUPERVISOR = 'supervisor'

it('every machine here reads as the kind its tags say', async ({ okc, assert, log }) => {
  // ASKED OF THE HOST, not of rows made up to have the answer. What can go wrong
  // that a fixture cannot show: a machine built before the tag words settled, or
  // one retagged by hand, sitting in the pool reading as something it is not —
  // and the queue chooses which credential to hand a machine BY ITS KIND.
  const { vms } = await okc('vmList')
  assert.needs(vms.length, 'this host has no machines, so there is nothing to be consistent — run "the machines are built" first')

  const wrong = []
  vms.forEach((v) => {
    const tags = (v.tags || []).map((t) => String(t).toLowerCase())
    const kind = v.kind || null

    // A KIND IS A CLAIM ABOUT A TAG, in both directions. Reading as a judge
    // without carrying the word is a machine the queue will send judgements to
    // for a reason nobody can see; carrying the word and reading as something
    // else is the same fault the other way up.
    if (kind === SUPERVISOR && !tags.includes(SUPERVISOR)) wrong.push(`${v.name} reads as a supervisor without carrying "${SUPERVISOR}"`)
    if (kind === JUDGE && !tags.includes(JUDGE)) wrong.push(`${v.name} reads as a judge without carrying "${JUDGE}"`)
    if (tags.includes(SUPERVISOR) && kind !== SUPERVISOR) wrong.push(`${v.name} carries "${SUPERVISOR}" and reads as ${kind}`)
  })

  assert.equal(wrong.length, 0, wrong.join('; '))
  log(`${vms.length} machine(s), each reading as what it carries: ${vms.map((v) => `${v.name}=${v.kind || 'unsaid'}`).join(', ')}`)
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

  // ANY ORDINARY MACHINE THAT IS NOT BUSY. Written as "kind === worker" first,
  // which found nothing on a host whose only spare machine is tagged as a judge
  // — and the claim is about moving a role, so which end it starts at does not
  // matter.
  const idle = here.find((v) => v.kind !== SUPERVISOR && !v.branch && !v.borrowed && !v.holdsCredential)
  assert.needs(idle, 'no ordinary machine is idle here, and changing what a busy machine is FOR is refused on purpose')

  const was = (idle.tags || []).map((t) => String(t))
  const wasJudge = was.map((t) => t.toLowerCase()).includes(JUDGE)

  // THE OTHER ROLE, WHICHEVER THIS ONE IS NOT — and the word is SWAPPED, not
  // dropped.
  //
  // Written as "take the judge tag off" first, and beta-install1 came back
  // reading as `null` rather than as a runner. That is the app being right: a
  // machine that has not said what it is for is not a worker by default, it is
  // unlabelled, and the queue sends it nothing because nothing knows which
  // sign-in to hand it. Moving a role means saying the other word.
  const want = wasJudge ? WORKER : JUDGE
  const moved = was.filter((t) => ![JUDGE, WORKER].includes(String(t).toLowerCase())).concat([want])

  state.retagged = idle.name
  state.wasTags = was.join(',')

  await okc('vmTags', { name: idle.name, tags: moved.join(',') })
  const now = ((await okc('vmList')).vms || []).find((v) => v.name === idle.name)
  assert.equal(now.kind, want,
    `${idle.name} was tagged "${want}" and reads as ${now.kind}`)

  // AND BACK, because a role that can only be given is a role that traps a
  // machine in it.
  await okc('vmTags', { name: idle.name, tags: was.join(',') })
  const back = ((await okc('vmList')).vms || []).find((v) => v.name === idle.name)
  assert.equal(back.kind, wasJudge ? JUDGE : WORKER,
    `${idle.name} could not be put back to what it was — it reads as ${back.kind}`)
  state.retagged = null

  // THE PROVISION CANNOT MOVE, for the reason the role can: a supervisor is a
  // different build, not a different label on the same one.
  const sup = here.find((v) => v.kind === SUPERVISOR)
  if (sup) {
    await assert.refuses(
      () => okc('vmTags', { name: sup.name, tags: 'test' }),
      'keeps the',
      `the "${SUPERVISOR}" tag could be taken off ${sup.name}, which would put a machine with no project provisioning into the queue's pool`)
  }

  log(`${idle.name} changed role and changed back${sup ? `; ${sup.name} cannot stop being a supervisor` : ''}`)
})

it('and a role cannot change underneath running work', async ({ okc, assert, log }) => {
  // THE GUARD THAT REPLACED "NEVER". A machine that becomes a judge mid-task, or
  // a worker mid-judgement, is holding a sign-in for a role it no longer has —
  // and the next thing lent to it would be the wrong kind. So the question is
  // whether it is BUSY, which is about right now, rather than when it was made.
  const busy = ((await okc('vmList')).vms || []).find((v) => v.kind !== SUPERVISOR && (v.branch || v.borrowed || v.holdsCredential))
  assert.needs(busy, 'no machine is busy here, so there is nothing to refuse — this checks the refusal, not the permission')

  await assert.refuses(
    () => okc('vmTags', { name: busy.name, tags: [...(busy.tags || []), JUDGE].join(',') }),
    'cannot change right now|mid-task|mid-judgement',
    `${busy.name} is busy and its role could still be changed underneath the work it is doing`)

  log(`${busy.name} is busy, so what it is for cannot be changed until it is finished`)
})

cleanup(async ({ okc, state }) => {
  // A MACHINE LEFT WEARING THE WRONG ROLE is worse than a failed drill: the queue
  // would go on choosing credentials for it by that role. Put back whatever it
  // was, whether or not the check that changed it got as far as changing it back.
  if (state.retagged) {
    try { await okc('vmTags', { name: state.retagged, tags: state.wasTags || '' }) } catch { /* it may be gone */ }
    state.retagged = null
  }
})
