'use strict'

// Where the work lives, and the lines cut across the repositories.
//
// Part of the window. See ui/load.js for the order these are read in and why
// the order matters.

// ---- branches ----------------------------------------------------------
//
// A branch is the unit of work here: it is what a task delivers, what a machine
// is set up on, and what a verdict is about. THREE PLACES KNEW THAT AND NONE OF
// THEM MET -- the repositories know a name exists, the board knows a task claimed
// one, the registry knows one is checked out on a machine. So a branch belonging
// to a task that was thrown away looked exactly like one somebody made by hand,
// and the difference is the whole of what deleting it costs.
//
// The one number that matters is how far ahead of the default it is. Nothing
// ahead means the name is all there is and sweeping it up loses nothing;
// anything ahead means work exists here and nowhere else.

// There was an "ours" filter here -- protected, or claimed, or held, or
// orphaned -- because a workspace accumulates names and a list showing all of
// them equally was the confusion this tab exists to remove.
//
// It is gone because the question it answered is now answered properly. "Ours"
// was a guess at which branches this system made; `cut` is the RECORD of it,
// written when the branch was cut. Every row in this pane is one by definition,
// so a filter for them would hide nothing and a checkbox offering it would be a
// control with no off state worth having.
//
// It would also have been actively wrong here: your cuts are mostly "spare" --
// no task, no machine, nothing ahead -- and that filter hid exactly those.

// Which branch the other two columns are about. Remembered, like the machine
// selection, and reconciled against what exists on every draw -- a branch can be
// deleted between one window and the next, and coming back to a name that is
// gone is the same stranded panel as never having chosen.
let pickedBranch = been.get('branch', null)

// Which question is being asked about branches. Remembered like the main tabs,
// and for the same reason: coming back to a window should find it where it was
// left rather than at the beginning.
let branchPane = been.get('branch-pane', 'overview')

// Which two lines are being compared, what is being read about them, and which
// file. Remembered, because reading a change is not something anybody finishes
// in one sitting, and coming back to a blank pane is how a review gets started
// again from the top. Declared here rather than beside the functions that use
// them, because those sit above `been`.
let changeFrom = been.get('change-from', null)
let changeInto = been.get('change-into', null)
let changeLook = been.get('change-look', 'commits')
let changeMode = been.get('change-mode', 'sides')
let changePicked = null
let changeSeen = null
// The last comparison and plan, and what they were about. See paintChanges: this
// pane is the most expensive thing in the window and must not be asked on a
// timer.
let changeAnswer = null
// Which group the Baselines pane is describing.
let pickedGroup = been.get('group', null)

// SCOPED TO THE ONES THAT NAME A PANE. `.subtab` is a look, and the Merge pane
// has two of its own inside it for commits and files — caught by a document-wide
// selector, those would set `branchPane` to undefined and blank the tab. The
// styling is shared on purpose; what distinguishes them is what they carry.
document.querySelectorAll('#view-branches .subtab[data-pane]').forEach(b => {
  b.onclick = () => {
    branchPane = b.dataset.pane
    been.set('branch-pane', branchPane)
    document.querySelectorAll('#view-branches .subtab[data-pane]').forEach(x => x.classList.toggle('active', x === b))
    document.querySelectorAll('#view-branches .pane').forEach(p => p.classList.toggle('active', p.id === `pane-${branchPane}`))
    // Painted at once rather than on the next tick, or switching to a pane that
    // has never been drawn shows an empty one for up to three seconds.
    paintBranches()
  }
})

// Applied before anything is drawn, so the remembered pane and the markup agree.
;(() => {
  const tab = document.querySelector(`#view-branches .subtab[data-pane="${branchPane}"]`)
  if (!tab) { branchPane = 'overview'; return }
  document.querySelectorAll('#view-branches .subtab[data-pane]').forEach(x => x.classList.toggle('active', x === tab))
  document.querySelectorAll('#view-branches .pane').forEach(p => p.classList.toggle('active', p.id === `pane-${branchPane}`))
})()

function paintBranches () {
  if (view !== 'branches') return
  // Said before the asking, not after: the gap this fills is the time the answer
  // takes to arrive.
  waiting('branches', { cards: 4 })
  waiting('branch-actions', { lines: 4 })
  waiting('branch-artifacts', { lines: 6 })
  paintBranchesNow()
}

