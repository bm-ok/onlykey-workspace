'use strict'

// The Changes pane on Branches: what a line carries, and the files it
// touches. It sits this early because it always has -- these were the
// first panels written and the order of the file is load-bearing.
//
// Part of the window. See ui/load.js for the order these are read in and why
// the order matters.

// ---- landing a line ----------------------------------------------------
//
// Which two lines are being compared, what is being read about them, and which
// file. Module-level and remembered, because reading a change is not a thing
// somebody finishes in one sitting and coming back to a blank pane is how a
// review gets started again from the top.
// The `let`s these use are declared beside the other remembered pane state,
// further down, next to `branchPane` — they read from `been`, and `been` is
// defined after this point in the file. The functions here are declarations and
// hoist; a `const` does not, and putting them here threw
// "Cannot access 'been' before initialization" on the first line of the page.

function paintChanges () {
  waiting('change-summary', { cards: 1 })
  api('lines').then(({ groups }) => {
    const usable = (groups || []).filter(g => !g.broken.length)
    const proposed = usable.filter(g => g.marked)

    // NOTHING TO READ IS A STATE WORTH EXPLAINING, and it is the ordinary one:
    // most of the time nothing is up for landing. A pane that says only "pick
    // something" from two empty dropdowns is a pane nobody can act on.
    if (!proposed.length) {
      fill($('change-summary'), el('div', { className: 'panel' },
        el('p', { className: 'empty', textContent: usable.length
          ? 'No line is proposed for landing.'
          : 'No lines are named yet, so there is nothing that could be landed.' }),
        el('p', { className: 'empty', textContent: 'A branch that carries finished work is made into a line — "Make it a line", on Overview — and then proposed here. Proposing changes nothing; it says somebody thinks it is done, and it is what puts it on the left below.' })))
      fill($('change-commits'), null)
      fill($('change-filelist'), null)
      fill($('change-diff'), null)
      fill($('change-actions'), null)
      setText($('change-state'), '')
      paintChangesPicks(proposed, usable)
      return
    }

    if (!proposed.some(g => g.name === changeFrom)) changeFrom = proposed[0].name
    const others = usable.filter(g => g.name !== changeFrom)
    if (!others.some(g => g.name === changeInto)) {
      // The line in use is what work is currently counted from, so it is the one
      // a proposal almost always goes into. Guessed, not assumed — it is a
      // dropdown, and being wrong costs one click.
      changeInto = (others.find(g => !g.marked) || others[0] || {}).name || null
    }
    paintChangesPicks(proposed, usable)

    if (!changeInto) {
      fill($('change-summary'), el('div', { className: 'panel' },
        el('p', { className: 'empty', textContent: 'There is no other line to compare it against. Name the line it would go into on the Lines tab.' })))
      return
    }

    const marked = proposed.find(g => g.name === changeFrom)
    setText($('change-state'), marked && marked.marked
      ? `proposed ${ago(marked.marked.at)}${marked.marked.why ? ` — ${marked.marked.why}` : ''}`
      : '')

    // ASKED WHEN THE QUESTION CHANGES, NOT EVERY THREE SECONDS.
    //
    // This pane is expensive in a way nothing else here is. `changeRead` runs
    // three or four git processes per repository. On a three-repository
    // workspace that is a dozen processes, and the window redraws every three
    // seconds.
    //
    // A trace said so plainly: 78% of the samples that were not idle were inside
    // `spawn`, with the pane open and nobody touching it. That is the same fault
    // the artifact cache was written for, arriving by a new door, and the lesson
    // is the same one -- a panel that asks git something on a timer is a panel
    // that costs a process per repository per tick for an answer nobody asked
    // for twice.
    //
    // So the answer is kept until its question changes, and re-read on a much
    // slower clock so a branch that moved underneath it is still noticed.
    // Not the two names joined by a space: a line is called things like
    // "testing2 line", so a space is part of a name and two different pairs
    // could produce one key.
    const key = JSON.stringify([changeFrom, changeInto])
    const fresh = changeAnswer && changeAnswer.key === key && Date.now() - changeAnswer.at < 30000
    const asked = fresh
      ? Promise.resolve(changeAnswer.value)
      : api('changeRead', { source: changeFrom, target: changeInto })
          .then(value => { changeAnswer = { key, at: Date.now(), value }; return value })

    asked.then(cmp => {
      if (!changed('change', [changeFrom, changeInto, changeLook, changeMode, cmp])) return
      changeSeen = cmp
      paintChangesSummary(cmp)
      paintChangesActions(cmp)
      paintChangesBody(cmp)
    }).catch(oops)
  }).catch(oops)
}

