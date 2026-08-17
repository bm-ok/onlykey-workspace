'use strict'

// Talking to the supervisor.
//
// Part of the window. See ui/load.js for the order these are read in.
//
// THE ONE TAB WHERE THIS APP IS NOT REPORTING. Everything else here says what
// was done — a branch cut, a task queued, a run finished. This says what was
// ASKED FOR, and what the thing doing the deciding said about it.
//
// NEITHER END IS USUALLY PRESENT. A supervisor is switched off most of the time
// and reads this when it next wakes; a person types something and closes the
// window. So it is a file on this host rather than a connection — see
// core/chat.js — and "sent" means written down, not delivered. The note under
// the heading says so, because a chat box that looks like a chat box invites the
// expectation that somebody is on the other end right now.

// What was drawn last, so the thread only redraws when it changed. This one
// matters more than most: a redraw moves the scroll, and moving somebody's
// scroll while they are reading a long answer is the most irritating thing a
// panel can do.
let chatSeen = 0

// WHICH SIDE, WHICH IS HOW A CONVERSATION SAYS WHO IS SPEAKING. Yours on the
// right, the supervisor's on the left — the one convention every chat window
// shares, which makes the label above a bubble a courtesy rather than the only
// way to tell.
// ---- a message that is written as markdown, read as markdown ---------------
//
// A supervisor answers in prose most of the time, and sometimes in a list of
// three tasks with their branches, or a fenced block of what a job would run. As
// source that second kind is a wall of dashes and backticks, and the formatting
// it was written with is the thing that does not happen.
//
// IN THE SANDBOXED FRAME, which is not a styling convenience. This text came from
// a model, and markdown carries raw HTML through by design — marked does not
// sanitise it and never claimed to. Rendered into THIS document it would be
// running inside an app page that has node and require(). The frame can do
// nothing: no scripts, no same-origin, a CSP of default-src 'none'. See
// markdownFrame in ui/base.js, which the artifact viewer already uses.
//
// ONLY WHEN IT IS ACTUALLY MARKDOWN. A frame per bubble is a document per
// bubble, and a one-line answer does not need one — worse, a frame cannot be
// measured from out here (that needs same-origin), so its height is an estimate
// and an estimate around one sentence looks like a bug. So: prose stays text,
// and anything with structure gets the viewer.
const LOOKS_MARKDOWN = /(^|\n)\s*(#{1,6} |[-*+] |\d+\. |> |\|)|```|`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)\s]+\)/

// HOW TALL, ESTIMATED, BECAUSE THE FRAME CANNOT BE ASKED.
//
// Reading a frame's height needs allow-same-origin, which is exactly what must
// not be granted to text off a machine — and letting it MEASURE ITSELF and
// report back needs allow-scripts, which would mean a <script> in the markdown
// running too. Both were written and both were thrown away: the trade is a
// hostile script for a tidier bottom margin, and the margin is not worth it.
//
// So: lines as written, plus what long ones wrap to at this width, plus what
// markdown adds around blocks. About 120 characters is a line at 92% of this
// window; the first version assumed 95 and left a hand's width of blank under
// every answer.
//
// IT ERRS GENEROUS ON PURPOSE. Blank space under a message reads as spacing; a
// scrollbar inside a chat bubble reads as broken.
const guessHeight = text => {
  const lines = String(text).split('\n')
  const rows = lines.reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 120)), 0)
  // Headings, fences and tables carry margins and borders a line count cannot
  // see.
  const blocks = (String(text).match(/(^|\n)\s*(#{1,6} |```|\|)/g) || []).length
  return Math.min(560, Math.max(58, rows * 22 + blocks * 10 + 30))
}

const oneMessage = (m, read) => {
  const mine = m.who === 'person'
  // DELIVERED, WHICH IS NOT THE SAME AS SENT. Yours sits faded until the
  // supervisor has actually been handed it — it is switched off most of the
  // time, and a message waiting for a machine to boot looks exactly like a
  // message being ignored. See the receipt in core/chat.js.
  const waiting = mine && Number(m.n) > Number((read && read.n) || 0)
  return el('div', { className: `msg ${mine ? 'mine' : 'theirs'}${waiting ? ' waiting' : ''}` },
    el('div', { className: 'msg-who' },
      el('span', { textContent: mine ? 'you' : 'the supervisor' }),
      // WHERE IT CAME FROM, when it was not somebody typing here. A line written
      // by a drill or from the command line is not a person asking for
      // something, and it should not look like one at a glance.
      m.via && m.via !== 'window' && m.via !== 'wire'
        ? el('span', { className: 'badge muted', textContent: m.via })
        : null,
      // Which machine said it, when it was a machine. Two supervisors are not
      // supposed to run at once, and this is where it would show.
      !mine && m.from ? el('span', { className: 'mono', textContent: m.from }) : null,
      el('span', { textContent: ago(m.at) }),
      mine
        ? el('span', { textContent: waiting ? 'not read yet' : 'read' })
        : null,
      m.about ? el('span', { textContent: `about ${m.about}` }) : null),
    el('div', { className: 'msg-body' },
      // Never textContent-or-innerHTML-by-taste: one of the two branches renders
      // in a frame that can do nothing, and the other does not parse at all.
      LOOKS_MARKDOWN.test(m.text)
        ? markdownFrame(m.text, { height: guessHeight(m.text) + 'px' })
        : m.text))
}


// ---- IS IT UP, AND CAN IT RUN -----------------------------------------------
//
// The first thing this tab says, because it is the thing that is invisible
// everywhere else. A supervisor machine that is running and dialled in and
// holding NO credential looks exactly like a working one on the Runners tab, on
// the queue, and here — and every wake against it ends in three seconds having
// done nothing. That is what happened on this host: a message sat unread all
// afternoon and nothing anywhere said why.
//
// ONE PRESS TO START IT, because it is two steps in an order that matters —
// start the machine, wait for it to dial in, then give it its sign-in. Doing
// that by hand is what went wrong; a button that does both cannot forget the
// second half. Stopping is the same two steps backwards, and that order matters
// more: the credential comes off BEFORE the machine goes down, or a sign-in is
// left on a disk with nothing on this host recording it as out.
function paintSupervisorState () {
  if (view !== 'chat') return

  api('supervisorState').then(st => {
    if (view !== 'chat') return
    if (!changed('supervisor-state', st)) return

    if (!st.there) {
      fill($('supervisor-state'), el('span', { className: 'muted', textContent: 'no supervisor machine', title: st.note }))
      return standIn(st, [])
    }

    const one = (st.supervisors || [])[0] || {}
    const busy = !!st.thinking

    // ONE LINE, AND ONLY WHAT DECIDES SOMETHING. The name, whether it can run,
    // what it is signed in as, and the one button that changes that. Everything
    // else this knows — the machine's state, the reason it cannot run — is on
    // the hover, because it is what somebody wants only once it is wrong.
    //
    // NO "WAKE IT" HERE: the header already has one, six pixels to the right,
    // and two buttons doing the same thing in one row is a row somebody has to
    // read twice.
    fill($('supervisor-state'),
      el('span', { className: 'mono', textContent: one.name }),
      el('span', {
        className: `badge ${busy ? 'run' : st.ready ? 'ok' : 'warn'}`,
        style: 'margin-left:6px',
        // The whole story, on the hover. A badge that says "cannot run" and
        // nothing else is a badge that sends somebody looking through tabs.
        title: one.why || st.note || '',
        textContent: busy ? 'thinking' : st.ready ? 'ready' : 'cannot run'
      }),
      // WHAT IT IS SIGNED IN AS, which is the fact that was invisible everywhere
      // else and cost an afternoon. A name and a fingerprint, never a value.
      one.signedInAs
        ? el('span', { className: 'muted', style: 'margin-left:8px', title: `fingerprint ${one.fingerprint || ''}`, textContent: one.signedInAs })
        : el('span', { className: 'warn', style: 'margin-left:8px', title: 'A worker on it cannot authenticate, so waking it does nothing.', textContent: 'no credential' }),
      st.ready
        ? el('button', {
          className: 'btn',
          style: 'margin-left:10px',
          textContent: 'Put it away',
          title: 'Takes its credential back first, then stops it',
          onclick: () => press('supervisorDown', 'Putting it away — taking the credential back first.')
        })
        : el('button', {
          className: 'btn ok',
          style: 'margin-left:10px',
          textContent: 'Start it',
          title: 'Starts the machine, waits for it to dial in, and signs it in',
          onclick: () => press('supervisorUp', 'Starting it and signing it in — this takes a minute.')
        }))

    // AND THE BOX YOU TYPE INTO GOES WITH IT.
    standIn(st, st.supervisors || [])
  }).catch(() => { /* the chrome says when the dashboard is unreachable */ })
}


// ---- WHAT YOU CAN DO, WHERE THE COMPOSER IS ---------------------------------
//
// A message to a supervisor that cannot run is KEPT and delivered whenever one
// next wakes — which is the worst of both: the box accepts it, the send works,
// and nothing answers for as long as the machine stays down. That is the exact
// shape of the afternoon this came out of.
//
// So when nothing can read it, the composer is replaced in place by the decision
// that would actually help: which supervisor, and start it. Same position, same
// height, so the page does not jump when one comes up.
function standIn (st, rows) {
  const ready = !!(st && st.ready)

  // THE WHOLE BODY GOES, not only the composer. A thread nothing can answer is
  // not useful context — it is a record of a conversation with something that is
  // not there, sitting above a box that accepts messages nobody will read. The
  // one useful thing on this tab while the machine is down is the way to bring
  // it up, so that is the only thing on it.
  //
  // THE HEADER STAYS, because it says WHY: the name, "cannot run", and what it
  // is signed in as. That line is the answer to the question this screen raises.
  for (const id of ['chat-note', 'chat-thread', 'chat-composer']) {
    $(id).classList.toggle('hidden', !ready)
  }
  $('chat-offline').classList.toggle('hidden', ready)

  // AND THE HEADER'S OWN WAKE BUTTON, which is not this panel's but is the one
  // thing on the screen that would still do nothing if pressed. A control that
  // is offered and has no effect is the fault this whole tab exists to end.
  $('chat-wake').disabled = !ready
  $('chat-wake').title = ready ? 'One turn: it reads what changed and answers' : 'It cannot run yet — start it first'
  if (ready) return

  if (!changed('chat-offline', [rows.map(r => `${r.name}${r.state}${r.signedInAs || ''}`), !!(st && st.there)])) return

  const instead = $('chat-offline')
  if (!st || !st.there) {
    return fill(instead,
      el('p', { className: 'why', textContent: 'This host has no supervisor machine.' }),
      el('p', { className: 'why muted', textContent: 'Make one on the Runners tab — tick "supervisor machine?" when you create it.' }))
  }

  // ONE IS THE ORDINARY CASE, and a picker with one entry asks a question with
  // one answer. Shown only when there is a real choice — and only one may run at
  // a time anyway, so picking is picking WHICH.
  const pick = rows.length > 1
    ? el('select', { id: 'chat-which' }, ...rows.map(r => el('option', { value: r.name, textContent: `${r.name} — ${r.state}` })))
    : null

  fill(instead,
    el('p', { className: 'why', textContent: rows.length === 1 ? `${rows[0].name} is not running.` : 'No supervisor is running.' }),
    rows.length === 1 && rows[0].why
      ? el('p', { className: 'why muted', textContent: rows[0].why })
      : null,
    el('div', { style: 'display:flex; gap:10px; align-items:center; flex-wrap:wrap; justify-content:center' },
      pick,
      el('button', {
        className: 'btn ok',
        textContent: rows.length > 1 ? 'Start the one you picked' : `Start ${rows[0] ? rows[0].name : 'it'}`,
        title: 'Starts the machine, waits for it to dial in, and signs it in',
        onclick: () => {
          const chose = pick ? pick.value : (rows[0] || {}).name
          press('supervisorUp', `Starting ${chose} and signing it in — this takes a minute.`)
        }
      })),
    // SAID PLAINLY, because a message typed while it is down is not lost — it is
    // kept and delivered whenever one next wakes, which is the behaviour that
    // makes an accepting composer worse than none at all.
    el('p', { className: 'why muted', textContent: 'Anything said while it is down would wait unread until one is up, so there is nowhere to type until then.' }))
}

// A press that takes a while, said before it starts rather than after: starting
// a machine is a minute of nothing visible happening, and a button that goes
// quiet is one somebody presses again.
function press (what, saying) {
  say(saying)
  api(what).then(said => {
    say(said.note || 'done')
    forget('supervisor-state')
    paintSupervisorState()
  }).catch(e => say(e.message, 'bad'))
}

function paintChat () {
  // The state strip first: it is the thing that decides whether anything below
  // it can happen at all.
  paintSupervisorState()
  if (view !== 'chat') return

  api('chat').then(said => {
    if (view !== 'chat') return
    const rows = said.messages || []
    setText($('chat-context'), rows.length ? `— ${rows.length}` : '')
    setText($('chat-note'), rows.length
      ? 'The supervisor reads this when it next wakes, not this second — it is a note left for it, and it is switched off most of the time.'
      : 'Nothing said yet. What you type here is what the supervisor is asked to do; it reads it when it next looks, and answers here.')

    // Whether it answers by itself, and whether it is thinking right now.
    // Asked here rather than in the draw loop, because this is the only tab that
    // shows either and a panel behind a tab must ask nothing.
    api('supervisorThinking').then(how => {
      if (view !== 'chat') return
      $('chat-wakes').checked = !!how.wakes
      $('chat-wake').disabled = !!how.thinking
      setText($('chat-wake'), how.thinking ? 'thinking…' : 'Wake it')
    }).catch(() => { /* the tab still works without it */ })

    // The mark is part of the signature: a message going from unread to read
    // changes nothing about the messages themselves, and it is exactly what
    // somebody is watching for.
    if (!changed('chat-thread', [said.bookmark, said.read && said.read.n])) return
    chatSeen = said.bookmark

    fill($('chat-thread'), rows.length
      ? rows.map(m => oneMessage(m, said.read))
      : el('p', { className: 'empty', textContent: 'No conversation yet.' }))

    // The newest at the bottom and in view, which is where a conversation is
    // read from. Only when it actually changed — see the guard above — so this
    // cannot yank the scroll out from under somebody mid-sentence.
    const box = $('chat-thread')
    if (box.lastElementChild) box.lastElementChild.scrollIntoView({ block: 'nearest' })
  }).catch(e => { if (changed('chat-bad', String(e.message))) oops(e) })
}

// SAYING SOMETHING IS ONE CALL AND NO DIALOG. It is a note left for something
// that is not here; asking "are you sure" about a sentence would be asking about
// the wrong thing.
const saySomething = async () => {
  const box = $('chat-text')
  const text = String(box.value || '').trim()
  if (!text) return
  // Emptied BEFORE the call, so a slow answer does not leave what was typed
  // sitting there looking unsent — and put back if it failed, because losing
  // what somebody wrote is worse than a duplicate.
  box.value = ''
  box.style.height = 'auto'
  try {
    await api('chatSay', { text })
    paintChat()
  } catch (e) {
    box.value = text
    oops(e)
  }
}

// A TEXTAREA THAT GROWS WITH WHAT IS IN IT, up to a limit the stylesheet sets.
// A brief for a supervisor is often a paragraph, and typing one into a
// single-line box that scrolls sideways is how it ends up being one sentence.
const sizeComposer = () => {
  const box = $('chat-text')
  box.style.height = 'auto'
  box.style.height = Math.min(box.scrollHeight, 144) + 'px'
}

$('chat-send').onclick = saySomething
$('chat-text').oninput = sizeComposer
$('chat-text').onkeydown = e => {
  // Enter sends, Shift+Enter makes a line. The other way round is defensible and
  // is not what anybody's fingers expect from a chat box.
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saySomething() }
}

// WAKING IT, WHICH IS THE HALF THAT WAS MISSING. A message was left on this tab,
// nothing read it, and the tab looked exactly like a chat where the other end is
// ignoring you.
//
// One turn: the machine comes up if it is down, its model reads what changed,
// does what needs doing and answers here. Not a session and not a loop — a
// supervisor that runs continuously is one spending money to discover that
// nothing has changed.
//
// SAID WHILE IT HAPPENS, because a turn takes the better part of a minute and a
// button that goes quiet for that long reads as a button that did nothing.
const wakeIt = async why => {
  const button = $('chat-wake')
  button.disabled = true
  setText(button, 'thinking…')
  try {
    const said = await api('supervisorWake', { why })
    if (said.woke === false) say(said.why, 'muted')
    paintChat()
  } catch (e) {
    oops(e)
  } finally {
    button.disabled = false
    setText(button, 'Wake it')
  }
}

$('chat-wake').onclick = () => wakeIt('you pressed the button')

$('chat-wakes').onchange = async e => {
  const on = !!e.target.checked
  try {
    await api('settingSet', { name: 'supervisorWakes', value: on })
    say(on
      ? 'it will wake and answer when you say something — a machine starts and a model thinks, each time'
      : 'it will not wake by itself. What you say here waits until you press Wake it.', on ? 'good' : 'muted')
  } catch (err) {
    e.target.checked = !on
    oops(err)
  }
}

$('chat-clear').onclick = () => ask({
  title: 'Throw the conversation away?',
  plain: [
    'Everything said here, both ways, is deleted.',
    'What was DONE is untouched — the tasks, the branches and the event stream are all still there. This is only what was said about it.'
  ],
  confirm: 'Throw it away',
  danger: true,
  onYes: async () => {
    await api('chatClear', {})
    chatSeen = 0
    say('the conversation is gone')
    paintChat()
  }
})