// Split from the guard and the placeholders above so those happen SYNCHRONOUSLY
// on the click, and only the reading waits for a frame. A tab that yielded
// before putting its skeleton up would show the last tab's contents for two
// frames, which is a different kind of lie.
async function paintBranchesNow () {
  await settle()
  // Asked again after the wait: two frames is long enough to click another tab,
  // and answering into a panel nobody is looking at is how a stale board gets
  // painted over a fresh one.
  if (view !== 'branches') return
  api('branchBoard').then(board => {
    const find = $('branch-find').value.trim().toLowerCase()

    // CUTS ONLY, WHICH IS WHAT THIS PANE IS NOW CALLED.
    //
    // A cut and a line are the same thing except that a line is protected --
    // and this list showed both, under a heading that said "branch cuts". That
    // is where the word stopped meaning anything: half the rows were things
    // work is measured against rather than done on.
    //
    // Two tests, and both are needed. `cut` is the record this app wrote when
    // it made the branch, so a repository's own default and anything made by
    // hand are not cuts. `protected` then takes precedence over that record: a
    // branch cut here and later named into a line IS a line now, because that
    // is what naming it meant. The record is of an act that happened, not of
    // what the branch is today.
    //
    // The lines are next door under Lines, and the protected ones under
    // Protected. Nothing is hidden; it is filed.
    const cuts = board.branches.filter(b => b.cut && !b.protected)
    const rows = cuts
      // THE SELECTED ONE IS ALWAYS SHOWN, whatever the finder says. Two columns
      // describe it, and a selection you cannot see is worse than a row the
      // filter would rather hide -- the panels then look like they belong to
      // something else on screen, or to nothing.
      .filter(b => b.name === pickedBranch || !find || b.name.toLowerCase().includes(find))

    // Against every cut rather than the filtered rows: typing in the finder
    // should not silently move the selection to something else.
    if (!cuts.some(b => b.name === pickedBranch)) {
      pickedBranch = (rows[0] || cuts[0] || {}).name || null
      been.set('branch', pickedBranch)
    }

    // COUNTED OVER THE CUTS, not over the board. The chips used the board-wide
    // figures, which was right while the list was the board and became a set of
    // numbers about other panes' rows the moment it was not.
    const c = {
      all: cuts.length,
      claimed: cuts.filter(b => b.tasks.length).length,
      held: cuts.filter(b => b.heldBy).length,
      orphaned: cuts.filter(b => b.orphaned).length,
      spare: cuts.filter(b => b.spare).length
    }
    // WHAT IS NOT ON SCREEN, SAID WHERE THE COUNT IS. The chips describe the
    // whole workspace and the list is filtered, so "4 in all" above three rows
    // reads as a fault in the list rather than as a filter doing its job. It is
    // the count that has to say so, because it is the count that is disagreed
    // with -- and it is worth keeping the board-wide numbers, since "there is an
    // orphan somewhere" is exactly the thing a filtered list would hide.
    const hidden = cuts.length - rows.length

    if (changed('branches', [rows, c, hidden, pickedBranch])) {
      fill($('branch-counts'),
        chip(hidden ? `${rows.length} of ${c.all}` : `${c.all} in all`, null),
        c.claimed ? chip(`${c.claimed} claimed by a task`, 'ok') : null,
        // "Claimed by", not "checked out on": the count includes machines that
        // are switched off, and a claim outlives the machine being on.
        c.held ? chip(`${c.held} claimed by a machine`, 'ok') : null,
        c.orphaned ? chip(`${c.orphaned} orphaned`, 'bad') : null,
        c.spare ? chip(`${c.spare} spare`, 'warn') : null,
        // Actionable rather than merely honest: the thing you want on reading
        // "1 hidden" is to see it, so this is the button that does that.
        // Only the finder can hide a cut now, so this clears that rather than a
        // checkbox that no longer exists.
        hidden
          ? el('button', {
              className: 'chip warn linky-chip',
              textContent: `${hidden} hidden by the finder — show`,
              onclick: () => { $('branch-find').value = ''; forget('branches'); paintBranches() }
            })
          : null,

        // MORE THAN ONE BASELINE IN ONE WORKSPACE. Not a fault -- every
        // repository has its own default and something other than master is
        // ordinary -- but it changes what every other number on this screen
        // means, because "ahead of the default" is then measured against a
        // different branch per repository and summed into one figure.
        board.mixed
          ? chip(`${board.baselines.length} baselines`, 'bad')
          : null)

      // Said in full underneath, because a chip has room for the fact and not
      // for what follows from it.
      if (board.mixed) {
        $('branch-counts').append(el('p', { className: 'note', style: 'flex-basis:100%;margin:6px 0 0' },
          el('strong', { textContent: 'These repositories do not share a default branch. ' }),
          el('span', {
            textContent: `${board.baselines.map(p => `${p.branch} in ${p.repos.join(', ')}`).join('; ')}. ` +
              'A branch cut across all of them starts from a different branch in each, so one "commits ahead" figure is a sum of things counted from different places. Nothing is wrong with it — it is just not one number about one thing, and naming a line is what says which point they are being read at together.'
          })))
      }

      // TWO EMPTIES THAT MEAN OPPOSITE THINGS. "There are no cuts" is a state of
      // the workspace; "the finder matched none of them" is a state of this box.
      // Saying the first when the second is true sends somebody looking for a
      // fault in the wrong place.
      fill($('branches'), rows.length
        ? rows.map(branchCard)
        : el('p', { className: 'empty', textContent: cuts.length
            ? `None of the ${cuts.length} cut${cuts.length === 1 ? '' : 's'} match what you typed.`
            : 'No branch cuts. Make one with + — a cut is where work is done, and it is cut from a line.' }))
    }

    const picked = board.branches.find(b => b.name === pickedBranch) || null
    branchActions(picked)
    paintBranchArtifacts(picked)

    // Only the pane on screen. The other two read git and would be paying for
    // answers nobody is looking at, three seconds at a time.
    if (branchPane === 'baselines') paintBaselines()
    if (branchPane === 'changes') paintChanges()
    if (branchPane === 'protected') paintProtected(board)
  }).catch(oops)
}

// The branches nothing may be built on, and WHY each one is one.
//
// Three different reasons, and they are not interchangeable: a repository's own
// default is a fact about git that cannot be unmade here; a chosen baseline is a
// decision about one repository; a link in a group is a decision about a line of
// work across all of them. Collapsing them into "protected" is what made
// `master` claim to be a baseline for a repository that was counting from
// something else entirely.
// WHAT MAY NOT BE BUILT ON, AND WHETHER YOU COULD CHANGE THAT.
//
// This was a flat list of cards all saying "protected", with the reasons as rows
// of a table. Reading it, the question a person actually has is not which
// branches are protected — it is whether a particular one can be worked on, and
// if not, what would have to happen first. Those have completely different
// answers for the two kinds:
//
//   a default branch   a fact about the repository, read from git. Nothing here
//                      can unprotect it, and nothing should.
//   a link in a line   a decision somebody made by naming the line. Forgetting
//                      the line gives the branch back.
//
// So they are two sections rather than one list with a column, and each says
// what to do about it — including the one where the answer is "nothing".
function paintProtected (board) {
  if (!changed('protected', board.protected)) return

  const facts = board.protected.filter(p => p.asDefault.length)
  const chosen = board.protected.filter(p => !p.asDefault.length)

  const card = (p, kind) => el('div', { className: 'card' },
    el('div', { className: 'card-title' },
      el('span', { className: 'mono', textContent: p.branch }),
      el('span', { className: `badge ${kind === 'fact' ? 'muted' : 'warn'}`, textContent: kind === 'fact' ? 'always' : 'while it is a link' })),
    el('div', { className: 'card-sub muted', textContent: kind === 'fact'
      ? `the default branch of ${p.asDefault.join(', ')}`
      : `named in ${[...new Set(p.asGroup)].join(', ')}` }),
    // A branch can be both, and then the weaker reason is worth saying too:
    // forgetting the line will not give this one back.
    kind === 'fact' && p.asGroup && p.asGroup.length
      ? el('div', { className: 'card-sub muted', textContent: `also a link in ${[...new Set(p.asGroup)].join(', ')} — forgetting that line would not unprotect it` })
      : null)

  fill($('protected'),
    board.protected.length
      ? el('div', {},
          el('div', { className: 'carries' },
            el('div', { className: 'carries-head' },
              el('span', { textContent: 'Facts about the repositories' }),
              el('span', { className: 'muted', textContent: `${facts.length}` })),
            el('p', { className: 'note', textContent: 'Where everything lands eventually. Read from git the first time each repository was seen, and not changeable from here — a machine is refused this branch whatever else is configured.' }),
            facts.length
              ? el('div', { className: 'stack' }, ...facts.map(p => card(p, 'fact')))
              : el('p', { className: 'empty bad', textContent: 'No repository here has a default branch, which should not be possible and is worth looking at.' })),

          el('div', { className: 'carries' },
            el('div', { className: 'carries-head' },
              el('span', { textContent: 'Links in a line' }),
              el('span', { className: 'muted', textContent: `${chosen.length}` })),
            el('p', { className: 'note', textContent: 'Named in a line, so work is cut from them and merged back into them rather than built on directly. That is a decision — forget the line on the Lines tab and the branch is ordinary again.' }),
            chosen.length
              ? el('div', { className: 'stack' }, ...chosen.map(p => card(p, 'link')))
              : el('p', { className: 'empty', textContent: 'No line names a branch that is not already a default. Nothing here is protected by a decision.' })))
      : el('p', { className: 'empty bad', textContent: 'Nothing is protected, which means no repository here has a default branch — worth looking at.' }))
}

