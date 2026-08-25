'use strict'

// the order — a change goes out and comes back
//
// The end of the flow, and the part that used to stop at a browser: a cut with
// something on it becomes a line, a line becomes one pull request per
// repository, the pull requests are merged as one act, the forks are pulled up
// to their parents, and this host follows. Nine steps, one series, because every
// one of them only means anything after the one above it.
//
// ONE TEST RATHER THAN TWO, and that is a fact about the shape rather than a
// preference: what a series hands along lives in the file, so "open it" and
// "land it" cannot be separate files without the second one having to go looking
// for what the first one made.
//
// THE COMMIT IS MADE HERE, not by a worker. In the real order a machine puts it
// there, and a drill that needed one would cost ten minutes and a runner
// switched on — which is how the last set of drills ended up deleted rather than
// run. So this proves the half either side of the worker: that a branch with
// something on it pushes, opens, lands, and comes back.
//
// IT WRITES TO GITHUB FOR REAL. A pull request wherever this workspace sends
// work — the parent when one has been picked, and the fork itself when nothing
// has — a merge on that repository's default branch, a branch on the fork and
// then not. Nothing here is mocked —
// the whole reason for it is that the interesting failures are on the other side
// of the network. Which is why it runs only while testing mode is on, for the
// workspace somebody named at the window: `prCutLand` and `branchDeleteRemote`
// both refuse from outside it.
//
// ONE FILE NAME, REUSED. Every run rewrites `drill-order.md` rather than adding
// a file of its own, so a repository that has run this fifty times carries one
// file and not fifty. The commits are history and cannot be helped; the clutter
// can.

const { it, cleanup } = require('../../harness')
const { scratch, aLine } = require('../../helpers')

// The repository the change is made in. One rather than all three: a change that
// spans one repository is the ordinary case, and it makes the checks about what
// carried and what did not sharper.
const ONE = 'local-repo-a'

// WHAT IT SAW LAST TIME is recorded at the bottom of this file, and it matters
// more here than anywhere else in this folder: these nine steps talk to GitHub,
// so the transcript is the only place the real answers — a pull request number,
// how the fork was brought up, what came back — are written down where they can
// be read without opening another one.

it('a cut is made, and a change is committed on it', async ({ okc, assert, state, log }) => {
  // LEVEL WITH THE FORK BEFORE CUTTING ANYTHING, which is what a person does
  // without thinking about it and what this did not do at all.
  //
  // THE DRILL COLLIDED WITH ITS OWN LAST RUN. Every run rewrites the same file,
  // so a run that merged and then stopped before its final step left this host
  // one commit behind: the next run cut from the stale default, wrote
  // `drill-order.md` again, and GitHub answered "Pull Request has merge
  // conflicts" — about a conflict this file had created for itself. Twice.
  //
  // It only fast-forwards, so it cannot lose anything here; and it is the same
  // action the last step of this series uses to follow the change home.
  const level = await okc('repoSync')
  log(`brought this host level with its remotes first — ${level.note || 'nothing to do'}`)

  state.line = await aLine(okc, assert)
  state.branch = scratch('sent-out')
  await okc('branchCreate', { branch: state.branch, reason: 'a drill proving a change can be sent out and land', group: state.line })

  const made = await okc('drillCommit', {
    branch: state.branch,
    repo: ONE,
    file: 'drill-order.md',
    text: `A drill proving the order of the work, ${new Date().toISOString()}.\n`,
    message: 'drill: a change to send out'
  })
  assert.equal(made.commits.length, 1, 'The commit did not land in exactly the repository it was asked for')
  state.commit = made.commits[0].commit
  log(`cut "${state.branch}" from line "${state.line}", and committed ${String(state.commit).slice(0, 8)} in ${ONE}`)
})

