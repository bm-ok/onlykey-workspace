'use strict'

// what a machine is made with — its console, its tags, and asking for a kind
//
// Three things about a machine that are decided when it is built and were each
// wrong in the same quiet way: they were written down somewhere nothing read.
//
//   its console   was off unless somebody turned it on, so every machine the
//                 test kit built could be watched and every machine made at the
//                 window could not. An install ran for twelve minutes with the
//                 Terminal tab showing nothing.
//   its tags      went into the spec, and vmTags, the queue and the card all read
//                 them from the top of the record — so a machine created with
//                 tags came back carrying none, and a supervisor built with the
//                 box ticked lost the tag that keeps it out of the pool.
//   asking for a  did not exist: "the first free machine" reaches whatever is
//   kind          idle, which on a host with working runners beside a test kit is
//                 the wrong answer more often than the right one.
//
// NONE OF THIS NEEDS A MACHINE TO BE RUNNING. It is what this host recorded when
// it built them, and one refusal.

const { it, requires } = require('../../harness')
const { POOL_TAG } = require('../../helpers')

requires('the machines are built')

it('every machine writes its console somewhere', async ({ okc, assert, state, log }) => {
  // A MACHINE THAT WILL NOT BOOT IS THE ONE NOTHING CAN BE ASKED OF, which makes
  // the one time this is wanted the one time it could not be arranged. It is
  // attached when a machine is built now, and given to older ones at startup.
  const machines = (await okc('vmList')).vms || []
  assert.needs(machines.length, 'this host has no machines')
  state.machines = machines

  const blind = machines.filter(m => !m.serial)
  assert.ok(!blind.length,
    `${blind.map(m => m.name).join(', ')} write their console nowhere, so a boot that never finishes cannot be read. It is attached when a machine is built and given to older ones at startup — see provisioner.makeSureConsolesAreCaptured`)
  log(`${machines.length} machine(s), all writing their console to this host`)
}, { gate: true })

it('and it cannot be turned off', async ({ okc, assert, state, log }) => {
  // What vmSerial is FOR now is putting one back. Off was the default once, and
  // what it produced was an instrument only the drills had.
  const one = (state.machines || [])[0]
  assert.needs(one, 'no machine to ask')
  await assert.refuses(
    () => okc('vmSerial', { name: one.name, on: false }),
    'Every machine keeps its console',
    `the console was turned off for ${one.name}, which puts it back in the blind spot`)
  log(`turning ${one.name}'s console off is refused`)
})

it('and every machine is in a pool', async ({ okc, assert, state, log }) => {
  // WHICH POOL A MACHINE IS IN NOW ALWAYS HAS AN ANSWER, and that is the point of
  // naming the ordinary one. Machines with no tag were a kind too — the default
  // kind — and it had no name, so anything checking that work went where it was
  // meant to had to special-case a shrug.
  //
  // Written onto the machine rather than inferred by whatever is reading, so the
  // register says it: built into one, and given to the ones that predate the idea
  // at startup. See POOL in machines/vms.js.
  const machines = state.machines || []
  const homeless = machines.filter(m => !(m.tags || []).length)
  assert.ok(!homeless.length,
    `${homeless.map(m => m.name).join(', ')} belong to no pool at all. Every machine carries a tag — "default" when nobody chose one — so that "which pool is this" is always answerable`)

  // AND THE POOLS REPORT SAYS THE SAME. Two places knowing the same thing and
  // disagreeing is the fault this window keeps finding.
  const pools = await okc('pools')
  assert.ok(!(pools.inNoPool || []).length, `pools reports ${pools.inNoPool.join(', ')} as belonging to nothing`)
  const named = new Set((pools.pools || []).flatMap(p => p.machines.map(m => m.name)))

  // EXCEPT THE ONES THIS KIT IS HOLDING, and leaving them out was a mistake this
  // check made about the suite two folders up from it. Warming keeps somebody's
  // own machines back — `kit-held`, `forTasks: false` — precisely so the drills
  // cannot borrow them, and `pools` reports what the QUEUE can reach, which is
  // correctly not those. So this failed on a host in exactly the state the kit
  // had deliberately put it in, and it failed saying "work can go to it", about
  // a machine the kit had just made sure work cannot go to.
  //
  // Cooling gives them back. Until it runs — and it does not run on a sweep that
  // stopped early — this is the honest state rather than a fault.
  const reachable = machines.filter(x => !x.supervisor && x.forTasks !== false && !(x.tags || []).includes('kit-held'))
  for (const m of reachable) {
    assert.ok(named.has(m.name), `${m.name} is a machine work can go to and is in none of the pools`)
  }
  const held = machines.filter(x => !x.supervisor && !reachable.includes(x))
  if (held.length) log(`kept back, so not in a pool: ${held.map(m => m.name).join(', ')} — suite 11 gives them back`)
  log(`${(pools.pools || []).map(p => `${p.tag} (${p.machines.length})`).join(', ')}`)
})