// What each repository measures work against. NOT what branches are cut
// from — cutting names its own line, which is what requiring a group did.
//
// A SEPARATE QUESTION FROM ITS DEFAULT BRANCH, which is a fact about git: what
// that repository says HEAD is. The baseline is a decision, and a repository
// whose default is `master` may perfectly well be working toward `version2`.
// They were one word here for as long as every repository answered both the same
// way, and a third repository defaulting to something else is what separated
// them.
function paintBaselines () {
  waiting('groups', { cards: 2 })
  api('repoDefaults').then(({ repos, groups, note }) => {
    if (!changed('baselines', [repos, groups])) return

    // EACH REPOSITORY'S DEFAULT BRANCH, which is the one fact about a repository
    // that still belongs here. This block used to say what each repository was
    // "counted from" — a workspace-wide pointer that no longer exists, because a
    // branch records what it was cut from and is measured against that.
    fill($('baselines-now'), repos.length
      ? el('div', { className: 'card' },
          el('div', { className: 'card-title' }, el('span', { textContent: 'Default branches' })),
          ...repos.map(r => el('div', { className: 'group-part' },
            el('span', { className: 'mono', textContent: r.repo }),
            el('span', { className: 'mono muted', textContent: r.default }))),
          el('div', { className: 'card-sub muted', textContent: 'A repository\'s own default, read from git and always protected. A branch is measured against the line it was cut from, not against these — except when it was cut before lines existed.' }))
      : el('p', { className: 'empty', textContent: 'No repositories in the workspace.' }))

    // ---- the groups -----------------------------------------------------
    // Reconciled against what exists, like every other selection here: a group
    // can be forgotten between one draw and the next, and coming back to a name
    // that is gone leaves the panel beside it stranded.
    if (!groups.some(g => g.name === pickedGroup)) {
      pickedGroup = groups.length ? (groups.find(g => g.marked) || groups[0]).name : null
      been.set('group', pickedGroup)
    }

    setText($('group-context'), groups.length ? `— ${groups.length}` : '')
    fill($('groups'), groups.length
      ? groups.map(g => el('div', {
          // `on` IS SELECTED, everywhere in this window. It was being used here
          // to mean "in use", so the group work is counted from looked selected
          // whatever you clicked — and clicking anything else changed nothing
          // visible, because the panel beside it was showing every group anyway.
          // "In use" already has a badge, which is where a fact about the group
          // belongs; the highlight is about what YOU are looking at.
          className: `card pick${g.name === pickedGroup ? ' on' : ''}${g.broken.length ? ' warn' : ''}`,
          onclick: () => { pickedGroup = g.name; been.set('group', pickedGroup); forget('baselines'); paintBaselines() }
        },
        el('div', { className: 'card-title' },
          el('span', { className: 'mono', textContent: g.name }),
          g.marked ? el('span', { className: 'badge warn', textContent: 'proposed' }) : null,
          g.broken.length ? el('span', { className: 'badge bad', textContent: 'broken' }) : null),
        el('div', { className: 'badges' },
          el('span', { className: 'muted', textContent: `${g.on.length} repositor${g.on.length === 1 ? 'y' : 'ies'}` }),
          g.missing.length ? el('span', { className: 'muted', textContent: `${g.missing.length} not named` }) : null)))
      : el('p', { className: 'empty', textContent: 'No lines yet. A line names one branch per repository, so work can be cut from a point rather than from a branch at a time.' }))

    // ONE GROUP, THE SELECTED ONE.
    //
    // This used to render every group, on the reasoning that a group is small
    // enough to show whole and there are rarely many. That was true while there
    // was exactly one — and it read as a detail panel, which is what made it
    // wrong the moment a second appeared: the list gained a selection nothing
    // responded to, and the panel beside it showed both. A panel headed "what a
    // group is", showing two groups, is answering a question nobody asked.
    const one = groups.filter(g => g.name === pickedGroup)
    fill($('group-detail'), one.length
      ? one.map(g => el('div', { className: 'carries' },
          el('div', { className: 'carries-head' },
            el('span', { textContent: g.name }),
              g.marked ? el('span', { className: 'badge warn', textContent: 'proposed' }) : null,
            g.why ? el('span', { className: 'muted', textContent: g.why }) : null),
          g.marked
            ? el('p', { className: 'note', textContent: `Proposed for landing ${ago(g.marked.at)}${g.marked.why ? ` — ${g.marked.why}` : ''}. Read it on the Merge tab.` })
            : null,
          ...g.on.map(p => el('div', { className: 'group-part' },
            el('span', { className: 'mono', textContent: p.repo }),
            el('span', { className: p.there ? 'mono' : 'mono gone', textContent: p.there ? p.branch : `${p.branch} — gone` }))),
          g.missing.length
            ? el('p', { className: 'note', textContent: `${g.missing.join(', ')} ${g.missing.length === 1 ? 'is' : 'are'} not named in this group and keep whatever they are counting from.` })
            : null,
          el('div', { className: 'row', style: 'margin-top:8px' },
            // "Measure everything from it" was here, and before that "Count
            // everything from it". It pointed the whole workspace at this line,
            // and every "N commits ahead" on the board was then counted from it.
            //
            // GONE, BECAUSE A BRANCH KNOWS ITS OWN ANSWER. What a branch is
            // measured against is what it was cut from, which has been recorded
            // on the branch since cutting had to name a line. A global pointer
            // on top of that was a second, worse answer to a question already
            // answered — and one click reinterpreted every number on the board
            // at once, for branches that had nothing to do with the line being
            // pointed at. That happened by accident within an hour of the button
            // existing, which is the clearest argument it could have made.
            // PROPOSING IT, from where the group lives. The Merge tab can take a
            // proposal back, because that is where somebody is when they decide
            // it is not ready; putting one up happens here, where you are
            // looking at what the line actually is.
            el('button', {
              className: 'btn',
              textContent: g.marked ? 'Stop proposing it' : 'Propose it for landing',
              disabled: g.broken.length > 0,
              title: g.broken.length ? g.broken.join('; ') : 'A proposed line is what the Merge tab compares',
              onclick: () => (g.marked ? unproposeGroup(g) : proposeGroup(g))
            }),
            el('button', {
              className: 'btn danger',
              textContent: 'Forget it',
              onclick: () => askToForgetGroup(g)
            }))))
      : el('p', { className: 'empty', textContent: groups.length
          ? 'Pick a line on the left.'
          : 'A line is a point the whole workspace can be read at: master today, version2 next, each one cut from the last. Naming it is what lets work be cut from it — and what protects it while it is a link.' }))
  }).catch(() => { /* the panel beside it is the one worth an error */ })
}

