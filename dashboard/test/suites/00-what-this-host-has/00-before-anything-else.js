'use strict'

// what this host has — the doors that a person opens
//
// The first suite, and the only one whose purpose is to stop the others. See the
// README beside this file for why it exists and why it never reads a value.

const { it } = require('../../../tasks/harness')

it('a folder of repositories is open', async ({ okc, assert, log }) => {
  // THE FIRST THING, because almost every action here is refused without one —
  // `needs: 'workspace'` in the action table — and a run against a closed
  // workspace produces the same refusal a dozen times over instead of once.
  const open = await okc('workspaces')
  const here = open.open || open.dir || (open.workspaces || []).find(w => w.open)
  assert.asksYou(here, 'no workspace is open. Open the folder of repositories you want to work in — the Repositories tab — and run this again.')

  const { repos } = await okc('repositories')
  assert.asksYou(repos && repos.length, 'a workspace is open and holds no repositories. This app works on a folder of git repositories; put some there, or open a different folder.')
  log(`${repos.length} repositor${repos.length === 1 ? 'y' : 'ies'}: ${repos.map(r => r.repo || r.name).join(', ')}`)
}, { gate: true })

it('and drills are allowed to run here', async ({ okc, assert, log }) => {
  // NOT A THING THIS CAN TURN ON, and that is the whole design of it. The drills
  // write tasks, take credentials off machines and open pull requests; against
  // three scaffolding repositories that is what they are for, and against
  // somebody's real work it is a stranger typing into their repository. Nothing
  // here can tell the two apart, so a person says which folder they do not mind.
  //
  // It is asked for BY NAME here rather than left to the first refusal, because
  // the refusal arrives from whichever check happened to run first and reads as
  // being about that check.
  const { tests } = await okc('settings')
  assert.asksYou(tests && tests.allowed,
    `drills are not allowed in this workspace${tests && tests.why ? ` — ${tests.why}` : ''}. Turn testing mode on for this folder, at the top of the window, and run this again. It is off by default on purpose.`)
  log(`testing mode is on for ${tests.forDir}`)
}, { gate: true })

it('and a GitHub token that still works', async ({ okc, assert, log }) => {
  // ASKED OF GITHUB, not of the disk. A token that is present and has been
  // revoked, expired or had its scopes changed is worse than a missing one: it
  // fails at the far end of the flow, after a branch has been cut and a machine
  // has done the work.
  //
  // WHAT IT LEARNS AND WHAT IT DOES NOT. Whether one is held, who it belongs to,
  // and whether GitHub still accepts it. Never the token. The rule for this app
  // is that a model may know something was done in the Keys tab and not what,
  // and a check that printed a value would put it in the log, the result and the
  // transcript at once.
  const held = await okc('githubHeld')
  assert.asksYou(held && held.held,
    'this host holds no GitHub token, so nothing can be pushed, no pull request can be opened and no fork can be synced. Add one on the Keys tab — it is checked against GitHub before it is kept — and run this again.')

  // ASKED NOW, not read from the last time somebody asked. `githubHeld` carries
  // a `checked` from whenever it was last tried, which here was two days old —
  // and "it worked on Thursday" is exactly the answer that lets a revoked token
  // through to fail at the far end of the flow, after a branch has been cut and
  // a machine has done the work.
  const now = await okc('githubCheck')
  assert.asksYou(now && now.ok,
    `the GitHub token here is not working${now && now.why ? ` — ${now.why}` : ''}${now && now.status ? ` (GitHub answered ${now.status})` : ''}. It may have been revoked, expired, or had its scopes changed. Replace it on the Keys tab and run this again.`)

  log(`a GitHub token is held for ${now.login}${now.kind ? ` (${now.kind})` : ''}, scopes ${(now.scopes || []).join(', ') || 'none listed'}, expires ${now.expires || 'never'}`)
  log('asked of GitHub just now, not read from the last time it was checked')
}, { gate: true })

// WHAT IT SAW — 16 August 2026, 16:44, three passed
//
//   a folder of repositories is open
//     3 repositories: local-repo-a, local-repo-b, local-repo-c
//
//   and drills are allowed to run here
//     testing mode is on for
//     c:\Users\bmatu\Desktop\software\onlykey\onlykey-claude\workspace
//
//   and a GitHub token that still works
//     a GitHub token is held for bmatusiak (classic), scopes repo, expires
//     2026-09-13 04:14:04 UTC
//     asked of GitHub just now, not read from the last time it was checked
//
// THREE LINES ABOUT KEYS AND NOT ONE VALUE, which is the property worth checking
// in a transcript rather than promising in a comment. A login, a kind, a scope
// list and an expiry — everything needed to know whether the token is the right
// one and still good, and nothing that would let anybody use it.
//
// This is also the suite whose interesting result is the one NOT shown here.
// Everything above passes because this host is set up; on a fresh one each of
// these is a "needs you" carrying the sentence that says where to go. That path
// is proven against the harness rather than by taking somebody's token away.
