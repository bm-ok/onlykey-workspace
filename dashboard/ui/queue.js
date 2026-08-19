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
          // THE LABEL THE ENTRY CARRIES, never one built here. A judgement and a
          // task can both be number 1, and this drew "#1" for J1 the first time
          // it ran — the two kinds sharing one column and one numbering that is
          // not shared is exactly the collision `ref` exists to prevent.
          el('span', { textContent: `${w.ref || `#${w.number}`} ${w.title || ''}`.trim() }),
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

    // ---- WHAT HAS ALREADY BEEN THROUGH ------------------------------
    //
    // Under what is waiting, in the same column, because they are one story
    // read downwards: what is about to happen, then what did. An idle host
    // showed "nothing is waiting and nothing is running" and nothing else,
    // which is the same screen as a host where work has never arrived.
    const history = q.history || []
    fill($('queue-history'),
      history.length
        ? el('div', { className: 'stack' }, ...history.map(h => el('div', { className: 'card' },
          el('div', { className: 'card-title' },
            el('span', { className: 'grow', textContent: `${h.ref} ${h.title || ''}`.trim() }),
            // HOW IT ENDED, and a verdict is not the same as having ended. A
            // judgement that ran and was never decided about is the ordinary
            // case, and showing it as plain "done" hides a backlog.
            h.verdict
              ? el('span', { className: `badge ${h.verdict === 'accepted' ? 'ok' : 'bad'}`, textContent: h.verdict })
              : el('span', { className: 'badge muted', textContent: h.state })),
          h.on ? el('div', { className: 'card-sub mono', textContent: h.on }) : null,
          el('div', { className: 'card-sub muted', textContent: [
            h.machine ? `on ${h.machine}` : null,
            // A TASK THAT NEVER GOT A MACHINE. It went through this queue and
            // produced nothing, which is a different thing from a run that
            // failed — and the queue does exactly this when it can be given no
            // identity, so it is not a rare case.
            h.kind === 'task' && h.tries === 0 ? 'never ran' : null,
            h.at ? ago(h.at) : null
          ].filter(Boolean).join(' · ') }))))
        : el('p', { className: 'empty', textContent: 'Nothing has been through the queue yet.' }))

    // ---- THE POOL, AS CARDS -----------------------------------------------
    //
    // ONLY THE MACHINES THAT CAN TAKE WORK. This listed every machine with a
    // reason beside each — which answered "why has nothing picked this up" and
    // became a wall of red text on a host where most machines are not for the
    // queue at all. A supervisor never is. One without a role is somebody's to
    // label, and saying so four times does not say it better than once.
    //
    // WHAT IS MISSING IS STILL ACCOUNTED FOR, underneath, in one line. The
    // question this screen exists to answer is kept; it is just no longer
    // shouted from four rows at a machine that was never a candidate.
    const machines = q.machines || []
    const pool = machines.filter(m => (m.kinds || []).some(k => k === 'worker' || k === 'judge'))
    const roleless = machines.filter(m => m.roleless)

    fill($('queue-machines'),
      pool.length
        ? el('div', { className: 'stack' }, ...pool.map(m => el('div', { className: 'card' },
          el('div', { className: 'card-title' },
            el('span', { className: 'grow', textContent: m.name }),
            // WHAT IT MAY DO, always — a worker and a judge idle are not
            // interchangeable, and the row used to show them identically.
            el('span', { className: 'badge', textContent: (m.kinds || []).join('+') }),
            m.free
              ? el('span', { className: 'badge ok', textContent: 'free' })
              : el('span', { className: 'badge muted', textContent: 'busy' })),
          m.free ? null : el('div', { className: 'card-sub muted', textContent: m.why || 'not free' }))))
        : el('p', { className: 'empty', textContent: 'No machine on this host can take queued work yet. A machine takes work once it is tagged "worker" or "judge" — the queue chooses which sign-in to hand over from that.' }))

    // ONE LINE FOR WHAT IS NOT IN THE POOL, and it only appears when it is the
    // answer to something: work waiting with an untagged machine sitting idle.
    setText($('queue-machines-note'), roleless.length
      ? `${roleless.map(m => m.name).join(', ')} ${roleless.length === 1 ? 'is' : 'are'} idle and not tagged "worker" or "judge", so the queue leaves ${roleless.length === 1 ? 'it' : 'them'} alone.`
      : '')

    // The rule, in the app's own words rather than this file's, so it cannot
    // describe an order the queue does not follow. Under the tab's own title
    // now: it is about the QUEUE, and beneath the machines panel it read as a
    // footnote about machines.
    setText($('queue-order'), `${q.order || ''} The queue looks every ${q.every || '15s'}.`)

    const counts = q.counts || {}
    $('queue-context').textContent = inFlight.length || waiting.length
      ? `— ${inFlight.length} running, ${waiting.length} waiting${counts.judgement ? ` (${counts.judgement} to judge)` : ''}`
      : '— idle'
  }).catch(() => { /* the chrome already says when the dashboard is unreachable */ })
}