// Naming what everything is counted from right now.
// NAMING A LINE IS WHERE ITS BRANCHES ARE CHOSEN.
//
// This used to snapshot whatever the per-repository baselines happened to be, so
// making a group meant first setting three things one at a time somewhere else
// and then giving the result a name. Those three settings were the problem: they
// were edited individually, nothing described them together, and what a branch
// got cut from depended on all of them being right at once.
//
// So the choice moved here, to the moment it is one decision. A repository can
// also be left OUT, which is not an omission — it is how a line that never
// reached a repository says so, and it is what scopes every task cut from this
// group to the repositories the work is actually about.
function newGroup () {
  api('repoDefaults').then(({ repos }) => {
    if (!repos.length) throw new Error('There are no repositories in this workspace to name a line across.')

    return ask({
      title: 'Name a line',
      plain: [
        'A line names one branch per repository, and it is what work is cut from — because a change spans repositories, and what work is measured against is one question with one answer.',
        'Every branch in a line is protected while it is in one: work is cut from it and merged back into it, never built on directly. That is what makes chaining safe rather than a convention.',
        'Leave a repository out if this line does not reach it. A task cut from this line only ever touches the repositories named here — it is not checked out on a machine, and that machine cannot fetch it.'
      ],
      fields: [
        { name: 'name', label: 'Called', placeholder: 'the version2 line' },
        { name: 'why', label: 'What it is, if it needs saying', placeholder: 'everything since the v2 split' },
        // One per repository, defaulted to what it counts from now — so the
        // ordinary case is still "name what is already true", answered by
        // reading it rather than by it happening invisibly.
        ...repos.map(r => ({
          name: `on:${r.repo}`,
          label: r.repo,
          value: r.baseline || '',
          options: [
            ...(r.branches || []).map(b => ({
              value: b,
              label: b === r.default ? `${b} — its default` : b
            })),
            { value: '', label: '— not part of this line —' }
          ]
        }))
      ],
      confirm: 'Name it',
      onYes: async f => {
        const on = {}
        for (const r of repos) {
          const chosen = f[`on:${r.repo}`]
          if (chosen) on[r.repo] = chosen
        }
        if (!Object.keys(on).length) {
          throw new Error('A line has to reach at least one repository. Every repository is set to "not part of this line".')
        }

        const saved = await api('lineSave', { name: f.name, why: f.why, on })
        forget('baselines')
        forget('branches')
        const left = repos.filter(r => !(r.repo in on)).map(r => r.repo)
        say(`"${saved.name}" — ${saved.on.map(p => `${p.repo}:${p.branch}`).join(', ')}${left.length ? `. Not part of it: ${left.join(', ')}.` : ''}`)
        return draw()
      }
    })
  }).catch(oops)
}

// `showGroup` was here. It answered a click on a group by flashing a notice,
// which is what a list does when nothing is actually selected — the panel beside
// it showed every group regardless, so there was nothing for a click to change.

// `askToMeasureFrom` was here, with the button that opened it.

function proposeGroup (g) {
  ask({
    title: `Propose "${g.name}" for landing?`,
    plain: [
      `It says this line is finished: ${g.on.map(p => `${p.repo}:${p.branch}`).join(', ')}.`,
      'Nothing moves and nothing is protected that was not already — its branches are protected because they are named in a line. What this adds is intent, so a second person can tell a line being worked on from one being offered.',
      'It then appears on the left of the Merge tab, where it can be read against the line it would go into and landed.'
    ],
    fields: [
      { name: 'why', label: 'Why it is ready, if it needs saying', placeholder: 'the scaffolding is done' }
    ],
    confirm: 'Propose it',
    onYes: async f => {
      const r = await api('linePropose', { name: g.name, why: f.why })
      changeAnswer = null
      forget('baselines')
      forget('change')
      say(r.note)
      return draw()
    }
  })
}

function unproposeGroup (g) {
  ask({
    title: `Stop proposing "${g.name}"?`,
    plain: [
      'It goes back to being a line rather than a proposal, and leaves the Merge tab.',
      'Its branches stay protected, because they are still named in a line. Forgetting the line is what gives them back.',
      'Nothing that has already landed is undone.'
    ],
    confirm: 'Take it back',
    danger: true,
    onYes: async () => {
      const r = await api('lineWithdraw', { name: g.name })
      changeAnswer = null
      forget('baselines')
      forget('change')
      say(r.note)
      return draw()
    }
  })
}

function askToForgetGroup (g) {
  ask({
    title: `Forget the "${g.name}" line?`,
    plain: [
      'The branches are untouched. Forgetting a line is a decision about branches, not a thing the branches belong to.',
      'What it does change: those branches stop being protected by it, so work could be built directly on one.',
      // What branches cut FROM it recorded stays recorded: a branch says what it
      // started against, and forgetting the line it was cut from does not change
      // what it was cut from. So nothing on the board starts counting differently.
      'Branches already cut from it keep measuring against what they were cut from — that was written on them when they were made, and this does not touch it.',
      g.marked ? 'It is currently proposed for landing, and will leave the Merge tab.' : null
    ].filter(Boolean),
    confirm: 'Forget it',
    danger: true,
    onYes: async () => {
      await api('lineForget', { name: g.name })
      forget('baselines')
      forget('branches')
      say(`"${g.name}" forgotten. Its branches are untouched.`)
      return draw()
    }
  })
}

// Choosing one. The list is that repository's own branches, because a baseline
// has to exist there -- it is what everything else in it is counted from.
// `chooseBaseline` was here. It set ONE repository's baseline, and it was the
// last way to make three independent settings that nothing described together —
// the state the group requirement exists to end, since what a branch is cut from
// then depends on all of them being right at once and nobody is looking at any
// of them while typing a branch name.
//
// Choosing a branch per repository happens in the name-a-line dialog now, where
// it is one decision with one name on it. `repoBaseline` remains an action: on a
// command line it is a deliberate single step, and `lineUse_REMOVED` is built
// out of it.