it('what the cut carries can be read, on the cut', async ({ okc, assert, state, log }) => {
  // THE STEP A PERSON DOES NOT SKIP: reading what is actually on the branch
  // before sending it anywhere. A pull request opened without that is the one
  // nobody reviews.
  //
  // ASKED OF THE BRANCH, and this test was written the other way round first —
  // `changeRead`, which is the Changes tab — and it FAILED, saying "there is no
  // line called drill/sent-out". That is the order being enforced rather than
  // described: a comparison is between two LINES, and a cut is not one yet. The
  // reading that exists at this point is the artifact on the branch, which is
  // the Branches Cut tab. The failure was the useful part.
  // `branchArtifacts` RATHER THAN `branchArtifact`, and the git half of it.
  //
  // The app being ported from had two shapes of this question and this drill
  // asked the narrower one — `artifact.read`, straight out. Here there is one
  // action and it answers the whole of what a branch carries: what git says, the
  // tasks that named it, and what the worker remembers. The reading this check is
  // about is the first of those.
  //
  // ASKED FRESH, which is the part that matters at this point in the file. A
  // cached answer would be from before the commit above, and the check would be
  // about the branch as it was rather than as it is.
  const art = (await okc('branchArtifacts', { branch: state.branch })).git || {}
  const one = (art.repos || []).find(r => r.repo === ONE)
  assert.ok(one, `Nothing was reported about ${ONE} at all`)
  assert.equal(one.ahead, 1, `The cut should carry exactly the one commit that was made on it, and carries ${one.ahead}`)
  assert.ok((one.files || []).some(f => (f.path || f.file || f) === 'drill-order.md' || String(f.path || f.file || f).endsWith('drill-order.md')),
    'The file that was committed is not among the files the cut carries')
  log(`${ONE} is ${one.ahead} ahead, carrying ${(one.files || []).map(f => f.path || f.file || f).join(', ')}`)
})

it('a cut becomes a line before it leaves', async ({ okc, assert, state, log }) => {
  // A pull request is cut between two LINES, so the branch has to become one
  // first. That is the order this app enforces, and the reason `prCutMake` asks
  // for lines rather than for branches.
  await okc('branchAsLine', { branch: state.branch })
  state.promoted = true
  const after = (await okc('gitBranches')).branches.find(b => b.name === state.branch)
  assert.ok(after.protected, 'A line is protected, and this one is not')

  // AND IT CANNOT BE RETIRED YET, which is the guard that makes retiring safe
  // enough to offer at all. A line is retired when its change has LANDED;
  // retiring one now would delete branches carrying a change that has not even
  // been sent, and there would be nothing to say it had ever existed.
  //
  // ASKED HERE RATHER THAN IN A REFUSALS DRILL because the state it needs — a
  // real line, promoted a moment ago, with nothing sent from it — is one this
  // series is standing in the middle of. A refusal drill would have to build
  // the whole order to ask it.
  const early = await assert.refuses(
    () => okc('lineRetire', { name: state.branch }),
    'has not landed|never been sent',
    'A line was retired before its change had gone anywhere')
  log(`"${state.branch}" is a line now, protected: ${!!after.protected} — and retiring it is refused: ${early}`)
})

it('and now it can be compared with the line it was cut from', async ({ okc, assert, state, log }) => {
  // The Changes tab, which is a comparison between lines and so only becomes
  // possible at this point in the order. The same fact from the other side: what
  // the branch carries, said as what one line has that another does not.
  // `compare`, WHICH IS WHAT THIS APP CALLS IT, and the two names are the same
  // question asked from opposite ends: `changeRead` took the SOURCE and the
  // target, this takes the BASE and the head. So the cut is the head and the line
  // it was cut from is the base — reading it the other way round compares
  // backwards and reports nothing carried, which looks exactly like a commit
  // that never landed.
  const change = await okc('compare', { base: state.line, head: state.branch })

  // AND `carrying` IS THE ANSWER RATHER THAN SOMETHING DERIVED FROM THE ROWS.
  // This used to filter on `ahead > 0`; there is no `ahead` here, and a filter on
  // a field that does not exist keeps nothing and reports that the change is
  // missing. Asking for the app's own answer cannot go wrong that way.
  const carrying = change.carrying || []
  assert.equal(carrying.length, 1, `The change should be one commit in one repository, and ${carrying.length} repositories carry something`)
  assert.equal(carrying[0], ONE, `The change is in ${carrying[0]}, which is not where it was made`)
  log(`comparing "${state.branch}" with "${state.line}": ${carrying.join(', ')} carries it — the other repositories carry nothing`)
})

it('and it leaves as one pull request, from the repository that carries something', async ({ okc, assert, state, log }) => {
  const cut = await okc('prCutMake', {
    source: state.branch,
    target: state.line,
    title: 'drill: proving the order end to end',
    body: 'Opened by a drill. It is merged, synced and cleaned up by the same drill — see dashboard/test/suites/00-the-order.'
  })
  state.cut = true
  const opened = (cut.pulls || []).filter(p => p.opened)
  // The cut spans every repository; the CHANGE spans one. A pull request on a
  // repository carrying nothing is noise a reviewer has to dismiss, and this is
  // what says the app does not open one.
  assert.equal(opened.length, 1, `Expected one pull request, got ${opened.length}: ${(cut.pulls || []).map(p => p.why || 'opened').join('; ')}`)
  assert.ok(opened[0].number, 'A pull request was reported as opened without a number')
  state.pull = opened[0]
  log(`opened #${opened[0].number} on ${opened[0].repo || ONE}: ${opened[0].url || '(no url reported)'}`)
  for (const p of (cut.pulls || []).filter(p => !p.opened)) log(`${p.repo}: none opened — ${p.why}`)
})

