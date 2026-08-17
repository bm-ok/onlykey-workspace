'use strict'

// THE QUEUE, ON A SCREEN OF ITS OWN.
//
// It was a strip inside the task board, which was right while a task was the
// only thing that could be queued. A judgement waits for a machine exactly as a
// task does — same machines, same reasons for not getting one — so they share
// one queue, and a panel living inside one of the two kinds could only ever draw
// half of it.
//
// WHAT THIS SCREEN IS FOR is the reasons, not the count. "Nothing is queued" and
// "everything is queued and no machine can take it" look identical from outside
// and want opposite responses; so do the four ways a machine can be unavailable.
// The badge says how many, and this says why.
//
// THE ORDER IS REPORTED, NOT DECIDED. `tasks/queue.js` sorts what it dispatches
// and hands the same sentence back through `queueState.order`. A board that
// sorted its own copy could disagree with what actually goes out, and both
// halves would look right on their own.

// A kind is a word on a row, so the two are told apart at a glance rather than
// by which column they are in — there is one column.
const KIND_BADGE = { judgement: 'warn', task: 'muted' }

function paintQueue (q) {
  // THE VIEW GUARD, first line, because the loop runs every few seconds whatever
  // tab is open. See CLAUDE.md — this rule has been written down, been right,
  // and then not applied to the next three panels built.
  if (view !== 'queue') return

  // Handed in rather than fetched. drawOnce already asked, and asking twice per
  // draw doubles a call that walks every machine — a VBoxManage process each.
  Promise.resolve(q || api('queueState')).then(q => {
    if (view !== 'queue') return
    if (!changed('queue-view', q)) return

    const waiting = q.waiting || []
    const inFlight = q.inFlight || []

    // WHAT IS RUNNING FIRST, then what is waiting, in one column and in the
    // order the queue will take them. Two lists side by side would be two
    // answers to "what is next".
    fill($('queue-waiting'),
      ...inFlight.map(f => el('div', { className: 'card' },
        el('div', { className: 'card-title' },
          el('span', { textContent: `${f.task} on ${f.machine}` }),
          el('span', { className: 'badge run', textContent: 'running' })))),

      ...waiting.map((w, at) => el('div', { className: 'card' },
        el('div', { className: 'card-title' },
          el('span', { textContent: `#${w.number} ${w.title || ''}`.trim() }),
          el('span', { className: `badge ${KIND_BADGE[w.kind] || 'muted'}`, textContent: w.kind })),
        // WHERE IT IS IN THE LINE, said as a number, because "next" is the only
        // thing anybody wants from a queue and counting rows is not it.
        el('div', { className: 'card-sub muted', textContent: at === 0 ? 'next' : `${at + 1} in line` }),
        w.on ? el('div', { className: 'card-sub mono', textContent: w.on }) : null,
        // A tagged entry waits for its own kind of machine rather than taking
        // somebody else's, so a row that is not moving says why here.
        w.tag ? el('div', { className: 'card-sub muted', textContent: `waits for a machine tagged "${w.tag}"` }) : null)),

      inFlight.length || waiting.length
        ? null
        : el('p', { className: 'empty', textContent: 'Nothing is waiting and nothing is running.' }))

    // EVERY MACHINE AND WHY, not only the free ones. A list of what is available
    // answers "can something run"; this screen exists to answer "why has nothing
    // picked this up", and that answer is in the machines that are not free.
    const machines = q.machines || []
    fill($('queue-machines'),
      machines.length
        ? el('table', { className: 'kv' },
          ...machines.map(m => el('tr', {},
            el('th', { textContent: m.name }),
            el('td', {}, m.free
              ? el('span', { className: 'badge ok', textContent: 'free' })
              : el('span', { className: 'muted', textContent: m.why || 'not free' })))))
        : el('p', { className: 'empty', textContent: 'This host has no machines.' }),
      // SAID WHEN IT IS THE ANSWER. Work waiting with nothing that can take it is
      // the state somebody is staring at the screen about.
      waiting.length && !machines.some(m => m.free)
        ? el('p', { className: 'note bad', textContent: 'Nothing can take it. It stays queued until something can.' })
        : null)

    // The rule, in the app's own words rather than this file's, so it cannot
    // describe an order the queue does not follow.
    $('queue-order').textContent = `${q.order || ''} The queue looks every ${q.every || '15s'}.`

    const counts = q.counts || {}
    $('queue-context').textContent = inFlight.length || waiting.length
      ? `— ${inFlight.length} running, ${waiting.length} waiting${counts.judgement ? ` (${counts.judgement} to judge)` : ''}`
      : '— idle'
  }).catch(() => { /* the chrome already says when the dashboard is unreachable */ })
}
