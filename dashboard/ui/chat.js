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

const WHO = {
  person: { label: 'you', className: 'card' },
  supervisor: { label: 'the supervisor', className: 'card pick' }
}

const oneMessage = m => {
  const who = WHO[m.who] || { label: m.who, className: 'card' }
  return el('div', { className: who.className },
    el('div', { className: 'card-title' },
      el('span', { className: 'grow', textContent: who.label }),
      m.from ? el('span', { className: 'badge muted', textContent: m.from }) : null,
      el('span', { className: 'muted', textContent: ago(m.at) })),
    // Prose, kept as written. `textContent` rather than anything that parses:
    // this is text from a model, and a window that renders what a model sends is
    // a window that renders what anything that talked to that model sends.
    el('div', { className: 'note', style: 'white-space:pre-wrap' }, m.text),
    m.about ? el('div', { className: 'badges' }, el('span', { className: 'muted', textContent: `about ${m.about}` })) : null)
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

    if (!changed('chat-thread', said.bookmark)) return
    chatSeen = said.bookmark

    fill($('chat-thread'), rows.length
      ? rows.map(oneMessage)
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
  try {
    await api('chatSay', { text })
    paintChat()
  } catch (e) {
    box.value = text
    oops(e)
  }
}

$('chat-send').onclick = saySomething
$('chat-text').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saySomething() } }

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
