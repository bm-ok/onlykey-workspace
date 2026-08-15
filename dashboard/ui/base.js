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
// Whatever this window is running inside. One of ui/nwjs.js or ui/browser.js
// has already declared it; everything below asks it for what a page cannot do on
// its own, and never asks which one it got.
const app = host.app
const liveLog = app
  ? require('./core/log')
  : { on: () => ({ info () {}, warn () {}, bad () {}, good () {}, out () {} }) }

// WHETHER THIS WINDOW IS BEING DRIVEN FROM OUTSIDE.
//
// `windowClick` and `windowFill` exist so the window can be tested from the
// command line — it was the one half of this app with no way in, so every fault
// in a click handler was found by a person clicking it. A driven press reaches
// exactly the handlers a real press reaches, which is the point: a test that
// took a different path would not be testing the button.
//
// And that is also the hazard. The window is where a person is assumed to be:
// approving a job, a prompt or a contract is refused over the wire precisely
// because a model may write one and may not ratify its own. A driven press is
// not refused — testing the approve button means being able to press it — but it
// must not be able to CLAIM to be a person, because "somebody read this and
// approved it" is the whole of what that record asserts.
//
// So it is marked, and the mark travels with every call the press causes. See
// `whoAsked` in actions/shared.js.
//
// CLEARED BY A REAL HUMAN TOUCH, not by a timer. A press sets off work that
// finishes whenever it finishes — a dialog opened now and confirmed in a minute
// is one act — so there is no duration that is right. What is unambiguous is
// somebody putting their hand on the window: `isTrusted` is set by the browser
// and cannot be forged from script, so the first genuine mousedown or keypress
// says a person is here again. Until then it stays set, which is the safe way
// round: the worst it does is describe a person's action as driven, and the
// alternative is describing a model's action as a person's.
let drivenFromTheWire = false
const drivingNow = on => { drivenFromTheWire = !!on }
for (const kind of ['mousedown', 'keydown', 'wheel']) {
  document.addEventListener(kind, e => { if (e.isTrusted) drivenFromTheWire = false }, true)
}

// Through `call` rather than the table directly, so the window is refused the
// same things the command line is refused. See server.js.
const api = async (name, args = {}) => host.call(name, drivenFromTheWire ? { ...args, _driven: true } : args)

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

// FORGETTING IS NOT THE SAME AS DRAWING NOTHING, and conflating them cost a
// panel that would not clear.
//
// `changed(key, null)` was the idiom for "throw the signature away so the next
// paint definitely happens" -- used seventy-five times. But `null` is also a real
// value: it is what every detail panel here is handed when nothing is selected.
// So deleting the last prompt did this:
//
//     the handler   forget('prompt-detail')   stores "null"
//     the repaint   forget('prompt-detail')   ALREADY "null" -> false
//
// and the panel kept showing the thing that had just been deleted, with buttons
// that then failed with "there is no prompt called...". The list beside it said
// "none yet" at the same time, which is the two halves of one screen disagreeing
// about whether something exists.
//
// So invalidating has its own word. It cannot collide with a value because it
// stores no value.
const forget = key => { drawnFrom.delete(key) }

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

// AS TALL AS WHAT IS IN IT, and ace is the one that knows.
//
// The height used to be arithmetic here — line count times an em-and-a-half,
// clamped to a fixed number of rows. Both halves of that were wrong. Too short,
// because everything worth reading whole (a job's script, the words a worker is
// handed) hit the clamp and got a scrollbar inside a page that already scrolls,
// which is how a hundred lines of JavaScript gets scrolled past and approved
// anyway. And too tall, because `wrap: true` turns one long line into three
// screen rows and counting `\n` cannot know that — so a short prompt written as
// paragraphs came out with empty space below it AND a scrollbar.
//
// `minLines`/`maxLines` are ace measuring its own laid-out rows, after wrapping,
// and resizing the container to them. It grows and shrinks on its own.
//
// A LID EXISTS BECAUSE ONE THING HERE HAS NO UPPER BOUND. With maxLines, ace
// lays out every row instead of only the visible ones, which is fine for a
// script somebody wrote and is not fine for a ten-thousand-line diff. So a diff
// asks for a lid and everything read whole does not.
const HUGE = 100000
// The lid a diff asks for. Generous enough that an ordinary change is read whole
// and nothing here has to guess, low enough that a machine-generated diff cannot
// lay out fifty thousand rows and take the window with it.
const DIFF_LID = 500

function codeBlock (text, mode = 'javascript', { min = 3, max = Infinity } = {}) {
  const host = el('div', { className: 'code' })
  // A height before ace sees it, still. Ace measures its container to lay out,
  // so a container with no height renders an editor with no rows in it — which
  // looks exactly like an empty file. This is only the first frame; ace replaces
  // it with the real one.
  const rough = Math.max(min, Math.min(max === Infinity ? 40 : max, String(text || '').split('\n').length + 1))
  host.style.height = `${rough * 1.5}em`

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
      showFoldWidgets: false,
      minLines: min,
      // Infinity is not a number ace will take; it wants a count.
      maxLines: max === Infinity ? HUGE : max
    })
    ed.renderer.$cursorLayer.element.style.display = 'none'
    // The inline height was a guess for one frame. Ace owns it now, and leaving
    // the guess behind would fight it.
    host.style.height = ''
  })
  return host
}

