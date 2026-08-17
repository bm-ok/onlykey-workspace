'use strict'

// reading a long list — issues and pull requests, a page at a time
//
// A supervisor decides what to do next mostly by reading what is being ASKED of
// a repository. Everything else in this app starts with somebody writing a task;
// an issue is work that turned up.
//
// A HUNDRED OF FIVE THOUSAND IS NOT A SHORT LIST, IT IS A WRONG ONE. The
// overview shows what the last "Ask GitHub" gathered, which is the first hundred
// and says nothing about being the first hundred. Anything deciding from that is
// deciding from the first page of a list it does not know is longer — which is
// the failure this pair of actions exists to prevent, and the only thing here
// worth checking.
//
// TWO KINDS OF PAGING, AND THAT IS GITHUB'S DOING, not a choice. Pull requests
// still answer with numbered pages and a `last`, so "page 3 of 370" is sayable.
// Big issue trackers have moved to CURSOR paging: the answer carries a `next`
// with an opaque `after=` and no `last` at all, so there is no page count to
// report and a walk has no numbers. Both are checked, because a caller that
// assumes either one is a caller that stops early on the other.
//
// IT ASKS GITHUB, so it needs this host's token and it costs a few seconds. It
// reads and never writes.

const { it, requires } = require('../../../tasks/harness')

requires('what this host has')

// A TRACKER BIG ENOUGH TO PROVE THE POINT, and a public one so this needs no
// permission of its own. anthropics/claude-code has over five thousand open
// issues and several hundred open pull requests — the workspace's own
// repositories have nearly none, so paging against them would pass without ever
// turning a page.
const BUSY = 'anthropics/claude-code'