it('the pull requests are merged as one act, and merged as merges', async ({ okc, assert, state, log }) => {
  // WHERE THE HUMAN GATE IS, if there is one. This is refused outright from the
  // command line unless testing mode is on — see prCutLand — so a run that gets
  // here has already been permitted by somebody at the window.
  const landed = await okc('prCutLand', { source: state.branch, target: state.line })
  const merged = (landed.merged || []).filter(m => m.merged)
  assert.equal(merged.length, 1, `The cut did not land: ${(landed.merged || []).map(m => m.why || 'merged').join('; ')}`)
  state.landed = true

  // AND HOW IT MERGED, WHICH THIS DID NOT ASK AND SHOULD HAVE.
  //
  // "It merged" is the same sentence for a merge and for a squash, and for a
  // while `prCutLand` defaulted to squash — so five runs of this drill passed
  // while landing five flat commits directly on local-repo-a's master, under the
  // human's name, indistinguishable in the graph from somebody pushing to a
  // protected branch. The drill asserted the merge and was silent about the only
  // part that had gone wrong.
  //
  // A MERGE IS THE SHAPE THE WHOLE FLOW IS FOR. The branch went out, a pull
  // request was opened on it, and the merge commit is the record that both
  // happened — "Merge pull request #N from <fork>/<branch>", with the work
  // hanging off it. A squash keeps the change and throws away the evidence of
  // how it arrived, which for a drill about the ORDER of the work is the one
  // thing it exists to prove.
  assert.equal(merged[0].how, 'merge',
    `It landed by "${merged[0].how}". A squash or a rebase puts a flat commit straight on the default branch and `
    + 'loses the pull request it came through — which is what this drill is proving did not happen')
  assert.ok(merged[0].sha, 'A pull request was reported as merged without the commit it produced')
  state.mergeSha = merged[0].sha

  const at = await okc('prCutState', { source: state.branch, target: state.line })
  assert.ok(at.landed, 'GitHub does not agree that every pull request in the cut is merged')
  log(`merged ${merged.map(m => `#${m.number} in ${m.repo} by "${m.how}" as ${String(m.sha).slice(0, 8)}`).join(', ')}`
    + ', and GitHub agrees the cut has landed')
})

it('the fork is behind its parent, and syncing pulls it up', async ({ okc, assert, state, log }) => {
  // The answer to "I merged the PR and now my branch and master are off". The
  // parent moved when the change landed and the fork did not, so everything cut
  // from the fork afterwards would start from something out of date.
  //
  // ONLY WHEN WORK ACTUALLY GOES TO THE PARENT, and that is a choice somebody
  // makes per repository rather than a fact about forks.
  //
  // Unset means "your own remote", so the pull request above was opened against
  // the FORK and merged into the fork's own default branch. The parent never
  // moved, `merge-upstream` correctly answers "none", and asserting that the sync
  // did something would be asserting that this host is configured a particular
  // way. It failed exactly that way here — a real merge, a correct "none", and a
  // red check about neither.
  const row = ((await okc('repositories')).repos || []).find(r => r.repo === ONE) || {}
  const sends = row.target || {}

  assert.needs(sends.chosen && sends.on !== sends.self,
    `work from ${ONE} goes to ${sends.on || 'its own remote'}, which is this repository itself — so the merge above landed on the fork and its parent did not move. There is nothing upstream to pull up. Point it at the fork it was forked from (Repositories -> Repos -> Send work here) to exercise this`)

  const up = await okc('repoForkSync', { repo: ONE })
  const one = (up.repos || [])[0]
  assert.ok(one, 'Nothing was reported about the fork at all')
  assert.notEqual(one.how, 'none', 'The fork was already level with its parent, which cannot be true just after a merge — the sync did nothing')
  state.synced = true
  log(`${one.repo || ONE}: the fork was brought up to its parent by "${one.how}"${one.note ? ` — ${one.note}` : ''}`)
})

