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

// Through `call` rather than the table directly, so the window is refused the
// same things the command line is refused. See server.js.
const api = async (name, args = {}) => app.call(name, args)

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