// ---- markdown, read as markdown ---------------------------------------
//
// A report handed back by a run is written to be read: headings, a table, a
// quoted brief. As source it is a wall of pipes and hashes, and the one thing it
// was formatted for is the thing that does not happen.
//
// IN AN IFRAME, AND THAT IS THE WHOLE DESIGN, not a convenience for styling.
// This text came off a machine running a script somebody wrote, so it is exactly
// as trustworthy as that script -- and markdown carries raw HTML through by
// design, which marked does not sanitise and never claimed to. Put in this
// document it would be running inside an app page that has node.
//
// So it renders into a frame that can do nothing:
//
//   sandbox=""      no scripts, and no same-origin. A <script> or an onerror in
//                   the markdown is inert, and nothing in the frame can reach
//                   this document, its globals, or require()
//   a CSP as well   default-src 'none', so a remote <img> cannot phone home --
//                   which would otherwise turn "somebody opened this artifact"
//                   into a request to a host of the author's choosing
//   srcdoc          no file is written anywhere to show it
//
// The cost of a real sandbox is that this side cannot measure the frame's
// content to size it, because reading contentDocument needs allow-same-origin.
// So it gets a height and scrolls inside, which a dialog does anyway.
const MD_STYLE = `
  :root { color-scheme: dark }
  body { margin: 0; padding: 14px 16px; background: #0a0d12; color: #d7dee8;
         font: 13px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
  h1, h2, h3, h4 { color: #fff; line-height: 1.25; margin: 1.2em 0 .5em; }
  h1 { font-size: 1.5em; border-bottom: 1px solid #2a323d; padding-bottom: .3em }
  h2 { font-size: 1.25em; border-bottom: 1px solid #2a323d; padding-bottom: .3em }
  h1:first-child, h2:first-child, h3:first-child { margin-top: 0 }
  a { color: #4aa3ff }
  code { font-family: ui-monospace, Consolas, monospace; font-size: 12px;
         background: #161b22; padding: .15em .4em; border-radius: 4px }
  pre { background: #161b22; border: 1px solid #2a323d; border-radius: 8px;
        padding: 12px; overflow-x: auto }
  pre code { background: none; padding: 0 }
  blockquote { margin: 0 0 1em; padding: .2em 0 .2em 14px; border-left: 3px solid #2a323d; color: #9aa6b5 }
  table { border-collapse: collapse; margin: 0 0 1em; display: block; overflow-x: auto }
  th, td { border: 1px solid #2a323d; padding: 6px 10px; text-align: left }
  th { background: #161b22 }
  hr { border: 0; border-top: 1px solid #2a323d; margin: 1.5em 0 }
  img { max-width: 100% }
  ul, ol { padding-left: 22px }
  li { margin: .2em 0 }
`

function markdownFrame (text, { height = '60vh' } = {}) {
  let body
  try {
    body = marked.parse(String(text == null ? '' : text))
  } catch (e) {
    // Said in the frame rather than thrown, because the source view beside it
    // still works and is what somebody would fall back to anyway.
    body = `<p>This could not be rendered as markdown: ${String(e.message).replace(/[<&]/g, c => (c === '<' ? '&lt;' : '&amp;'))}</p>`
  }
  const frame = el('iframe', {
    className: 'md',
    sandbox: '',
    srcdoc: `<!doctype html><html><head><meta charset="utf-8">` +
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">` +
      `<style>${MD_STYLE}</style></head><body>${body}</body></html>`
  })
  frame.style.height = height
  return frame
}

// Rendered or as written, and the toggle remembers which you last chose.
//
// Both, because they answer different questions. The rendered view is for
// reading what a run produced; the source is for seeing what it actually wrote,
// which is what matters when the formatting is the thing that went wrong.
// NOT READ AT LOAD TIME. `been` is declared in ui/shell.js, which loads after
// this file -- see ui/load.js on why the order is not a preference. Reading it
// here at the top level would be a ReferenceError before the window ever drew.
let mdLook = null

function markdownBlock (text, { height = '60vh' } = {}) {
  if (mdLook === null) mdLook = been.get('md-look', 'rendered')
  const box = el('div', {})
  const rendered = el('button', { className: 'btn small', textContent: 'Rendered' })
  const source = el('button', { className: 'btn small', textContent: 'Source' })
  const view = el('div', {})

  const show = which => {
    mdLook = which
    been.set('md-look', which)
    rendered.classList.toggle('ok', which === 'rendered')
    source.classList.toggle('ok', which === 'source')
    fill(view, which === 'rendered'
      ? markdownFrame(text, { height })
      // Not auto-height here: the two views swapping between a fixed frame and
      // a page-length editor makes the dialog jump under the pointer.
      : codeBlock(text, 'markdown', { max: 400 }))
  }

  rendered.onclick = () => show('rendered')
  source.onclick = () => show('source')

  fill(box, el('div', { className: 'row', style: 'margin-bottom:8px' }, rendered, source), view)
  show(mdLook)
  return box
}

