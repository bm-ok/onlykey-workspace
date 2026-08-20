'use strict'

// what asking GitHub must not forget — a choice is not a fact about a remote
//
// WHERE WORK GOES IS THE ONLY SETTING IN THIS APP WITH SOMEBODY ELSE'S NAME ON
// IT. Everything else decides what happens on this host; this decides whose
// repository a pull request is opened against. Losing it does not fail — it
// quietly sends the next change somewhere else, and unset means "your own
// remote", which looks exactly like working.
//
// WHAT WENT WRONG. `check()` wrote `notes[repo] = { ... }` on every branch, a
// whole-object replacement, so asking GitHub anything threw away everything in
// the note GitHub had not just answered. The chosen target lived in that note.
// One 403 -- a rate limit, an expired token, a laptop shut mid-sweep -- and
// "send work to the fork you are working with" became "send it to yourself".
//
// AND THE SUCCESS PATH DID IT TOO, which is worse: the inbox invites somebody to
// "ask GitHub about this one", and doing exactly what it asked would unset where
// their work goes.
//
// FOUND BY PROBING RATHER THAN BY READING. The code looks reasonable at every
// individual line; the fault is in which fields each branch does not mention.
// That is what this checks -- not "is the rule right" but "does every branch
// still obey it", which is the part a reader cannot hold in their head and the
// part that breaks when a sixth branch is added.
//
// NO NETWORK AND NO MACHINE. GitHub is made to answer 403 for the length of one
// call. That is the only way to reach a failure branch on demand: waiting for a
// real one means a drill that passes for months and then cannot be trusted the
// one time it matters.

const { it, cleanup } = require('../../harness')
const remotes = require('../../../repos/remotes')
const github = require('../../../core/github')

it('a repository has somewhere it sends work', async ({ okc, assert, state, log }) => {
  const rows = (await okc('repositories')).repos || []
  const one = rows.find(r => r.target && r.target.chosen)
  assert.needs(one, 'no repository in this workspace has been pointed at a fork, so there is no choice here to lose. Pick one in Repositories -> Repos -> Send work here')

  state.repo = one.repo
  state.target = one.target.on
  state.knew = { fork: one.fork, parent: one.parent }
  log(`"${one.repo}" sends work to ${one.target.on}, picked by ${one.target.by || 'somebody'}`)
}, { gate: true })

it('and a check that cannot reach GitHub does not unset it', async ({ okc, assert, state, log }) => {
  // ONE CALL, PUT BACK IMMEDIATELY. `finally` rather than after the await,
  // because a throw here would otherwise leave this whole app unable to reach
  // GitHub until it was restarted -- a drill that breaks the host when it fails
  // is worse than no drill.
  const real = github.call
  github.call = async () => ({ status: 403, body: { message: 'a drill pretending the token was rate limited' } })
  try {
    await okc('repositoriesCheck', { repo: state.repo })
  } finally {
    github.call = real
  }

  const now = remotes.targetOf(state.repo)
  assert.equal(now.on, state.target, `a failed check moved where "${state.repo}" sends work, from ${state.target} to ${now.on}`)
  assert.ok(now.chosen, 'a failed check turned a chosen target back into the default, which is your own remote — the next pull request would open against yourself and look normal')

  log(`403 from GitHub, and "${state.repo}" still sends work to ${now.on}`)
})

it('and what was already known is still known, marked as older', async ({ assert, state, log }) => {
  // UNREACHABLE IS NOT GONE. A repository that cannot be reached today was a
  // fork yesterday and still is. Forgetting turns "unreachable, and here is what
  // was last known" into "nothing is known", which reads identically to never
  // having asked — and sends somebody to set up what is already set up.
  const row = remotes.notesOnly().find(r => r.repo === state.repo)
  assert.equal(String(row.fork), String(state.knew.fork), 'a failed check forgot whether it was a fork')
  assert.equal(String(row.parent), String(state.knew.parent), 'a failed check forgot what it was forked from')

  // AND THE TIMESTAMPS TELL THE TRUTH ABOUT IT. Keeping the facts while stamping
  // them as freshly checked would be worse than forgetting them, because then a
  // failure would look like a success. `checked` is when this last ASKED;
  // `learned` is when an answer last came back.
  assert.ok(row.reachable === false, `it should be recorded as unreachable, and reads ${row.reachable}`)
  assert.ok(/rate limited/.test(row.why || ''), `it should say why, and says: ${row.why}`)

  log(`still a fork of ${row.parent}, and marked unreachable: ${row.why}`)
})

cleanup(async ({ okc, state, log }) => {
  // ASKING FOR REAL, which overwrites the drill's failure with the truth. If the
  // check above has regressed, the target is already gone by now — so it is put
  // back explicitly rather than hoped for.
  if (!state.repo) return
  try { await okc('repositoriesCheck', { repo: state.repo }) } catch { /* the network is not this drill's business */ }
  const now = remotes.targetOf(state.repo)
  if (state.target && now.on !== state.target) {
    remotes.setTarget(state.repo, state.target, { by: 'the window', why: 'put back by the drill that proved it can be lost' })
    log(`the target WAS lost and has been put back: "${state.repo}" -> ${state.target}`)
  }
  state.repo = null
})
