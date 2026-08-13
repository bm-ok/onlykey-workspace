'use strict'

// The window. Four tabs: the machines, the live log, the keys this host holds so
// that machines do not have to, and every action the server has. How a machine
// gets set up is not one of them -- that is internal, and lives in provision/ as
// shell scripts.
//
// The rule it is written against: an answer belongs where the person was already
// looking. Results appear in the notice bar next to the button that caused them,
// and anything irreversible says in plain words what will and will not happen
// before it does it.

// An app page, so it has node. It requires the app and calls the same actions the
// API exposes -- no fetch, no origin, no port, nothing to reconnect.
//
// require() in a page resolves against the app root, where package.json and
// server.js are.
const app = require('./server')
const liveLog = require('./core/log')

const api = async (name, args = {}) => {
  const action = app.actions[name]
  if (!action) throw new Error(`No action called "${name}"`)
  return action.run(args)
}

const keep = kids => kids.flat(9).filter(k => k !== null && k !== undefined && k !== false && k !== '')

const el = (tag, attrs = {}, ...kids) => {
  const node = Object.assign(document.createElement(tag), attrs)
  keep(kids).forEach(k => node.append(k))
  return node
}
const $ = id => document.getElementById(id)

// Always use this, never replaceChildren directly.
//
// replaceChildren takes (...Node|string) and does NOT flatten: hand it an array
// and the array is stringified, so a column of cards renders as the literal text
// "[object HTMLDivElement]". Flattening belongs in one place rather than in a
// spread at each call site that someone will forget.
const fill = (node, ...kids) => node.replaceChildren(...keep(kids))

// ---- drawing only what moved -----------------------------------------
//
// A repaint that changes nothing is not free. replaceChildren swaps in new nodes
// even when the new ones are identical, and a selection lives on the exact nodes
// it was made in -- so text being read out of a panel is deselected by the next
// poll, and a value that is polled every three seconds cannot be copied at all.
// Setting textContent to the string it already holds does the same thing: the
// text node is replaced, and it visibly flickers.
//
// So a panel is drawn from a signature of everything it reads, and does nothing
// at all while that has not moved.
//
// The signature has to name every field the panel uses -- including the ones only
// a click handler reads, because a stale handler is captured in the nodes that
// were not redrawn. Getting that wrong makes a panel silently stop updating,
// which is worse than the flicker it fixes, so each signature is defined beside
// the code that reads those fields rather than centrally.
const drawnFrom = new Map()
const changed = (key, value) => {
  const now = JSON.stringify(value)
  if (drawnFrom.get(key) === now) return false
  drawnFrom.set(key, now)
  return true
}

const setText = (node, text) => { if (node.textContent !== text) node.textContent = text }

// Everything any machine panel reads, including what its click handlers close
// over: `running` decides whether a button starts or stops, and `description`
// is carried into the configure dialog.
const vmKey = v => v && [v.name, v.state, v.stage, v.live, v.running, v.connected, v.baseSnapshot, v.description || '', v.branch || '', v.forTasks !== false]

// What the queue last said about each machine, by name. Kept here so a card can
// show the queue's own verdict rather than working one out again -- see
// queueWhy. Filled on every draw, from the same call the banner already makes.
let queueSays = new Map()
// And which task each machine is running, from the same answer.
let queueBusy = new Map()

// ---- code, for reading ------------------------------------------------
//
// Two things in this window are read carefully enough that a decision hangs on
// them: the source of a pre-defined task, which somebody has to approve, and a
// branch's diff, which somebody has to judge. Both were a `<pre>`, and a hundred
// lines of undifferentiated JavaScript is not something a person reads — it is
// something a person scrolls past and then approves anyway, which defeats the
// point of putting it on the screen at all.
//
// Read-only, deliberately and in three ways: the content is not editable, the
// cursor and active-line highlight are off so it does not invite a cursor, and
// the syntax worker is not loaded. Nothing here is a place to write code.
ace.config.set('basePath', '../vendors/ace/')

function codeBlock (text, mode = 'javascript', { lines = 18 } = {}) {
  const host = el('div', { className: 'code' })
  // Sized before ace sees it. Ace measures its container to lay out, so a
  // container with no height renders an editor with no rows in it — which looks
  // exactly like an empty file.
  host.style.height = `${Math.min(lines, Math.max(6, String(text || '').split('\n').length + 1)) * 1.5}em`

  // After it is in the document, for the same reason.
  queueMicrotask(() => {
    if (!host.isConnected) return
    const ed = ace.edit(host)
    ed.setTheme('ace/theme/tomorrow_night')
    ed.session.setMode(`ace/mode/${mode}`)
    ed.session.setUseWorker(false)
    ed.setValue(String(text == null ? '' : text), -1)
    ed.setReadOnly(true)
    ed.setOptions({
      highlightActiveLine: false,
      highlightGutterLine: false,
      showPrintMargin: false,
      fontSize: 12,
      // Wrapped, because the alternative is a horizontal scrollbar on the thing
      // somebody is meant to read every line of.
      wrap: true,
      showFoldWidgets: false
    })
    ed.renderer.$cursorLayer.element.style.display = 'none'
  })
  return host
}

// The same, but it hands back the editor.
//
// `codeBlock` deliberately returns only a node — nothing needed the editor, and
// not returning it kept every caller from reaching in. A side-by-side view does
// need it: two editors have to be told about each other to scroll together, and
// the rows that are additions have to be marked. So this is the same
// construction with a way out, and `codeBlock` stays as it was for everything
// that only wants to show text.
function editorBlock (text, mode, { lines = 18, gutter = null, onReady = null } = {}) {
  const host = el('div', { className: 'code' })
  host.style.height = `${Math.min(lines, Math.max(6, String(text || '').split('\n').length + 1)) * 1.5}em`

  queueMicrotask(() => {
    if (!host.isConnected) return
    const ed = ace.edit(host)
    ed.setTheme('ace/theme/tomorrow_night')
    ed.session.setMode(`ace/mode/${mode}`)
    ed.session.setUseWorker(false)
    ed.setValue(String(text == null ? '' : text), -1)
    ed.setReadOnly(true)
    ed.setOptions({
      highlightActiveLine: false,
      highlightGutterLine: false,
      showPrintMargin: false,
      fontSize: 12,
      // NOT WRAPPED, for a side-by-side. Wrapping makes one row taller than its
      // opposite number, and then the two columns say different things at the
      // same height — which is the one thing this view exists to avoid.
      wrap: false,
      showFoldWidgets: false
    })
    ed.renderer.$cursorLayer.element.style.display = 'none'

    // The line numbers of the ORIGINAL file, not of this pane. A side-by-side is
    // built by padding both sides until they line up, so a pane's own row
    // numbers count padding and are wrong in exactly the way that matters — you
    // cannot use them to find the line in the file.
    if (gutter) {
      try {
        ed.session.gutterRenderer = {
          getWidth: (session, last, config) => (gutter.width || 4) * config.characterWidth,
          getText: (session, row) => gutter.at[row] == null ? '' : String(gutter.at[row])
        }
      } catch { /* an Ace without a gutter renderer still shows its own numbers */ }
    }

    if (onReady) onReady(ed)
  })
  return host
}

// A unified diff, turned into rows that line up.
//
// BUILT FROM THE DIFF, not from the two whole files. Git has already done the
// hard part — which lines correspond — and re-deriving that here would mean
// writing a diff algorithm and getting a different answer from the one every
// other view on this screen shows. What comes back is one row per displayed
// line, each with a left and a right side, either of which can be absent: that
// absence is what makes the columns align, and it is the whole trick.
function alignDiff (text) {
  const rows = []
  let l = 0
  let r = 0
  let dels = []
  let adds = []

  // A run of removals followed by a run of additions is a change, and pairing
  // them index by index is what puts the old line beside the new one. Runs of
  // different lengths leave a blank on the shorter side.
  const flush = () => {
    const n = Math.max(dels.length, adds.length)
    for (let i = 0; i < n; i++) {
      rows.push({
        left: dels[i] ? dels[i].text : null,
        leftNo: dels[i] ? dels[i].no : null,
        right: adds[i] ? adds[i].text : null,
        rightNo: adds[i] ? adds[i].no : null,
        kind: 'change'
      })
    }
    dels = []
    adds = []
  }

  for (const line of String(text || '').split('\n')) {
    if (line.startsWith('@@')) {
      flush()
      const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (m) { l = Number(m[1]); r = Number(m[2]) }
      rows.push({ left: line, leftNo: null, right: line, rightNo: null, kind: 'hunk' })
      continue
    }
    // Everything before the first hunk is git's header — which file, what mode,
    // which blobs. Worth keeping, and not a line of either side.
    if (!rows.length && !line.startsWith('@@')) {
      if (/^(diff |index |--- |\+\+\+ |new file|deleted file|similarity|rename |old mode|new mode|Binary )/.test(line)) continue
    }
    if (line.startsWith('-')) { dels.push({ text: line.slice(1), no: l++ }); continue }
    if (line.startsWith('+')) { adds.push({ text: line.slice(1), no: r++ }); continue }
    flush()
    if (line.startsWith('\\')) continue // "\ No newline at end of file"
    const text2 = line.startsWith(' ') ? line.slice(1) : line
    rows.push({ left: text2, leftNo: l++, right: text2, rightNo: r++, kind: 'same' })
  }
  flush()
  return rows
}

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

// ---- the notice bar ---------------------------------------------------

let noticeTimer
function say (text, kind = 'ok') {
  const bar = $('notice')
  bar.className = `notice ${kind}`
  fill(bar,
    el('span', { textContent: text }),
    el('button', { className: 'notice-x', textContent: '×', onclick: () => bar.classList.add('hidden') }))
  clearTimeout(noticeTimer)
  if (kind === 'ok') noticeTimer = setTimeout(() => bar.classList.add('hidden'), 6000)
}
const oops = e => say(e.message, 'bad')

// ---- where you were ---------------------------------------------------
//
// The window is restarted constantly -- every change to server.js needs one --
// and it came back on the machines tab with nothing selected every time. So the
// cost of a restart was not the four seconds, it was finding your place again,
// and that is paid by whoever is working ON this tool rather than by the tool.
//
// localStorage rather than the data directory: this is where a person was
// looking, which is a property of this window and of nothing else. The command
// line has no view to restore and should not acquire one.
//
// Every read is guarded. A window that will not open because it could not
// remember which tab was showing would be a poor trade for the convenience.
const been = {
  get (key, fallback) {
    try {
      const raw = localStorage.getItem(`okc.${key}`)
      return raw === null ? fallback : JSON.parse(raw)
    } catch { return fallback }
  },
  set (key, value) {
    try { localStorage.setItem(`okc.${key}`, JSON.stringify(value)) } catch { /* private mode, or a full disk */ }
  }
}

// ---- tabs -------------------------------------------------------------

// Branches, not machines, for a window nobody has used before. It is the head of
// the chain everything else hangs off -- a branch holds the work, a task
// produces it, a machine is what a task borrows -- and the markup's `active`
// class has to agree with this or a fresh window shows one tab selected and a
// different one's panel.
let view = been.get('view', 'branches')
document.querySelectorAll('.tab').forEach(b => {
  b.onclick = () => {
    const from = view
    view = b.dataset.view
    been.set('view', view)
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === b))
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`))
    if (view === 'live') clearBadge()

    // SAID INTO THE LOG, because the log is the only thing anything outside
    // this window can watch. A session following the stream can otherwise see
    // every machine, task and branch change and not the one thing that says
    // what the person is actually looking at -- which is most of the context
    // for "why are they asking about this".
    //
    // Only on a real change: switching to the tab you are on is a click that
    // says nothing, and a watcher full of those learns to ignore the tag.
    if (from !== view) liveLog.on('window').info(`looking at ${view}`)
  }
})
const showTab = name => document.querySelector(`.tab[data-view="${name}"]`).click()

// Applied immediately, before anything is drawn.
//
// Not through showTab(): that would clear the live badge as a side effect of
// restoring a view somebody has not looked at yet, and would report output
// arriving while the window was closed as though it had been read.
;(() => {
  const tab = document.querySelector(`.tab[data-view="${view}"]`)
  if (!tab) { view = 'ops'; return }
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === tab))
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`))
})()

// ---- the dialog ------------------------------------------------------
//
// One dialog, used by everything. In-page rather than native confirm() because it
// carries what a native one cannot: what the action does in plain words, what it
// costs when that cannot be undone, and any fields it needs. A confirm() would
// reduce all of that to a sentence and an OK button.

// `extra` is a second way out: one more button beside the confirm, for a dialog
// where the other thing you might have come to do is not a variation of the
// confirm but its opposite. It closes this dialog and does its own asking, so
// something irreversible still states its cost on its own screen rather than
// borrowing the consent given to whatever was on this one.
// Opened in the browser you actually use, not in this window.
//
// This page is an app page: an ordinary <a href> navigates the DASHBOARD to the
// address, which replaces the window with a sign-in page and loses everything
// on screen -- including the dialog waiting for the code. nw.Shell.openExternal
// hands it to the operating system instead.
//
// The address is still shown as selectable text beside it, because a link that
// silently fails to open leaves nothing to fall back on, and this one is the
// only way to finish what was started on the machine.
function externalLink (url) {
  const open = () => {
    // The current API first; `nw.gui` is the old name and is only reached if the
    // global is missing, which would mean this is not the app page it thinks it
    // is. Either way a failure says so rather than doing nothing, because a
    // button that quietly does not work is the failure this whole window is
    // written against.
    try {
      nw.Shell.openExternal(url)
    } catch {
      try { require('nw.gui').Shell.openExternal(url) } catch { say('Could not open a browser — copy the address below instead.', 'bad') }
    }
  }
  return el('div', { style: 'margin: 4px 0 12px' },
    el('button', { className: 'btn ok', textContent: 'Open the sign-in page', onclick: open }),
    el('p', {
      className: 'mono',
      style: 'margin:8px 0 0; color:var(--muted); word-break:break-all; user-select:text',
      textContent: url
    }))
}

// `tabs` is a second whole dialog behind the first, for when one button leads to
// two genuinely different ways of doing the same thing -- writing a task from
// nothing, or picking one that is already written down. They are not variations
// of each other: different fields, different confirm, different consequence. A
// single dialog trying to be both grows a mode switch and a set of fields that
// are ignored half the time.
//
// Each tab is `{ label, plain, cost, fields, confirm, danger, onYes }` and the
// outer arguments are the first tab's defaults.
function ask ({ title, plain, cost, link, fields = [], confirm, danger, onYes, extra, tabs, _tabsBar }) {
  const errBox = el('p', { className: 'dlg-err hidden' })
  const inputs = {}

  // Rebuilt rather than hidden and shown, because a tab's fields are what get
  // read on confirm: leaving the other tab's inputs in the tree means whichever
  // was touched last decides what is submitted.
  if (tabs && tabs.length) {
    let open = 0
    const draw = () => {
      const t = tabs[open]
      document.querySelectorAll('.dlg-overlay').forEach(o => o.remove())
      ask({
        title,
        link,
        plain: t.plain || plain,
        cost: t.cost || cost,
        fields: t.fields || [],
        confirm: t.confirm || confirm,
        danger: t.danger || danger,
        onYes: t.onYes || onYes,
        _tabsBar: el('div', { className: 'dlg-tabs' }, ...tabs.map((x, i) =>
          el('button', {
            className: `dlg-tab ${i === open ? 'active' : ''}`,
            textContent: x.label,
            onclick: () => { open = i; draw() }
          })))
      })
    }
    return draw()
  }

  const yes = el('button', { className: `btn ${danger ? 'danger' : 'ok'}`, textContent: confirm })
  const no = el('button', { className: 'btn', textContent: 'Never mind' })
  const other = extra
    ? el('button', {
        className: `btn ${extra.danger ? 'danger' : ''}`,
        textContent: extra.label,
        onclick: () => { close(); extra.onClick() }
      })
    : null

  // The middle scrolls; the title and the buttons do not.
  //
  // A dialog can now carry a diff or a whole definition, and those are as long
  // as they are -- so without this the confirm button ends up below the bottom
  // of the screen, on a fixed overlay that does not scroll, and the dialog
  // cannot be answered at all. The thing being read is what should move, not the
  // question being asked about it.
  const body = el('div', { className: 'dlg-body' },
    plain && plain.length
      ? el('div', {},
          el('div', { className: 'dlg-heading', textContent: 'What this does' }),
          el('ul', {}, ...plain.map(p => el('li', { textContent: p }))))
      : null,
    cost ? el('div', { className: 'dlg-cost' }, el('strong', { textContent: 'Cannot be undone: ' }), cost) : null,
    link ? externalLink(link) : null)

  const overlay = el('div', { className: 'dlg-overlay' },
    el('div', { className: 'dlg' },
      el('div', { className: 'dlg-title', textContent: title }),
      _tabsBar || null,
      body,
      errBox,
      el('div', { className: 'dlg-actions' }, no, other, yes)))

  // Fields go in the scrolling half, after whatever explains them.
  for (const f of fields) {
    // A list of real choices beats a path to type out, and it cannot be typed
    // wrong. Three kinds, because a brief is prose and a one-line input turns
    // prose into a slot you scroll sideways through -- what a worker is actually
    // told is the most important text on the screen and should be readable while
    // it is being written.
    const input = f.options
      ? el('select', {}, ...f.options.map(o =>
          el('option', { value: o.value, textContent: o.label, selected: o.value === f.value })))
      : f.multiline
        ? el('textarea', { placeholder: f.placeholder || '', value: f.value || '', rows: f.rows || 8 })
        : el('input', { placeholder: f.placeholder || '', value: f.value || '', type: f.type || 'text' })
    inputs[f.name] = input
    body.append(el('div', {}, el('label', { textContent: f.label }), input))
  }

  const close = () => overlay.remove()
  no.onclick = close
  overlay.onclick = e => { if (e.target === overlay) close() }
  yes.onclick = async () => {
    yes.disabled = true
    try {
      const values = {}
      for (const k in inputs) values[k] = inputs[k].value.trim()
      await onYes(values)
      close()
      await draw()
    } catch (e) {
      errBox.textContent = e.message
      errBox.classList.remove('hidden')
      yes.disabled = false
    }
  }
  document.body.append(overlay)
  const first = Object.values(inputs)[0]
  ;(first || yes).focus()
}

// A picture, shown at the size it was taken and no larger.
//
// Read here rather than sent through the action, because this window is on the
// same machine that wrote the file -- so the action returns a path, which is
// what the command line wants anyway, and the two callers each take the form
// that suits them instead of one carrying a megabyte of base64 for the other.
//
// A data URI rather than file://, which an app page loaded from disk treats as a
// different origin and refuses often enough not to rely on.
function showImage ({ title, file, note }) {
  const fsMod = require('node:fs')
  let src
  try {
    src = `data:image/png;base64,${fsMod.readFileSync(file).toString('base64')}`
  } catch (e) {
    return oops(new Error(`The picture was taken but could not be read back: ${e.message}`))
  }

  const close = () => overlay.remove()
  const overlay = el('div', { className: 'dlg-overlay' },
    el('div', { className: 'dlg', style: 'max-width: 90vw' },
      el('div', { className: 'dlg-title', textContent: title }),
      el('img', { src, style: 'max-width:100%; max-height:70vh; display:block; border:1px solid var(--line); border-radius:6px' }),
      // Said, and selectable, because the whole point of keeping the file is
      // being able to go and find it.
      el('p', { className: 'note mono', style: 'margin-top:10px; user-select:text', textContent: file }),
      note ? el('p', { className: 'note', textContent: note }) : null,
      el('div', { className: 'dlg-actions' }, el('button', { className: 'btn', textContent: 'Close', onclick: close }))))

  overlay.onclick = e => { if (e.target === overlay) close() }
  document.body.append(overlay)
}