function paintChangesPicks (proposed, usable) {
  const pick = (box, list, value, onPick) => {
    if (!changed(`${box}-list`, [list.map(g => g.name), value])) return
    fill($(box), ...list.map(g => el('option', {
      value: g.name,
      textContent: `${g.name}${g.marked ? ' — proposed' : ''}`,
      selected: g.name === value
    })))
    $(box).onchange = () => onPick($(box).value)
  }
  pick('change-from', proposed, changeFrom, v => {
    changeFrom = v; been.set('change-from', v); changePicked = null; changeAnswer = null; changed('change', null); paintChanges()
  })
  pick('change-into', usable.filter(g => g.name !== changeFrom), changeInto, v => {
    changeInto = v; been.set('change-into', v); changePicked = null; changeAnswer = null; changed('change', null); paintChanges()
  })
}

function paintChangesSummary (cmp) {
  fill($('change-summary'), el('div', { className: 'card' },
    el('div', { className: 'card-title' },
      el('span', { textContent: cmp.summary }),
      cmp.anything
        ? el('span', { className: 'badge', textContent: `+${cmp.added} −${cmp.removed}` })
        : null,
      cmp.anything ? null : el('span', { className: 'badge muted', textContent: 'nothing in it' })),
    ...cmp.repos.map(r => el('div', { className: 'group-part' },
      el('span', { className: 'mono', textContent: `${r.repo}  ${r.head} → ${r.base}` }),
      el('span', {
        className: r.missing ? 'muted' : r.noBase ? 'bad' : r.empty ? 'muted' : '',
        textContent: r.missing ? 'not in this repository'
          : r.noBase ? `${r.base} is not here`
            : r.empty ? 'nothing to land'
              : `${r.ahead} commit(s), +${r.added} −${r.removed}`
      }))),
    // Repositories one line reaches and the other does not. Said, because "why
    // is that repository not listed" is the first question a reader has.
    cmp.onlyInSource.length
      ? el('div', { className: 'card-sub muted', textContent: `${cmp.onlyInSource.join(', ')} — in "${cmp.source}" only, so there is nowhere in "${cmp.target}" for it to land.` })
      : null,
    cmp.onlyInTarget.length
      ? el('div', { className: 'card-sub muted', textContent: `${cmp.onlyInTarget.join(', ')} — in "${cmp.target}" only; this line never reached it.` })
      : null,
    null))
}

// WHAT YOU CAN DO WITH A CHANGE YOU HAVE READ.
//
// "Land it" and "Land it and push" were here, with a dry run of the git commands
// they would run. They merged a line into another ON THIS HOST -- which made this
// app the one thing allowed to write to a protected branch, outside every rule it
// enforces on a machine. That is the same category error as a machine pushing to
// master, arriving through the door marked "but I am the tool".
//
// Landing is a pull request now. The review stays here, where it is local and
// fast and reads the repositories directly; the landing goes where landings
// belong, with their own approvals and their own record. What is missing is the
// button that opens one, and saying so is better than leaving the old ending in
// place because it was already built.
function paintChangesActions (cmp) {
  fill($('change-actions'),
    el('button', {
      className: 'btn ok',
      textContent: 'Open pull requests',
      disabled: true,
      title: 'Not built yet — this is the next piece of work',
      onclick: () => {}
    }),
    el('button', {
      className: 'btn danger',
      textContent: 'Take it back',
      title: 'Stop proposing this line, so work on it can continue',
      onclick: () => ask({
        title: `Stop proposing "${cmp.source}"?`,
        plain: [
          'It stops being a proposal and goes back to being a line.',
          'Its branches stay protected, because they are still named in a line. Forget the line on the Lines tab to build on them directly again.',
          'Nothing that has already landed is undone.'
        ],
        confirm: 'Take it back',
        danger: true,
        onYes: async () => {
          const r = await api('lineWithdraw', { name: cmp.source })
          changeAnswer = null; changed('change', null); changed('baselines', null); changed('branches', null)
          say(r.note)
          return draw()
        }
      })
    }),
    el('p', { className: 'note', style: 'flex-basis:100%;margin:8px 0 0' },
      el('strong', { textContent: 'Nothing here lands a change. ' }),
      el('span', { textContent: `A default branch is protected, and that includes from this app. When pull requests are built, this is where "${cmp.source}" becomes one per repository — ${cmp.repos.filter(r => r.ahead).map(r => r.repo).join(', ') || 'none yet'} — tracked together so the change is landed only when all of them are.` })))
}

