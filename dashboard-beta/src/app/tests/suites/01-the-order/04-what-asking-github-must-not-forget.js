'use strict'

// what asking GitHub must not forget — a choice is not a fact about a remote
//
// WHERE WORK GOES IS THE ONLY SETTING IN THIS APP WITH SOMEBODY ELSE'S NAME ON
// IT. Everything else decides what happens on this host; this decides whose
// repository a pull request is opened against. Losing it does not fail — it
// quietly sends the next change somewhere else, and unset means "your own
// remote", which looks exactly like working.
//
// WHAT WENT WRONG. `repositoriesCheck` filed its answer as `notes[repo] = row`,
// a whole-object replacement, so asking GitHub anything threw away everything in
// the note GitHub had not just answered. The chosen target lived in that note.
// One 403 — a rate limit, an expired token, a laptop shut mid-sweep — and "send
// work to the fork you are working with" became "send it to yourself".
//
// AND THE SUCCESS PATH DID IT TOO, which is worse: the inbox invites somebody to
// "ask GitHub about this one", and doing exactly what it asked would unset where
// their work goes.
//
// ---- where the probe went, and why it is better off there ----------------
//
// THIS FILE COULD NOT LOAD. It required `repos/remotes` and `core/github` — the
// second so it could replace `github.call` with one that answers 403, put it
// back in a `finally`, and watch what the failure branch did to the note. A
// drill runs from `dist/suites` with only the harness beside it and can reach
// neither.
//
// THE IDEA WAS RIGHT AND THE PLACE WAS WRONG. Making GitHub fail on demand is
// the only way to reach a failure branch when you want one — waiting for a real
// 403 means a check that passes for months and cannot be trusted the one time it
// matters — and it needs no host, no machine and no token. It is in
// `test/repositories/repositories.test.js` now, where the stand-in GitHub can be
// made to answer anything between one call and the next, and it drives every way
// asking can go wrong rather than the one this file could reach: a rate limit,
// an expired token, a repository the token was not granted, a server error, a
// remote that is not GitHub at all, and the success path.
//
// IT FOUND THE FAULT STILL HERE. Written against this app, it failed on the
// first branch: one 403 and the target went from `someone/their-fork` to
// `anowner/arepo`. The choice is now kept at the one place an answer is filed,
// rather than by each branch remembering to mention it.
//
// ---- and what is left here, which is the part with a real token in it ----
//
// THE SUCCESS PATH ON THIS HOST. Everything above is arithmetic on a stand-in;
// what a drill can say is that asking the REAL GitHub about a REAL repository
// with a REAL token — the thing the inbox invites somebody to do — comes back
// without having moved where that repository sends its work.

const { it, draft, requires } = require('../../harness')

requires('what this host has')

it('a repository here has somewhere it sends work', async ({ okc, assert, state, log }) => {
  const rows = (await okc('repositories')).repos || []
  const one = rows.find((r) => r.target && r.target.chosen)

  assert.needs(one, 'no repository in this workspace has been pointed at a fork, so there is no choice here to lose. Pick one in Repositories -> Repos -> Send work here')

  state.repo = one.repo
  state.target = one.target.on
  log(`"${one.repo}" sends work to ${one.target.on}, picked by ${one.target.by || 'somebody'}`)
}, { gate: true })

it('and asking GitHub about it does not move that', async ({ okc, assert, state, log }) => {
  // THE REAL CALL, WITH THE REAL TOKEN. This is what the inbox offers as a
  // one-press errand, so it is the exact sequence somebody is invited to run —
  // and the version of this fault that survived longest was the one on the
  // SUCCESS path, where nothing looks like it went wrong at all.
  //
  // NOT WRAPPED IN A FALSE FAILURE. Making GitHub fail belongs where it can be
  // done without breaking this app for everything else using it; see the header.
  await okc('repositoriesCheck', { repo: state.repo })

  const now = ((await okc('repositories')).repos || []).find((r) => r.repo === state.repo)
  assert.ok(now, `"${state.repo}" is not in the list after being asked about`)
  assert.equal(now.target && now.target.on, state.target,
    `asking GitHub about "${state.repo}" moved where it sends work, from ${state.target} to ${now.target && now.target.on}`)
  assert.ok(now.target && now.target.chosen,
    'asking GitHub turned a chosen target back into the default, which is your own remote — the next pull request would open against yourself and look normal')

  log(`asked GitHub for real, and "${state.repo}" still sends work to ${now.target.on}`)
})

// WHAT WAS ALREADY KNOWN IS STILL KNOWN, MARKED AS OLDER — the other half of the
// same idea, and this app does not do it yet.
//
// A repository that cannot be reached today was a fork yesterday and still is.
// `unasked` — what every failure branch returns — carries no `fork` and no
// `parent`, so a 403 turns "unreachable, and here is what was last known" into
// "nothing is known", which reads identically to never having asked and sends
// somebody to set up what is already set up.
//
// A DRAFT RATHER THAN A FIX MADE IN PASSING, because the careful version is not
// "keep the fields". Keeping facts while stamping them as freshly checked is
// WORSE than forgetting them: a failure would then look like a success. Doing it
// properly means the note distinguishing when this last ASKED from when an
// answer last CAME BACK, which is a change to the shape of what is stored rather
// than a line that was left out.
draft('and what was already known is still known, marked as older',
  'THE CLAIM: after a check that could not reach GitHub, the note still says whether the repository is a fork and what '
  + 'it was forked from, while recording that this attempt failed and why. '
  + 'WHERE IT STANDS: the chosen target is kept as of the commit that added this — that one is a choice, and losing it '
  + 'sends work elsewhere. The remembered FACTS are still dropped by `unasked` in repositories/repos/server.js. '
  + 'WHAT IT WOULD TAKE: two timestamps rather than one, so the note can say `checked` (when this last asked) apart '
  + 'from `learned` (when an answer last came back). Without that, keeping the facts makes a failed check look like a '
  + 'successful one, which is worse than forgetting. '
  + 'THE CHECK, once there is one: drive a 403 through repositories.test.js as the tests beside it already do, and ask '
  + 'that fork and parent survive while reachable reads false and `checked` has moved but `learned` has not.')