// What can be done to the selected branch. One set of buttons for all of them,
// the same arrangement as the machines tab, so the answer to "why can I not
// delete this" is beside the thing that would do it rather than on its card.
function branchActions (b) {
  const box = $('branch-actions')
  setText($('branch-context'), b ? `— ${b.name}` : '— nothing selected')
  if (!b) {
    if (changed('branch-actions', null)) fill(box, el('p', { className: 'empty', textContent: 'Pick a branch on the left.' }))
    return
  }
  // The machine you are working in is part of the signature, because it comes
  // from the registry rather than from the branch row -- so a machine becoming
  // yours changes nothing about `b`, and the button offering to give it back
  // would never appear.
  const mine = mineFor(b)
  if (!changed('branch-actions', [b, mine && mine.name])) return

  fill(box,
    // WHY IT EXISTS, first, because it is the thing that cannot be worked out
    // from anything else on this screen. Absent on every branch cut before a
    // reason was required, and that absence is shown rather than hidden: "nobody
    // recorded this" is the honest state of most of the board, and it is exactly
    // what made one of them impossible to account for.
    el('p', { className: b.note ? 'note' : 'note muted' },
      b.note
        ? `${b.note.reason} — ${b.note.by || 'made'} ${b.note.made ? ago(b.note.made) : ''}`
        : 'No reason was recorded. It was cut before that was required, or by something other than this app.'),

    // WHAT IT WAS CUT FROM, which is the other half of accounting for a branch
    // and the half git stops being able to answer. "3 commits ahead" is measured
    // against a baseline that may have moved since; this says where the work
    // actually started, and names the line if one was chosen.
    b.note && b.note.from
      ? el('p', { className: 'note muted' },
          b.note.group
            ? `Cut from the "${b.note.group}" line — ${Object.entries(b.note.from).map(([r, f]) => `${r}:${f}`).join(', ')}.`
            : `Cut from ${Object.entries(b.note.from).map(([r, f]) => `${r}:${f}`).join(', ')}.`)
      : null,

    el('div', { className: 'branch-facts' },
      el('span', { className: b.commits ? 'strong' : 'muted', textContent: b.commits ? `${b.commits} commit(s) ahead` : 'nothing beyond the default' }),
      el('span', { className: 'muted', textContent: `in ${b.in.join(', ') || 'none'}` }),
      // NOT SAID ABOUT A DEFAULT BRANCH. Every repository has its own, so one
      // that is the baseline in some of them is not MISSING from the rest -- it
      // is simply not theirs, and calling that absence a gap reads as a fault to
      // go and fix.
      b.missing.length && !b.protected ? el('span', { className: 'muted', textContent: `not in ${b.missing.join(', ')}` }) : null,
      b.protected ? el('span', { className: 'muted', textContent: protectedAs(b) }) : null,
      b.heldBy ? el('span', { className: 'muted', textContent: b.heldRunning ? `checked out on ${b.heldBy}` : `${b.heldBy} claims it, and is off` }) : null),

    b.whyNot ? el('p', { className: 'note', textContent: b.whyNot }) : null,

    el('div', { className: 'row', style: 'margin-top:10px' },
      // WORKING IN IT YOURSELF, which is the flow a person actually has. A
      // branch is a workspace when the human is the one working: take a free
      // machine, set it up on this branch, open it. One button, because
      // assembling it from three was how a machine got left running.
      //
      // NOT "in VS Code" any more. It said that when an editor was the only
      // thing it could open, and the dialog behind it now offers three answers —
      // VS Code, a terminal here, or nothing yet because the task is for later.
      // A button that names one of three is a promise it keeps a third of the
      // time, and the two it breaks are the ones somebody chose deliberately.
      !b.protected && !b.heldBy
        ? el('button', {
            className: 'btn ok',
            textContent: 'Work on it',
            title: 'Write a task on this branch, and take a machine now or leave it for later',
            onclick: () => workOnBranch(b)
          })
        : null,

      // MAKING THIS THE BASELINE, which is what chaining looks like from the
      // front: a branch carrying finished work becomes what the NEXT work is
      // counted from and cut from, so the next task starts where this one ended
      // rather than from a default that does not have it yet.
      //
      // MAKING A LINE OUT OF IT, which is what "Count from it" was reaching for
      // and getting wrong. That button pointed the whole workspace at this
      // branch; what somebody actually wants at this moment is for the finished
      // work to become a thing with a name — one that can be proposed, compared
      // and landed. Naming it is also what protects it.
      //
      // Not offered on something already protected: it is a default branch or
      // already a link in a line, and neither wants doing twice.
      !b.protected && b.commits
        ? el('button', {
            className: 'btn',
            textContent: 'Make it a line',
            title: `Name "${b.name}" as a line, so it can be proposed and landed`,
            onclick: () => askToMakeALine(b)
          })
        : null,

      // A SHELL INTO THE MACHINE THIS BRANCH IS ON, which is where a shell for
      // working belongs. It used to be offered on the machine's own panel, which
      // is a way into a machine with no branch and no task -- the same category
      // error as the editor button. Here it can only ever open on work.
      b.heldBy && b.heldRunning
        ? el('button', {
            className: 'btn',
            textContent: `Shell on ${b.heldBy}`,
            title: `A terminal in ${b.heldBy}, where "${b.name}" is checked out`,
            // Named for the branch, because that is what the shell is FOR. The
            // machine is the second half of the label and the tooltip.
            onclick: () => goToShell(b.heldBy, { what: b.name })
          })
        : null,

      // And giving it back, which only appears when there is something to give
      // back. It is the same action the queue uses to put a machine away, so it
      // refuses while anything is uncommitted rather than rolling it back.
      mine
        ? el('button', {
            className: 'btn',
            textContent: `Done with ${mine.name}`,
            onclick: () => finishOnBranch(b, mine)
          })
        : null,

      // "GIVE IT TO A MACHINE" WAS HERE, and it is gone for the same reason the
      // editor and shell buttons went from the machines tab: it set a machine up
      // on a branch with NO TASK, so the work that followed had no brief, no
      // attempts, no verdict and nothing recording that it happened.
      //
      // There are two ways to put a machine on a branch and both of them make a
      // task first: "Work on it" for a person, and queueing or giving
      // a task for a worker. A machine on a branch outside those is a machine
      // nothing on the board can account for.

      // The way out of the one state that blocks deletion, offered where the
      // block is explained. Enabled only while the machine is running, because
      // that is the only time it can be asked what it is holding.
      b.heldBy
        ? el('button', {
            className: 'btn',
            textContent: `Let ${b.heldBy} go of it`,
            disabled: !b.heldRunning,
            onclick: () => api('vmRelease', { name: b.heldBy })
              .then(r => say(r.note || `${b.heldBy} let go of ${b.name}.`)).catch(oops)
          })
        : null,
      el('button', {
        className: 'btn danger',
        textContent: 'Delete it',
        disabled: !b.removable,
        onclick: () => askToDeleteBranch(b)
      })))
}

const chip = (text, kind) => el('span', { className: `chip${kind ? ' ' + kind : ''}`, textContent: text })

// A panel that has not been filled yet, drawn as the shape of what is coming.
//

// Why a branch is protected, said as the two separate claims it can be.
//
// A branch is the DEFAULT of a repository -- a fact about git, read from it --
// or the chosen BASELINE of one, or both, in any combination across a workspace.
// Collapsing them into one list said the wrong thing the moment a baseline was
// chosen anywhere: `master` reported itself as "baseline for local-repo-a" while
// local-repo-a was counting from something else entirely, and was only still
// protected there because it is that repository's default.
//
// The chosen-baseline half is gone with the setting. What is left is the two
// that remain true: a fact about a repository, and a decision about a line —
// and a branch protected only by a line said the bare word "protected", which is
// the least useful thing a label can say about a branch you cannot work on.
function protectedAs (b) {
  const parts = [
    b.asDefault.length ? `default of ${b.asDefault.join(', ')}` : null,
    b.asGroup && b.asGroup.length ? `a link in ${[...new Set(b.asGroup)].join(', ')}` : null
  ].filter(Boolean)
  if (!parts.length) return 'protected'
  return parts.join('; ')
}

// One row per branch, selectable, and deliberately thin. Everything that used
// to be on the card -- what is on it, what can be done to it, which tasks ran --
// is in the two columns beside it now, for the same reason the machines tab is
// arranged that way: a list you choose from should be readable at a glance, and
// a card carrying five facts and three buttons is not a list.
function branchCard (b) {
  // What this branch IS, in one word, because that is the question. The order
  // matters: protected beats everything, and orphaned beats spare because
  // carrying work is the more important fact about it.
  //
  // "In use" and "claimed by a machine that is off" are DIFFERENT, and saying
  // both with the same word was a small lie the tab told about a real state: a
  // claim is a registry entry, and it outlives the machine being switched on.
  const [tag, kind] =
    b.protected ? ['protected', 'ok']
      : b.heldRunning ? ['in use', 'ok']
        : b.heldBy ? ['claimed, off', 'warn']
          : b.tasks.length ? ['claimed', 'ok']
            : b.orphaned ? ['orphaned', 'bad']
              : ['spare', 'warn']

  return el('div', {
    className: `card pick${pickedBranch === b.name ? ' on' : ''}`,
    onclick: () => { pickedBranch = b.name; been.set('branch', b.name); paintBranches() }
  },
    el('div', { className: 'card-title' },
      el('span', { className: 'mono', textContent: b.name }),
      el('span', { className: `badge ${kind}`, textContent: tag })),
    el('div', { className: 'badges' },
      // The one number that decides everything else about a branch -- except on
      // the default, where "empty" is meaningless: it is the thing the count is
      // measured against, so it can only ever be zero ahead of itself.
      el('span', {
        className: 'muted',
        // "The baseline" is wrong the moment a workspace has more than one. It
        // is A baseline, for some of the repositories, and which ones is the
        // whole of what makes the number beside every other branch mean
        // different things in different repositories.
        textContent: b.protected ? protectedAs(b) : b.commits ? `${b.commits} commit(s)` : 'empty'
      }),
      b.heldBy ? el('span', { className: 'muted', textContent: b.heldBy }) : null))
}