it('and this host follows, with the change on its default branch', async ({ okc, assert, state, log }) => {
  // WHERE THIS HOST'S DEFAULT LINE IS BEFORE IT FOLLOWS, so "it moved" is a
  // measurement rather than a hope.
  const before = ((await okc('repositories')).repos || []).find(r => r.repo === ONE) || {}

  await okc('repoSync', {})
  // Read from the repositories rather than from what the sync REPORTED. "It said
  // it moved" and "the change is here" are different claims, and only the second
  // one is what somebody wanted.
  //
  // Asked as a comparison rather than by looking for the commit: after a squash
  // or a rebase the sha on the default branch is not the sha that was pushed,
  // and a check that looked for the sha would fail on a merge method somebody is
  // entitled to choose. What matters is that the branch carries nothing the
  // default line does not already have.
  // MEASURED AS THE DEFAULT LINE MOVING, not as the branch carrying nothing.
  //
  // THIS ASKED `compare` AND WAS WRONG ABOUT A MERGE THAT WORKED. The comment
  // above says the point exactly — after a squash or a rebase the sha on the
  // default branch is not the sha that was pushed — and then it asked a question
  // that cannot survive either. `compare` diffs `base...head`, three dots, which
  // is against the MERGE BASE: squashing does not move that, so the branch goes on
  // "carrying" its change for ever, and this reported that a change which had
  // landed had not come back. The repository said `drill: a change to send out
  // (#7)` on its default branch at the time.
  //
  // THREE DOTS IS RIGHT FOR THE PANE and wrong for this claim. It answers "what
  // does this branch add", which is what somebody reviewing wants, and it is
  // deliberately stable while the base moves underneath.
  //
  // SO THE CLAIM IS ASKED OF THE THING THAT ACTUALLY HAD TO HAPPEN: this host's
  // default line moved. Together with the step above — GitHub agreeing every pull
  // request in the cut is merged — that is the change being home, and neither
  // half depends on which merge button somebody pressed.
  const after = ((await okc('repositories')).repos || []).find(r => r.repo === ONE) || {}

  assert.ok(after.head, `${ONE} does not report where its default branch is`)
  assert.notEqual(after.head, before.head,
    `${ONE}'s default branch is still at ${String(before.head).slice(0, 8)} after syncing, so the change that landed on the fork has not reached this host`)

  // AND THE COMMIT THAT ARRIVED IS THE ONE THAT WAS MADE, which is the claim the
  // paragraphs above talked themselves out of.
  //
  // Everything from "after a squash the sha is not the sha that was pushed"
  // onwards is true, and it was reasoning about a merge method this app had
  // chosen for itself and nobody had asked for. Once the cut lands as a MERGE —
  // which the step above now holds it to — the commit made at the top of this
  // file is on the default branch, by its own sha, and the strongest available
  // check is simply to look for it.
  //
  // `gitLog` DROPS MERGES (`--no-merges`), so what comes back is the work rather
  // than the commit that carried it in. One entry, and it is ours.
  const arrived = (await okc('gitLog', { repo: ONE, base: before.head, head: after.head })).commits || []
  assert.ok(arrived.some(c => String(state.commit).startsWith(c.sha)),
    `${ONE}'s default branch moved, but the commit this drill made (${String(state.commit).slice(0, 8)}) is not among `
    + `what arrived: ${arrived.map(c => `${c.sha} ${c.subject}`).join('; ') || 'nothing'}. A flat commit with a new sha `
    + 'is what a squash leaves behind')

  log(`pulled: ${ONE} moved from ${String(before.head).slice(0, 8)} to ${String(after.head).slice(0, 8)}, `
    + `carrying ${String(state.commit).slice(0, 8)} itself — the change is home, and it is the same commit`)
})

it('and the branch it came from is taken off the fork', async ({ okc, assert, state, log }) => {
  // The button GitHub offers on a merged pull request. A fork that keeps every
  // branch it has ever merged is a list nobody can read, and the branches that
  // matter are lost among the ones that are already in master.
  const gone = await okc('branchDeleteRemote', { branch: state.branch, repo: ONE })
  assert.ok((gone.repos || []).some(r => r.gone), `The branch is still on the fork: ${gone.note}`)
  state.droppedRemote = true
  log(`taken off the fork: ${(gone.repos || []).filter(r => r.gone).map(r => r.repo).join(', ')}`)
})

