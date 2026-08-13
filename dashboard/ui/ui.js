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
    v.forTasks === false ? el('span', { className: 'badge warn', textContent: 'not for tasks' }) : null))

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

    // A snapshot with no title is one nobody can choose between later, so the
    // title is asked for rather than generated.
    el('button', {
      className: 'btn',
      textContent: 'Take a snapshot',
      // Off only. A running machine would have its memory stored too, and the
      // server refuses it for that reason -- this is the same rule said early, so
      // the answer arrives before the dialog is filled in rather than after.
      disabled: !v.live || v.running,
      title: v.running ? 'Shut it down first — a snapshot of a running machine stores its memory too, which makes it enormous' : '',
      onclick: () => ask({
        title: `Snapshot ${v.name}`,
        plain: ['A snapshot is a point you can come back to.', 'Taking one changes nothing about the machine as it is now.'],
        fields: [
          { name: 'title', label: 'Title for this snapshot', value: v.baseSnapshot ? '' : 'base', placeholder: 'clean install' },
          { name: 'description', label: 'What is true at this point — optional', placeholder: 'operating system installed, nothing else' }
        ],
        confirm: 'Take it',
        onYes: f => api('vmSnapshotTake', { name: v.name, title: f.title, description: f.description })
          .then(() => say(`Snapshot "${f.title}" taken`))
      })
    }),

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
  if (!changed('snapshots', [v.name, v.running, s])) return

  fill($('snapshots'), s.snapshots.length
    ? s.snapshots.map(x => el('div', { className: 'card' },
        el('div', { className: 'card-title' },
          el('span', { className: 'mono', textContent: x.name }),
          x.name === s.current ? el('span', { className: 'badge run', textContent: 'on this one' }) : null),
        el('div', { className: 'row', style: 'margin-top:8px' },
          el('button', {
            className: 'btn',
            textContent: 'Go back to it',
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
            textContent: 'Throw it away',
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
          }))))
    : el('p', { className: 'empty', textContent: 'None yet.' }))
}

function paintDetails () {
  const v = latest.vms.find(x => x.name === picked)
  const box = $('details')
  if (!v) {
    if (changed('details', null)) fill(box, el('p', { className: 'empty', textContent: 'No machine selected.' }))
    return
  }

  const spec = v.spec || {}
  const rows = [
    ['stage', v.stage],
    ['state', v.state],
    ['made', new Date(v.created).toLocaleString()],
    ['snapshot to reset to', v.baseSnapshot || 'none yet'],
    // What it may push, which is a different question from what it has checked
    // out -- that one only the machine knows, and this is the one that is
    // enforced.
    ['may push', v.branch || 'nothing yet'],
    ['last heard from', v.reported ? new Date(v.reported).toLocaleString() : 'never'],
    ['memory', `${spec.memoryMB} MB`],
    ['processors', String(spec.cpus)],
    ['disk', `${Math.round((spec.diskMB || 0) / 1024)} GB`],
    ['network', spec.network === 'bridged' ? `bridged${spec.bridge ? ` on ${spec.bridge}` : ''}` : `nat, ssh on 127.0.0.1:${spec.sshPort}`],
    ['user', spec.user],
    ['installer image', spec.iso ? spec.iso.split(/[\\/]/).pop() : 'none'],
    ['hostname', spec.hostname]
  ]

  if (v.connected && v.agent) {
    const facts = v.agent.facts || {}
    rows.push(
      ['dialled in', `${new Date(v.agent.since).toLocaleTimeString()}, from ${v.agent.from}`],
      ['it says it is', facts.hostname ? `${facts.hostname} — ${facts.system || ''}` : 'unknown'],
      ['its addresses', (facts.addresses || []).join(', ') || 'unknown'])
  }

  // The rows themselves are the signature: they are already the finished strings,
  // so nothing this panel shows can move without the signature moving with it.
  // This is the table people copy values out of, so it must hold still.
  if (!changed('details', [v.name, rows])) return

  fill(box, el('table', { className: 'kv' }, ...rows.map(([k, val]) =>
    el('tr', {}, el('th', { textContent: k }), el('td', { className: 'mono', textContent: String(val) })))))
}

function paintVms () {
  // `picked` is in the signature because it decides which card is highlighted.
  if (changed('vms', [latest.available, picked, latest.vms.map(vmKey)])) {
    fill($('vms'), latest.vms.length
      ? latest.vms.map(vmCard)
      : el('p', { className: 'empty', textContent: latest.available ? 'None yet. The + above makes one.' : 'VirtualBox was not found.' }))
  }
  vmActions()
  paintDetails()
  paintSnapshots().catch(() => {})
}

$('add-task-open').onclick = newTask

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
  const [list, status, running] = await Promise.all([
    api('vmList'),
    api('status'),
    api('queueState').catch(() => ({ inFlight: [] }))
  ])
  const busyMachines = new Set((running.inFlight || []).map(f => f.machine))
  latest = list

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
    ...latest.vms
      .filter(v => v.running &&
        !busyMachines.has(v.name) &&        // the queue is using it
        v.forTasks !== false &&             // somebody said keep this one back
        v.stage !== 'installing')           // it is being built
      .map(v => v.holdsCredential
        ? [`${v.name} is on, doing nothing, and holding a worker credential. `,
            'A runner rests off and holding nothing. Take the credential back and shut it down, or give it something to do.']
        : [`${v.name} is on and doing nothing. `,
            'A runner rests off — the queue starts one when there is work. Shut it down, or give it something to do.'])
  ].filter(Boolean)

  $('trouble').classList.toggle('hidden', !trouble.length)
  if (changed('trouble', trouble)) {
    fill($('trouble'), trouble.map(([bold, rest]) => el('div', {},
      el('strong', { textContent: bold }),
      el('span', { textContent: rest }))))
  }

  paintVms()
  paintKeys()
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