// ---- keys ------------------------------------------------------------
//
// The sign-in is a conversation with a program running on a machine: it prints
// an address, a person visits it, and a code comes back. So it is two dialogs
// rather than one, and the machine holds its half open in between -- which is
// the whole reason this is not a single button that either works or does not.

function paintKeys () {
  api('credentialsHeld').then(held => {
    setText($('keys-context'), held.held ? `— taken from ${held.from}` : '— none yet')
    if (!changed('keys', held)) return

    // WHAT THE STATE ACTUALLY IS, from the two things that know: the credential's
    // own refresh-token clock, and the last time a machine really tried it.
    //
    // They are shown as two rows and not merged into one verdict, because they
    // disagree in a way that matters and the disagreement IS the information.
    // This host's credential says "four weeks left" and a worker says "OAuth
    // session expired" — the clock is not lying, it is answering a different
    // question, since a refresh rotates the token and one grabbed from a machine
    // that refreshed since is already superseded.
    const life = held.life || {}
    const tried = held.checked || null
    const dead = life.usable === false || (tried && tried.ready === false)
    const proven = tried && tried.ready === true

    fill($('keys'), held.held
      ? el('div', { className: `card${dead ? ' warn' : ''}` },
          el('div', { className: 'card-title' },
            el('span', { textContent: 'Claude Code' }),
            el('span', {
              className: `badge ${dead ? 'bad' : proven ? 'ok' : 'warn'}`,
              textContent: dead ? 'will not work' : proven ? 'working' : 'not tried yet'
            })),
          el('table', { className: 'kv', style: 'margin-top:8px' },
            // The headline: how long is left, and on which clock.
            el('tr', {}, el('th', { textContent: 'time left' }),
              el('td', {}, life.refresh
                ? el('span', {
                    className: life.refresh.expired ? 'bad' : '',
                    textContent: life.refresh.expired
                      ? `expired ${lasts(life.refresh.left)} ago`
                      : `${lasts(life.refresh.left)} — until ${new Date(life.refresh.at).toLocaleString()}`
                  })
                : el('span', { className: 'muted', textContent: life.readable ? 'it does not say' : (life.why || 'unreadable') }))),
            // The short clock, which is expired almost always and means nothing
            // on its own. Said anyway, because otherwise somebody reads it
            // elsewhere and draws the wrong conclusion from it.
            life.access
              ? el('tr', {}, el('th', { textContent: 'session token' }),
                  el('td', { className: 'muted' },
                    life.access.expired
                      ? `expired ${lasts(life.access.left)} ago — normal, it is refreshed when needed`
                      : `${lasts(life.access.left)} left`))
              : null,
            // The only proof there is.
            el('tr', {}, el('th', { textContent: 'last tried' }),
              el('td', {}, tried
                ? el('span', {
                    className: tried.ready ? 'ok' : 'bad',
                    textContent: `${tried.ready ? 'worked' : 'refused'} on ${tried.on}, ${ago(tried.at)}`
                  })
                : el('span', { className: 'muted', textContent: 'never — no machine has used it since it was taken' }))),
            life.plan ? el('tr', {}, el('th', { textContent: 'plan' }), el('td', { className: 'mono', textContent: life.plan })) : null,
            el('tr', {}, el('th', { textContent: 'taken from' }), el('td', { className: 'mono', textContent: held.from })),
            el('tr', {}, el('th', { textContent: 'when' }), el('td', { className: 'mono', textContent: `${new Date(held.taken).toLocaleString()} — ${ago(held.taken)}` })),
            // The path, not the contents. A page that shows a secret is a page
            // that ends up in a screenshot.
            el('tr', {}, el('th', { textContent: 'kept in' }), el('td', { className: 'mono', style: 'user-select:text', textContent: held.dir })),
            // Which protection is actually holding, not which one was intended.
            // "Encrypted for this account" and "the folder happens to be yours"
            // are different answers to "is this safe here", and only one of them
            // survives the file being copied somewhere else.
            el('tr', {}, el('th', { textContent: 'at rest' }),
              el('td', {}, el('span', { className: `badge ${held.sealed ? 'ok' : 'warn'}`, textContent: held.sealed ? 'sealed' : 'plain' }))),
            el('tr', {}, el('th', { textContent: '' }), el('td', { className: 'muted', textContent: held.protection || '' }))),

          // WHAT TO DO ABOUT IT, beside the thing that is wrong. A panel that
          // reports a dead credential and leaves the cure on another row of the
          // page is a panel somebody reads twice and acts on neither time.
          el('p', { className: 'note', style: 'margin-top:10px', textContent: dead
            ? (life.usable === false ? life.why : 'A machine tried it and the worker reported itself signed out. Only a person at a sign-in page can replace it.')
            : proven
              ? 'Handed to a machine per task and taken back afterwards, so no machine keeps it and none can be snapshotted while holding one.'
              : 'It has not been tried since it was taken. Testing it takes a machine for a minute or two and settles it now, rather than a task finding out.' }),

          // BOTH, ALWAYS. Replacing was offered only while the credential was
          // known bad — so a freshly signed-in one had no way to be replaced,
          // and the moment somebody most wants to redo a sign-in is right after
          // one that went wrong in a way nothing detected.
          el('div', { className: 'row' },
            el('button', {
              className: `btn ${dead ? '' : 'ok'}`,
              textContent: proven ? 'Test it again' : 'Test it on a machine',
              title: 'Borrows a free machine, hands it the credential, asks the worker, then takes it back and puts the machine away',
              onclick: () => testCredentials()
            }),
            el('button', {
              className: `btn ${dead ? 'ok' : ''}`,
              textContent: 'Sign in again and replace it',
              onclick: () => getCredentials()
            })))
      : el('div', {},
          el('p', { className: 'empty', textContent: 'No worker credential yet, so nothing on a machine can run claude.' }),
          el('button', { className: 'btn ok', textContent: 'Sign in and get one', onclick: () => getCredentials() })))
  }).catch(() => { /* the tab is not worth an error bar of its own */ })
}

// ---- tasks -----------------------------------------------------------
//
// The work half of the window. A task is written, given to a machine, and judged
// on what came back -- and what comes back is a BRANCH.
//
// Which is why the artifact panel is read from the repositories on this host and
// never from the machine. Everything else on this screen is somebody's account
// of the work: the state a person set, the run the worker started, what its
// transcript says it did. The branch is the work. Where they disagree the branch
// is right, and a panel that mixed the two would let the account win.

let pickedTask = been.get('task', null)
let taskList = []

// What a task's card and its detail panel read, including what the buttons close
// over. A field missed here is a panel that silently stops updating, which is
// worse than the flicker the signature exists to prevent.
// WHO DOES IT, and with what. The task carries a `worker` slot and until now
// nothing on the screen said which one was set -- so a task written for a person
// and a task written for Claude looked identical on the board, and the only way
// to find out which was to give it to a machine and see what happened.
//
// `person` says VS Code specifically because that is what taskWorkOn opens, and
// Claude runs in its integrated terminal there -- so a person task is not "no
// worker", it is a person and Claude in the same window.
const WORKERS = {
  claude: { label: 'Claude', cls: 'run', long: 'Claude, run by the queue on a machine.' },
  shell: { label: 'shell', cls: 'muted', long: 'A shell command on a machine, with no model involved.' },
  person: { label: 'VS Code', cls: 'ok', long: 'You, in VS Code on the machine — with Claude in its integrated terminal.' }
}
const workerOf = t => WORKERS[t && t.worker] || WORKERS.claude

const taskKey = t => t && [
  t.number,
  t.id, t.title, t.branch, t.state, t.reads, t.machine || '', t.run || '', t.worker || '',
  t.delivered, t.artifact, t.contract || '', (t.verdict && t.verdict.call) || ''
]

const STATE_BADGE = {
  draft: 'muted',
  queued: 'warn',
  'done, nothing delivered': 'bad',
  done: 'muted',
  working: 'warn',
  delivered: 'ok',
  accepted: 'ok',
  rejected: 'bad'
}

function paintTasks (queued) {
  Promise.all([api('tasks'), api('planned')]).then(([{ tasks }, plan]) => {
    taskList = tasks
    // Reconciled against what exists, for the same reason the machine selection
    // is: a task remembered from the last window may have been thrown away
    // since, and falling back to the newest is better than a panel showing
    // nothing with no explanation.
    if (!tasks.some(t => t.id === pickedTask)) {
      pickedTask = tasks.length ? tasks[0].id : null
      been.set('task', pickedTask)
    }

    // ASKED FOR HERE, where it can be seen.
    //
    // Approval was reachable only from inside the write-a-task dialog, three
    // clicks in — so ten definitions could sit waiting and the window said
    // nothing at all, which is indistinguishable from there being none. A
    // decision that has to be sought out is a decision that does not get made.
    const waiting = plan.waiting + plan.lapsed
    if (changed('approvals', [plan.waiting, plan.lapsed])) {
      fill($('approvals'), waiting
        ? el('div', { className: 'card wants' },
            el('div', { className: 'card-title' },
              el('span', { textContent: `${waiting} pre-defined task${waiting === 1 ? '' : 's'} waiting for you` }),
              el('span', { className: 'badge warn', textContent: 'needs reading' })),
            el('div', { className: 'card-sub muted', textContent: plan.lapsed
              ? `${plan.waiting} never read, ${plan.lapsed} changed since you approved them.`
              : 'Written by a model. Nothing runs until you have read it and said so.' }),
            el('button', { className: 'btn ok', style: 'margin-top:8px', textContent: 'Read them', onclick: () => readDefinition() }))
        : null)
      $('approvals').classList.toggle('hidden', !waiting)
    }
    setText($('tasks-badge'), waiting ? String(waiting) : '')
    $('tasks-badge').classList.toggle('hidden', !waiting)

    if (changed('tasks', [tasks.map(taskKey), pickedTask])) {
      fill($('tasks'), tasks.length
        // `pick` and `on`, which are the classes that exist. This said `picked`,
        // a name nothing in the stylesheet matches — so the click worked, the
        // panel changed, and the list gave no cursor, no hover and no highlight
        // to say which one was chosen. A control that responds without looking
        // like a control reads as broken, and is reported as "not selectable".
        ? tasks.map(t => el('div', {
            className: `card pick${t.id === pickedTask ? ' on' : ''}`,
            onclick: () => { pickedTask = t.id; been.set('task', pickedTask); draw() }
          },
          el('div', { className: 'card-title' },
            el('span', {}, el('span', { className: 'muted mono', textContent: '#' + t.number + ' ' }), t.title),
            el('span', { className: `badge ${STATE_BADGE[t.reads] || 'muted'}`, textContent: t.reads })),
          el('div', { className: 'card-sub mono', textContent: t.branch }),
          el('div', { className: 'card-sub' },
            el('span', { className: `badge ${workerOf(t).cls}`, textContent: workerOf(t).label }),
            el('span', { className: 'muted', style: 'margin-left:6px', textContent: t.artifact }))))
        : el('p', { className: 'empty', textContent: 'No tasks yet. Write one with +.' }))
    }

    paintQueue(queued)

    const task = tasks.find(t => t.id === pickedTask)
    setText($('task-context'), task ? `— #${task.number}  ${task.id}` : '— nothing selected')
    paintTaskDetail(task)
    paintHistory(task)
    paintArtifact(task)
  }).catch(e => {
    // SAID, not swallowed. This was quiet on purpose and that was wrong: a
    // panel that shows nothing when it is broken looks exactly like a panel
    // with nothing to show, and the difference is the whole question a person
    // is asking when they look at an empty tab.
    if (changed('tasks-error', e.message)) {
      fill($('tasks'), el('p', { className: 'empty', textContent: `The board could not be read: ${e.message}` }))
    }
  })
}

// What the queue is doing, and why it is not doing anything.
//
// Shown only when there is something to say — work waiting, work running, or a
// machine held back. An empty queue with everything free is the ordinary state
// and does not need a panel announcing it.
//
// The REASONS are the point. "Nothing is queued" and "everything is queued and
// no machine can take it" look identical from outside and want opposite
// responses, and the four ways a machine can be unavailable each want a
// different one: release it, snapshot it, put it back in the pool, or wait.
function paintQueue (q) {
  // Handed in rather than fetched. drawOnce already asked, and asking twice per
  // draw doubles a call that walks every machine -- which is a VBoxManage
  // process each. A window that polls every three seconds cannot afford to ask
  // the same question twice out of tidiness.
  Promise.resolve(q || api('queueState')).then(q => {
    const held = q.machines.filter(m => !m.free)
    const worth = q.waiting.length || q.inFlight.length || held.some(m => /kept back/.test(m.why))
    $('queue').classList.toggle('hidden', !worth)
    if (!worth || !changed('queue', q)) return

    fill($('queue'), el('div', { className: 'card' },
      el('div', { className: 'card-title' },
        el('span', { textContent: 'The queue' }),
        el('span', {
          className: `badge ${q.inFlight.length ? 'run' : q.waiting.length ? 'warn' : 'muted'}`,
          textContent: q.inFlight.length ? `${q.inFlight.length} running` : q.waiting.length ? `${q.waiting.length} waiting` : 'idle'
        })),
      ...q.inFlight.map(f => el('div', { className: 'card-sub', textContent: `${f.task} on ${f.machine}` })),
      ...q.waiting.map(w => el('div', { className: 'card-sub muted', textContent: `#${w.number} ${w.title} — waiting` })),
      // Only the ones that cannot take work. A list of free machines is noise
      // on the normal case and makes the exception harder to find.
      ...held.map(m => el('div', { className: 'card-sub muted', textContent: `${m.name} ${m.why}` })),
      q.machines.some(m => m.free) || !q.waiting.length
        ? null
        : el('div', { className: 'card-sub bad', textContent: 'Nothing can take it. It stays queued until something can.' })))
  }).catch(() => { /* the board already says if the dashboard is unreachable */ })
}

function paintTaskDetail (task) {
  if (!changed('task-detail', task && taskKey(task))) return
  if (!task) return fill($('task-detail'), el('p', { className: 'empty', textContent: 'Select a task.' }))

  const idle = latest.vms.filter(v => v.connected)

  fill($('task-detail'),
    el('table', { className: 'kv' },
      el('tr', {}, el('th', { textContent: 'branch' }), el('td', { className: 'mono', style: 'user-select:text', textContent: task.branch })),
      el('tr', {}, el('th', { textContent: 'state' }), el('td', {}, el('span', { className: `badge ${STATE_BADGE[task.reads] || 'muted'}`, textContent: task.reads }))),
      el('tr', {}, el('th', { textContent: 'worked by' }),
        el('td', {}, el('span', { className: `badge ${workerOf(task).cls}`, textContent: workerOf(task).label }),
          el('div', { className: 'muted', textContent: workerOf(task).long }))),
      el('tr', {}, el('th', { textContent: 'given to' }), el('td', { className: 'mono', textContent: task.machine || 'nobody yet' })),
      el('tr', {}, el('th', { textContent: 'run' }), el('td', { className: 'mono', textContent: task.run || '—' })),
      // Said whether or not there is one, because "no rules" is the dangerous
      // reading and it is also the silent one: a task with no contract looks
      // exactly like a task with one from everywhere except here.
      el('tr', {}, el('th', { textContent: 'contract' }),
        el('td', {}, task.contract
          ? el('span', { className: 'mono', style: 'user-select:text', textContent: task.contract })
          : el('span', { className: 'badge warn', textContent: 'none — the worker gets no rules' }))),
      task.verdict
        ? el('tr', {}, el('th', { textContent: 'verdict' }),
            el('td', {}, el('span', { className: `badge ${task.verdict.call === 'accept' ? 'ok' : 'bad'}`, textContent: task.verdict.call }),
              el('div', { className: 'muted', textContent: task.verdict.note || '' })))
        : null),

    el('div', { className: 'dlg-heading', style: 'margin-top:12px', textContent: 'The brief, as the worker gets it' }),
    el('pre', { className: 'console short', style: 'user-select:text', textContent: task.brief }),

    // What has become of it, and what is becoming of it. Filled in separately,
    // because it asks the machine and the board must stay cheap to redraw.
    el('div', { className: 'dlg-heading', style: 'margin-top:12px', textContent: 'Attempts' }),
    el('div', { id: 'task-history' }, el('p', { className: 'muted', textContent: '…' })),

    el('div', { className: 'row', style: 'margin-top:12px' },
      // THE WORKER SLOT DECIDES HOW IT STARTS, and until now nothing did.
      //
      // A task written for a person offered "Queue it" and "Give it to a machine
      // now" — both of which dispatch Claude. So the board could hold a task that
      // said VS Code and whose only two buttons handed it to a model, and a
      // person task written for later had no way to be started as itself at all.
      // Same shape as the buttons taken off the machines tab, arrived at from
      // inside a task: the tool could do the thing, so the window offered it,
      // without asking whether it was the thing this task said.
      task.worker === 'person'
        ? el('button', {
            className: 'btn ok',
            textContent: task.machine ? 'Open VS Code again' : 'Work on it in VS Code',
            disabled: !!task.verdict,
            title: task.verdict ? 'This task has been judged' : 'A machine is brought up on its branch with VS Code open in it',
            onclick: () => takeTaskByHand(task, 'editor')
          })
        : task.state === 'queued'
        ? el('button', {
            className: 'btn',
            textContent: 'Take it out of the queue',
            onclick: async () => { await api('taskUnqueue', { id: task.id }); say(`#${task.number} is back to a draft.`); draw() }
          })
        : el('button', {
            className: 'btn ok',
            textContent: 'Queue it',
            disabled: !!task.verdict,
            title: task.verdict ? 'This task has been judged' : 'The next free machine takes it, runs it, and shuts down',
            onclick: () => queueTask(task)
          }),
      // THE SECOND DOOR ONTO THE SAME TASK. Same machine, same branch, same
      // credential, same finish — a terminal instead of an editor, landed in the
      // checkout, with nothing typed into it. This is what the Terminal tab's
      // machine picker used to be for, minus the part where the work had no
      // task: booting a machine and typing `claude` in its shell was the way
      // this was done by hand before any of it existed, and it is a way of
      // working, not a way of starting work.
      task.worker === 'person'
        ? el('button', {
            className: 'btn',
            textContent: task.machine ? 'Open a terminal again' : 'Work on it in a terminal',
            disabled: !!task.verdict,
            title: task.verdict ? 'This task has been judged' : 'A machine is brought up on its branch and a shell opens here, in the checkout',
            onclick: () => takeTaskByHand(task, 'terminal')
          })
        : null,

      // The other half of the person path: saying it is done. It is the exact
      // counterpart of a worker's exit code, and without it on the task itself
      // the only way to end one was from the machine that happened to be holding
      // it — which is the machines tab deciding a task's fate again.
      task.worker === 'person'
        ? (task.machine
            ? el('button', {
                className: 'btn',
                textContent: 'Finish it',
                title: 'Gives the machine back and puts the task up for a verdict',
                onclick: () => finishTaskByHand(task)
              })
            : null)
        : el('button', {
            className: 'btn',
            textContent: task.machine ? 'Give it out again' : 'Give it to a machine now',
            disabled: !idle.length || !!task.verdict,
            title: !idle.length ? 'No machine is dialled in' : task.verdict ? 'This task has been judged' : 'Skips the queue and uses a machine that is already up',
            onclick: () => giveTask(task, idle)
          }),
      // Only while something is actually running, because that is the only time
      // it means anything — and it is the button somebody wants at the moment
      // they would otherwise be opening a shell on the guest.
      // AND ONLY WHEN THERE IS A RUN TO STOP. A person's task reads as "working"
      // the same way a worker's does, and there is no process on the other end of
      // it -- "Stop it" would have killed nothing and reported the task lost.
      task.reads === 'working' && task.run
        ? el('button', {
            className: 'btn danger',
            textContent: 'Stop it',
            onclick: () => ask({
              title: `Stop #${task.number}?`,
              plain: [
                'The worker is killed, along with anything it started.',
                'Whatever it had already committed and pushed is here and is not touched. Whatever it had not is lost with the machine.',
                'The machine is then put away as usual — credential taken back, shut down, rolled back — so it is free for other work.'
              ],
              cost: 'The run ends with no result. It reads as `lost`, which is what it is.',
              confirm: 'Stop it',
              danger: true,
              onYes: async () => {
                const r = await api('taskStop', { id: task.id })
                say(`${r.run} ${r.outcome}. ${r.note}`)
              }
            })
          })
        : null,

      el('button', {
        className: 'btn',
        textContent: 'Judge it',
        disabled: !task.delivered,
        title: task.delivered ? '' : 'Nothing has arrived on this branch yet',
        onclick: () => judgeTask(task)
      }),

      // Sending it back is the answer to a rejection, and the rule is that the
      // answer is never "fix it yourself".
      task.state === 'rejected'
        ? el('button', {
            className: 'btn ok',
            textContent: 'Send it back',
            title: 'Re-queue it on the same branch, with the reason attached',
            onclick: () => ask({
              title: `Send #${task.number} back?`,
              plain: [
                'The reason you gave is appended to the brief, dated, so the worker sees both what was asked and what was wrong with the answer.',
                `It goes back in the queue on ${task.branch}, which still carries the first attempt — so the next machine continues rather than starting again.`,
                'The verdict is kept in the record.'
              ],
              confirm: 'Send it back',
              onYes: async () => {
                const r = await api('taskSendBack', { id: task.id })
                say(r.note)
              }
            })
          })
        : null,
      el('button', {
        className: 'btn danger',
        textContent: 'Throw it away',
        onclick: () => ask({
          title: `Throw away "${task.title}"?`,
          plain: [
            'Forgets what was asked, who it went to and any verdict.',
            `Leaves the branch "${task.branch}" exactly as it is — the work that came back is not touched.`
          ],
          cost: 'The brief and the verdict are gone. What was delivered is not.',
          confirm: 'Throw it away',
          danger: true,
          onYes: async () => { await api('taskRemove', { id: task.id }); pickedTask = null; say('Task removed. Its branch is untouched.') }
        })
      })))
}