it('a repository with thousands of issues comes back one page at a time', async ({ okc, assert, state, log }) => {
  const first = await okc('issues', { on: BUSY, perPage: 3 })
  assert.ok(Array.isArray(first.issues), `it did not answer with a list of issues: ${JSON.stringify(first).slice(0, 200)}`)
  assert.ok(first.issues.length <= 3, `asked for 3 and got ${first.issues.length}`)
  assert.ok(first.more === true, `${BUSY} has thousands of open issues and this says there are no more pages — which is what a truncated list looks like`)

  // NOT A PULL REQUEST AMONG THEM. GitHub's issues endpoint returns pull
  // requests too — a pull request IS an issue there — so an unfiltered list
  // double-counts every one of them.
  for (const i of first.issues) {
    assert.ok(!/\/pull\//.test(String(i.url || '')), `a pull request came back in the issue list: ${i.url}`)
  }

  state.after = first.nextAfter
  state.page1 = first.issues.map(i => i.number)
  log(`${BUSY}: ${first.issues.length} issues on the first page, and ${first.more ? 'there is more' : 'that is all'}`)
  log(first.note)
})

it('and the next page is a different page', async ({ okc, assert, state, log }) => {
  // THE CHECK THAT CATCHES THE REAL FAULT. Paging that quietly ignores what it
  // was given answers with the first page for ever — and a caller walking it
  // sees a list that never ends and never changes, or stops at what it thinks is
  // the end. Compared by issue number, which is the one thing that cannot repeat.
  assert.needs(state.after, 'the first page carried no cursor, so there is nothing to walk')

  const second = await okc('issues', { on: BUSY, perPage: 3, after: state.after })
  const numbers = second.issues.map(i => i.number)
  assert.ok(numbers.length, 'the second page came back empty')
  for (const n of numbers) {
    assert.ok(!state.page1.includes(n), `issue #${n} is on both pages, so the cursor was ignored and this is the first page again`)
  }

  // AND IT DOES NOT INVENT A PAGE NUMBER. A cursor walk has none: GitHub sends
  // no `last`, so "page 2 of 1" was what the first version of this said — a
  // sentence wrong twice. Null is the honest answer and the note says so.
  assert.equal(second.page, null, `a page fetched by cursor reported itself as page ${second.page}, and a cursor walk has no page numbers`)
  assert.ok(!/page \d+ of/i.test(String(second.note || '')), `the note claims a page count GitHub did not give: "${second.note}"`)
  log(`the next page is ${numbers.join(', ')} — none of ${state.page1.join(', ')}`)
})

it('and pull requests page the other way, with a count', async ({ okc, assert, log }) => {
  // THE SAME PROBLEM, THE OTHER LIST, and GitHub still numbers this one. Which
  // means the count IS sayable here — and a caller that assumed cursors would
  // never find it, exactly as a caller that assumes numbers stops early on the
  // issues above.
  const first = await okc('pulls', { on: BUSY, perPage: 2 })
  assert.ok(Array.isArray(first.pulls), `it did not answer with a list of pull requests: ${JSON.stringify(first).slice(0, 200)}`)
  assert.ok(first.more === true, `${BUSY} has hundreds of open pull requests and this says there are no more pages`)
  assert.ok(first.pages > 1, `it reports ${first.pages} page(s) for a repository with hundreds of open pull requests`)
  assert.ok(/page 1 of/i.test(String(first.note || '')), `the note does not say which page of how many: "${first.note}"`)
  log(`${BUSY}: ${first.pulls.length} per page, ${first.pages} pages of open pull requests`)
  log(first.note)
})

it('and a repository in this workspace answers about its parent', async ({ okc, assert, log }) => {
  // WHERE THE CONVERSATION IS. Every repository here is a fork, and a fork's own
  // tracker is usually empty and usually disabled — so asking about one by its
  // workspace name has to answer about the repository a pull request would go
  // to, or it answers "no issues" about a project with plenty.
  // `repos`, not `repositories`. The action is called one and answers with the
  // other, and reading the wrong key gives an empty list — which reports itself
  // as "this workspace holds no repositories" and looks exactly like a quiet
  // host rather than a drill asking the wrong question.
  const repos = (await okc('repositories')).repos || []
  const one = repos[0]
  assert.needs(one, 'this workspace holds no repositories')

  const said = await okc('issues', { repo: one.repo, perPage: 3 })
  assert.ok(said.on && said.on.includes('/'), `it did not say which repository it read: ${JSON.stringify(said).slice(0, 200)}`)
  assert.ok(Array.isArray(said.issues), 'it did not answer with a list')
  log(`"${one.repo}" reads its issues from ${said.on} — ${said.issues.length} on the first page`)
})

// ---- WHAT IT SAW ----------------------------------------------------------
//
// 17 August 2026, against anthropics/claude-code and this workspace. Four
// checks, eight seconds, all reads.
//
//     anthropics/claude-code: 3 issues on the first page, and there is more
//     Page 1, and there is more. GitHub does not say how many pages this
//     repository has — ask again with after "Y3Vyc29yOnYyOpLPAAABoA1TMRjP..."
//     for the next 3, and keep going until "more" is false.
//     PASS a repository with thousands of issues comes back one page at a time
//
//     the next page is 87228, 87227, 87226 — none of 87231, 87230, 87229
//     PASS and the next page is a different page
//
//     anthropics/claude-code: 2 per page, 370 pages of open pull requests
//     Page 1 of 370 — ask again with page 2 for the next 2.
//     PASS and pull requests page the other way, with a count
//
//     "local-repo-a" reads its issues from bmatusiak/local-repo-a — 0 on the
//     first page
//     PASS and a repository in this workspace answers about its parent
//
// TWO KINDS OF PAGING IN ONE REPOSITORY, which is the thing worth knowing:
// 5,000+ issues answer with a cursor and no page count, and 740 pull requests
// answer with numbered pages and a last. Same host, same token, same minute.
//
// THE FIRST VERSION SAID "Page 1 of 1" BESIDE A NEXT PAGE — a sentence wrong
// twice — because it assumed a `last` link that big trackers no longer send. It
// reports no count when GitHub gives none, and no page number at all on a cursor
// walk, since a number that is true about the request and false about the answer
// is worse than nothing.
//
// The last check reported "this workspace holds no repositories" on its first
// run: the action is called `repositories` and answers with `repos`, and reading
// the wrong key looked exactly like a quiet host.