// Everything the branch carries, of every kind.
//
// A branch used to mean commits and nothing else. A run can now hand over a file
// a branch cannot hold -- a built binary, an archive -- and the session that
// produced the work is the third thing worth keeping with it. All three are read
// in ONE call, so what is on screen is one moment rather than three.
function paintBranchArtifacts (b) {
  const box = $('branch-artifacts')
  setText($('branch-carries'), b ? `— ${b.name}` : '')
  setText($('branch-tasks-context'), '')

  if (!b) {
    if (changed('branch-carries', null)) {
      fill(box, el('p', { className: 'empty', textContent: 'Pick a branch on the left.' }))
      fill($('branch-tasks'), el('p', { className: 'empty', textContent: '' }))
    }
    return
  }

  // This one reads git for real, uncached, because it is what somebody judges
  // from -- so it is the slowest panel in the window and the one most worth
  // saying "not yet" about.
  waiting('branch-artifacts', { lines: 6 })
  waiting('branch-tasks', { cards: 2 })

  api('branchArtifacts', { branch: b.name }).then(a => {
    if (!changed('branch-carries', [b.name, a])) return

    // ---- the tasks that ran on it, in the middle column -----------------
    setText($('branch-tasks-context'), a.tasks.length ? `— ${a.tasks.length}` : '— none')
    fill($('branch-tasks'), a.tasks.length
      ? a.tasks.map(t => el('div', { className: 'card' },
          el('div', { className: 'card-title' },
            el('button', {
              className: 'linky mono',
              textContent: `#${t.number} ${t.title}`,
              // The task is where a verdict is given, and this tab deliberately
              // does not duplicate that -- it only makes the connection findable
              // from the branch end.
              onclick: () => goToTask(t.task)
            }),
            el('span', { className: `badge ${t.state === 'accepted' ? 'ok' : t.state === 'rejected' ? 'bad' : ''}`, textContent: t.state })),
          el('div', { className: 'badges' },
            t.machine ? el('span', { className: 'muted', textContent: `on ${t.machine}` }) : null,
            t.files.length ? el('span', { className: 'muted', textContent: `${t.files.length} file(s) handed over` }) : null)))
      : el('p', { className: 'empty', textContent: 'No task claims this branch. Its commits arrived some other way, or its task was thrown away.' }))

    // ---- what it carries, in the wide column ----------------------------
    const carrying = a.git.repos.filter(r => !r.missing && !r.empty)

    fill(box,
      // GIT. The artifact for anything that is source, and the better one:
      // reviewable, diffable, and already what a verdict is about.
      el('div', { className: 'carries' },
        el('div', { className: 'carries-head' },
          el('span', { textContent: 'Commits' }),
          el('span', { className: 'muted', textContent: a.git.summary })),
        carrying.length
          ? carrying.map(r => el('div', { className: 'carries-part' },
              el('div', { className: 'card-title' },
                el('span', { className: 'mono', textContent: r.repo }),
                el('span', { className: 'muted', textContent: `${r.ahead} on top of ${r.base}` }),
                el('button', {
                  className: 'linky',
                  textContent: 'read the diff',
                  onclick: () => showDiffOf(b.name, r.repo)
                })),
              codeBlock(
                r.commits.map(c => `${c.sha}  ${new Date(c.at).toLocaleString()}  ${c.who}\n    ${c.subject}`).join('\n') || 'nothing',
                'markdown')))
          : el('p', { className: 'empty', textContent: 'Nothing beyond the default branch.' })),

      // FILES. What a branch could not hold, handed over by a run before its
      // machine was rolled back. On this host, not on the machine.
      el('div', { className: 'carries' },
        el('div', { className: 'carries-head' },
          el('span', { textContent: 'Files handed over' }),
          el('span', { className: 'muted', textContent: a.files.length ? `${a.files.length}, ${kb(a.files.reduce((n, f) => n + f.bytes, 0))}` : 'none' })),
        a.files.length
          ? el('table', { className: 'kv' }, ...a.files.map(f =>
              el('tr', {},
                el('th', { className: 'mono', textContent: f.name }),
                el('td', { className: 'muted' },
                  el('span', { textContent: `${kb(f.bytes)} · #${f.number} · ${f.kept ? new Date(f.kept).toLocaleString() : ''}` })))))
          : el('p', { className: 'empty', textContent: 'None. A run hands one over by calling "okc-artifact <file>", which is on its PATH.' })),

      // THE SESSION. Not built yet, and said so rather than left blank: a branch
      // is where work lives and the session is how that work was reached, so its
      // absence is a fact about the tool rather than about this branch.
      el('div', { className: 'carries' },
        el('div', { className: 'carries-head' },
          el('span', { textContent: 'Worker session' }),
          el('span', { className: 'badge warn', textContent: a.session.kept ? 'kept' : 'not kept' })),
        el('p', { className: 'note', textContent: a.session.why })))
  }).catch(oops)
}

