'use strict'

// an arrived pull request — two names for it, and one person who may say yes
//
// A PULL REQUEST FROM OUTSIDE IS THE ONE THING HERE THAT NOBODY HERE WROTE.
// Judging it means fetching a stranger's change onto a machine that holds a
// credential, and the thing doing the reading is a model reading text the author
// wrote. So it waits on a person, at a named commit, and everything below is a
// way of that being true rather than nearly true.
//
// ALL OF IT RUNS WITHOUT A MACHINE. Every check here is a refusal or a shape,
// which is the whole point: what is being proved is where the gate is, not what
// a judge would conclude if it got through.
//
// WHY THESE EXIST. The gate refused the first pull request that ever arrived on
// its own, correctly — and then it stayed refused for two reasons neither of
// which was the gate:
//
//   the name    an allowance is filed under owner/name, because that is where a
//               pull request lives. A supervisor says the WORKSPACE name, which
//               is what it sees everywhere else. Those are different strings, so
//               the lookup went to a key nothing had ever written and the
//               refusal read "nobody has allowed this" about something somebody
//               had just allowed.
//   the size    `judging` answered with seventy-five thousand characters,
//               because every judgement carries the words it was given and the
//               rules it was held to. A supervisor cannot read that: it spills
//               to a file on a host it has no filesystem access to.
//
// Both were found by running it, and neither is visible in the code.

const { it, requires } = require('../../harness')

requires('the order')

it('allowing one is refused down the pipe, and refused to a driven click', async ({ actions, assert }) => {
  // THE ONE DECISION A MODEL MAY NOT MAKE FOR ITSELF. Not because a supervisor
  // is untrusted with much — it is trusted with a machine and a credential —
  // but because this specific question is "may somebody else's code be read
  // here", and the thing being protected against is the only thing that would
  // be answering.
  await assert.refuses(
    () => actions.prAllowJudging.run({ repo: 'local-repo-a', number: 1, _overTheWire: true }),
    'window|person',
    'a pull request was allowed to be judged from down the pipe'
  )

  // AND A DRIVEN CLICK IS THE COMMAND LINE WEARING THE WINDOW'S COAT. Whichever
  // button it lands on, it is not a person — this is the hole every other
  // approval in this app had at some point.
  await assert.refuses(
    () => actions.prAllowJudging.run({ repo: 'local-repo-a', number: 1, _driven: true }),
    'window|person',
    'a driven click allowed a pull request to be judged'
  )

  // The same on the way back out, for the same reason: an allowance somebody
  // else can take back is not an allowance a person gave.
  await assert.refuses(
    () => actions.prForbidJudging.run({ repo: 'local-repo-a', number: 1, _overTheWire: true }),
    'window|person|like giving',
    'an allowance was taken back from down the pipe'
  )
})

it('a pull request nobody has allowed cannot be judged, whichever name it is called', async ({ okc, actions, assert, log }) => {
  const { repos } = await okc('repositories')
  const one = (repos || []).find(r => r.parent || (r.remote && r.remote.owner))
  assert.needs(one, 'no repository here has a GitHub remote')

  const parent = one.parent || `${one.remote.owner}/${one.remote.repo}`
  const number = 999999

  // BOTH NAMES REACH THE SAME GATE. This is the check the name bug would have
  // failed in the direction that matters: the workspace name used to resolve to
  // a key nothing writes, so the allowance was never found and the refusal was
  // right by accident. Asking under both names proves they arrive together.
  for (const on of [one.repo, parent]) {
    await assert.refuses(
      () => actions.judgementCreate.run({ kind: 'pull', on, number, sha: '0'.repeat(40), job: 'anything', _overTheWire: true }),
      'allow',
      `a pull request named "${on}" got past the gate with nobody having allowed it`
    )
    log(`refused under "${on}"`)
  }

  // AND A NAME THAT IS NEITHER SAYS SO, rather than being quietly treated as a
  // repository that does not exist somewhere further in.
  await assert.refuses(
    () => actions.judgementCreate.run({ kind: 'pull', on: 'not-a-repository-here', number, sha: '0'.repeat(40), job: 'anything', _overTheWire: true }),
    'not a repository|owner/name',
    'a name that is not a repository at all was accepted'
  )
})

it('the list of judgements is small enough to read, and one of them is not', async ({ okc, assert, log }) => {
  const list = await okc('judging')
  const size = JSON.stringify(list).length

  // A NUMBER, BECAUSE THE FAILURE WAS A SIZE. Sixty thousand characters is not
  // a target — it is well above what this has ever returned with the long
  // fields left out, and well below the seventy-five thousand that broke it. If
  // this trips, something has started carrying its whole text in a list again.
  assert.ok(size < 60000, `the list of judgements is ${size} characters, which is a file rather than a list`)
  log(`${(list.judgements || []).length} judgement(s), ${size} characters`)

  // PER ROW AS WELL AS IN TOTAL, and the per-row bound is the one that will
  // catch the next one. The total scales with how many judgements a host
  // happens to have: this same list passed the size check for weeks on a host
  // with a handful of them while each row was already carrying its whole text,
  // and only tripped once there were twenty-nine. A host with five would still
  // be under sixty thousand with rows of ten thousand characters each.
  //
  // Named fields are checked because they are the two that were taken out
  // before; the SIZE is checked because the next one to grow will have a name
  // nobody has thought of yet. `question` and `note` are exactly that — they
  // grew back into the space `brief` and `rules` vacated, and no assertion here
  // mentioned them.
  for (const j of list.judgements || []) {
    assert.ok(!('brief' in j), `${j.ref} carries the words it was given in the list`)
    assert.ok(!('rules' in j), `${j.ref} carries the rules it was held to in the list`)

    const row = JSON.stringify(j).length
    const worst = Object.entries(j)
      .map(([k, v]) => [k, JSON.stringify(v == null ? '' : v).length])
      .sort((a, b) => b[1] - a[1])[0]
    assert.ok(row < 2500,
      `${j.ref} is ${row} characters on its own — a row in a list, not a record. Its longest field is "${worst[0]}" at ${worst[1]}`)
  }

  // AND NOTHING WAS TAKEN AWAY — it moved one press further in. A list that
  // dropped the text for good would be an app that cannot say what a worker was
  // actually held to, which is the thing the copies exist for.
  //
  // THE NEWEST ONE, not the first. The oldest judgements on this host predate
  // the brief being copied onto them at all, so reading one of those proves the
  // key is present and proves nothing about the text surviving — which is the
  // half that would actually break.
  const rows = list.judgements || []
  const first = rows[rows.length - 1]
  if (!first) return log('nothing has been judged here yet, so there is no one to read in full')

  const full = await okc('judging', { ref: first.ref })
  assert.equal(full.judgement.ref, first.ref, 'asking for one by ref returned a different one')
  assert.ok('brief' in full.judgement, `${first.ref} in full does not carry the words it was given`)
  assert.ok('rules' in full.judgement, `${first.ref} in full does not carry the rules it was held to`)
  log(`${first.ref} in full: brief ${String(full.judgement.brief || '').length} chars, rules ${String(full.judgement.rules || '').length} chars`)

  // A ref nothing answers to says what there is, rather than an empty answer
  // that reads as "it has nothing in it".
  await assert.refuses(() => okc('judging', { ref: 'J-nothing-is-called-this' }), 'no judgement', 'a ref nothing answers to returned something')
}, { minutes: 2 })