// What has become of a task, and what is becoming of it.
//
// Its own request, throttled, because it asks the MACHINE and the board redraws
// every few seconds. The board must stay cheap; this is one task at a time,
// while somebody is looking at it.
//
// It also causes a finished run's log to be pulled here and kept — the machine
// is the disposable half of this tool, and rolling one back takes the only
// account of what happened with it unless somebody has copied it first.
let historyAt = 0
function paintHistory (task) {
  const box = $('task-history')
  if (!box) return
  if (!task) return
  // Ten seconds, not three. This is a guest round trip; the board is not.
  if (Date.now() - historyAt < 10000 && drawnFrom.has('history-' + task.id)) return
  historyAt = Date.now()

  api('taskProgress', { id: task.id }).then(p => {
    if (!changed('history-' + task.id, p)) return
    const box2 = $('task-history')
    if (!box2) return

    // `ended` means the machine is gone and we cannot ask how it went — which is
    // not the same as it having failed. Reading it as a failure would paint most
    // finished tasks red, because the queue shuts a machine down the moment its
    // work ends.
    const badge = a => a.state === 'running' ? 'run'
      : a.state === 'lost' ? 'bad'
        : a.state === 'ended' ? 'muted'
          : a.exit === 0 ? 'ok' : 'bad'
    const said = a => a.state === 'gone' ? 'the machine no longer has it'
      : a.state === 'ended' ? 'ended — its machine has been put away'
        : a.state || 'unknown'
    fill(box2,
      p.attempts.length
        ? p.attempts.map((a, i) => el('div', { className: 'card' },
            el('div', { className: 'card-title' },
              el('span', { textContent: `attempt ${i + 1} — ${a.machine || 'unknown'}` }),
              el('span', { className: `badge ${badge(a)}`, textContent: said(a) })),
            el('div', { className: 'card-sub mono', textContent: a.run }),
            el('div', { className: 'card-sub muted', textContent: a.at ? new Date(a.at).toLocaleString() : '' }),
            // Where the minutes actually went. A total says nothing about
            // whether the machine took eight of them to boot, and half of every
            // task here is the machine being made ready.
            a.spent
              ? el('div', { className: 'card-sub muted', textContent: Object.entries(a.spent)
                  .filter(([k]) => k !== 'total')
                  .map(([k, ms]) => `${k} ${Math.round(ms / 1000)}s`).join(' · ') +
                  (a.spent.total ? `  —  ${Math.round(a.spent.total / 1000)}s in all` : '') })
              : null,
            a.failed ? el('div', { className: 'card-sub bad', textContent: a.failed }) : null,
            // Only when there is something kept to read. A button that opens
            // nothing is worse than no button.
            a.kept
              ? el('button', { className: 'btn', style: 'margin-top:6px', textContent: 'Read its log', onclick: () => showLog(task, a.run) })
              : el('div', { className: 'card-sub muted', textContent: a.state === 'running' ? 'still going; the log is kept when it ends' : 'no log was kept for this attempt' })))
        : el('p', { className: 'empty', textContent: p.why || 'never given out' }),

      // What it is doing NOW, which is the question a running task provokes and
      // which nothing on this screen answered before.
      p.live
        ? el('div', { style: 'margin-top:10px' },
            el('div', { className: 'dlg-heading', textContent: `Right now — ${p.live.title || 'working'}${typeof p.live.idle === 'number' ? `, quiet ${p.live.idle}s` : ''}` }),
            el('div', { className: 'console short', style: 'user-select:text' },
              ...(p.live.entries.length
                ? p.live.entries.map(e => el('div', { className: 'line' },
                    el('span', { className: 't', textContent: e.kind }),
                    el('span', { textContent: e.text })))
                : [el('div', { className: 'muted', textContent: 'nothing said yet' })])))
        : null)
  }).catch(e => {
    const box2 = $('task-history')
    if (box2 && changed('history-err-' + task.id, e.message)) {
      fill(box2, el('p', { className: 'empty', textContent: `Could not be read: ${e.message}` }))
    }
  })
}

function showLog (task, run) {
  api('taskLog', { id: task.id, run, lines: 400 }).then(l => {
    ask({
      title: `${task.title} — ${run}`,
      plain: [
        l.found ? `Kept on this host, so it survives the machine that produced it.` : 'Nothing was kept for that run.',
        l.found ? `${l.lines} lines${l.more ? `, showing the last ${l.lines - l.more}` : ''}. Full file: ${l.file}` : ''
      ].filter(Boolean),
      confirm: 'Done',
      onYes: async () => {}
    })
    const body = document.querySelector('.dlg-body')
    if (body) body.append(codeBlock(l.text || '(nothing)', 'markdown', { lines: 22 }))
  }).catch(oops)
}

// What actually arrived, read the way a pull request is read.
function paintArtifact (task) {
  setText($('artifact-context'), task ? `— ${task.branch}` : '')
  if (!task) {
    if (changed('artifact', null)) fill($('artifact'), el('p', { className: 'empty', textContent: 'Select a task.' }))
    return
  }

  api('taskArtifact', { id: task.id }).then(art => {
    if (!changed('artifact', [task.id, art])) return

    const carrying = art.repos.filter(r => !r.missing && !r.empty)
    fill($('artifact'),
      el('p', { className: art.delivered ? 'note' : 'empty', textContent: art.summary }),

      // Reported per repository, including the ones with nothing, because "the
      // branch is not there" and "the branch is there and empty" mean different
      // things about what happened and only one of them is a worker that failed
      // to push.
      ...art.repos.map(r => el('div', { className: 'card' },
        el('div', { className: 'card-title' },
          el('span', { className: 'mono', textContent: r.repo }),
          el('span', {
            className: `badge ${r.missing ? 'muted' : r.empty ? 'warn' : 'ok'}`,
            textContent: r.missing ? 'never pushed' : r.empty ? 'nothing beyond ' + r.base : `+${r.added} −${r.removed}`
          })),
        r.missing || r.empty ? null : el('div', {},
          el('div', { className: 'card-sub muted', textContent: `${r.ahead} commit${r.ahead === 1 ? '' : 's'} on top of ${r.base}` }),
          ...r.commits.map(c => el('div', { className: 'card-sub' },
            el('span', { className: 'mono', textContent: c.sha }),
            el('span', { textContent: ' ' + c.subject }))),
          r.more ? el('div', { className: 'card-sub muted', textContent: `and ${r.more} more` }) : null,
          el('div', { className: 'card-sub muted', style: 'margin-top:6px', textContent: r.files.map(f => f.file).join(', ') + (r.moreFiles ? ` and ${r.moreFiles} more` : '') }),
          el('button', {
            className: 'btn', style: 'margin-top:8px', textContent: 'Read the changes',
            onclick: () => showDiff(task, r.repo)
          }))))
    )
  }).catch(() => { /* a branch that does not exist yet is not an error */ })
}

function showDiff (task, repo) {
  api('taskDiff', { id: task.id, repo }).then(({ diff }) => {
    ask({
      title: `${repo} — ${task.branch}`,
      plain: [`Everything this branch adds to ${repo}, against the branch it was cut from.`],
      confirm: 'Done',
      onYes: async () => {}
    })
    // Put in after the dialog exists rather than through a field, because a diff
    // is neither a bullet nor an input: it is long, it is read rather than
    // answered, and it needs to scroll and be selectable.
    const body = document.querySelector('.dlg-body')
    if (body) body.append(codeBlock(diff || 'no changes', 'diff', { lines: 22 }))
  }).catch(oops)
}

function queueTask (task) {
  api('queueState').then(q => {
    const can = q.machines.filter(m => m.free)
    ask({
      title: `Queue #${task.number} "${task.title}"`,
      plain: [
        'It waits here until a machine is free. No machine is chosen now — the first one that can take it does.',
        'That machine is rolled back to its base snapshot before it starts, so the work begins on a clean machine every time.',
        'When the run ends, its log is kept here, the credential is taken back, and the machine is shut down again.',
        can.length
          ? `Free right now: ${can.map(m => m.name).join(', ')}.`
          : `Nothing can take it yet — ${q.machines.map(m => `${m.name} ${m.why}`).join('; ')}. It will wait.`
      ],
      cost: `The machine that takes it is rolled back to its base snapshot first. Anything on it that is not on a branch here is discarded.`,
      confirm: 'Queue it',
      onYes: async () => {
        const r = await api('taskQueue', { id: task.id })
        say(`#${task.number} queued. ${r.note}`)
      }
    })
  }).catch(oops)
}

function giveTask (task, idle) {
  ask({
    title: `Give "${task.title}" to a machine`,
    plain: [
      `Sets that machine's workspace up on ${task.branch}, in every repository.`,
      'Then dispatches the brief and lets go — the work runs unattended and this returns as soon as it has started.',
      task.contract ? 'The contract is read from this host and carried with the run.' : 'No contract: the worker is given no rules beyond the brief.'
    ],
    cost: 'The machine stays on this branch until it is clean. There is no way to move it off except going back to a snapshot from before.',
    fields: [{
      name: 'name',
      label: 'Which machine does it',
      value: (idle.find(v => v.name === task.machine) || idle[0]).name,
      options: idle.map(v => ({ value: v.name, label: `${v.name} — ${v.description || v.stage}` }))
    }],
    confirm: 'Give it out',
    onYes: async ({ name }) => {
      const r = await api('taskGive', { id: task.id, name })
      say(`${name} is working on ${task.title} — run ${r.run}`)
    }
  })
}

function judgeTask (task) {
  ask({
    title: `Judge "${task.title}"`,
    plain: [
      'Records what you decided about what arrived, and who decided it.',
      'It does NOT merge anything. Landing work is a separate act with its own rules, and a verdict that quietly merged would make reading the work and publishing it the same button.'
    ],
    fields: [
      { name: 'verdict', label: 'Verdict', value: 'accept', options: [{ value: 'accept', label: 'Accept' }, { value: 'reject', label: 'Reject — send it back' }] },
      { name: 'note', label: 'Why (required to reject)', multiline: true, rows: 4, placeholder: 'What is wrong, in the words the worker will be given.' }
    ],
    confirm: 'Record it',
    onYes: async ({ verdict, note }) => {
      await api('taskJudge', { id: task.id, verdict, note })
      say(`Recorded: ${verdict}ed.`)
    }
  })
}

// Two ways in, and they are deliberately not variations of each other.
//
// WRITING a task is authoring work. PICKING a pre-defined one is not: it is
// choosing from work that has already been decided, written down, and reviewed
// while nobody was in a hurry.
//
// That distinction is the point of the second tab rather than a convenience. A
// supervisor -- a person or a session running this -- should be picking from the
// plan, not inventing a task at the moment of dispatch, because a task invented
// then has been reviewed by nobody and is judged afterwards by whoever wrote it.
// Authoring belongs to the operator, at a keyboard, in the first tab.
function newTask () {
  Promise.all([api('gitBranches'), api('planned')]).then(([{ branches: known, protected: guarded }, plan]) => {
    const taken = new Set((guarded || []).map(g => g.branch))

    // Flattened for a list. The suite is what a drill is FOR, so it travels with
    // the name rather than being a heading somebody has to scroll back to.
    // The approval state is in the label rather than beside it, because this is
    // a dropdown and there is nowhere beside it. An unapproved drill is still
    // listed: hiding it would leave a person wondering where the thing they
    // asked for went, and the refusal on confirm says what to do.
    const mark = t => t.approved ? 'approved' : t.lapsed ? 'CHANGED since you approved it' : 'not yet approved'
    const choices = (plan.suites || []).flatMap(s =>
      s.tests.map(t => ({ value: s.name + '::' + t.name, label: `${t.name}  [${mark(t)}]` })))

    ask({
      title: 'A task for a worker',
      tabs: [
        {
          label: 'Write a task',
          plain: [
            'A task is what a worker is told, and the branch it delivers on.',
            'That branch is the artifact: it is what comes back, and what gets judged.',
            'Nothing is given out yet — writing a task touches no machine.'
          ],
          fields: [
            { name: 'title', label: 'Title', placeholder: 'Short enough to read in a list' },
            { name: 'branch', label: 'Branch it delivers on', placeholder: 'fix/the-thing' },
            { name: 'brief', label: 'The brief — what the worker is actually told', multiline: true, rows: 10, placeholder: 'Write it as instructions to somebody who cannot ask you a question.' },
            { name: 'contract', label: 'Contract (a file on this host, optional)', placeholder: 'the rules the worker is given' },
            { name: 'folder', label: 'Folder on the machine (optional)', placeholder: 'defaults to its workspace' }
          ],
          confirm: 'Write it',
          onYes: async values => {
            if (taken.has(values.branch)) throw new Error(`"${values.branch}" is protected here. Work is merged into it, never done on it.`)
            const made = await api('taskCreate', { task: values })
            pickedTask = made.id
            say(`Task "${made.title}" written, delivering on ${made.branch}. Known branches: ${(known || []).length}.`)
          }
        },
        {
          label: `Pre-defined${plan.waiting + plan.lapsed ? ` (${plan.waiting + plan.lapsed} to read)` : ''}`,
          plain: [
            'Work decided in advance and written down, rather than invented at the moment of dispatch.',
            'A model writes these when you ask it to. You approve them. Only then can one be run — including by the model that wrote it.',
            'Half of them pass by being REFUSED: a drill that is stopped is a drill that passed.',
            'This RUNS the one you pick. It is not written to the board first.'
          ],
          cost: choices.length
            ? 'Some occupy a machine for several minutes and leave a branch behind. Progress goes to the live log.'
            : null,
          fields: choices.length
            ? [
                { name: 'pick', label: 'Which one', value: choices[0].value, options: choices },
                {
                  name: 'machine',
                  label: 'On which machine (only some need one)',
                  value: (latest.vms.find(v => v.connected) || {}).name || '',
                  options: [{ value: '', label: 'none' }, ...latest.vms.filter(v => v.connected).map(v => ({ value: v.name, label: v.name }))]
                }
              ]
            : [],
          confirm: choices.length ? 'Run it' : 'Nothing is registered',
          // The way to approve, and it is a second button rather than a
          // checkbox beside the run: approving is reading, and it needs a
          // screen of its own with the definition on it.
          extra: choices.length ? { label: 'Read it…', onClick: () => readDefinition() } : null,
          onYes: async ({ pick, machine }) => {
            const cut = String(pick).indexOf('::')
            const suite = String(pick).slice(0, cut)
            const name = String(pick).slice(cut + 2)
            showTab('live')
            say(`Running "${name}" — watch the live log.`)
            const r = await api('plannedRun', { suite, name, machine: machine || undefined })
            say(r.failed
              ? `${name}: ${r.failed} failed, ${r.passed} passed in ${r.seconds}s`
              : `${name}: passed in ${r.seconds}s`, r.failed ? 'bad' : 'ok')
          }
        }
      ]
    })
  }).catch(oops)
}

