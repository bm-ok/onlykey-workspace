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
      // Which machine said it, when it was a machine. Two supervisors are not
      // supposed to run at once, and this is where it would show.
      !mine && m.from ? el('span', { className: 'mono', textContent: m.from }) : null,
      el('span', { textContent: ago(m.at) }),
      mine
        ? el('span', { textContent: waiting ? 'not read yet' : 'read' })
        : null,
      m.about ? el('span', { textContent: `about ${m.about}` }) : null),
    // textContent, never anything that parses. This is text from a model, and a
    // window that renders what a model sends renders what anything that talked
    // its way into that model sends.
    el('div', { className: 'msg-body', textContent: m.text }))
}

function paintChat () {
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