const kb = n => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`

// One repository's changes, in full. A dialog rather than a panel because it is
// long, read once, and not something to keep on screen beside everything else.
function showDiffOf (branch, repo) {
  api('branchDiff', { branch, repo }).then(({ diff }) => {
    ask({
      title: `${repo} — ${branch}`,
      plain: [`Everything this branch adds to ${repo}, against the branch it was cut from.`],
      confirm: 'Done',
      onYes: async () => {}
    })
    const body = document.querySelector('.dlg-body')
    if (body) body.append(codeBlock(diff || 'no changes', 'diff', { max: DIFF_LID }))
  }).catch(oops)
}

// Cutting one, with the reason as a required field rather than a nicety.
//
// The dialog says what the reason is FOR, because "why does this exist" is a
// question asked months later by somebody deciding whether to delete it -- and
// the answer costs one sentence now and cannot be reconstructed then.
// WHAT IT IS CUT FROM IS ASKED, AND IT IS REQUIRED.
//
// This dialog used to say a branch was cut "from wherever that repository
// currently is", which stopped being true when cutting moved to the baseline and
// was never a good idea while it was true — it made whatever somebody last
// checked out on the host decide where the next task started.
//
// The per-repository baselines were the obvious replacement and they are three
// answers to a question that has one. Worse, they are the QUIET answer: always
// available, never asked about, and decided by settings nobody is looking at
// while typing a branch name. So a named group is not the alternative here, it
// is the only way — the same rule as refusing a branch with no reason, one level
// up. A branch nobody can name the starting point of cannot be measured against
// anything afterwards.
//
// WITH NONE NAMED, THIS DOES NOT OFFER TO CUT ANYTHING. A dialog with a
// disabled-looking confirm and a field that cannot be filled is worse than a
// dialog that says what is missing and where to go and fix it.
async function newBranch () {
  const { groups } = await api('lines').catch(() => ({ groups: [] }))
  const usable = (groups || []).filter(g => !g.broken.length)
  const broken = (groups || []).filter(g => g.broken.length)

  if (!usable.length) {
    return ask({
      title: 'Nothing to cut a branch from yet',
      plain: [
        'A branch is cut from a named line: one branch per repository, named together because they are one point in the work.',
        broken.length
          ? `${broken.length} group(s) are named but cannot be cut from — ${broken.map(g => `${g.name}: ${g.broken.join('; ')}`).join(' · ')}.`
          : 'None have been named yet.',
        'Name one on the Lines tab — one branch per repository, given a name. Then work can be cut from it, and every branch can say what it started against.'
      ],
      confirm: 'Go to the lines',
      onYes: () => {
        showTab('branches')
        const pane = document.querySelector('.subtab[data-pane="baselines"]')
        if (pane) pane.click()
      }
    })
  }

  ask({
    title: 'Cut a branch',
    plain: [
      'It is cut in every repository that does not already have it, and nothing is built on it until a task takes it — creating it moves no other branch and touches no working tree.',
      'It starts at the line you choose, in every repository at once, and that line is recorded as what the branch is measured against ever after.'
    ],
    fields: [
      { name: 'branch', label: 'Name', placeholder: 'feature/fix-name' },
      { name: 'reason', label: 'What is it for', placeholder: 'why this exists, for whoever finds it later' },
      // No blank option, because there is no blank answer. A select that opens
      // on a real choice is also the one that cannot be skipped past.
      {
        name: 'group',
        label: 'Cut it from',
        value: usable[0].name,
        options: usable.map(g => ({
          value: g.name,
          label: `${g.name} — ${g.on.map(p => `${p.repo}:${p.branch}`).join(', ')}`
        }))
      }
    ],
    confirm: 'Cut it',
    onYes: async f => {
      if (!f.group) throw new Error('Say what it is cut from. Every branch starts somewhere, and this is the record of where.')
      const r = await api('branchCreate', { branch: f.branch, reason: f.reason, group: f.group })
      pickedBranch = r.branch
      been.set('branch', r.branch)
      forget('branches')
      say(r.already
        ? `"${r.branch}" already existed everywhere.`
        // Says where it was cut from, not only that it happened. It is the fact
        // that decides what the branch will be measured against.
        : `Cut "${r.branch}" — ${r.cut.filter(c => c.created).map(c => `${c.repo} from ${c.from}`).join(', ')}.`)
    }
  })
}

// NAMING A FINISHED BRANCH AS A LINE.
//
// This was `askToUseAsBaseline`, which pointed the whole workspace at a branch.
// The scenario it existed for is real -- a branch carries work the next piece of
// work should be read against -- and cutting from a named line answers it
// properly: the next branch records that line as what it started from, and is
// measured against it for ever, whatever the workspace does afterwards.
//
// So what is left is the useful half: give this branch a name that outlives it.
function askToMakeALine (b) {
  ask({
    title: `Make "${b.name}" a line?`,
    plain: [
      `It names one branch per repository — ${b.in.join(', ')} at "${b.name}" — which is what this branch already is. What it adds is a name that outlives the branch.`,
      'Its branches become protected: work is cut FROM a line and merged back INTO it, never built on directly. That is what makes chaining safe rather than a convention.',
      'It moves nothing and counts nothing from it. A line is somewhere work can start and somewhere work can land, and neither happens until you say so.',
      b.missing.length
        ? `${b.missing.join(', ')} do not have this branch and are not named in the line.`
        : null,
      'Propose it on the Lines tab when it is ready to go in, and it appears on the Merge tab.'
    ].filter(Boolean),
    fields: [
      { name: 'name', label: 'Called', value: `${b.name} line`, placeholder: 'the version2 line' },
      { name: 'why', label: 'What it is, if it needs saying', placeholder: 'everything since the v2 split' }
    ],
    confirm: 'Name it',
    onYes: async f => {
      const r = await api('branchAsLine', { branch: b.name, name: f.name, why: f.why })
      pickedGroup = r.name
      been.set('group', pickedGroup)
      forget('branches')
      forget('baselines')
      say(r.note)
      return draw()
    }
  })
}

// STARTING A PERSON'S TASK FROM THE TASK, which is where it belongs.
//
// The branch dialog can write one and start it in the same breath, and that only
// covers work decided on at the moment it begins. A task written on Monday for
// Thursday had no door: the Tasks tab offered to queue it or give it out, both of
// which run Claude on it, and neither of which is what the task says.
function takeTaskByHand (task, open = 'editor') {
  const free = (queueSays.size ? [...queueSays.values()] : []).filter(m => m.free)
  const term = open === 'terminal'
  ask({
    title: `Work on #${task.number} yourself`,
    plain: [
      `A free machine is borrowed, brought up at its base snapshot, and set up with every repository checked out on "${task.branch}".`,
      term
        ? 'A shell then opens on the Terminal tab, in the folder the work is in. Nothing is typed into it — it is a bash prompt on the machine, and what you run there is yours to decide.'
        : 'VS Code then opens into it over ssh.',
      'Claude is signed in on the machine, so typing `claude` works rather than asking you to log in.',
      task.machine
        ? `#${task.number} is already on ${task.machine}. This takes another machine, so give that one back first unless you meant to.`
        : 'The task is marked as taken, on the machine that gets it.',
      free.length
        ? `Free right now: ${free.map(m => m.name).join(', ')}.`
        : 'Nothing is free at the moment, so this will refuse and say why.'
    ],
    cost: `It takes a minute or two to bring a machine up before the ${term ? 'shell' : 'editor'} can open.`,
    confirm: term ? 'Take a machine and open a terminal' : 'Take a machine and open it',
    onYes: async () => {
      const r = await api('taskWorkOn', { id: task.id, open })
      forget('tasks')
      forget('branches')

      // THE SHELL IS OPENED HERE, because a terminal is the one thing the action
      // table cannot hand over: there is no terminal on the other side of it.
      // The action does everything else and says where the work is; this puts a
      // pty on the far end of an ssh and lands it in that folder. The command
      // line's half of the same split is `vmShell`, which hands its own terminal
      // to ssh for the same reason.
      if (term && r.name) {
        showTab('terminal')
        await openShell(r.name, { what: `#${task.number}`, cwd: r.folder, task: task.id })
          .catch(e => say(`${r.name} is yours, but the shell did not open: ${e.message}`, 'bad'))
      }

      say(r.note)
      return draw()
    }
  })
}

// And ending it, which is the person's half of an exit code.
function finishTaskByHand (task) {
  ask({
    title: `Finish #${task.number}?`,
    plain: [
      `${task.machine} goes back to its base snapshot and returns to the pool, and "${task.branch}" stops being claimed by it.`,
      'It refuses while anything on the machine is uncommitted, because rolling back is how a machine is put away and uncommitted work does not survive it.',
      'The task then stands where a worker\'s would: whatever is on the branch is what it delivered, and it is up to be judged.'
    ],
    cost: 'Anything on that machine that is not pushed is gone.',
    confirm: 'Give it back',
    onYes: async () => {
      const r = await api('taskFinished', { id: task.id })
      forget('tasks')
      forget('branches')
      say(r.note || `#${task.number} is finished and up for a verdict.`)
      return draw()
    }
  })
}

