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

let view = been.get('view', 'ops')
document.querySelectorAll('.tab').forEach(b => {
  b.onclick = () => {
    view = b.dataset.view
    been.set('view', view)
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === b))
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`))
    if (view === 'live') clearBadge()
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

    fill($('keys'), held.held
      ? el('div', { className: 'card' },
          el('div', { className: 'card-title' },
            el('span', { textContent: 'Claude Code' }),
            el('span', { className: 'badge ok', textContent: 'held' })),
          el('table', { className: 'kv', style: 'margin-top:8px' },
            el('tr', {}, el('th', { textContent: 'taken from' }), el('td', { className: 'mono', textContent: held.from })),
            el('tr', {}, el('th', { textContent: 'when' }), el('td', { className: 'mono', textContent: new Date(held.taken).toLocaleString() })),
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
          el('p', { className: 'note', style: 'margin-top:10px', textContent: 'Hand it to a machine with vmCredentialsPut, and take it back with vmCredentialsForget before snapshotting.' }))
      : el('p', { className: 'empty', textContent: 'No worker credential yet. Get one from a machine that is running.' }))
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
const taskKey = t => t && [
  t.number,
  t.id, t.title, t.branch, t.state, t.reads, t.machine || '', t.run || '',
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
          el('div', { className: 'card-sub muted', textContent: t.artifact })))
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
      // Queueing is the ordinary way. A machine's natural state is off, so
      // "give it to runner2, which is on and idle" is the unusual case that
      // needs a machine kept warm on purpose — and it is offered second.
      task.state === 'queued'
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
      el('button', {
        className: 'btn',
        textContent: task.machine ? 'Give it out again' : 'Give it to a machine now',
        disabled: !idle.length || !!task.verdict,
        title: !idle.length ? 'No machine is dialled in' : task.verdict ? 'This task has been judged' : 'Skips the queue and uses a machine that is already up',
        onclick: () => giveTask(task, idle)
      }),
      // Only while something is actually running, because that is the only time
      // it means anything — and it is the button somebody wants at the moment
      // they would otherwise be opening a shell on the guest.
      task.reads === 'working'
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

function paintBranches () {
  if (view !== 'branches') return
  // Said before the asking, not after: the gap this fills is the time the answer
  // takes to arrive.
  waiting('branches', 'reading the repositories…')
  waiting('branch-actions', '…')
  waiting('branch-artifacts', '…')
  api('branchBoard').then(board => {
    const find = $('branch-find').value.trim().toLowerCase()
    const mine = $('branch-mine').checked
    const rows = board.branches
      .filter(b => !mine || oursOnly(b))
      .filter(b => !find || b.name.toLowerCase().includes(find))

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
    if (changed('branches', [rows, c, pickedBranch])) {
      fill($('branch-counts'),
        chip(`${c.all} in all`, null),
        c.claimed ? chip(`${c.claimed} claimed by a task`, 'ok') : null,
        // "Claimed by", not "checked out on": the count includes machines that
        // are switched off, and a claim outlives the machine being on.
        c.held ? chip(`${c.held} claimed by a machine`, 'ok') : null,
        c.orphaned ? chip(`${c.orphaned} orphaned`, 'bad') : null,
        c.spare ? chip(`${c.spare} spare`, 'warn') : null)

      fill($('branches'), rows.length
        ? rows.map(branchCard)
        : el('p', { className: 'empty', textContent: mine ? 'Nothing this system made. Untick "ours" to see the rest.' : 'No branches match.' }))
    }

    const picked = board.branches.find(b => b.name === pickedBranch) || null
    branchActions(picked)
    paintBranchArtifacts(picked)
  }).catch(oops)
}

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
  if (!changed('branch-actions', b)) return

  fill(box,
    el('div', { className: 'branch-facts' },
      el('span', { className: b.commits ? 'strong' : 'muted', textContent: b.commits ? `${b.commits} commit(s) ahead` : 'nothing beyond the default' }),
      el('span', { className: 'muted', textContent: `in ${b.in.join(', ') || 'none'}` }),
      b.missing.length ? el('span', { className: 'muted', textContent: `not in ${b.missing.join(', ')}` }) : null,
      b.heldBy ? el('span', { className: 'muted', textContent: b.heldRunning ? `checked out on ${b.heldBy}` : `${b.heldBy} claims it, and is off` }) : null),

    b.whyNot ? el('p', { className: 'note', textContent: b.whyNot }) : null,

    el('div', { className: 'row', style: 'margin-top:10px' },
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

// A panel that has not been filled yet says so.
//
// EVERY PANEL HERE FILLS FROM AN ACTION, so the first frame after switching to a
// tab is empty -- and an empty panel is indistinguishable from a panel whose
// answer is "nothing". That is not a small difference: "no branches" and "not
// asked yet" look identical and mean opposite things, and the Branches tab
// photographs blank for exactly as long as its first read takes.
//
// ONLY WHEN THERE IS NOTHING THERE. Blanking a panel that already has content
// on every refresh would make the whole window flicker every three seconds,
// which is a worse fault than the one being fixed.
function waiting (id, text) {
  const box = $(id)
  if (box.childElementCount) return
  fill(box, el('p', { className: 'empty waiting', textContent: text }))
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
      // The one number that decides everything else about a branch.
      el('span', { className: 'muted', textContent: b.commits ? `${b.commits} commit(s)` : 'empty' }),
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
  waiting('branch-artifacts', `reading ${b.name}…`)
  waiting('branch-tasks', '…')

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

function openShell (name) {
  api('vmShell', { name }).then(where => {
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

    shell.child.stdout.on('data', d => term.write(d.toString('utf8')))
    shell.child.stderr.on('data', d => term.write(d.toString('utf8')))
    shell.off.push(term.onData(write))

    // The remote pty is created at ssh's idea of our size, which is 80x24
    // because we have no terminal here. Telling the far end the real size is the
    // only way anything full-screen -- an editor, `less`, `top` -- lays out
    // correctly, and it has to be said again whenever the window changes.
    shell.off.push(term.onResize(() => write(`stty rows ${term.rows} cols ${term.cols} 2>/dev/null\n`)))
    setTimeout(() => write(`stty rows ${term.rows} cols ${term.cols} 2>/dev/null; clear\n`), 700)

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
  }).catch(oops)
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
  el('span', { textContent: `${s.name}${shells.filter(o => o.name === s.name).length > 1 ? ` #${s.id}` : ''}` }),
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
}

// Whether the worker on the machine you are looking at can authenticate.
//
// HERE BECAUSE THIS IS WHERE IT BITES. Opening a shell on a fresh machine and
// running `claude` gets a sign-in menu, because a runner's credential is handed
// to it per task and taken back afterwards — so a machine sitting idle is
// signed OUT by design, and the way to fix that was a command line only.
//
// Not probed. The dashboard already records who is holding one, because a
// machine holding a credential is the thing that cannot be snapshotted.
function paintTermAuth () {
  const name = $('term-machine').value
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
  const pick = $('term-machine')
  const up = latest.vms.filter(v => v.connected || v.lastAddress)
  if (changed('term-machines', up.map(v => [v.name, v.connected]))) {
    const was = pick.value
    fill(pick, ...up.map(v => el('option', {
      value: v.name,
      textContent: `${v.name}${v.connected ? '' : ' — not dialled in, last known address'}`
    })))
    if (was && up.some(v => v.name === was)) pick.value = was
  }
  $('term-open').disabled = !up.length
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
function getCredentials () {
  const running = latest.vms.filter(v => v.connected)
  if (!running.length) {
    return oops(new Error('No machine is dialled in. Start one and wait for it to connect — the sign-in happens on a machine, not here.'))
  }

  ask({
    title: 'Get Claude Code credentials',
    plain: [
      'One machine signs in, and this host keeps what it gets.',
      'It opens a sign-in on that machine and gives you an address to visit; the machine waits, holding it open, until you bring the code back.',
      'Nothing is installed or changed on the machine beyond signing its worker in.'
    ],
    fields: [{
      name: 'name',
      label: 'Which machine signs in',
      value: running[0].name,
      options: running.map(v => ({ value: v.name, label: `${v.name} — ${v.description || v.stage}` }))
    }],
    confirm: 'Start the sign-in',
    onYes: async f => {
      const started = await api('vmAuthBegin', { name: f.name })
      // A second dialog rather than a field on the first, because the address
      // does not exist until the machine has been asked -- and a form that asks
      // for a code before there is anything to get one from is a form nobody can
      // fill in.
      askForCode(f.name, started.url)
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
    extra: {
      label: 'Give up',
      onClick: () => api('vmAuthCancel', { name }).then(() => say(`the sign-in on ${name} was abandoned`)).catch(oops)
    },
    onYes: async f => {
      if (!f.code) throw new Error('Paste the code from the sign-in page.')
      await api('vmAuthCode', { name, code: f.code })
      // Taken straight away rather than left for a second click. The reason the
      // machine was signed in at all is so this host holds the result, and a
      // credential left sitting on a machine is the thing this exists to avoid.
      const kept = await api('vmCredentialsGrab', { name })
      say(`${name} signed in, and its credential is kept here`)
      showTab('keys')
      paintKeys()
      return kept
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

    // ONE button, and it asks a question only once.
    //
    // A machine on a branch stays on it until it is clean, so there is nothing
    // to decide on the way back in: opening again just opens. There was briefly
    // a second button for moving to another branch, and it was a mistake --
    // switching is how half-finished work stops being anywhere, sitting on a
    // branch the machine may no longer push with nothing saying so. The way off
    // a branch is back to a snapshot from before it, which is an action that
    // states what it discards.
    //
    // The setup still runs on the way in, because it is safe to -- it never
    // resets the machine's copy -- and it repairs a workspace that is not there,
    // which is exactly the state a machine is in after being rolled back.
    v.connected && v.branch
      ? el('button', {
          className: 'btn',
          textContent: 'Open in VS Code',
          title: `${v.name} is on ${v.branch}, and stays there until it is clean`,
          onclick: () => {
            showTab('live')
            return api('vmWorkspace', { name: v.name, branch: v.branch })
              .then(() => api('vmEditor', { name: v.name }))
              .then(r => say(`${v.name} is on ${v.branch} — VS Code opened ${r.opened}`))
              .catch(oops)
          }
        })
      : el('button', {
          className: 'btn',
          textContent: 'Open in VS Code',
          disabled: !v.connected,
          title: v.connected ? '' : 'It has to be dialled in — that is where its address comes from',
          onclick: () => api('gitBranches').then(({ repos, branches }) => {
            // Two questions, kept apart, because the way out of each is
            // different. A branch may not be AVAILABLE -- protected, or another
            // machine has it -- and then the answer is to pick another one. Or
            // it may not be RECLAIMABLE, meaning a checkout here has uncommitted
            // work in it, and then the answer is in that working tree and this
            // choice was fine.
            const open = branches.filter(b => b.usable)
            const taken = branches.filter(b => !b.available)
            const stuck = branches.filter(b => b.available && !b.reclaimable)

            return ask({
              title: `Open ${v.name} in VS Code?`,
              plain: [
                `It sets up a workspace on ${v.name} holding ${repos.length ? repos.join(', ') : 'the workspace repositories'}, all on one branch, pointed back here.`,
                'Pick a branch to carry on with, or type a name to start new work.',
                'Nothing lands on a default branch: the branch is cut here first and the machine arrives with it already checked out.',
                // Asked once, and said so while it is still a free choice. After
                // this the machine is on that branch until it is rolled back to a
                // point from before it, which is the only way off.
                `${v.name} stays on whichever you pick until it goes back to a snapshot from before it.`,
                // What is missing from the list, and why -- otherwise a branch
                // somebody knows exists is simply absent, which reads as a bug.
                ...taken.map(b => b.protected
                  ? `${b.name} is not offered: it is the default branch, and work is merged into it here rather than done on it.`
                  : `${b.name} is not offered: ${b.heldBy} is working on it.`),
                // Said differently on purpose. This one is not about the branch
                // at all -- it is available, and something in a working tree
                // here is in the way of using it.
                ...stuck.map(b => `${b.name} is free, but ${b.blocked.join(' ')}`),
                'Then a new window opens on it; this one is not replaced.'
              ],
              fields: [
                {
                  name: 'existing',
                  label: open.length ? 'Carry on with' : 'Nothing to carry on with — type a name below',
                  value: '',
                  options: [
                    { value: '', label: open.length ? '— start a new one —' : 'none available' },
                    ...open.map(b => ({
                      value: b.name,
                      // What a name means is which repositories are on it, so
                      // that is said here rather than discovered after picking.
                      label: b.missing.length ? `${b.name} — in ${b.in.join(', ')}` : `${b.name} — all of them`
                    }))
                  ]
                },
                { name: 'fresh', label: 'Or a new branch', placeholder: 'fix/the-thing' }
              ],
              confirm: 'Set it up and open it',
              onYes: async f => {
                const branch = f.fresh.trim() || f.existing
                if (!branch) throw new Error('Pick a branch to carry on with, or type a name for a new one.')

                showTab('live')
                // Two calls, because they fail differently and only one of them
                // is slow: setting up clones over the network, opening does not.
                // If the setup fails there is nothing worth opening, and the
                // reason is in the log rather than behind an editor window.
                const w = await api('vmWorkspace', { name: v.name, branch })
                const r = await api('vmEditor', { name: v.name })
                say(`${v.name} is on ${w.branch} — VS Code opened ${r.opened}`)
              }
            })
          }).catch(oops)
        }),

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
  waiting('snapshots', 'reading its snapshots…')

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
const goToShell = name => { showTab('terminal'); openShell(name) }

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
    el('div', { className: 'row', style: 'margin-top:10px' },
      el('button', {
        className: 'btn',
        textContent: 'Open a shell',
        disabled: !(v.connected || v.lastAddress),
        title: (v.connected || v.lastAddress) ? '' : 'It has to have dialled in once for its address to be known',
        onclick: () => goToShell(v.name)
      }),
      v.branch ? el('button', { className: 'btn', textContent: 'Its branch', onclick: () => goToBranch(v.branch) }) : null,
      doing ? el('button', { className: 'btn', textContent: 'Its task', onclick: () => goToTask(doing) }) : null),

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
  if (changed('vms', [latest.available, picked, latest.vms.map(v => [vmKey(v), queueWhy(v)])])) {
    fill($('vms'), latest.vms.length
      ? latest.vms.map(vmCard)
      : el('p', { className: 'empty', textContent: latest.available ? 'None yet. The + above makes one.' : 'VirtualBox was not found.' }))
  }
  vmActions()
  paintDetails()
  paintSnapshots().catch(() => {})
}

$('add-task-open').onclick = newTask
$('term-open').onclick = () => openShell($('term-machine').value)
$('term-close').onclick = () => closeShell(active)
// The sign-in line is about the machine in the picker, not the one in the front
// tab -- it is what you read BEFORE opening a shell, to know whether opening one
// is worth doing.
$('term-machine').onchange = () => paintTermAuth()
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
    api('vmList'),
    api('status'),
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

  // A path worth copying, so it must not be replaced under a selection.
  setText($('vbox-path'), status.virtualbox || '')
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
    if (want.view && want.view !== view) {
      const tab = document.querySelector(`.tab[data-view="${want.view}"]`)
      // TWO draws, not one. One was enough for a tab whose panels come from data
      // already in hand, and not for one that reads git the moment it opens --
      // the Branches tab photographed showing its own "reading…" placeholder,
      // which is honest and still not what the picture was for.
      if (tab) { tab.click(); shotSettle = 2; return }
      // Named a tab that does not exist. Said rather than silently photographing
      // whatever was already open and letting it read as that tab.
      api('windowShotDone', { file: want.file, error: `there is no tab called "${want.view}"` })
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

$('keys-get').onclick = () => getCredentials()
paintActions().catch(oops)
draw().then(sync).catch(e => say(e.message, 'bad'))