// Reading a definition, and deciding about it.
//
// THE DEFINITION IS ON THE SCREEN. That is the whole of this dialog: approving
// something you have not read is not approval, and a button that says "approve"
// beside a name is a button that gets pressed without anybody having looked. So
// the source of what will actually run is here, and the button is underneath it.
//
// Only in the window. `plannedApprove` refuses over the socket, because that is
// the socket a supervising model drives — and a model approving a definition it
// wrote is the one path nothing reviews.
function readDefinition (which) {
  api('planned').then(plan => {
    const all = (plan.suites || []).flatMap(s => s.tests.map(t => ({ suite: s.name, ...t })))
    // Whatever most needs reading, when nothing was named: something changed
    // since it was approved first, then something never read at all.
    const t = (which && all.find(x => x.name === which)) ||
      all.find(x => x.lapsed) || all.find(x => !x.approved) || all[0]
    if (!t) return oops(new Error('Nothing is registered.'))

    const others = all.filter(x => x.name !== t.name)

    ask({
      title: t.name,
      plain: [
        `From "${t.suite}".`,
        t.approved
          ? `You approved this on ${new Date(t.at).toLocaleString()}.${t.note ? ` Note: ${t.note}` : ''}`
          : `This ${t.why}`,
        'An approval is recorded against this exact source and lapses if it changes, so approving cannot be inherited by a later edit.'
      ],
      cost: t.approved ? null : 'Approving it means a supervising session may run it without asking you again.',
      fields: [
        { name: 'note', label: 'A note, if you want one on the record', value: t.note || '', placeholder: 'why this is alright to run' },
        others.length
          ? { name: 'next', label: 'Read another instead', value: '', options: [{ value: '', label: '— stay on this one —' }, ...others.map(o => ({ value: o.name, label: `${o.name} [${o.approved ? 'approved' : o.lapsed ? 'CHANGED' : 'not approved'}]` }))] }
          : null
      ].filter(Boolean),
      confirm: t.approved ? 'Keep it approved' : 'Approve it',
      extra: t.approved ? { label: 'Withdraw approval', danger: true, onClick: () => api('plannedWithdraw', { suite: t.suite, name: t.name }).then(() => say(`Approval withdrawn for "${t.name}".`)).catch(oops) } : null,
      onYes: async ({ note, next }) => {
        if (next) return setTimeout(() => readDefinition(next), 0)
        await api('plannedApprove', { suite: t.suite, name: t.name, note })
        say(`Approved "${t.name}".`)
      }
    })

    // Inserted after the dialog exists, for the same reason a diff is: source is
    // read, not answered, and it needs to scroll and be selectable.
    const body = document.querySelector('.dlg-body')
    if (body) {
      body.append(el('div', { className: 'dlg-heading', textContent: 'What it does, exactly' }))
      body.append(codeBlock(t.source, 'javascript', { lines: 20 }))
    }
  }).catch(oops)
}

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

// Which branches are worth looking at by default.
//
// A workspace accumulates names -- a drill's branch outlives the drill, somebody
// cuts one by hand -- and a list that shows everything equally is the confusion
// this tab exists to remove rather than to display. So the default is what this
// system made or is using, and the toggle is right there for the rest.
const oursOnly = b => b.protected || b.tasks.length || b.heldBy || b.orphaned

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
document.querySelectorAll('.subtab[data-pane]').forEach(b => {
  b.onclick = () => {
    branchPane = b.dataset.pane
    been.set('branch-pane', branchPane)
    document.querySelectorAll('.subtab[data-pane]').forEach(x => x.classList.toggle('active', x === b))
    document.querySelectorAll('.pane').forEach(p => p.classList.toggle('active', p.id === `pane-${branchPane}`))
    // Painted at once rather than on the next tick, or switching to a pane that
    // has never been drawn shows an empty one for up to three seconds.
    paintBranches()
  }
})

// Applied before anything is drawn, so the remembered pane and the markup agree.
;(() => {
  const tab = document.querySelector(`.subtab[data-pane="${branchPane}"]`)
  if (!tab) { branchPane = 'overview'; return }
  document.querySelectorAll('.subtab[data-pane]').forEach(x => x.classList.toggle('active', x === tab))
  document.querySelectorAll('.pane').forEach(p => p.classList.toggle('active', p.id === `pane-${branchPane}`))
})()

function paintBranches () {
  if (view !== 'branches') return
  // Said before the asking, not after: the gap this fills is the time the answer
  // takes to arrive.
  waiting('branches', { cards: 4 })
  waiting('branch-actions', { lines: 4 })
  waiting('branch-artifacts', { lines: 6 })
  api('branchBoard').then(board => {
    const find = $('branch-find').value.trim().toLowerCase()
    const mine = $('branch-mine').checked
    const rows = board.branches
      // THE SELECTED ONE IS ALWAYS SHOWN, whatever the filter says. Two columns
      // describe it, and a selection you cannot see is worse than a row the
      // filter would rather hide -- the panels then look like they belong to
      // something else on screen, or to nothing.
      .filter(b => b.name === pickedBranch || !mine || oursOnly(b))
      .filter(b => b.name === pickedBranch || !find || b.name.toLowerCase().includes(find))

    // Against the WHOLE board rather than the filtered rows: typing in the
    // finder should not silently move the selection to something else.
    if (!board.branches.some(b => b.name === pickedBranch)) {
      // Not the first row, which is alphabetical and therefore usually the
      // default branch -- the one branch where every action is refused and there
      // is nothing to read. Landing there says "this tab does nothing".
      const worth = rows.find(b => !b.protected) || rows[0] || board.branches[0]
      pickedBranch = (worth || {}).name || null
      been.set('branch', pickedBranch)
    }

    const c = board.counts
    // WHAT IS NOT ON SCREEN, SAID WHERE THE COUNT IS. The chips describe the
    // whole workspace and the list is filtered, so "4 in all" above three rows
    // reads as a fault in the list rather than as a filter doing its job. It is
    // the count that has to say so, because it is the count that is disagreed
    // with -- and it is worth keeping the board-wide numbers, since "there is an
    // orphan somewhere" is exactly the thing a filtered list would hide.
    const hidden = board.branches.length - rows.length

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
        hidden
          ? el('button', {
              className: 'chip warn linky-chip',
              textContent: `${hidden} hidden — show`,
              onclick: () => { $('branch-mine').checked = false; changed('branches', null); paintBranches() }
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

      fill($('branches'), rows.length
        ? rows.map(branchCard)
        : el('p', { className: 'empty', textContent: mine ? 'Nothing this system made. Untick "ours" to see the rest.' : 'No branches match.' }))
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
          onclick: () => { pickedGroup = g.name; been.set('group', pickedGroup); changed('baselines', null); paintBaselines() }
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
        changed('baselines', null)
        changed('branches', null)
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
      changed('baselines', null)
      changed('change', null)
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
      changed('baselines', null)
      changed('change', null)
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
      changed('baselines', null)
      changed('branches', null)
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
// EVERY PANEL HERE FILLS FROM AN ACTION, so the first frame after switching to a
// tab is empty -- and an empty panel is indistinguishable from a panel whose
// answer is "nothing". That is not a small difference: "no branches" and "not
// asked yet" look identical and mean opposite things.
//
// A WORD IN THE GAP WAS NOT ENOUGH. It is easy to miss, it can be mistaken for
// the answer, and -- the part that mattered -- when the Branches tab
// photographed blank on a cold start, the placeholder was not there either, and
// there was no way to tell whether the panel had painted an empty state or had
// not painted at all. A shape is unmistakable in a screenshot, and its absence
// is now evidence rather than ambiguity.
//
// ONLY WHEN THERE IS NOTHING THERE. Blanking a panel that already has content on
// every refresh would make the whole window flicker every three seconds, which is
// a worse fault than the one being fixed.
const skelLine = width => el('div', { className: 'skel skel-line', ...(width ? { style: `width:${width}` } : {}) })

const skelCard = () => el('div', { className: 'skel-card' }, skelLine(), skelLine())

function waiting (id, { cards = 0, lines = 0 } = {}) {
  const box = $(id)
  if (box.childElementCount) return
  const shapes = []
  for (let n = 0; n < cards; n++) shapes.push(skelCard())
  // Ragged on purpose: equal-length bars read as a table with no data, and
  // uneven ones read as text that has not arrived.
  const widths = ['70%', '45%', '85%', '60%']
  for (let n = 0; n < lines; n++) shapes.push(skelLine(widths[n % widths.length]))
  fill(box, shapes)
}

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
                'markdown', { lines: Math.min(8, Math.max(2, r.commits.length * 2)) })))
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
    if (body) body.append(codeBlock(diff || 'no changes', 'diff', { lines: 22 }))
  }).catch(oops)
}

