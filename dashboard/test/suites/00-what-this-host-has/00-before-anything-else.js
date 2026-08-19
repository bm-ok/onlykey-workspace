'use strict'

// what this host has — the doors that a person opens
//
// The first suite, and the only one whose purpose is to stop the others. See the
// README beside this file for why it exists and why it never reads a value.

// WHAT THE KIT MARKS A MACHINE WITH WHEN IT KEEPS IT BACK, so that cooling gives
// back exactly what warming took and nothing else. See the check below and
// suite 11.
const HELD = 'kit-held'

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

it('and every machine that is not the kit\'s is kept back while it runs', async ({ okc, assert, log }) => {
  // THE KIT QUEUES REAL WORK, AND THE QUEUE TAKES WHATEVER IS FREE.
  //
  // A task with no tag takes any free machine — correct, and it means a drill can
  // reach the operator's own runners, bring one up, and give it back rolled to
  // its base snapshot. It has happened twice: once when a drill borrowed by hand,
  // and once when the supervisor queued an untagged task of its own.
  //
  // Tagging every drill's work would fix the first and not the second: work the
  // SUPERVISOR writes is not the kit's to tag. So the fleet is held instead —
  // while the kit runs, only machines tagged "test" are available to the queue,
  // whoever asks it for one.
  //
  // THE EXISTING LEVER, NOT A NEW ONE. "Keep it back from tasks" is the button a
  // person already has for exactly this wish, and it applies to every caller
  // rather than to whichever one somebody thought of. A second mechanism for one
  // more kind of asker is how two of them come to disagree.
  //
  // IT REMEMBERS WHAT IT TOOK, WITH A TAG. A machine already kept back is left
  // alone and never marked — so cooling gives back exactly the machines this kit
  // held, and a machine somebody switched off on purpose stays off. Guessing from
  // "kept back and not tagged test" would re-enable that one on the way out,
  // which is the sort of tidying-up nobody asked for.
  const machines = (await okc('vmList')).vms || []
  const held = []
  const already = []

  for (const m of machines) {
    if (m.supervisor) continue                       // never in the queue's reach anyway
    if ((m.tags || []).includes(HELD)) continue      // this kit already holds it
    if ((m.tags || []).includes('test')) continue    // the kit's own, and the point of the exercise
    if (m.forTasks === false) { already.push(m.name); continue }

    await okc('vmForTasks', { name: m.name, enabled: false })
    await okc('vmTags', { name: m.name, tags: [...(m.tags || []), HELD] })
    held.push(m.name)
  }

  // AND IT IS TRUE OF THE POOLS, not merely written down: the queue is what
  // decides, and this is the queue's own answer.
  // ASKED OF THE MACHINE, NOT OF THE POOL IT APPEARS IN. A pool is a ROLE now --
  // worker, judge -- and a machine may carry both, so the kit's own kit-1 shows
  // up twice, once under each, with neither pool named "test". Filtering on the
  // pool's tag therefore reported the kit's own machines as somebody else's and
  // failed a check that was doing its job.
  //
  // What this is actually about is whose machine it is, and that is a property
  // of the machine: it carries the "test" tag or it does not.
  const ours = new Set(machines.filter(m => (m.tags || []).includes('test')).map(m => m.name))
  const pools = await okc('pools')
  const loose = (pools.pools || [])
    .flatMap(p => p.machines.map(x => ({ ...x, tag: p.tag })))
    .filter(x => x.free && !ours.has(x.name))
  assert.ok(!loose.length,
    `${loose.map(x => `${x.name} (${x.tag})`).join(', ')} are still free to the queue. While the kit runs, only machines tagged "test" may be taken — a drill or a supervisor queuing untagged work would otherwise reach somebody's working machine`)

  log(held.length ? `kept back for the run: ${held.join(', ')}` : 'nothing needed keeping back')
  if (already.length) log(`already kept back by somebody, and left that way: ${already.join(', ')}`)
  log('only the "test" pool is available to the queue until the host is cooled down')
})

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