// showMergePlan and askToLand were here: the dry run of the git commands a
// landing would run, and the confirmation that ran them. Both went with the
// landing itself.

// ---- what is in it: commits, and the files -----------------------------

function paintChangesBody (cmp) {
  document.querySelectorAll('#change-tabs .subtab[data-look]').forEach(b => {
    b.classList.toggle('active', b.dataset.look === changeLook)
    b.onclick = () => {
      changeLook = b.dataset.look
      been.set('change-look', changeLook)
      changed('change', null)
      paintChanges()
    }
  })
  $('change-commits').classList.toggle('hidden', changeLook !== 'commits')
  $('change-files').classList.toggle('hidden', changeLook !== 'files')

  if (changeLook === 'commits') return paintChangesCommits(cmp)
  paintChangesFiles(cmp)
}

function paintChangesCommits (cmp) {
  const carrying = cmp.repos.filter(r => !r.missing && !r.noBase && !r.empty)
  fill($('change-commits'), carrying.length
    ? carrying.map(r => el('div', { className: 'carries' },
        el('div', { className: 'carries-head' },
          el('span', { textContent: r.repo }),
          el('span', { className: 'muted', textContent: `${r.ahead} on top of ${r.base}` })),
        ...r.commits.map(c => el('div', { className: 'change-commit' },
          el('span', { className: 'mono sha', textContent: c.sha }),
          el('span', { className: 'subject', textContent: c.subject }),
          el('span', { className: 'muted who', textContent: `${c.who}, ${ago(c.at)}` }))),
        r.more ? el('div', { className: 'card-sub muted', textContent: `and ${r.more} more` }) : null))
    : el('p', { className: 'empty', textContent: 'Nothing to land — these two lines carry the same commits.' }))
}

function paintChangesFiles (cmp) {
  const carrying = cmp.repos.filter(r => !r.missing && !r.noBase && !r.empty)
  if (!carrying.length) {
    fill($('change-filelist'), el('p', { className: 'empty', textContent: 'No files differ.' }))
    fill($('change-diff'), null)
    setText($('change-filename'), '')
    return
  }

  if (!changePicked || !carrying.some(r => r.repo === changePicked.repo && r.files.some(f => f.file === changePicked.file))) {
    const first = carrying.find(r => r.files.length)
    changePicked = first ? { repo: first.repo, file: first.files[0].file } : null
  }

  fill($('change-filelist'), ...carrying.map(r => el('div', {},
    el('div', { className: 'change-repo', textContent: `${r.repo} — ${r.files.length}${r.moreFiles ? `+${r.moreFiles}` : ''} file(s)` }),
    ...r.files.map(f => el('button', {
      className: `change-file${changePicked && changePicked.repo === r.repo && changePicked.file === f.file ? ' on' : ''}`,
      onclick: () => { changePicked = { repo: r.repo, file: f.file }; changed('change-file', null); paintChangesFiles(cmp) },
      title: f.file
    },
    // The path reads right-to-left so a long one keeps its FILENAME rather than
    // its first directory. Truncating the other way hides the only part that
    // tells two rows apart.
    el('span', { className: 'path', textContent: f.file }),
    f.binary
      ? el('span', { className: 'muted', textContent: 'binary' })
      : el('span', {}, el('span', { className: 'plus', textContent: `+${f.added}` }), ' ', el('span', { className: 'minus', textContent: `−${f.removed}` })))),
    r.moreFiles ? el('div', { className: 'card-sub muted', style: 'padding:2px 6px', textContent: `and ${r.moreFiles} more not listed` }) : null)))

  paintChangesDiff(cmp)
}