// Choosing which folder of repositories this is about.
//
// SWITCHING IS GUARDED, and the dialog says so before offering it rather than
// refusing afterwards: a machine set up on a branch cannot be reasoned about
// from a workspace that has no such branch, so anything holding one has to be
// finished or put away first. The same list the action refuses with is shown
// here, or the window would offer something the action turns down.
function chooseWorkspace () {
  api('workspaces').then(w => {
    const stuck = w.inTheWay || []
    ask({
      title: 'Which repositories is this about?',
      plain: [
        `Serving ${w.current.dir} — ${(w.known.find(k => k.current) || {}).repos || 0} repositories.`,
        'Tasks, branch reasons and baselines belong to a workspace and follow it. The machines are this host\'s and do not move.',
        stuck.length
          ? `Cannot switch while ${stuck.map(s => s.why).join('; ')}.`
          : 'Nothing is holding a machine, so switching is safe.'
      ],
      fields: [
        {
          name: 'dir',
          label: 'Use',
          value: w.current.dir,
          options: w.known.map(k => ({
            value: k.dir,
            label: `${k.name}${k.current ? ' (in use)' : ''}${k.there ? ` — ${k.repos} repo${k.repos === 1 ? '' : 's'}` : ' — MISSING'}`
          }))
        },
        // Adding is the same field as choosing, because typing a path somewhere
        // it is not already known is exactly how a new one arrives.
        { name: 'add', label: 'Or a folder it has not seen', value: '', placeholder: 'C:\\path\\to\\a\\folder\\of\\repositories' }
      ],
      confirm: 'Use it',
      onYes: async f => {
        const where = (f.add || '').trim() || f.dir
        if (!where) throw new Error('Say which folder.')
        if ((f.add || '').trim()) await api('workspaceAdd', { dir: where })
        const now = await api('workspaceUse', { dir: where })
        // Everything on screen is about the old one until it is redrawn.
        for (const key of ['branches', 'baselines', 'branch-actions', 'branch-carries', 'tasks', 'vms']) changed(key, null)
        say(now.changed ? `Now serving ${now.dir} — ${(now.repos || []).length} repositories.` : now.note)
        return draw()
      }
    })
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
      { name: 'branch', label: 'Name', placeholder: 'task/what-it-is-for' },
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
      changed('branches', null)
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
      changed('branches', null)
      changed('baselines', null)
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
      changed('tasks', null)
      changed('branches', null)

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
      changed('tasks', null)
      changed('branches', null)
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
      changed('branches', null)
      changed('tasks', null)

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

// ---- shells on machines ------------------------------------------------
//
// THE PTY IS AT THE FAR END. `ssh -tt` allocates one on the machine, which is
// where the shell actually is; this side only moves bytes between a child
// process and a terminal widget. That matters because a pty on THIS side would
// mean a compiled native module matching NW.js's Node ABI, and this app has no
// native modules on purpose.
//
// Spawned from the window rather than through an action, and that is not a
// hole in "one surface": the command line's half of this is `vmShell`, which
// does the same thing with the same key. What cannot be shared is the terminal —
// the dashboard has none to hand over, and an interactive session needs the one
// the person is sitting at.
//
// SEVERAL AT ONCE, each its own tab. A terminal is mostly somewhere you wait —
// for a build, for a sign-in, for an agent to say something — and needing a
// second one while the first is busy is the ordinary case, not the exotic one.
//
// EACH TAB OWNS ITS OWN Terminal, WHICH IS ALSO THE FIX FOR A REAL BUG. The
// first version made one widget and reused it. `onData` registers a handler and
// hands back a disposable; reusing the widget meant registering again on every
// open without ever disposing, so after closing one shell and opening another
// each keystroke was written to stdin TWICE — once per session ever opened.
// It looked like a stuck key rather than a leak, which is why it took a person
// noticing rather than anything here reporting it. Nothing is shared between
// shells now, so there is nothing left to leak.
let shells = []
let active = null
let shellSeq = 0

const shellFor = id => shells.find(s => s.id === id) || null

// A shell on a machine, in this window.
//
// `what` names the shell in the tab strip and `cwd` is the folder it lands in --
// the two things that made this a machine-picker rather than a place work
// arrives at. It returns the shell so a caller can hold on to one.
//
// IT LANDS YOU IN BASH AND STOPS. It does not run `claude` for you, and that is
// deliberate: the point of a terminal is that a person is at it. Typing the
// command is how they decide what session this is, and a window that types it
// for them has taken the one decision the terminal was opened to make.
function openShell (name, { what = null, cwd = null, task = null } = {}) {
  return api('vmShell', { name }).then(where => {
    const { spawn } = require('node:child_process')

    // Its own element, its own widget, its own child process. The element is
    // what the tab switches between, so a hidden shell keeps its scrollback and
    // its running command rather than being torn down and rebuilt.
    const holder = el('div', { className: 'term-pane' })
    $('term').append(holder)

    const term = new Terminal({
      fontFamily: 'Consolas, "Cascadia Mono", monospace',
      fontSize: 13,
      // Matches the window rather than xterm's default black, so a terminal
      // sitting in this page does not look like a hole cut in it.
      theme: { background: '#0a0d12', foreground: '#c9d1d9', cursor: '#58a6ff' },
      cursorBlink: true,
      // Kept, because the whole point of a terminal is reading what went past.
      scrollback: 5000
    })
    const fit = new FitAddon.FitAddon()
    term.loadAddon(fit)
    term.open(holder)

    // -tt FORCES a pty even though our stdin is a pipe rather than a terminal.
    // Without it ssh notices there is no terminal here and runs the command
    // without one, which gives a shell with no prompt, no line editing and no
    // job control -- something that looks like a broken terminal rather than a
    // deliberate one.
    const args = [
      '-tt',
      ...(where.identity ? ['-o', `IdentityFile=${String(where.identity).split('\\').join('/')}`, '-o', 'IdentitiesOnly=yes'] : []),
      '-o', 'StrictHostKeyChecking=accept-new',
      where.target
    ]

    const shell = {
      id: ++shellSeq,
      name,
      // What this shell IS, rather than only which machine it is on. A strip of
      // tabs all reading "runner1" is what a machine-picker produces; a strip
      // reading "#25 claude" is what work arriving produces.
      what,
      task,
      target: where.target,
      live: where.live,
      term,
      fit,
      holder,
      child: spawn('ssh', args, { windowsHide: true }),
      // Every handler this shell registered, so closing it takes them with it.
      off: [],
      ended: false
    }
    shells.push(shell)

    const write = t => { try { shell.child && shell.child.stdin.write(t) } catch { /* it has gone */ } }
    // Kept on the shell as well, so something outside this closure can say
    // things into it. It was the missing half of driving one from anywhere else.
    shell.write = write

    // WHAT WE TYPED IS TAKEN BACK OUT OF WHAT COMES BACK.
    //
    // The remote pty's size can only be changed by running `stty` in it, and
    // running something in a shell means typing it — which the shell then echoes,
    // so every resize printed `stty rows 44 cols 168` into the terminal a person
    // is trying to read. That was reported as the terminal being buggy, and it
    // was: the tool's own housekeeping was being shown as though the user had
    // typed it.
    //
    // So a command sent by this code is registered before it goes, and struck
    // from the first output that contains it. Exact match, first occurrence,
    // once — if it does not match, nothing is removed and the worst case is what
    // happened before.
    shell.hush = []
    const scrub = text => {
      for (let i = 0; i < shell.hush.length; i++) {
        const at = text.indexOf(shell.hush[i])
        if (at === -1) continue
        // The echo carries the newline that ended it, in either spelling.
        const end = at + shell.hush[i].length
        const skip = text.startsWith('\r\n', end) ? 2 : (text[end] === '\r' || text[end] === '\n') ? 1 : 0
        text = text.slice(0, at) + text.slice(end + skip)
        shell.hush.splice(i, 1)
        i--
      }
      return text
    }

    shell.child.stdout.on('data', d => term.write(scrub(d.toString('utf8'))))
    shell.child.stderr.on('data', d => term.write(scrub(d.toString('utf8'))))
    shell.off.push(term.onData(write))

    // The remote pty is created at ssh's idea of our size, which is 80x24
    // because we have no terminal here. Telling the far end the real size is the
    // only way anything full-screen -- an editor, `less`, `top` -- lays out
    // correctly, and it has to be said again whenever the window changes.
    // Said once the dragging stops, not on every frame of it. A resize produces
    // a burst of these — one per column crossed — and each one was a command run
    // in the shell, so the cost of widening a window was thirty prompts.
    const quietly = cmd => { shell.hush.push(cmd); write(`${cmd}\n`) }
    let resizing = null
    shell.off.push(term.onResize(() => {
      clearTimeout(resizing)
      resizing = setTimeout(() => quietly(`stty rows ${term.rows} cols ${term.cols} 2>/dev/null`), 400)
    }))
    // Closing takes the pending resize with it, or a shell disposed mid-drag
    // writes to a child that has gone.
    shell.off.push({ dispose: () => clearTimeout(resizing) })
    // The size, and the folder the work is in, once the login has finished.
    //
    // NOTHING IS CLEARED. This used to end in `; clear`, which wiped the login
    // banner — the distribution, the update count, the last-login line — and left
    // a bare prompt. That was reported as the banner not showing, and "cleared by
    // something" was exactly right: the thing a person reads first to know which
    // machine they are on was being erased a moment after it arrived, by us.
    //
    // Sent through `quietly`, so the housekeeping does not appear as though it
    // had been typed. What remains visible is one fresh prompt, which is honest:
    // something ran.
    //
    // Quoted, because the folder came from a dialog somebody can type in and
    // this is a line being handed to a shell.
    setTimeout(() => quietly(
      `stty rows ${term.rows} cols ${term.cols} 2>/dev/null` +
      (cwd ? `; cd '${String(cwd).split("'").join("'\\''")}' 2>/dev/null || echo "could not enter ${String(cwd).split('"').join('')}"` : '')
    ), 700)

    shell.child.on('close', code => {
      term.write(`\r\n\x1b[38;5;244m[the session ended${code ? ` — ssh exited ${code}` : ''}]\x1b[0m\r\n`)
      shell.child = null
      shell.ended = true
      // Left open on purpose. Whatever it said before it died is the reason it
      // died, and closing the tab automatically would take that away at exactly
      // the moment it is worth reading.
      paintShellTabs()
    })
    shell.child.on('error', e => term.write(`\r\n\x1b[31m[could not start ssh: ${e.message}]\x1b[0m\r\n`))

    showShell(shell)
    // Handed back so a caller can hold on to it. The catch belongs to whoever
    // asked -- a task opening one wants the failure said next to the task.
    return shell
  })
}

// The box gets whatever is left of the window, measured rather than assumed.
//
// What sits above it is a header, a banner that is sometimes several lines and
// sometimes absent, a note, a sign-in line and a strip of tabs. A stylesheet
// cannot subtract that -- the first version tried, with `100vh - 200px`, and the
// page grew a scrollbar with the terminal running off the bottom the moment two
// of those rows were added. Asking the element where it ended up is exact and
// stays exact.
function sizeTerminal () {
  const box = $('term')
  if (view !== 'terminal') return
  const top = box.getBoundingClientRect().top
  // The 16 is main's own bottom padding, which is a real constant rather than a
  // guess at a layout.
  box.style.height = `${Math.max(240, Math.round(window.innerHeight - top - 16))}px`
}

function showShell (shell) {
  active = shell || null
  for (const s of shells) s.holder.classList.toggle('on', s === active)
  paintShellTabs()
  if (!active) return
  // Sized and THEN fitted, in that order: fit measures the container, so fitting
  // before the container has its height measures the old one.
  sizeTerminal()
  // Fitted only once visible: a terminal laid out inside a hidden element
  // measures zero and comes back at the wrong size.
  try { active.fit.fit() } catch { /* not laid out yet */ }
  active.term.focus()
}

function closeShell (shell) {
  if (!shell) return
  if (shell.child) { try { shell.child.kill() } catch { /* already gone */ } }
  // Disposed EXPLICITLY, both the handlers and the widget. This is the half
  // that was missing before: a killed child stops producing output, but a
  // handler on a widget that outlives it goes on delivering keystrokes.
  for (const d of shell.off) { try { d.dispose() } catch { /* already gone */ } }
  try { shell.term.dispose() } catch { /* already gone */ }
  shell.holder.remove()
  shells = shells.filter(s => s !== shell)
  if (active === shell) showShell(shells[shells.length - 1] || null)
  else paintShellTabs()
}

function paintShellTabs () {
  const bar = $('term-tabs')
  bar.classList.toggle('hidden', !shells.length)
  fill(bar, shells.map(s => el('span', {
    className: `term-tab${s === active ? ' on' : ''}${s.ended ? ' ended' : ''}`,
    onclick: () => showShell(s),
    title: `${s.target}${s.ended ? ' — this session has ended' : ''}`
  },
  // What the shell is for, and the machine second. Two shells opened for two
  // tasks on the same machine were "runner1" and "runner1 #2" -- true, and no
  // help at all in picking the one you meant.
  el('span', { textContent: s.what ? `${s.what} · ${s.name}` : `${s.name}${shells.filter(o => o.name === s.name).length > 1 ? ` #${s.id}` : ''}` }),
  el('button', {
    className: 'term-x',
    textContent: '×',
    title: 'close this shell',
    onclick: e => { e.stopPropagation(); closeShell(s) }
  }))))

  setText($('term-context'), active
    ? `— ${active.target}${active.live ? '' : ' (last known address)'}${active.ended ? ', ended' : ''}`
    : '')
  $('term-close').disabled = !active
  // The sign-in line describes the front tab, so it moves when the front tab
  // does rather than waiting for the next draw.
  paintTermAuth()
}

// Whether the worker in the shell you are looking at can authenticate.
//
// HERE BECAUSE THIS IS WHERE IT BITES. Typing `claude` in a shell on a machine
// that is signed out gets a sign-in menu, because a runner's credential is
// handed to it per task and taken back afterwards — so a machine sitting idle is
// signed OUT by design, and the way to fix that was a command line only.
//
// IT FOLLOWS THE ACTIVE TAB now, not a picker, because the picker is gone. That
// is also the more useful question: it used to describe a machine somebody was
// considering, and now it describes the shell they are actually sitting in.
//
// Not probed. The dashboard already records who is holding one, because a
// machine holding a credential is the thing that cannot be snapshotted.
function paintTermAuth () {
  const name = active && active.name
  const vm = latest.vms.find(v => v.name === name)
  const box = $('term-auth')
  if (!vm) { box.classList.add('hidden'); return }
  box.classList.remove('hidden')

  const held = latest.credentialsHeld || {}
  if (!changed('term-auth', [name, vm.holdsCredential, !!held.held])) return

  const has = vm.holdsCredential
  fill(box, el('div', { className: `authline ${has ? 'ok' : ''}` },
    el('strong', { textContent: has ? `claude is signed in on ${name}. ` : `claude is signed out on ${name}. ` }),
    el('span', {
      textContent: has
        ? 'It is holding this host\'s worker credential, which also means it cannot be snapshotted until that is taken back.'
        : held.held
          ? 'A runner is handed a credential per task and it is taken back afterwards, so an idle one is signed out by design.'
          : 'This host holds no worker credential either. Sign one machine in on the Keys tab first.'
    }),
    has
      ? el('button', {
          className: 'btn danger small',
          textContent: 'Take it back',
          onclick: () => api('vmCredentialsForget', { name })
            .then(() => say(`${name} no longer holds a credential.`)).catch(oops)
        })
      : held.held
        ? el('button', {
            className: 'btn ok small',
            textContent: 'Sign it in',
            onclick: () => api('vmCredentialsPut', { name })
              .then(() => say(`${name} is ready — credential placed and the first-run wizard marked done. A claude already running will not notice; start it again.`))
              .catch(oops)
          })
        : null))
}

function paintTerminal () {
  // AN AREA WORK ARRIVES AT. The machine picker and its "Open a shell" button
  // stood here, and they were the last way in this window to end up on a machine
  // with nothing saying what the work is. What replaces them is a sentence
  // saying where terminals come from -- shown only when there are none, because
  // once one has landed the tab strip says it better.
  const idle = !shells.length
  $('term').classList.toggle('hidden', idle)
  $('term-empty').classList.toggle('hidden', !idle)
  // Said here as well as in paintShellTabs, which only runs once a shell has
  // existed — so on a window where none ever has, the button sat there looking
  // like something you could press.
  $('term-close').disabled = !active
  if (idle && changed('term-empty', true)) {
    fill($('term-empty'), el('div', { className: 'panel' },
      el('p', { className: 'empty', textContent: 'No terminals are open.' }),
      el('p', { className: 'empty', textContent: 'They start from a task, the same way VS Code does — take a task and choose "in a terminal", and the shell lands here with the branch checked out and the machine signed in. Then type claude, or anything else.' }),
      el('button', {
        className: 'btn',
        textContent: 'Go to the tasks',
        onclick: () => showTab('tasks')
      })))
  }
  if (!idle) changed('term-empty', false)

  paintTermAuth()
  // Resized and refitted every draw, because what sits above the box changes on
  // its own: the banner appears and disappears with the state of the machines.
  sizeTerminal()
  if (view === 'terminal' && active) { try { active.fit.fit() } catch { /* not open yet */ } }
}

// The two keys this app needs in order to be itself.
//
// Together because they are the same kind of thing: a credential the app owns,
// kept in its own directory rather than in anybody's home, which nothing else
// should have to provide. One is how a machine knows it is talking to this host;
// the other is how this host gets back into a machine when the machine has
// stopped talking.
//
// NEITHER SHOWS A PRIVATE KEY. A fingerprint identifies a key without being one,
// and a window that displays a secret is a window that ends up in a screenshot.
function paintAppKeys () {
  Promise.all([api('sshKey'), api('tlsKey')]).then(([mine, tls]) => {
    if (!changed('app-keys', [mine, tls])) return

    const strangers = (mine.machines || []).filter(m => !m.authorised)

    fill($('app-keys'),
      // ---- ssh ----------------------------------------------------------
      el('div', { className: 'card' },
        el('div', { className: 'card-title' },
          el('span', { textContent: 'ssh — the way back into a machine' }),
          el('span', { className: `badge ${mine.ok ? 'ok' : 'warn'}`, textContent: mine.ok ? 'have one' : 'none yet' })),
        mine.ok
          ? el('table', { className: 'kv', style: 'margin-top:8px' },
              el('tr', {}, el('th', { textContent: 'fingerprint' }), el('td', { className: 'mono', style: 'user-select:text', textContent: mine.fingerprint || '—' })),
              el('tr', {}, el('th', { textContent: 'kept in' }), el('td', { className: 'mono', style: 'user-select:text', textContent: mine.file || '' })),
              el('tr', {}, el('th', { textContent: 'made' }), el('td', { className: 'muted', textContent: mine.made ? new Date(mine.made).toLocaleString() : '—' })))
          : el('p', { className: 'note', textContent: mine.why || '' }),

        // Which machines would actually let it in — a different question from
        // whether the key exists, and the one that matters when you cannot get
        // into something.
        strangers.length
          ? el('div', { className: 'card-sub muted', style: 'margin-top:8px' },
              `${strangers.length} machine${strangers.length === 1 ? '' : 's'} will not accept it: ` +
              `${strangers.map(m => m.name).join(', ')} — built with a different key, and nothing here can change that from outside.`)
          : el('div', { className: 'card-sub muted', style: 'margin-top:8px', textContent: 'Every machine here accepts it.' }),

        el('div', { className: 'row', style: 'margin-top:10px' },
          el('button', {
            className: 'btn',
            textContent: 'Write the ssh config',
            title: 'So ssh and VS Code find these machines by name, using this key',
            onclick: () => api('sshConfig').then(r => say(
              `${r.hosts.length} machine${r.hosts.length === 1 ? '' : 's'} written to ${r.file}${r.include.added ? `, and included from ${r.include.file}` : ''}`
            )).catch(oops)
          }),
          el('button', {
            className: 'btn danger',
            textContent: mine.ok ? 'Make a new one' : 'Make one',
            onclick: () => ask({
              title: mine.ok ? 'Make a new ssh key?' : 'Make this app an ssh key?',
              plain: mine.ok
                ? [
                    'A new key is written, and this one is gone.',
                    'Every machine already built has the OLD public key in its authorized_keys, and nothing here can reach in to change that — the only thing that could is the key being replaced.',
                    'Machines built after this will accept the new one.'
                  ]
                : [
                    'Makes a key belonging to this app, kept beside its certificate.',
                    'New machines are built with it; machines that already exist are not touched.'
                  ],
              cost: mine.ok ? 'This app loses its way into every existing machine. They have to be rebuilt, or given the new key by hand while the old one still works.' : null,
              confirm: mine.ok ? 'Replace it' : 'Make it',
              danger: !!mine.ok,
              onYes: async () => { const r = await api('sshKeyMake', { force: true }); say(`${r.fingerprint} — ${r.note}`) }
            })
          }))),

      // ---- tls ----------------------------------------------------------
      el('div', { className: 'card' },
        el('div', { className: 'card-title' },
          el('span', { textContent: 'https — how a machine knows it is this host' }),
          el('span', {
            className: `badge ${tls.ok ? 'ok' : tls.missing ? 'bad' : 'warn'}`,
            textContent: tls.missing ? 'none' : tls.expired ? 'expired' : !tls.matches ? 'wrong address' : tls.expiringSoon ? 'expiring' : 'good'
          })),
        el('table', { className: 'kv', style: 'margin-top:8px' },
          el('tr', {}, el('th', { textContent: 'names' }), el('td', { className: 'mono', style: 'user-select:text', textContent: (tls.covers || []).join(', ') || '—' })),
          el('tr', {}, el('th', { textContent: 'this host is' }), el('td', { className: 'mono', textContent: tls.address || 'unknown' })),
          el('tr', {}, el('th', { textContent: 'expires' }), el('td', { className: 'muted', textContent: tls.validTo ? `${new Date(tls.validTo).toDateString()} — ${tls.daysLeft} days` : '—' })),
          // Published rather than secret: a brand-new machine checks the
          // authority against this over a connection that is not yet protected,
          // which is what makes the very first fetch possible at all.
          el('tr', {}, el('th', { textContent: 'authority' }), el('td', { className: 'mono', style: 'user-select:text; word-break:break-all', textContent: tls.fingerprint || '—' }))),
        tls.why ? el('div', { className: 'card-sub bad', style: 'margin-top:8px', textContent: tls.why }) : null,

        el('div', { className: 'row', style: 'margin-top:10px' },
          el('button', {
            className: 'btn danger',
            textContent: 'Make a new certificate',
            onclick: () => ask({
              title: 'Make a new certificate?',
              plain: [
                'A new authority and a new certificate, naming this host\'s addresses as they are now.',
                'Every machine already built trusts the OLD authority, which was checked against a fingerprint when it was made. They will refuse the new one.',
                'This is what to do when this host\'s address has changed, or the certificate is close to expiring.'
              ],
              cost: 'Every existing machine has to be set up again before it can fetch scripts or push work.',
              confirm: 'Replace it',
              danger: true,
              onYes: async () => { await api('tlsRegenerate'); say('New certificate. Every machine has to be set up again.') }
            })
          }))))
  }).catch(() => { /* the tab above already says if the dashboard is unreachable */ })
}

// Ask which machine, sign in on it, then take what it got.
// One button, and the machine is clean before and gone afterwards.
//
// IT USED TO ASK WHICH RUNNING MACHINE SHOULD SIGN IN, which put the work in the
// wrong place. Somebody had to have started a machine, know which one was safe to
// use, and then remember three more steps afterwards -- take the credential,
// forget it, put the machine away -- with nothing reminding them. The ordinary
// outcome was a runner left on holding a live credential, which is exactly the
// state the banner nags about.
//
// Now: a free machine is borrowed, brought up at its base snapshot, signed in,
// emptied and put away. Nothing is chosen because there is nothing worth
// choosing, and no machine is left carrying anything.
// Settling it now, rather than a task finding out.
function testCredentials () {
  const free = (queueSays.size ? [...queueSays.values()] : []).filter(m => m.free)
  ask({
    title: 'Test the worker credential',
    plain: [
      'A free machine is borrowed and brought up clean, handed this host\'s credential, and asked whether its worker can actually authenticate.',
      'The credential is taken back off it and the machine is put away afterwards, whatever the answer — a test that leaves a credential on a disk has silently blocked that machine\'s next snapshot.',
      'The answer is kept here, so nothing has to ask again until the credential changes.',
      free.length
        ? `Free right now: ${free.map(m => m.name).join(', ')}.`
        : 'Nothing is free at the moment, so this will refuse and say why.'
    ],
    cost: 'It takes a minute or two to bring a machine up.',
    confirm: 'Test it',
    onYes: async () => {
      const r = await api('credentialsTest', {})
      changed('keys', null)
      say(r.note, r.ready === false ? 'bad' : undefined)
      return draw()
    }
  })
}

function getCredentials () {
  ask({
    title: 'Get Claude Code credentials',
    plain: [
      'A free machine is borrowed and brought up clean, it signs in, this host keeps what it gets, and the machine is put away with nothing left on it.',
      'You will get an address to visit; the machine holds the sign-in open until you bring the code back.',
      'The queue will not touch that machine while this is going on.'
    ],
    cost: 'It takes a minute or two to bring a machine up before there is anything to visit.',
    confirm: 'Start the sign-in',
    onYes: async () => {
      const started = await api('credentialsBegin', {})
      // A second dialog rather than a field on the first, because the address
      // does not exist until a machine has been brought up and asked -- and a
      // form that asks for a code before there is anything to get one from is a
      // form nobody can fill in.
      askForCode(started.name, started.url)
    }
  })
}

function askForCode (name, url) {
  ask({
    title: `Sign ${name} in`,
    plain: [
      'Open the sign-in page, approve it, and paste back what it gives you.',
      `${name} is holding the sign-in open until you do — it is waiting on that page, not on this window.`
    ],
    link: url,
    fields: [{ name: 'code', label: 'The code from that page', placeholder: 'paste it here' }],
    confirm: 'Finish signing in',
    // GIVING UP HAS TO HAND THE MACHINE BACK, or abandoning a sign-in leaves a
    // borrowed runner out of the pool with nobody using it — the exact failure
    // borrowing was meant to stop being possible.
    extra: {
      label: 'Give up',
      onClick: () => api('vmAuthCancel', { name })
        .catch(() => { /* it may never have started; the machine still goes back */ })
        .then(() => api('vmReturn', { name }))
        .then(() => say(`the sign-in on ${name} was abandoned, and ${name} is back in the pool`))
        .catch(oops)
    },
    onYes: async f => {
      if (!f.code) throw new Error('Paste the code from the sign-in page.')
      // One call: the code, the credential taken, and the machine put away
      // clean. Three steps somebody used to have to remember, in the order that
      // leaves nothing behind.
      const done = await api('credentialsFinish', { name, code: f.code })
      say(done.note)
      showTab('keys')
      paintKeys()
      return done
    }
  })
}

// ---- the machines ----------------------------------------------------
//
// Only machines this app made ever appear here. Anything else on the host is
// invisible to every action, because these actions can delete one.

let picked = been.get('vm', null)
let latest = { available: false, vms: [] }

// What the machine is holding, said in the dialog that would destroy it.
//
// Asked first and awaited, so the sentence is in front of the person BEFORE they
// decide rather than in the log afterwards. It costs a second on a machine that
// is dialled in and nothing at all on one that is not.
//
// Three different sentences, because there are three different situations and
// only one of them is "nothing to lose". A machine that could not be asked is
// the important one: it is off, which is exactly the state of a machine nobody
// has looked at recently, and reporting that as "nothing" would be this app
// asserting something it never checked.
const holdingLine = holds => holds.asked
  ? (holds.summary ? `${holds.summary} — all of it goes.` : 'It is holding nothing that is not already here.')
  : `It could not be asked what it is holding: ${holds.why} So this may be discarding work that exists nowhere else.`

// Said only when it is true, and only in the places that have just asked. A
// machine on a branch it may not push is not in danger -- the push refuses --
// but its work has nowhere to go, and nothing said so until somebody tried.
const adriftLines = holds => holds.adrift ? [holds.adrift] : []

const deleteVm = v => api('vmHolds', { name: v.name })
  .catch(() => ({ asked: false, why: 'asking it failed.' }))
  .then(holds => ask({
    title: `Delete ${v.name}?`,
    plain: [
      'No other virtual machine on this computer is touched.',
      holdingLine(holds),
      ...adriftLines(holds)
    ],
    cost: `${v.name} and its disks are deleted, and it is removed from this list.`,
    confirm: 'Delete it',
    danger: true,
    onYes: () => api('vmRemove', { name: v.name }).then(() => {
      if (picked === v.name) picked = null
      say(`${v.name} deleted`)
    })
  }))

// What a machine is for is the question a column of names cannot answer, and it is
// not derivable from anything -- so it is asked for and kept, and it belongs on the
// row rather than behind a selection.
const configVm = v => ask({
  title: `Configure ${v.name}`,
  plain: [
    'The note is yours: it appears beside this machine in the list and changes nothing about the machine.',
    'Everything else about a machine is settled when it is made.'
  ],
  fields: [{ name: 'description', label: 'Note', value: v.description || '', placeholder: 'what this one is for' }],
  confirm: 'Save',
  // Deleting is the other reason to open this, and it is deliberately not the
  // confirm: it asks again on its own screen, where it can state what it costs.
  extra: { label: 'Delete it', danger: true, onClick: () => deleteVm(v) },
  onYes: f => api('vmDescribe', { name: v.name, description: f.description })
    .then(() => say(f.description ? `Note saved for ${v.name}` : `Note cleared for ${v.name}`))
})

// The card carries identity, its note, state, and the way in to both settling that
// note and deleting it. Everything else lives in the one Actions panel rather than
// being repeated per row.
const vmCard = v => el('div', {
  className: `card pick${picked === v.name ? ' on' : ''}`,
  onclick: () => { picked = v.name; been.set('vm', picked); paintVms() }
},
  el('div', { className: 'card-title' },
    el('span', { className: 'mono', textContent: v.name }),
    el('button', {
      className: 'cog',
      title: `Configure ${v.name}`,
      textContent: '⚙',
      // Or selecting the row would also fire, and a click meant for this would
      // change what the panels are pointing at underneath the dialog.
      onclick: e => { e.stopPropagation(); configVm(v) }
    })),
  v.description ? el('div', { className: 'card-sub', textContent: v.description }) : null,
  el('div', { className: 'badges' },
    el('span', { className: `badge ${v.running ? 'ok' : ''}`, textContent: v.running ? 'running' : v.state }),
    // Two badges, not three. There was a separate "connected" one beside this,
    // on the condition `v.connected` -- but the stage IS "connected" whenever
    // that is true, since stageOf tests the channel before anything else. So it
    // never read as emphasis, only ever as the same word twice in a row. What
    // the extra badge was carrying was its colour, and dialled in being a
    // stronger statement than running is worth the green, so the stage takes it.
    el('span', {
      className: `badge ${v.stage === 'connected' || v.stage === 'ready' ? 'ok' : v.stage === 'defined' ? 'bad' : 'run'}`,
      textContent: v.stage
    }),
    // Only when it is being kept back, because that is the surprising state.
    // A badge on every machine saying it is available would be noise on the
    // normal case and would make the exception harder to see, not easier.
    v.forTasks === false ? el('span', { className: 'badge warn', textContent: 'not for tasks' }) : null,

    // WHY THE QUEUE WILL NOT TAKE IT, in the queue's own words.
    //
    // `ready` is a badge about PROVISIONING -- built, set up, has a base
    // snapshot -- and it was being read as ready for work, which is a different
    // question with a different answer. A machine still claiming a branch is
    // fully provisioned and is not available, and the card said `poweroff ready`,
    // identical to a machine that genuinely was.
    //
    // The sentence is not composed here. The queue already decides this and
    // already words it, so this renders that answer rather than a second opinion
    // that can drift from it -- which is the same mistake this tab has now made
    // twice, once about a credential and once about a claim.
    queueWhy(v) ? el('span', { className: 'badge warn', textContent: queueWhy(v), title: 'the queue will not take this machine while it is true' }) : null))

// What the queue says about a machine, when that is not already on the card.
//
// "Kept back" has its own badge and "installing" is the stage, so repeating
// either would be the same fact twice with different wording.
function queueWhy (v) {
  const said = queueSays.get(v.name)
  if (!said || said.free || !said.why) return null
  if (v.forTasks === false || v.stage === 'installing') return null
  return said.why
}

function vmActions () {
  const box = $('machine-actions')
  const v = latest.vms.find(x => x.name === picked)
  const go = (name, args, msg) => () => { showTab('live'); api(name, args).then(() => { say(msg); return draw() }).catch(oops) }

  setText($('actions-context'), v ? `— ${v.name}` : '— nothing selected')
  if (!v) {
    if (changed('actions', null)) fill(box, el('p', { className: 'empty', textContent: 'Pick a machine on the left, or make one with the + above it.' }))
    return
  }

  // Every button below is built from these: `running`, `live` and `baseSnapshot`
  // decide what is shown and what is disabled, and `running` is also read by a
  // click handler, where it picks between stopping and starting. A button left
  // standing with a stale one would do the wrong thing without saying so, which
  // is why the signature is the whole of vmKey rather than only what is visible.
  if (!changed('actions', vmKey(v))) return

  const pooled = v.forTasks !== false

  fill(box, el('div', { className: 'row' },
    // Whether the queue may have this machine. Beside the other things you do to
    // a machine rather than buried in its settings, because it is the answer to
    // "why has nothing picked this up" and to "why did that get wiped" -- and
    // both are asked while looking at exactly this panel.
    el('button', {
      className: `btn ${pooled ? '' : 'ok'}`,
      textContent: pooled ? 'Keep it back from tasks' : 'Let tasks use it',
      title: pooled
        ? 'The queue may roll this back and give it work when it is free'
        : 'The queue will not touch this machine',
      onclick: () => api('vmForTasks', { name: v.name, enabled: !pooled })
        .then(r => { say(r.note); return draw() }).catch(oops)
    }),

    el('button', {
      className: 'btn ok',
      textContent: v.running ? 'Shut it down' : 'Start it',
      disabled: !v.live,
      title: v.live ? '' : 'VirtualBox has no machine by this name any more',
      onclick: go(v.running ? 'vmStop' : 'vmStart', { name: v.name }, v.running ? 'Asked it to shut down' : 'Starting it')
    }),

    // Only when it is on a branch, because that is the only time the question
    // exists — and it is asked as "why is this machine stuck", which is this
    // panel's question rather than the branch list's.
    v.branch
      ? el('button', {
          className: 'btn',
          textContent: `Let go of ${v.branch}`,
          disabled: !v.connected,
          title: v.connected
            ? 'Only if it is holding nothing — it will be asked'
            : 'It has to be dialled in to be asked what it is holding',
          onclick: () => ask({
            title: `Let ${v.name} off ${v.branch}?`,
            plain: [
              'The machine is asked what it is holding first, and this is refused if anything is uncommitted or unpushed.',
              'Nothing on the machine changes. It stops being the machine that owns this branch, so another one can take it and this one can be given other work.',
              'Anything it already pushed is here and is not touched.'
            ],
            confirm: 'Let it go',
            onYes: async () => {
              const r = await api('vmRelease', { name: v.name })
              say(r.note || `${v.name} let go of ${r.was}.`)
            }
          })
        })
      : null,

    v.running
      ? el('button', {
          className: 'btn danger',
          textContent: 'Power off',
          onclick: () => ask({
            title: `Pull the power on ${v.name}?`,
            plain: ['This is the plug, not the button.'],
            cost: 'Anything it was part-way through writing may be left unfinished.',
            confirm: 'Power off',
            danger: true,
            onYes: () => api('vmStop', { name: v.name, force: true })
          })
        })
      : null,

    // "Take a snapshot" was here, among the things you do to a MACHINE. It is
    // not one: it captures the machine's CURRENT STATE, which is a specific
    // thing with a specific place in the snapshot tree, and that is where the
    // button now lives -- on the card for the state it copies. See
    // currentStateNode. This panel kept a button whose object was somewhere
    // else on the screen entirely.

    // "Install the operating system" and "Set it up again" were here. Both remain
    // as actions -- vmInstall and vmSetupAgain -- and the All actions tab still
    // lists them, because removing a button is not the same as removing what it
    // did. Making a machine still installs on its own, which was always the path
    // these two were the retry for.

    // Only when it is dialled in, because that is where the address comes from.
    // Disabled rather than hidden while it is not: a button that vanishes reads
    // as a feature that does not exist, and the reason is worth saying.
    // The only way to see a machine that is not talking yet -- which is most of
    // an install, and exactly when somebody wants to know whether it is working.
    el('button', {
      className: 'btn',
      textContent: 'See its screen',
      disabled: !v.running,
      title: v.running ? '' : 'It has to be running to have a screen',
      onclick: () => api('vmScreenshot', { name: v.name })
        .then(r => showImage({
          title: `${v.name}, just now`,
          file: r.file,
          note: 'Kept, not just shown — the path is in the live log too.'
        }))
        .catch(oops)
    }),

    // "Open in VS Code" WAS HERE, and it is deliberately gone.
    //
    // It opened an editor on a MACHINE, which meant choosing a branch from a
    // machine that had none, or carrying on with whatever one it happened to
    // hold -- and either way no task existed, so the work had no brief, no
    // attempts, no verdict and nothing recording that it happened. That is the
    // hole the human path was outside of, and it is not one to leave a second
    // door open into.
    //
    // Work is started from a BRANCH now: Branches -> Work on it, which makes
    // a task, borrows a machine, sets it up, and opens it in whichever of VS
    // Code or a terminal was asked for.
    // The chain is the same as a worker's and the board says who did it.
    //
    // `vmEditor` remains an action, listed with everything else in All actions.
    // Removing a button is not the same as removing what it did.

    v.live && !v.baseSnapshot
      ? el('button', {
          className: 'btn',
          textContent: 'Make a clean starting point',
          onclick: () => ask({
            title: `Snapshot ${v.name} as a clean starting point?`,
            plain: [
              'It shuts the machine down, takes the snapshot, and starts it again.',
              'Shut down first because that is what makes the snapshot small and clean — a running one would store its memory too.',
              'Afterwards you can return the machine to exactly this state whenever you like.'
            ],
            fields: [{ name: 'title', label: 'Call it', value: 'base' }],
            confirm: 'Do it',
            onYes: f => {
              showTab('live')
              return api('vmBaseSnapshot', { name: v.name, title: f.title || 'base' })
                .then(() => say(`"${f.title || 'base'}" taken; ${v.name} can be returned to it`))
            }
          })
        })
      : null,

    el('button', { className: 'btn danger', textContent: 'Delete it', onclick: () => deleteVm(v) })))
}

// Listed rather than hidden behind a dialog, because which snapshots exist is the
// question you have before you decide to restore one.
async function paintSnapshots () {
  const v = latest.vms.find(x => x.name === picked)
  if (!v || !v.live) {
    setText($('snap-context'), '')
    if (changed('snapshots', null)) fill($('snapshots'), el('p', { className: 'empty', textContent: 'No machine selected.' }))
    return
  }

  // The other panel that reads something real before it can say anything: this
  // one asks VBoxManage and then the machine's own config file.
  waiting('snapshots', { cards: 2 })

  let s
  try {
    s = await api('vmSnapshots', { name: v.name })
  } catch {
    setText($('snap-context'), '')
    if (changed('snapshots', 'unreadable')) fill($('snapshots'), el('p', { className: 'empty', textContent: 'Could not read its snapshots.' }))
    return
  }

  setText($('snap-context'), `— ${s.snapshots.length}`)
  // `running` is in here because the buttons below are disabled by it. It is not
  // shown anywhere in this panel, which is exactly why it is easy to leave out --
  // and leaving it out would freeze the buttons in whatever state the machine
  // was in when the list was last drawn.
  //
  // The rest arrived with the current-state card, which reads facts about the
  // MACHINE and not only about its snapshots: when it last dialled in, whether
  // it is live, and which snapshot the queue treats as its base.
  if (!changed('snapshots', [v.name, v.running, v.live, v.state, v.reported, v.cleanSince, v.baseSnapshot, s])) return

  // INDENTED, BECAUSE SNAPSHOTS ARE A TREE.
  //
  // Five in a line and five taken from the same moment arrived here as the same
  // flat list, and they are completely different situations: one is a history,
  // the other is five alternatives branching off one point. VirtualBox's own
  // window has always drawn this; the depth was in the data all along and was
  // being parsed away.
  //
  // The current one is marked from `x.current`, which VirtualBox reports as a
  // NODE. Comparing names would mark both of two snapshots that share one -- and
  // it allows that, which this project has already been caught by.
  // No "none yet" branch any more: a machine with no snapshots still has a
  // current state, and that card is now the only place a first snapshot can be
  // taken from.
  //
  // The indent is only written when there IS one, because the connector rule
  // keys off the attribute being present -- and a root at `margin-left:0px`
  // would be given a line joining it to a parent it does not have.
  fill($('snapshots'),
    [...s.snapshots.map(x => el('div', { className: 'card snap', ...(x.depth ? { style: `margin-left:${x.depth * 18}px` } : {}) },
        el('div', { className: 'card-title' },
          el('span', { className: 'mono', textContent: x.name }),
          // "On this one" was here. It is not needed any more: the current state
          // is its own card, hanging off the snapshot it came from, so where the
          // machine is is shown by POSITION rather than asserted by a label on a
          // different card.

          // The dashboard's own idea, which is not VirtualBox's: the point the
          // queue returns a machine to. Worth marking here because it is the one
          // snapshot whose deletion changes what the queue can do.
          x.name === v.baseSnapshot ? el('span', { className: 'badge ok', textContent: 'base' }) : null),
        // When, which VBoxManage does not report and which is most of what
        // somebody is asking: which of these is the one from before it broke.
        x.taken ? el('div', { className: 'card-sub', textContent: `${new Date(x.taken).toLocaleString()} — ${ago(x.taken)}` }) : null,
        x.description ? el('div', { className: 'card-sub', textContent: x.description }) : null,
        el('div', { className: 'row', style: 'margin-top:8px' },
          // NOT OFFERED ON THE ONE THE MACHINE IS ALREADY ON, because there it
          // is the same act as throwing away the current state -- and that is
          // offered on the current state's own card, where its object is. Two
          // buttons in different places doing one thing is how somebody ends up
          // unsure which of them they actually want.
          x.current ? null : el('button', {
            className: 'btn',
            // "Here", because the tree makes position mean something now: this
            // is the node the machine is moved to, and everything below it is
            // what that discards.
            textContent: 'Revert to here',
            // VirtualBox will not restore under a running machine, and the
            // server says so -- but only after the dialog has been read and
            // confirmed, which is the wrong end. Said here instead, before the
            // question about discarding work has even been asked.
            disabled: v.running,
            title: v.running ? 'Shut it down first — VirtualBox will not restore a snapshot while it is running' : '',
            onclick: () => api('vmHolds', { name: v.name })
              .catch(() => ({ asked: false, why: 'asking it failed.' }))
              .then(holds => ask({
              title: `Go back to "${x.name}"?`,
              plain: [
                'The machine must be shut down for this.',
                // The same sentence the delete dialog uses, for the same reason:
                // this discards the disk, and what is on the disk is the
                // question. A machine that has to be shut down before restoring
                // is often already off, which is precisely when it cannot be
                // asked -- so that case says so rather than saying nothing.
                holdingLine(holds),
                ...adriftLines(holds),
                // The permission moves with the disk, and it is not obvious that
                // it does. Worth saying here, because going back to a point from
                // before any work started is how a machine ends up allowed to
                // push a branch it no longer has.
                `What ${v.name} is allowed to push goes back with it — to whatever was set when "${x.name}" was taken.`
              ],
              cost: `Everything that changed on ${v.name} since "${x.name}" is discarded.`,
              confirm: 'Go back to it',
              danger: true,
              onYes: () => api('vmSnapshotRestore', { name: v.name, title: x.name })
                .then(r => say(r.branch
                  ? `Back at "${x.name}" — ${v.name} may push ${r.branch}`
                  : `Back at "${x.name}" — ${v.name} may push nothing until it is set up again`))
              })).catch(oops)
          }),

          // Throwing one away had no button at all, which is how a machine
          // ends up with two snapshots called the same thing and no way to
          // resolve it from the window.
          el('button', {
            className: 'btn danger',
            // Names what it deletes. "Throw it away" beside "go back to it" left
            // "it" doing two jobs in one row -- the snapshot, or everything
            // since it -- and those are opposite operations.
            textContent: 'Delete this snapshot',
            disabled: v.running,
            title: v.running ? 'Shut it down first' : '',
            onclick: () => ask({
              title: `Throw away "${x.name}"?`,
              plain: [
                'The snapshot goes; the machine keeps its current disk. What was recorded at that point is merged into what came after it.',
                x.name === v.baseSnapshot
                  ? `This is ${v.name}'s base — the point the queue returns it to. Without one it cannot be made clean, so the queue will stop using it.`
                  : 'This is not the base snapshot, so nothing the queue relies on changes.'
              ],
              cost: `There is no way back to "${x.name}" afterwards.`,
              confirm: 'Throw it away',
              danger: true,
              onYes: () => api('vmSnapshotDelete', { name: v.name, title: x.name })
                .then(() => say(`"${x.name}" is gone.`))
            })
          })))),

      // The machine as it is NOW, under the snapshot it came from.
      //
      // VirtualBox's window ends the tree with this and marks it "(changed)".
      // That flag is an API property its GUI reads and VBoxManage does not
      // report -- but the flag is not the only way to know, and this host has
      // better evidence than a flag anyway: THE MACHINE DIALLED IN AFTER THE
      // SNAPSHOT WAS TAKEN. It booted and wrote to its disk, and we logged the
      // moment it did. That is first-hand, not inferred.
      //
      // It stays changed until the disk is either thrown away, by going back to
      // a snapshot, or captured, by taking a new one.
      currentStateNode(v, s)
      ].filter(Boolean))
}

// "3 days ago", because a date alone does not answer which of these is old.
// The same shape as `ago`, forwards. A credential's remaining life is the thing
// somebody wants read at a glance, and "expires 2026-09-10T07:10:35.745Z" is a
// fact nobody subtracts today's date from in their head.
function lasts (ms) {
  const secs = Math.round(Math.abs(ms) / 1000)
  const [n, unit] = secs < 90 ? [secs, 'second']
    : secs < 5400 ? [Math.round(secs / 60), 'minute']
      : secs < 172800 ? [Math.round(secs / 3600), 'hour']
        : [Math.round(secs / 86400), 'day']
  return `${n} ${unit}${n === 1 ? '' : 's'}`
}

function ago (when) {
  const secs = Math.max(0, Math.round((Date.now() - Date.parse(when)) / 1000))
  const [n, unit] = secs < 90 ? [secs, 'second']
    : secs < 5400 ? [Math.round(secs / 60), 'minute']
      : secs < 172800 ? [Math.round(secs / 3600), 'hour']
        : [Math.round(secs / 86400), 'day']
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`
}

// Where the machine actually is, at the end of the tree.
//
// CHANGED IS KNOWN RATHER THAN GUESSED. The machine dialled in at a moment this
// host recorded; if that is after the current snapshot was taken, it booted and
// wrote to its disk since, and the disk has moved on. No flag from VirtualBox is
// needed to say so, and none is available -- `currentStateModified` is an API
// property its GUI reads and VBoxManage does not report.
//
// The reverse is NOT claimed. Never having heard from a machine is not evidence
// that nothing ran on it, only that nothing reached us, so that case says what
// it knows and stops.
// A machine with NO snapshots still has a current state -- it is the whole of
// what the machine is, with nothing recorded behind it. Returning nothing here
// would have taken the only way to snapshot a fresh machine with it, since that
// button now lives on this card.
function currentStateNode (v, s) {
  const on = s.snapshots.find(x => x.current) || null

  // Since WHEN the disk last matched a snapshot -- which is not simply when that
  // snapshot was taken. Reverting puts the disk back without moving the
  // snapshot, and taking one brings the snapshot to the disk; both leave the
  // machine clean, and both happen long after `taken`. Measured from the later
  // of the two, or a reverted machine reads as changed for ever on the strength
  // of a dial-in from before it was put back.
  const clean = [on && on.taken, v.cleanSince].filter(Boolean).sort().pop()
  const heardAfter = !!(on && v.reported && clean && Date.parse(v.reported) > Date.parse(clean))
  const indent = on ? (on.depth + 1) * 18 : 0

  return el('div', {
    className: `card snap current${heardAfter ? ' changed' : ''}`,
    ...(indent ? { style: `margin-left:${indent}px` } : {})
  },
    el('div', { className: 'card-title' },
      el('span', { textContent: 'Current state' }),
      heardAfter ? el('span', { className: 'badge warn', textContent: 'changed' }) : null,
      el('span', { className: `badge ${v.running ? 'ok' : ''}`, textContent: v.running ? 'running' : v.state })),
    el('div', { className: 'card-sub', textContent: !on
      ? 'There are no snapshots, so this is the whole of the machine with nothing recorded behind it. Nothing can be gone back to until one is taken.'
      : heardAfter
        ? `It dialled in ${ago(v.reported)}, after "${on.name}" was taken — so it has booted and written to its disk since. That stays true until this is either captured as a snapshot of its own, or reverted to "${on.name}" and discarded.`
        // Named by what actually happened. "Since it was taken" is wrong about a
        // machine that was put BACK an hour ago and right about one that has sat
        // untouched since the snapshot -- and the difference is the whole reason
        // this reads as clean.
        : `Nothing here has heard from it since ${clean === v.cleanSince ? `it was put back to "${on.name}" ${ago(clean)}` : `"${on.name}" was taken`}. That is not proof nothing ran on it — only that nothing reached this host.` }),

    // CAPTURING IT IS AN ACTION ON THIS, not on the machine in general, so the
    // button is on the card for the thing it copies rather than in a row of
    // buttons about a machine. It was in that row, with its object somewhere
    // else on the screen entirely -- and the sentence directly above says "or
    // captured, by taking a new one" while offering no way to do it.
    //
    // A snapshot with no title is one nobody can choose between later, so the
    // title is asked for rather than generated.
    el('div', { className: 'row', style: 'margin-top:8px' },
      el('button', {
        className: 'btn',
        textContent: 'Take a snapshot of it',
        // Off only. A running machine would have its memory stored beside its
        // disk, and the server refuses it for that reason -- said here so the
        // answer arrives before the dialog is filled in rather than after.
        disabled: !v.live || v.running,
        title: v.running ? 'Shut it down first — a snapshot of a running machine stores its memory too, which makes it enormous' : '',
        onclick: () => ask({
          title: `Snapshot ${v.name} as it is now`,
          plain: [
            'A snapshot is a point you can come back to.',
            'Taking one changes nothing about the machine as it is now.',
            !on
              ? 'It is the first, so it becomes the root of this machine\'s tree.'
              : heardAfter
                ? `It goes under "${on.name}", which is where the machine currently is, and becomes the point it comes back to instead.`
                : `It goes under "${on.name}", which is where the machine currently is.`
          ],
          fields: [
            { name: 'title', label: 'Title for this snapshot', value: v.baseSnapshot ? '' : 'base', placeholder: 'clean install' },
            { name: 'description', label: 'What is true at this point — optional', placeholder: 'operating system installed, nothing else' }
          ],
          confirm: 'Take it',
          onYes: f => api('vmSnapshotTake', { name: v.name, title: f.title, description: f.description })
            .then(() => say(`Snapshot "${f.title}" taken`))
        })
      }),

      // AND THROWING IT AWAY, which is the current state's own destructive act.
      //
      // It used to be "go back to it" on the snapshot the machine was already
      // on, which is the same operation described from the wrong end -- the
      // machine does not move, the changes since are discarded. Said as what it
      // does to the thing it does it to.
      //
      // Only when there is something to discard: with nothing recorded behind
      // it there is nowhere to go, and if nothing has run since the snapshot
      // there is nothing to throw.
      on && heardAfter
        ? el('button', {
            className: 'btn danger',
            // NAMES WHERE IT GOES, not what it destroys. "Throw it away" is
            // accurate about the current state and says nothing about where the
            // machine ends up -- which is the thing somebody needs to know
            // before pressing it, and it is right there in the tree above.
            textContent: `Revert to ${on.name}`,
            disabled: v.running,
            title: v.running ? 'Shut it down first — VirtualBox will not restore a snapshot while it is running' : '',
            onclick: () => api('vmHolds', { name: v.name })
              .catch(() => ({ asked: false, why: 'asking it failed.' }))
              .then(holds => ask({
                title: `Revert ${v.name} to "${on.name}"?`,
                plain: [
                  `${v.name} goes back to "${on.name}" and stays there. The snapshot is not touched.`,
                  holdingLine(holds),
                  ...adriftLines(holds),
                  `What ${v.name} is allowed to push goes back with it — to whatever was set when "${on.name}" was taken.`
                ],
                cost: `Everything that changed on ${v.name} since ${ago(on.taken)} is discarded.`,
                confirm: `Revert to ${on.name}`,
                danger: true,
                onYes: () => api('vmSnapshotRestore', { name: v.name, title: on.name })
                  .then(r => say(r.branch
                    ? `Back at "${on.name}" — ${v.name} may push ${r.branch}`
                    : `Back at "${on.name}" — ${v.name} may push nothing until it is set up again`))
              })).catch(oops)
          })
        : null))
}

// Getting from a machine to the thing it is entangled with.
//
// The tab knew about none of these. Branches links into Tasks; this linked
// nowhere, so going from "runner2 is stuck" to the branch it is stuck on meant
// switching tabs and picking the same machine out of a second list. That is the
// same "three places knew and none of them met" problem, at the machine end.
const goToBranch = branch => {
  $('branch-find').value = branch
  changed('branches', null)
  showTab('branches')
  paintBranches()
}
const goToTask = id => { pickedTask = id; been.set('task', id); showTab('tasks') }
const goToShell = (name, opts) => { showTab('terminal'); return openShell(name, opts).catch(oops) }

// What this machine is doing, and what is standing in its way.
//
// IT WAS A SPEC SHEET. Eight of its thirteen rows -- memory, processors, disk,
// network, user, installer image, hostname, when it was made -- cannot change
// after the machine exists, and they had the widest panel in the window. The one
// fact that decides everything, the branch it claims, was row five and worded as
// a permission.
//
// The tab was built when a machine WAS the product, so it answers "what is this
// machine". Tasks, branches, a terminal and a credential store arrived since,
// and the question became "what is this machine doing, and what is in the way".
// The spec is still here, one click away, because it is what people copy values
// out of -- it is just no longer the answer to a question nobody asked.
function paintDetails () {
  const v = latest.vms.find(x => x.name === picked)
  const box = $('details')
  if (!v) {
    if (changed('details', null)) fill(box, el('p', { className: 'empty', textContent: 'No machine selected.' }))
    return
  }

  const spec = v.spec || {}
  const facts = (v.agent && v.agent.facts) || {}
  const doing = queueBusy.get(v.name) || null
  const said = queueSays.get(v.name)
  const claimed = doing ? taskById(doing) : null

  // Live first, and in the order the questions are actually asked.
  const now = [
    ['power', v.running ? 'running' : v.state],
    ['reachable', v.connected
      ? `dialled in ${new Date(v.agent.since).toLocaleTimeString()}, from ${v.agent.from}`
      : v.lastAddress ? `not dialled in — last seen at ${v.lastAddress}` : 'never dialled in'],
    // Booted is not usable, and the agent reports the difference on every beat.
    // It decided whether a sign-in or an editor would work at all, and until now
    // it was collected and never shown.
    v.connected ? ['desktop', v.desktop ? 'up — anything needing a screen will work' : 'not up yet'] : null,

    ['doing', doing
      ? link(claimed ? `#${claimed.number} ${claimed.title}` : doing, () => goToTask(doing))
      : 'nothing'],
    // The queue's own words, again, rather than a second opinion.
    ['the queue', said ? (said.free ? 'free — the next task can take it' : said.why) : 'unknown'],

    ['claims a branch', v.branch
      ? link(v.branch, () => goToBranch(v.branch))
      : 'nothing — it is free to be given any'],

    // Never shown on this tab before. It is what stops a snapshot being taken,
    // and it survived a host restart on a powered-off machine without this panel
    // mentioning it once.
    ['worker credential', v.holdsCredential
      ? 'holding one — it cannot be snapshotted until that is taken back'
      : 'none, which is the resting state'],

    ['resets to', v.baseSnapshot || 'no base snapshot yet — it cannot be made clean'],
    ['last heard from', v.reported ? new Date(v.reported).toLocaleString() : 'never'],
    v.connected ? ['it says it is', facts.hostname ? `${facts.hostname} — ${facts.system || ''}` : 'unknown'] : null,
    v.connected ? ['its addresses', (facts.addresses || []).join(', ') || 'unknown'] : null
  ].filter(Boolean)

  const made = [
    ['made', new Date(v.created).toLocaleString()],
    ['memory', `${spec.memoryMB} MB`],
    ['processors', String(spec.cpus)],
    ['disk', `${Math.round((spec.diskMB || 0) / 1024)} GB`],
    ['network', spec.network === 'bridged' ? `bridged${spec.bridge ? ` on ${spec.bridge}` : ''}` : `nat, ssh on 127.0.0.1:${spec.sshPort}`],
    ['user', spec.user],
    ['installer image', spec.iso ? spec.iso.split(/[\\/]/).pop() : 'none'],
    ['hostname', spec.hostname],
    ['stage', v.stage]
  ]

  // Signed on the TEXT of every row rather than on the nodes, since a link is an
  // object and would never compare equal -- which would repaint this panel three
  // times a second and take the selection out of anything being copied.
  const sign = [...now, ...made].map(([k, val]) => `${k}=${typeof val === 'string' ? val : val.textContent}`)
  if (!changed('details', [v.name, sign])) return

  const table = rows => el('table', { className: 'kv' }, ...rows.map(([k, val]) =>
    el('tr', {}, el('th', { textContent: k }),
      el('td', { className: 'mono' }, typeof val === 'string' ? document.createTextNode(val) : val))))

  fill(box,
    table(now),

    // The ways out of this panel, beside the facts that send you there.
    //
    // "OPEN A SHELL" WAS HERE AND IS NOT ANY MORE, for the same reason the
    // editor button went: a shell opened to WORK in belongs to the branch the
    // work is on, and this panel is about a machine. Offered here it is a way
    // into a machine with no task and no branch, which is the shape of the hole
    // the human path used to sit outside of.
    //
    // A shell for DIAGNOSING a machine is a different thing and still exists --
    // the Terminal tab, which is about machines, and `vmShell` for when the agent
    // has stopped answering. That one is the back door and should not be behind a
    // branch, because the case it is for is a machine that has no working branch
    // at all.
    el('div', { className: 'row', style: 'margin-top:10px' },
      v.branch ? el('button', { className: 'btn', textContent: 'Its branch', onclick: () => goToBranch(v.branch) }) : null,
      doing ? el('button', { className: 'btn', textContent: 'Its task', onclick: () => goToTask(doing) }) : null,
      // Nothing at all is better than a button that leads somewhere it should
      // not, but a panel with an empty row reads as something failing to render.
      !v.branch && !doing
        ? el('span', { className: 'muted', textContent: 'Not on a branch and not running anything — nothing to go to.' })
        : null),

    // Closed, because it answers a question asked once: what was this made with.
    el('details', { className: 'spec' },
      el('summary', { textContent: 'How it was made' }),
      table(made)))
}

// A fact you can follow. Deliberately a button rather than an anchor: there is
// nowhere to navigate to, and an <a href> in an app page is how a window ends up
// replacing itself with a broken URL.
const link = (text, onclick) => el('button', { className: 'linky mono', textContent: text, onclick })

// From the list the Tasks tab already fetched. Asking the `tasks` action again
// here would read every branch out of git a second time on every draw, which is
// the thing queueState exists to avoid.
const taskById = id => (taskList || []).find(t => t.id === id) || null

function paintVms () {
  // `picked` is in the signature because it decides which card is highlighted.
  // The queue's verdict is part of the signature, or a machine that became
  // unavailable would keep the card it was drawn with.
  if (changed('vms', [latest.available, latest.unreachable || '', picked, latest.vms.map(v => [vmKey(v), queueWhy(v)])])) {
    fill($('vms'), latest.vms.length
      ? latest.vms.map(vmCard)
      // THREE DIFFERENT NOTHINGS, and they were two. Installed with no machines
      // yet, not installed at all, and installed but not answering are separate
      // situations with separate answers, and the third one used to read as the
      // second -- "VirtualBox was not found" said of a VirtualBox sitting right
      // there, wedged, which sends somebody to reinstall a thing that is fine.
      : latest.unreachable
        ? el('div', {},
            el('p', { className: 'empty bad', textContent: 'VirtualBox is not answering.' }),
            el('p', { className: 'empty', textContent: latest.unreachable }),
            el('p', { className: 'empty', textContent: 'Everything else here still works — a task list and a branch are read from this host, not from a machine.' }))
        : el('p', { className: 'empty', textContent: latest.available ? 'None yet. The + above makes one.' : 'VirtualBox was not found.' }))
  }
  vmActions()
  paintDetails()
  paintSnapshots().catch(() => {})
}

$('add-task-open').onclick = newTask
// Caught here because newBranch reads the baselines before it can draw itself,
// and a dialog that fails to open must say so rather than not appearing.
$('add-branch-open').onclick = () => newBranch().catch(oops)
$('add-group-open').onclick = newGroup
// `term-open` and `term-machine` were wired here. They were the machine picker
// and its button, and they are gone: a terminal is started from a task now. The
// sign-in line follows the front tab instead of the picker, which is repainted
// by showShell rather than by an onchange.
$('term-close').onclick = () => closeShell(active)
// Repainted on the spot rather than on the next draw, because a filter that
// takes up to three seconds to answer reads as one that did not work.
$('branch-mine').onchange = () => { changed('branches', null); paintBranches() }
$('branch-find').oninput = () => { changed('branches', null); paintBranches() }
window.addEventListener('resize', () => {
  if (view !== 'terminal') return
  sizeTerminal()
  if (active) { try { active.fit.fit() } catch { /* not laid out */ } }
})

// The settings are the previous version's, which were arrived at by running it:
// 8 GB, 4 cpus, 60 GB, a named LTS image type, and bridged networking so the
// guest can reach this app to fetch its scripts.
$('add-vm-open').onclick = () => Promise.all([api('vmIsos'), api('hostKeys')]).then(([isos, { keys }]) => ask({
  title: 'Make a virtual machine',
  plain: [
    'It makes the machine and its disk, then starts it and installs the operating system on its own.',
    'As that finishes it fetches its own setup scripts from here and runs them, reporting into the live log.',
    'It takes a long while, and a window will open so you can watch.',
    'Only machines made here ever appear in this list, and nothing else on this computer is touched.'
  ],
  fields: [
    { name: 'name', label: 'Name', placeholder: 'dev1' },
    {
      name: 'iso',
      label: isos.length ? 'Installer image' : 'Installer image — VirtualBox knows of none, so type a path',
      value: isos.length ? isos[0].location : '',
      options: isos.length ? [{ value: '', label: 'none for now' }, ...isos.map(i => ({ value: i.location, label: i.name }))] : undefined,
      placeholder: 'C:\\path\\to\\ubuntu.iso'
    },
    { name: 'memoryMB', label: 'Memory, in MB', value: '8192', type: 'number' },
    { name: 'cpus', label: 'Processors', value: '4', type: 'number' },
    { name: 'diskMB', label: 'Disk, in MB', value: '61440', type: 'number' },
    {
      name: 'network',
      label: 'Network',
      value: 'bridged',
      options: [
        { value: 'bridged', label: 'bridged — it can reach this app' },
        { value: 'nat', label: 'nat — private, with a forwarded ssh port' }
      ]
    },
    { name: 'user', label: 'User to create', value: 'okc' },
    { name: 'password', label: 'Its password', value: 'okc' },
    {
      name: 'sshKey',
      label: keys.length ? 'Authorise one of your ssh keys on it' : 'Your public ssh key — none found on this machine, so paste one',
      value: keys.length ? keys[0].key : '',
      options: keys.length
        ? [...keys.map(k => ({ value: k.key, label: `${k.file} — ${k.comment}` })), { value: '', label: 'none, use the password' }]
        : undefined,
      placeholder: 'ssh-ed25519 AAAA...'
    }
  ],
  confirm: 'Make it',

  // Make, then install. Two actions rather than one, because they fail differently
  // and the second is the one that takes half an hour: if the install will not
  // start, the machine still exists and the button to try again is right there.
  onYes: async f => {
    showTab('live')
    await api('vmCreate', { vm: { ...f, memoryMB: Number(f.memoryMB), cpus: Number(f.cpus), diskMB: Number(f.diskMB) } })
    picked = f.name

    if (!f.iso) {
      say(`${f.name} made. It has no installer image, so there is nothing to install yet.`)
      return
    }

    await api('vmInstall', { name: f.name })
    say(`${f.name} is installing and will set itself up. Watch it here.`)
  }
})).catch(oops)

// ---- All actions -----------------------------------------------------

async function paintActions () {
  const { actions } = await api('actions')
  fill($('action-list'), actions.map(a => el('div', { className: 'act' },
    el('code', { textContent: a.name }),
    el('span', { className: 'about', textContent: a.about }),
    el('span', { className: 'takes', textContent: a.takes.length ? a.takes.join(', ') : '' }))))
}

// ---- Live ------------------------------------------------------------

const lines = []
const off = new Set()
let follow = true
let find = ''
let unseen = 0
let unseenBad = false

const clearBadge = () => {
  unseen = 0
  unseenBad = false
  $('live-badge').classList.add('hidden')
}

const shown = e => !e.tags.some(t => off.has(t)) &&
  (!find || e.text.toLowerCase().includes(find) || e.tags.some(t => t.includes(find)))

const lineNode = e => el('div', { className: `line ${e.level}` },
  el('span', { className: 't', textContent: e.at.slice(11, 19) }),
  el('span', { className: 'g', textContent: e.tags.join(' ') }),
  el('span', { className: 'm', textContent: e.text }))

function paintLog () {
  const box = $('live')
  const visible = lines.filter(shown)
  const slice = visible.slice(-800)

  // An entry never changes after it is logged, so the ids in view say exactly
  // what is drawn. Worth guarding twice over: this runs per line rather than per
  // poll, and refilling the box also sent the scrollback to the top, so reading
  // anything above the fold during an install was impossible.
  if (changed('log', slice.map(e => e.id))) {
    fill(box, slice.map(lineNode))
    if (follow) box.scrollTop = box.scrollHeight
  } else if (follow) {
    box.scrollTop = box.scrollHeight
  }

  setText($('live-context'), `— ${visible.length} of ${lines.length} lines`)

  const counts = new Map()
  for (const e of lines) for (const t of e.tags) counts.set(t, (counts.get(t) || 0) + 1)
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1])
  if (!changed('logTags', [ordered, [...off].sort()])) return

  fill($('log-tags'), ordered
    .map(([tag, n]) => el('button', {
      className: 'chip' + (off.has(tag) ? '' : ' on'),
      onclick: () => { off.has(tag) ? off.delete(tag) : off.add(tag); paintLog() }
    }, tag, el('b', { textContent: String(n) }))))
}

$('log-follow').onchange = e => { follow = e.target.checked; paintLog() }
$('log-find').oninput = e => { find = e.target.value.trim().toLowerCase(); paintLog() }
$('log-clear').onclick = () => api('logClear').then(() => { lines.length = 0; paintLog() }).catch(oops)

// Anything that happened to a machine may have changed what the list should say --
// a guest reporting in, a machine starting, one being deleted from elsewhere. It
// was only guest lines before, so a machine deleted by another client sat in the
// list looking alive until something else forced a redraw.
//
// Debounced, because creating a machine logs a couple of dozen lines in a second
// and each one would otherwise mean asking VirtualBox for the whole list again.
let refreshSoon
const refresh = () => {
  clearTimeout(refreshSoon)
  refreshSoon = setTimeout(() => draw().catch(() => {}), 400)
}

function onLine (e) {
  lines.push(e)
  if (lines.length > 2000) lines.splice(0, lines.length - 2000)
  paintLog()

  if (e.tags.includes('vm') || e.tags.includes('guest')) refresh()

  if (view !== 'live') {
    unseen++
    if (e.level === 'bad') unseenBad = true
    const badge = $('live-badge')
    badge.textContent = String(unseen)
    badge.className = `tab-badge${unseenBad ? ' bad' : ''}`
  }
}

// Says so in the same log as everything else, which also proves the window and the
// server are sharing one node context rather than each holding its own copy.
liveLog.on('window').good('window opened')

// Everything already logged, then everything from here on.
lines.push(...liveLog.all())
paintLog()
liveLog.subscribe(onLine)
$('link-dot').classList.add('live')

// ---- draw ------------------------------------------------------------

async function drawOnce () {
  // The queue is asked here as well as in its own panel, because the banner
  // needs it: a machine the queue is driving is not an idle machine, and
  // nagging about one would train the operator to ignore the banner.
  const [list, status, running, held] = await Promise.all([
    // CAUGHT, because a broken VirtualBox is not a broken window.
    //
    // This was the one call in here without a catch, and it took the whole draw
    // down with it: the Promise.all rejected, and Tasks, Branches, Keys and the
    // photograph at the bottom were never painted. VirtualBox wedged -- every
    // VBoxManage call, including a read-only `list vms`, hanging until it timed
    // out -- and the window answered by emptying the two tabs that do not touch
    // a machine at all. A task list is read from a file on this host; there is
    // no reason it should go blank because a hypervisor is unwell.
    //
    // The machines panel says so itself, which is where it belongs.
    api('vmList').catch(e => ({ available: false, vms: [], unreachable: e.message })),
    api('status').catch(() => ({ repos: [], virtualbox: true })),
    api('queueState').catch(() => ({ inFlight: [] })),
    // Whether there is a credential to hand out at all, which is the difference
    // between "sign this machine in" and "there is nothing to sign it in with".
    api('credentialsHeld').catch(() => ({ held: false }))
  ])
  const busyMachines = new Set((running.inFlight || []).map(f => f.machine))
  latest = list
  latest.credentialsHeld = held
  queueSays = new Map((running.machines || []).map(m => [m.name, m]))
  queueBusy = new Map((running.inFlight || []).map(f => [f.machine, f.task]))

  // Reconcile the selection against what actually exists, every time, before
  // anything that depends on it is painted.
  //
  // The previous dashboard had a bug worth not repeating: with machines present it
  // never selected one at startup, so the panels rendered as though nothing were
  // selected and clicking the already-selected machine was the only way to get a
  // correct page. Two causes look alike -- nothing selected yet, and something
  // selected that no longer exists -- and both leave the panels stranded until a
  // click. So: after loading, the selection names a machine in the list, or is
  // null because the list is empty.
  // A remembered selection is checked against what exists, exactly like any
  // other: a machine can be deleted between one window and the next, and coming
  // back to a name that is gone is the same stranded state as never having
  // chosen. Remembering does not get to skip the reconciliation.
  if (!latest.vms.some(v => v.name === picked)) {
    picked = latest.vms.length ? latest.vms[0].name : null
    been.set('vm', picked)
  }

  // WHICH REPOSITORIES THIS IS ABOUT, in the chrome, because it is the context
  // for everything else on screen. A branch, a task, a baseline and a verdict
  // are all statements about one folder, and until that folder could be changed
  // it went without saying -- so the title bar carried the path to VBoxManage
  // instead, which never changes and which nobody needs to see twice.
  //
  // Clickable, because the thing you want on reading it is to change it.
  const ws = status.workspace
  if (changed('workspace-chip', ws)) {
    fill($('vbox-path'), el('button', {
      className: 'linky mono',
      // The folder's NAME, not its path. A path in the chrome is a line of text
      // nobody reads twice and which pushes everything else along; the name is
      // what somebody calls it. The full path and the count are one hover away,
      // where they answer "which one is this exactly" rather than sitting there.
      textContent: ws ? ws.name : 'no workspace',
      title: ws
        ? `${ws.dir}\n${ws.repos} repositor${ws.repos === 1 ? 'y' : 'ies'}\n\nClick to switch, or add another.`
        : 'Click to choose a folder of repositories',
      onclick: chooseWorkspace
    }))
  }
  setText($('topright'), latest.vms.length
    ? `${latest.vms.length} machine${latest.vms.length === 1 ? '' : 's'} this app made`
    : 'no machines yet')

  const gone = latest.vms.filter(v => !v.live)
  // Only the dirty ones. A repository sitting on a review branch with nothing
  // uncommitted is stepped off automatically the moment the branch is needed, so
  // saying anything about it would be noise about something already handled.
  const stuck = (status.repos || []).filter(r => !r.clean)

  // Everything the banner can say, built as one list rather than three
  // conditionals. The previous version wrote the machines in and then, if
  // VirtualBox was missing, REPLACED them -- so the more serious problem hid the
  // other one instead of joining it.
  const trouble = [
    !status.virtualbox
      ? ['VirtualBox was not found. ', 'Nothing here can make or start a machine until it is installed.']
      : null,
    // Said in the banner and not only in the machines panel, because it is a
    // fact about every tab: a task cannot be given out, a branch cannot be
    // worked on, and the reason has nothing to do with either of them.
    latest.unreachable
      ? ['VirtualBox is installed but not answering. ',
          `Machine actions will hang or fail until it recovers — everything read from this host is unaffected. It said: ${latest.unreachable}`]
      : null,
    ...gone.map(v => [
      `${v.name} is in this list but VirtualBox has no such machine. `,
      'It was deleted elsewhere, or never finished being made. Delete it here to tidy up.'
    ]),
    ...stuck.map(r => [
      `${r.repo} is on "${r.on}" here with uncommitted changes. `,
      `A machine working on "${r.on}" cannot push while that is true, and its own error will not say why. Commit or discard them, or put ${r.repo} back on ${r.home}.`
    ]),

    // A machine left on, doing nothing, holding a credential.
    //
    // Said because nothing else says it. A runner's natural state is off; one
    // that is up and idle looks exactly like one that is working, and that is
    // how a machine stayed on for hours holding a token while every panel
    // reported it as healthy. It was noticed by eye.
    //
    // The credential is the part that makes this worth a banner rather than a
    // note: an idle machine is the one case where a token is exposed for no
    // reason at all — nothing is using it, and it will keep not being used
    // until somebody looks.
    //
    // A SHELL OPEN ON IT COUNTS AS USING IT, which it did not until the Terminal
    // tab existed. Without that, the window argued with itself: the sign-in line
    // offers to hand a machine a credential so `claude` will run, and the banner
    // immediately scolds you for the credential you were just told to place, on a
    // machine you are visibly sitting in. A nag that fires at the thing the same
    // window recommended is a nag people learn to ignore, and this one is worth
    // not teaching that about.
    ...latest.vms
      .filter(v => v.running &&
        !busyMachines.has(v.name) &&        // the queue is using it
        !v.borrowed &&                      // somebody took it, deliberately
        !shells.some(s => s.name === v.name && !s.ended) && // you are in it
        v.forTasks !== false &&             // somebody said keep this one back
        v.stage !== 'installing')           // it is being built
      .map(v => v.holdsCredential
        ? [`${v.name} is on, doing nothing, and holding a worker credential. `,
            'A runner rests off and holding nothing. Take the credential back and shut it down, or give it something to do.']
        : [`${v.name} is on and doing nothing. `,
            'A runner rests off — the queue starts one when there is work. Shut it down, or give it something to do.']),

    // OFF, and still holding one. Which nothing said, because every other rule
    // here is about a machine that is running.
    //
    // A credential is taken back before a machine is shut down, so this state
    // cannot be reached by anything working correctly -- it means a machine was
    // stopped from OUTSIDE that sequence. A host that rebooted for an update is
    // the ordinary way, and it happened: an overnight update powered a runner off
    // mid-credential and the window had nothing to say about it in the morning.
    //
    // It matters more when the machine is off than when it is on, not less. A
    // running machine is at least visible; a powered-off one looks finished, and
    // the credential sits on its disk indefinitely, unmentioned, waiting for
    // somebody to happen to read a field. It also silently blocks the next
    // snapshot, with an error about credentials arriving at whoever tries.
    ...latest.vms
      .filter(v => !v.running && v.live && v.holdsCredential)
      .map(v => [
        `${v.name} is powered off and still holding a worker credential. `,
        'That cannot happen in the ordinary sequence — a credential is taken back before a machine is shut down — so it was stopped from outside it, which a host restart does. Start it, take the credential back, and shut it down again. Until then it cannot be snapshotted.'
      ])
  ].filter(Boolean)

  $('trouble').classList.toggle('hidden', !trouble.length)
  if (changed('trouble', trouble)) {
    fill($('trouble'), trouble.map(([bold, rest]) => el('div', {},
      el('strong', { textContent: bold }),
      el('span', { textContent: rest }))))
  }

  paintVms()
  paintKeys()
  paintAppKeys()
  paintTerminal()
  paintBranches()
  paintTasks(running)

  // Last, so the picture is of a window that has finished drawing.
  shotIfAsked()
}

// A photograph of this window, when something has asked for one.
//
// `capturePage` exists only here — the node side has no page to photograph — so
// the request is left in the actions table and answered on the next draw. That
// is the whole reason this is a poll rather than a call: the asking and the
// taking happen in different processes.
//
// It exists because the window is the one part of this tool nobody could check
// from a terminal. A misspelt CSS class produces no error, a panel can silently
// stop updating, and both have happened — so "it renders correctly" was, until
// now, always somebody's opinion.
function shotIfAsked () {
  api('windowShotPending').then(want => {
    if (!want || !want.file || shotInFlight) return

    // Switched to the asked-for tab first, and then A WHOLE DRAW IS LET PASS.
    //
    // One draw is not enough, which cost a picture to learn. Every panel here
    // fills from an action, so painting it is asynchronous, while this runs
    // synchronously at the END of the same draw that started those requests. A
    // tab that has never been painted is therefore still empty at exactly the
    // moment the photograph is taken -- and an empty panel in a screenshot is
    // worse than no screenshot, because it looks like a rendering fault rather
    // than a timing one. It did: the Branches tab photographed blank, correctly.
    // A view, and optionally a pane inside it: `branches/baselines`. Sub-tabs
    // are exactly as unverifiable as tabs were before this existed -- a panel
    // nobody clicked is a panel nobody has seen -- and from outside the window
    // there is no other way to reach one.
    const [wantView, wantPane] = String(want.view || '').split('/')

    if (wantPane && document.querySelector(`.subtab[data-pane="${wantPane}"]`) && branchPane !== wantPane) {
      document.querySelector(`.subtab[data-pane="${wantPane}"]`).click()
      shotSettle = 2
      // Deliberately not returning: the view itself may still need switching,
      // and clicking a sub-tab inside a hidden view changes nothing on screen.
    }

    if (wantView && wantView !== view) {
      const tab = document.querySelector(`.tab[data-view="${wantView}"]`)
      // TWO draws, not one. One was enough for a tab whose panels come from data
      // already in hand, and not for one that reads git the moment it opens --
      // the Branches tab photographed showing its own "reading…" placeholder,
      // which is honest and still not what the picture was for.
      if (tab) { tab.click(); shotSettle = 2; return }
      // Named a tab that does not exist. Said rather than silently photographing
      // whatever was already open and letting it read as that tab.
      api('windowShotDone', { file: want.file, error: `there is no tab called "${wantView}"` })
      return
    }
    // WHICH ROW, once the right tab is open. A detail panel that only exists for
    // one kind of task -- a person's, with its own two buttons -- was reachable
    // only by clicking that row by hand, which is the thing this whole mechanism
    // exists to avoid. Taken by number or by id, because a number is what the
    // board shows and an id is what every action takes.
    if (want.pick && view === 'tasks') {
      const t = (taskList || []).find(x => x.id === want.pick || String(x.number) === want.pick)
      if (t && pickedTask !== t.id) {
        pickedTask = t.id
        been.set('task', pickedTask)
        shotSettle = 2
        paintTasks()
        return
      }
    }

    // The Merge pane has a selection of its own: which of its two readings is
    // open, and which file. `commits` / `files`, or `repo:path` to open a file.
    if (want.pick && view === 'branches' && branchPane === 'changes') {
      if (want.pick === 'commits' || want.pick === 'files') {
        if (changeLook !== want.pick) {
          changeLook = want.pick
          been.set('change-look', changeLook)
          changed('change', null)
          shotSettle = 2
          paintBranches()
          return
        }
      } else if (want.pick.includes(':')) {
        const cut = want.pick.indexOf(':')
        const wanted = { repo: want.pick.slice(0, cut), file: want.pick.slice(cut + 1) }
        if (!changePicked || changePicked.repo !== wanted.repo || changePicked.file !== wanted.file) {
          changePicked = wanted
          changeLook = 'files'
          been.set('change-look', changeLook)
          changed('change', null)
          changed('change-file', null)
          shotSettle = 3
          paintBranches()
          return
        }
      }
    }

    // The same for a branch, by name. Two tabs are built around a list and a
    // detail panel, and only one of them could be reached from outside.
    // NOT WHILE THE MERGE PANE IS OPEN, which has its own meaning for `pick`.
    // Without this the Merge pane's "repo:file" was also read as a branch name,
    // set as the selection, reset by the next paint because no such branch
    // exists, and set again — a photograph that never arrived and a window that
    // never settled, which looked like the pane being broken.
    if (want.pick && view === 'branches' && branchPane !== 'change' && pickedBranch !== want.pick) {
      pickedBranch = want.pick
      been.set('branch', pickedBranch)
      // The finder is cleared, or a branch that does not match whatever was last
      // typed is selected and not on screen -- a photograph of a detail panel
      // beside a list that does not contain it.
      $('branch-find').value = ''
      $('branch-mine').checked = false
      changed('branches', null)
      shotSettle = 2
      paintBranches()
      return
    }

    if (shotSettle > 0) { shotSettle--; return }

    shotInFlight = true
    try {
      // Raw base64 rather than a data URI: it is written to a file, and the
      // `data:image/png;base64,` prefix would have to be sliced off again.
      nw.Window.get().capturePage(b64 => {
        try {
          const bytes = Buffer.from(b64, 'base64')
          require('node:fs').writeFileSync(want.file, bytes)
          api('windowShotDone', { file: want.file, bytes: bytes.length })
        } catch (e) {
          api('windowShotDone', { file: want.file, error: e.message })
        } finally { shotInFlight = false }
      }, { format: 'png', datatype: 'raw' })
    } catch (e) {
      shotInFlight = false
      api('windowShotDone', { file: want.file, error: e.message })
    }
  }).catch(() => { shotInFlight = false })
}
let shotInFlight = false
// Draws still to let pass before photographing, so a panel that was switched to
// has actually finished filling. See shotIfAsked.
let shotSettle = 0

// ---- right-click, and devtools ---------------------------------------
//
// NW.js ships no context menu at all, so right-click does nothing until one is
// built. This works now only because the page is opened from disk: a page loaded
// over http is a "remote" page and gets none of the nw.* APIs, whatever it is
// whitelisted for, so there was no way to open an inspector from one.

// ---- capture ----------------------------------------------------------
//
// Ctrl+Shift+D copies what is on screen -- the rendered DOM, not the source -- to
// the clipboard, and saves the same thing to state/capture.html.

async function capture () {
  const css = [...document.styleSheets].map(sheet => {
    try { return [...sheet.cssRules].map(r => r.cssText).join('\n') } catch { return '' }
  }).join('\n')

  const html = `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>captured</title>\n<style>\n${css}\n</style>\n</head>\n${document.body.outerHTML}\n</html>\n`

  try { await navigator.clipboard.writeText(html) } catch { /* the file still gets written */ }

  // A picture as well as the markup, because they answer different questions.
  //
  // The HTML says what the window is made of and can be searched, diffed and
  // read at leisure. It does not say what the window LOOKS like: a class that
  // matches no rule, a panel drawn off the bottom, text the same colour as its
  // background are all invisible in the markup and obvious in a photograph. The
  // one visual fault found so far was found by eye for exactly that reason.
  //
  // Taken first and awaited, so both files describe the same moment rather than
  // one being a second later than the other.
  const png = await new Promise(resolve => {
    try {
      nw.Window.get().capturePage(b64 => resolve(b64), { format: 'png', datatype: 'raw' })
    } catch { resolve(null) }
  })

  try {
    const { file, bytes, image } = await api('capture', { html, png })
    say(image
      ? `Copied to the clipboard. ${bytes} bytes to ${file}, and a picture beside it.`
      : `Copied to the clipboard, and saved ${bytes} bytes to ${file}`)
  } catch (err) {
    oops(err)
  }
}

document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
    e.preventDefault()
    // Announced BEFORE it is taken, and saying which tab, so anything watching
    // the stream knows a capture is coming and what it will be of. The action
    // logs the file afterwards; this logs the intent, and the two together are
    // what let a session following along say "they just photographed the
    // Branches tab" rather than noticing a file appear.
    liveLog.on('window').info(`asked for a capture of ${view} — Ctrl+Shift+D`)
    capture()
  }
})