it('and clearing a machine\'s tags puts it back in the default one', async ({ okc, assert, state, log }) => {
  // NOT INTO NONE, because "no pool" is not a state a machine can be in. Asking
  // for no tags is asking for the ordinary kind — which is what somebody means by
  // it, and it keeps the invariant above true by construction rather than by a
  // sweep noticing later.
  //
  // Done to a machine that is already in the default pool, so this changes
  // nothing about the host even if it is interrupted.
  const plain = (state.machines || []).find(m => !m.supervisor && (m.tags || []).join() === 'default')
  assert.needs(plain, 'no machine is in the default pool alone, and this must not disturb a machine somebody tagged on purpose')

  const said = await okc('vmTags', { name: plain.name, tags: [] })
  assert.ok((said.tags || []).includes('default'),
    `clearing ${plain.name}'s tags left it carrying ${JSON.stringify(said.tags)} — every machine is in a pool`)
  log(`${plain.name}: cleared, and back in "${said.tags.join(', ')}"`)
})

it('and a machine keeps the tags it was made with', async ({ okc, assert, state, log }) => {
  // Read from the TOP of the record, which is where everything that acts on a tag
  // reads: vmTags writes there, the queue matches there, the card draws from
  // there. The spec is where it was ASKED for.
  const machines = state.machines || []
  const tagged = machines.filter(m => (m.tags || []).length)
  assert.needs(tagged.length, 'no machine on this host carries a tag, so there is nothing to check')

  for (const m of tagged) {
    const said = await okc('vmTags', { name: m.name })
    assert.ok((said.tags || []).length, `${m.name} lists tags in vmList and none through vmTags — two places disagreeing about one fact`)
    for (const t of m.tags) {
      assert.ok(said.tags.includes(t), `${m.name} carries "${t}" in the list and not in its record`)
    }
  }
  log(tagged.map(m => `${m.name} [${m.tags.join(', ')}]`).join('; '))
})

it('and a supervisor keeps the one tag that is not a label', async ({ okc, assert, state, log }) => {
  // It decides what gets installed AND it is what keeps the machine out of the
  // pool, so it is chosen when the machine is made and refused in both directions
  // afterwards. A guarantee somebody can type away is not a guarantee.
  const boss = (state.machines || []).find(m => m.supervisor)
  assert.needs(boss, 'this host has no supervisor machine')

  await assert.refuses(
    () => okc('vmTags', { name: boss.name, tags: (boss.tags || []).filter(t => t !== 'supervisor') }),
    'keeps the "supervisor" tag',
    `"supervisor" came off ${boss.name}, which puts it in the queue's pool`)

  const runner = (state.machines || []).find(m => !m.supervisor)
  if (runner) {
    await assert.refuses(
      () => okc('vmTags', { name: runner.name, tags: [...(runner.tags || []), 'supervisor'] }),
      'not a tag you can add',
      `"supervisor" went onto ${runner.name}, which takes it out of the queue without giving it any of what a supervisor needs`)
  }
  log(`${boss.name} keeps its tag, and no runner can be given one`)
})

it('and a borrow can ask for a kind rather than whatever is idle', async ({ okc, assert, log }) => {
  // THE REFUSAL IS THE FEATURE. The queue waits for a tagged machine rather than
  // taking somebody else's, and a borrow that quietly ignored the kind asked for
  // would be the fault this fixed: drills borrowing a working runner because it
  // happened to be free, and giving it back rolled to its base snapshot.
  const said = await assert.refuses(
    () => okc('vmBorrow', { tag: 'okc-no-such-kind', why: 'a drill asking for a kind nothing carries' }),
    'No machine tagged',
    'a borrow asked for a kind nothing carries and was handed a machine anyway')

  // AND IT SAYS WHAT IS THERE, because "no" with no list is a dead end: the whole
  // point of asking for a kind is that you do not know which machine you want.
  assert.ok(/is free|is a supervisor|still claims|kept back|being installed/.test(said.message),
    `the refusal does not say what is actually free: ${said.message}`)
  log(said.message.slice(0, 160))
})