function paintChangesDiff (cmp) {
  setText($('change-filename'), changePicked ? `${changePicked.repo} · ${changePicked.file}` : '')
  $('change-mode').textContent = changeMode === 'sides' ? 'Unified' : 'Side by side'
  $('change-mode').onclick = () => {
    changeMode = changeMode === 'sides' ? 'unified' : 'sides'
    been.set('change-mode', changeMode)
    changed('change-file', null)
    paintChangesDiff(cmp)
  }
  if (!changePicked) return fill($('change-diff'), null)
  if (!changed('change-file', [changePicked, changeMode, cmp.source, cmp.target])) return

  waiting('change-diff', { lines: 10 })
  api('changeDiff', { source: cmp.source, target: cmp.target, repo: changePicked.repo, file: changePicked.file })
    .then(({ diff }) => {
      if (changeMode === 'unified') return fill($('change-diff'), codeBlock(diff || 'no changes', 'diff', { lines: 30 }))
      fill($('change-diff'), sideBySide(diff))
    })
    .catch(oops)
}

// The two sides, lined up.
function sideBySide (diff) {
  const rows = alignDiff(diff)
  if (!rows.length) return el('p', { className: 'empty', textContent: 'no changes' })

  const left = rows.map(r => r.left == null ? '' : r.left).join('\n')
  const right = rows.map(r => r.right == null ? '' : r.right).join('\n')
  const lines = Math.min(34, Math.max(8, rows.length + 1))

  // Scrolled together. Two columns that scroll independently are two views of
  // two files, which is what this exists to stop being.
  let a = null
  let b = null
  let syncing = false
  const tie = () => {
    if (!a || !b) return
    const link = (from, to) => from.session.on('changeScrollTop', y => {
      if (syncing) return
      syncing = true
      to.session.setScrollTop(y)
      syncing = false
    })
    link(a, b)
    link(b, a)
  }

  const marks = (ed, side) => {
    const Range = ace.require('ace/range').Range
    rows.forEach((r, i) => {
      const mine = side === 'left' ? r.left : r.right
      const theirs = side === 'left' ? r.right : r.left
      if (r.kind !== 'change') return
      // Absent on this side means the other side added or removed a line, and
      // the blank is padding rather than an empty line in the file. Marked
      // differently, because "there is nothing here" and "this line is gone"
      // are different things to be told.
      const cls = mine == null ? 'change-pad' : (side === 'left' ? 'change-removed' : 'change-added')
      if (mine == null && theirs == null) return
      try { ed.session.addMarker(new Range(i, 0, i, Infinity), cls, 'fullLine') } catch { /* an Ace without Range: the text is still right */ }
    })
  }

  // THE NUMBER AND THE SIGN, in the gutter, the way a diff is read everywhere
  // else. The sign is the thing the eye actually uses — colour alone fails for
  // anyone who cannot see the difference between the two greens, and it fails
  // for everybody in a screenshot that has been through a chat window.
  const gutterFor = side => {
    const width = String(rows.length).length
    return {
      width: width + 2,
      at: rows.map(r => {
        const no = side === 'left' ? r.leftNo : r.rightNo
        const mine = side === 'left' ? r.left : r.right
        if (r.kind === 'hunk') return ''
        if (no == null) return ''
        const sign = r.kind !== 'change' ? ' ' : (mine == null ? ' ' : (side === 'left' ? '-' : '+'))
        return `${String(no).padStart(width, ' ')} ${sign}`
      })
    }
  }

  const wasEmpty = rows.every(r => r.left == null || r.kind === 'hunk')
  const nowEmpty = rows.every(r => r.right == null || r.kind === 'hunk')

  return el('div', { className: 'change-sides' },
    el('div', { className: 'change-side' },
      el('div', { className: 'change-side-head' },
        el('span', { className: wasEmpty ? 'gone' : '', textContent: wasEmpty ? 'before — the file did not exist' : 'before' })),
      editorBlock(left, 'text', {
        lines,
        gutter: gutterFor('left'),
        onReady: ed => { a = ed; marks(ed, 'left'); tie() }
      })),
    el('div', { className: 'change-side' },
      el('div', { className: 'change-side-head' },
        el('span', { className: nowEmpty ? 'gone' : 'new', textContent: nowEmpty ? 'after — the file is gone' : 'after' })),
      editorBlock(right, 'text', {
        lines,
        gutter: gutterFor('right'),
        onReady: ed => { b = ed; marks(ed, 'right'); tie() }
      })))
}