it('and the line it became is retired, because its change is in', async ({ okc, assert, state, log }) => {
  // THE LAST STEP OF THE ORDER, AND THE ONE THAT DID NOT EXIST. This drill used
  // to end by calling `lineForget` and `branchDelete` by hand — which tidied up
  // after ITSELF and proved nothing about what happens to real work.
  //
  // AND REAL WORK WAS NOT TIDIED UP. Six lines in this workspace, one of them a
  // baseline; four of the other five had LANDED — merged weeks earlier, still
  // named, still protecting their branches. Promoting a cut is one-way, so every
  // change that completes costs the workspace one branch cut for ever, and the
  // list of places work can go had shrunk to two.
  //
  // SO THE DRILL DOES WHAT A PERSON WOULD, through the door a person presses.
  // If `lineRetire` ever stops working, this goes red — rather than the drill
  // quietly cleaning up around it and the silting-up going on unmeasured.
  const done = await okc('lineRetire', { name: state.branch, branches: true })
  state.promoted = false
  assert.equal(done.retired, state.branch, 'It reported retiring something else')
  assert.ok((done.branches || []).length, `The line was retired and its branches were left: ${done.note}`)
  assert.equal((done.failed || []).length, 0, `Some branches could not be deleted: ${(done.failed || []).join('; ')}`)
  state.branch = null

  // AND IT IS GONE FROM THE LIST, which is the whole point — asked of the app
  // rather than assumed from what the call said it did.
  const left = (await okc('lines')).lines || []
  assert.ok(!left.some(l => l.name === done.retired), 'It said it retired the line and the line is still listed')

  const swept = await okc('drillSweep', {})
  assert.equal(swept.total, 0, `The order ran and left something behind: ${JSON.stringify(swept.branches)} ${JSON.stringify(swept.remote)}`)
  log(`retired "${done.retired}" — it landed in ${done.landedIn}, ${(done.branches || []).join(', ')} deleted, `
    + `${left.length} line(s) left, and a sweep found ${swept.total} things left by drills`)
})

cleanup(async ({ okc, state }) => {
  // Only what the series did not get to. Every step above undoes itself when it
  // reaches the end; this is for the run that stopped in the middle, which is
  // the run that leaves an open pull request on somebody's repository.
  if (state.cut && !state.landed) {
    await okc('prCutUpdate', { source: state.branch, target: state.line, state: 'closed' }).catch(() => {})
    await okc('prCutForget', { source: state.branch, target: state.line }).catch(() => {})
  }
  if (state.promoted) await okc('lineForget', { name: state.branch }).catch(() => {})
  if (state.branch) {
    await okc('branchDelete', { branch: state.branch, force: true }).catch(() => {})
    if (!state.droppedRemote) await okc('branchDeleteRemote', { branch: state.branch, repo: ONE }).catch(() => {})
  }
})

// WHAT IT SAW — 16 August 2026, 14:21, all ten passed
//
//   a cut is made, and a change is committed on it
//     cut "drill/sent-out-142125" from line "default", and committed 90a88abc in
//     local-repo-a
//
//   what the cut carries can be read, on the cut
//     local-repo-a is 1 ahead, carrying drill-order.md
//
//   a cut becomes a line before it leaves
//     "drill/sent-out-142125" is a line now, protected: true
//
//   and now it can be compared with the line it was cut from
//     comparing "drill/sent-out-142125" with "default": local-repo-a +1 — the
//     other repositories carry nothing
//
//   and it leaves as one pull request, from the repository that carries something
//     opened #8 on local-repo-a: https://github.com/bmatusiak/local-repo-a/pull/8
//
//   the pull requests are merged as one act
//     merged #8 in local-repo-a, and GitHub agrees the cut has landed
//
//   the fork is behind its parent, and syncing pulls it up
//     local-repo-a: the fork was brought up to its parent by "fast-forward"
//
//   and this host follows, with the change on its default branch
//     pulled, and "drill/sent-out-142125" now carries nothing that "default" does
//     not already have — the change is home
//
//   and the branch it came from is taken off the fork
//     taken off the fork: local-repo-a
//
//   and nothing is left behind here
//     the line was forgotten, the branch deleted, and a sweep found 0 things left
//     by drills
//
// A REAL PULL REQUEST NUMBER AND A REAL URL, which is the whole difference
// between this drill and a description of it. #8 was opened and merged on
// github.com/bmatusiak/local-repo-a in the seconds that transcript was written,
// and anybody can go and look at it — that is what "nothing here is mocked"
// means, said as evidence rather than as a claim in a comment.
//
// "FAST-FORWARD" IS THE ANSWER TO A QUESTION PEOPLE ASK. Syncing a fork is not a
// merge commit and not a force push when the fork has nothing of its own: the
// parent moved, the fork catches up, and the word for that is the one GitHub's
// own Sync fork button uses. A run that ever reports something else here is a
// fork that has diverged, which is worth knowing about before the next cut is
// made from it.
//
// ONE COUNT WORTH KEEPING AN EYE ON: three repositories were cut and exactly one
// pull request opened, because only one carried anything. A run that reports two
// or three has started opening pull requests on repositories with nothing in
// them, which is noise a reviewer has to dismiss one at a time.