// The machine YOU are working in on this branch, if there is one.
//
// Borrowed and set up on this branch are two different facts and both are
// needed: a machine borrowed for a sign-in is not yours to finish here, and a
// machine on this branch that was not borrowed belongs to the queue.
const mineFor = b => latest.vms.find(v => v.borrowed && v.branch === b.name) || null

// Taking a machine, setting it up on this branch, and opening an editor in it.
//
// One button for what was three actions in a remembered order — and the order
// was the part that went wrong: a machine started and never used, a workspace
// set up on a machine somebody then forgot was theirs.
function workOnBranch (b) {
  const free = (queueSays.size ? [...queueSays.values()] : []).filter(m => m.free)
  ask({
    title: `Work on "${b.name}" yourself`,
    plain: [
      'A free machine is borrowed, brought up at its base snapshot, and set up with every repository checked out on this branch. It then opens over ssh, with this app\'s own key — in VS Code, or as a shell on the Terminal tab, whichever you choose below.',
      // THE POINT OF ASKING FOR A TITLE. Work done by hand used to happen off
      // the board entirely -- a machine borrowed, an editor opened, and nothing
      // anywhere saying it happened. A task is what makes the human path the
      // same shape as the worker path: same branch, same artifacts, same verdict.
      'It becomes a task, like any other work on this branch — so what you deliver is read the same way, and the board says who did it.',
      free.length
        ? `Free right now: ${free.map(m => m.name).join(', ')}.`
        : 'Nothing is free at the moment, so this will refuse and say why.'
    ],
    fields: [
      { name: 'title', label: 'Called', placeholder: 'what this piece of work is' },
      // THE BRIEF IS A SEPARATE FIELD, not the title used twice. A title is what
      // the board calls it; a brief is what the work IS -- and it is the same
      // field a worker would be given, which is the point of the human path
      // being a task at all. Writing it also makes you say what you are doing
      // before you start doing it, which is most of the value of a brief.
      { name: 'brief', label: 'What the work is', placeholder: 'the same thing you would tell a worker', multiline: true, rows: 7 },
      // HOW IT OPENS, asked once here rather than being a property of the task.
      // Both doors reach the same machine on the same branch, so this is a
      // preference about how somebody works today and not a fact about the work
      // -- which is why the task keeps offering both afterwards.
      { name: 'start', label: 'Take a machine now', value: 'editor', options: [
        { value: 'editor', label: 'Yes — bring one up and open VS Code' },
        { value: 'terminal', label: 'Yes — bring one up and open a terminal here' },
        { value: 'no', label: 'No — just write it down for later' }
      ] }
    ],
    cost: 'It takes a minute or two to bring a machine up before it can open.',
    confirm: 'Save it',
    onYes: async f => {
      if (!f.title || !f.title.trim()) throw new Error('Say what this is called — it is what the board will show.')
      if (!f.brief || !f.brief.trim()) throw new Error('Say what the work is. A task with no brief is a title nobody can act on later, including you.')

      const made = await api('taskCreate', {
        task: { title: f.title.trim(), brief: f.brief.trim(), branch: b.name, worker: 'person' }
      })
      const task = made.task || made
      forget('branches')
      forget('tasks')

      if (f.start === 'no') {
        say(`#${task.number} "${task.title}" is on the board, on "${b.name}". Start it when you want a machine.`)
        return draw()
      }

      // THE TASK EXISTS EITHER WAY. Starting it can fail -- nothing free, a
      // branch missing from a repository -- and a failure there must not read as
      // "nothing happened", because the task is written down and will be sitting
      // on the board wondering why it was not mentioned.
      try {
        const r = await api('taskWorkOn', { id: task.id, open: f.start })

        // Same split as the task's own button: the action does everything a
        // terminal needs and this window is the only thing that can BE one.
        if (f.start === 'terminal' && r.name) {
          showTab('terminal')
          await openShell(r.name, { what: `#${task.number}`, cwd: r.folder, task: task.id })
            .catch(e => say(`${r.name} is yours, but the shell did not open: ${e.message}`, 'bad'))
        }
        say(r.note)
      } catch (e) {
        say(`#${task.number} is on the board, but no machine was taken: ${e.message}`, 'bad')
      }
      return draw()
    }
  })
}

// Giving it back when the work is done.
//
// The same action the queue uses to put a machine away, so it refuses while
// anything is uncommitted rather than rolling it back — which is the whole
// reason this is a button and not a habit.
function finishOnBranch (b, vm) {
  // The task being worked by hand on this branch, if there is one. Finishing
  // through the task rather than through the machine is what puts the work up
  // for a verdict -- giving the machine back alone would leave a task marked as
  // given to a machine that is off, which is the state the queue adopts.
  const mine = (taskList || []).find(t => t.branch === b.name && t.machine === vm.name && t.state === 'given')

  ask({
    title: mine ? `Finish #${mine.number}?` : `Done with ${vm.name}?`,
    plain: [
      `${vm.name} goes back to its base snapshot and returns to the pool, and "${b.name}" stops being claimed by it.`,
      'It is asked what it is holding first: anything uncommitted or unpushed refuses this, because rolling it back would discard exactly that.',
      mine
        ? `#${mine.number} is then done and waiting to be judged — and what it delivered is whatever reached "${b.name}", the same as any other task.`
        : 'Nothing on the board refers to this machine, so only the machine is put away.'
    ],
    cost: `Everything on ${vm.name} that is not on a branch is discarded.`,
    confirm: mine ? 'Finish it' : 'Put it away',
    danger: true,
    extra: {
      label: 'Just release it, leave it running',
      onClick: () => api(mine ? 'taskFinished' : 'vmReturn', mine ? { id: mine.id, keep: true } : { name: vm.name, keep: true })
        .then(r => say(r.note)).catch(oops)
    },
    onYes: async () => {
      const r = mine
        ? await api('taskFinished', { id: mine.id })
        : await api('vmReturn', { name: vm.name })
      say(r.note)
    }
  })
}

// `giveBranchToMachine` was here. It set a machine up on a branch and stopped,
// which is the middle of a flow with neither end: no task before it saying what
// the work is, and nothing after it saying the work is done. `vmWorkspace`
// remains an action for the command line, where it is a step somebody is
// deliberately taking rather than a button that looks like a way to start work.

// Deleting a branch is the only way work made here is ever unmade, so the dialog
// says what would be lost in the same sentence as the question.
function askToDeleteBranch (b) {
  const loses = !b.contained && b.commits
  ask({
    title: `Delete "${b.name}"?`,
    danger: true,
    plain: [
      `It would go from ${b.in.join(' and ')}.`,
      loses
        ? `It carries ${b.commits} commit(s) that no default branch has. This is the only place that work exists.`
        : 'Everything on it is already in the default branch, so nothing is lost.',
      b.tasks.length
        ? `${b.tasks.map(t => `#${t.number}`).join(', ')} still refer(s) to it, and would be left pointing at a branch that is gone.`
        : null
    ].filter(Boolean),
    cost: loses ? 'The commits themselves survive until git collects them, and the report says where they were.' : null,
    confirm: loses ? 'Delete it and lose the work' : 'Delete it',
    onYes: () => api('branchDelete', { branch: b.name, force: !b.contained })
      .then(r => say(`Deleted "${r.branch}". ${r.note}`))
      .catch(oops)
  })
}