// The same, but it hands back the editor.
//
// `codeBlock` deliberately returns only a node — nothing needed the editor, and
// not returning it kept every caller from reaching in. A side-by-side view does
// need it: two editors have to be told about each other to scroll together, and
// the rows that are additions have to be marked. So this is the same
// construction with a way out, and `codeBlock` stays as it was for everything
// that only wants to show text.
function editorBlock (text, mode, { min = 3, max = Infinity, gutter = null, onReady = null, edit = false } = {}) {
  const host = el('div', { className: 'code' })
  const rough = Math.max(min, Math.min(max === Infinity ? 40 : max, String(text || '').split('\n').length + 1))
  host.style.height = `${rough * 1.5}em`

  queueMicrotask(() => {
    if (!host.isConnected) return
    const ed = ace.edit(host)
    ed.setTheme('ace/theme/tomorrow_night')
    ed.session.setMode(`ace/mode/${mode}`)
    ed.session.setUseWorker(false)
    ed.setValue(String(text == null ? '' : text), -1)
    // WRITABLE ONLY WHEN ASKED. Almost everything shown here is read rather
    // than written -- a diff, a prompt, a definition -- with one exception: a
    // job is code somebody writes, and code written in a <textarea> is code
    // written with no bracket matching and no indentation, which is how an
    // unreadable script gets approved.
    ed.setReadOnly(!edit)
    ed.setOptions({
      highlightActiveLine: edit,
      highlightGutterLine: edit,
      showPrintMargin: false,
      fontSize: 12,
      // NOT WRAPPED, for a side-by-side. Wrapping makes one row taller than its
      // opposite number, and then the two columns say different things at the
      // same height — which is the one thing this view exists to avoid.
      wrap: false,
      showFoldWidgets: false,
      minLines: min,
      maxLines: max === Infinity ? HUGE : max
    })
    if (!edit) ed.renderer.$cursorLayer.element.style.display = 'none'
    host.style.height = ''

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

// ---- not yet, rather than nothing ---------------------------------------
//
// A placeholder, the shapes it is made of, the yield that makes it visible, and
// the switch that holds it long enough to be judged.
//
// This lived beside the first panel that used one, which was fine while there
// was one panel. Five files call it now, and a helper declared halfway down the
// load order is one nobody can find and nobody dares call from earlier.

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

// LET THE BROWSER DRAW WHAT WAS JUST PUT THERE, before doing the work.
//
// This is what made every skeleton in this file invisible. Placing one is a DOM
// change, and a DOM change is not a paint -- the browser renders when JavaScript
// yields. Nothing here yielded: a paint function put the placeholder in and then
// called an action, and an action reads git with execFileSync, which blocks this
// thread. So the sequence was: skeleton written, thread frozen for a fifth of a
// second, real content written, ONE paint. The placeholder existed for the whole
// wait and was never on screen once.
//
// Two frames rather than one, and the second is the one that matters: a
// requestAnimationFrame callback runs BEFORE its paint, so a single one would
// hand control back at exactly the moment the skeleton still has not been drawn.
// Waiting for the frame after it means the frame carrying the skeleton has been
// through.
//
// The freeze that follows is unchanged -- this makes it VISIBLE, not shorter.
// That is the whole ask: a panel that says it is working reads as working, and
// the same panel silent reads as broken.
// Held longer on purpose while `windowSlow` is on, so a state that lasts a fifth
// of a second can be looked at, judged and photographed. Off unless asked for,
// and the banner says so while it is on. See the action of the same name.
let slowMs = 0

const settle = () => new Promise(r => {
  let went = false
  const go = async () => {
    if (went) return
    went = true
    // THE ONE MOMENT NOTHING OUTSIDE CAN CATCH. The placeholder is on screen and
    // nothing has been read yet, which is the state a screenshot asked for from
    // the command line can never land on -- asking takes longer than it lasts.
    // So it is taken here, by the window, at the moment it exists.
    if (catchLoading) { const want = catchLoading; catchLoading = null; await takeShot(want.file) }
    if (slowMs) return setTimeout(r, slowMs)
    r()
  }

  requestAnimationFrame(() => requestAnimationFrame(go))

  // AND A WAY OUT, because requestAnimationFrame is not a promise that something
  // will happen. A window behind another window gets its frames throttled, and a
  // minimised one gets none at all -- so waiting on frames alone means every
  // panel that yields here stops loading whenever nobody is looking directly at
  // it, and comes back stuck on a placeholder. Measured at thirteen seconds for
  // two frames with this window merely covered.
  //
  // The frames are the PREFERRED path because they are what guarantees the
  // placeholder was actually drawn. This is the floor under them: past a quarter
  // of a second, reading late is better than not reading.
  setTimeout(go, 250)
})

// A shot armed with when:'loading', waiting for the next placeholder to go up.
let catchLoading = null

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
