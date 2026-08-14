'use strict'

// The chrome every tab sits in: the notice bar, what the window
// remembers, the tabs themselves, and the one dialog everything asks
// through.
//
// Part of the window. See ui/load.js for the order these are read in and why
// the order matters.

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

    // DRAWN NOW, NOT ON THE NEXT TICK.
    //
    // Every panel here is empty until its paint function runs, and every paint
    // function refuses to run unless its tab is the one being looked at -- which
    // is right, and left switching tabs waiting for the poll. That poll is
    // TWELVE SECONDS when no machine is running, so a tab could sit blank for
    // twelve seconds after being clicked and the window looked broken rather
    // than busy.
    //
    // The two costs are worth telling apart, because only one of them was real:
    // reading the branch board takes under a second, and the wait before it
    // STARTED was the other eleven. Nothing here is faster than it was; it
    // simply begins when asked.
    //
    // The sub-tab handlers already did this. Only the tabs themselves did not.
    if (from !== view) draw()
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
    // A failure says so rather than doing nothing, because a button that quietly
    // does not work is the failure this whole window is written against. Which
    // APIs are tried, and in what order, is the host's business -- see ui/nwjs.js.
    if (!host.openExternal(url)) say('Could not open a browser — copy the address below instead.', 'bad')
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