// ---- staying in sync -------------------------------------------------
//
// Two things keep the window honest, because either alone is not enough.
//
// The log covers anything this app did: it reacts at once, so a machine created or
// deleted shows up immediately -- including when another client did it.
//
// The poll covers everything else, and there is plenty of it. A machine finishing
// its install and powering itself off logs nothing here. Nor does starting or
// stopping one in VirtualBox directly, or a snapshot taken outside. Without this
// the window would show a machine as running long after it stopped.
//
// One draw at a time. A draw asks VirtualBox about every machine, so overlapping
// them would multiply that for no benefit -- a request arriving mid-draw is
// remembered and run once the current one finishes.
let drawing = false
let drawAgain = false

async function draw () {
  if (drawing) { drawAgain = true; return }
  drawing = true
  try {
    await drawOnce()
  } finally {
    drawing = false
    if (drawAgain) { drawAgain = false; draw() }
  }
}

// Faster while something is happening, slower when nothing is. An install runs for
// twenty minutes and its interesting moments are at the end, so a fixed slow poll
// would make the finish look late; a fixed fast one would ask VirtualBox about
// idle machines all day.
async function sync () {
  // Nothing to keep in sync with while the window is not being looked at.
  if (!document.hidden) await draw().catch(() => {})
  const busy = latest.vms.some(v => v.running || v.stage === 'installing')
  setTimeout(sync, busy ? 3000 : 12000)
}

// `keys-get` was wired here. Getting a credential is now a button on the card
// that describes the one it replaces, beside the button that tests it.
paintActions().catch(oops)
draw().then(sync).catch(e => say(e.message, 'bad'))
