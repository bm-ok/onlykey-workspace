'use strict'

// The board: what has been asked for, who is doing it, and what came back.
//
// Part of the window. See ui/load.js for the order these are read in and why
// the order matters.

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

// WHICH SUB-TAB IS OPEN, and the wiring that switches them.
//
// Up here with the tab's own state rather than beside the pane it belongs to.
// It lived next to the Jobs pane and was deleted twice by edits that replaced
// that pane -- both times the whole tab stopped working, because everything
// below reads it. State the tab owns belongs where the tab is declared.
let taskPane = been.get('task-pane', 'board')

document.querySelectorAll('#view-tasks .subtab[data-pane]').forEach(t => {
  t.onclick = () => {
    taskPane = t.dataset.pane
    been.set('task-pane', taskPane)
    document.querySelectorAll('#view-tasks .subtab[data-pane]').forEach(x => x.classList.toggle('active', x === t))
    document.querySelectorAll('#view-tasks .pane').forEach(x => x.classList.toggle('active', x.id === `pane-${taskPane}`))
    paintJobs()
    paintPrompts()
  }
})
;(() => {
  const t = document.querySelector(`#view-tasks .subtab[data-pane="${taskPane}"]`)
  if (!t) { taskPane = 'board'; return }
  document.querySelectorAll('#view-tasks .subtab[data-pane]').forEach(x => x.classList.toggle('active', x === t))
  document.querySelectorAll('#view-tasks .pane').forEach(x => x.classList.toggle('active', x.id === `pane-${taskPane}`))
})()

// What a task's card and its detail panel read, including what the buttons close
// over. A field missed here is a panel that silently stops updating, which is
// worse than the flicker the signature exists to prevent.
// WHO DOES IT, and with what. The task carries a `worker` slot and until now
// nothing on the screen said which one was set -- so a task written for a person
// and a task written for Claude looked identical on the board, and the only way
// to find out which was to give it to a machine and see what happened.
//
// `person` says VS Code specifically because that is what taskWorkOn opens, and
// Claude runs in its integrated terminal there -- so a person task is not "no
// worker", it is a person and Claude in the same window.
const WORKERS = {
  claude: { label: 'Claude', cls: 'run', long: 'Claude, run by the queue on a machine.' },
  shell: { label: 'shell', cls: 'muted', long: 'A shell command on a machine, with no model involved.' },
  person: { label: 'VS Code', cls: 'ok', long: 'You, in VS Code on the machine — with Claude in its integrated terminal.' }
}
const workerOf = t => WORKERS[t && t.worker] || WORKERS.claude

const taskKey = t => t && [
  t.number,
  t.id, t.title, t.branch, t.state, t.reads, t.machine || '', t.run || '', t.worker || '',
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

// A CLICK IS ANSWERED BEFORE ANYTHING IS READ.
//
// Selecting a task used to set the selection and call draw(), and draw() reads
// the branch's artifact, which reads git, which blocks this thread. So the whole
// window locked, then unlocked showing the new task -- and for the length of the
// freeze the screen still showed the OLD task, with the OLD row highlighted. It
// looked like the click had not registered, which is the one thing a click must
// never look like.
//
// Three things, in this order, and the order is the point:
//
//   1. the highlight moves, so the click is acknowledged instantly
//   2. the panels about the old task are EMPTIED and given placeholders --
//      emptied first, because `waiting` refuses to overwrite a panel that has
//      something in it, which is right everywhere else and wrong here: what is
//      in it belongs to a task nobody is looking at any more
//   3. a frame is let through, so all of that is actually drawn, and only then
//      is anything read
//
// The reading is no faster. It is just no longer the first thing that happens.
async function pickTask (id, card) {
  if (id === pickedTask) return
  pickedTask = id
  been.set('task', pickedTask)

  // Moved here rather than left to the next paint, which is on the far side of
  // the read this is trying to get in front of.
  if (card && card.parentElement) {
    card.parentElement.querySelectorAll('.card.pick').forEach(x => x.classList.toggle('on', x === card))
  }

  // Cleared, not just re-skeletoned: the previous task's attempts and commits
  // sitting under a new task's heading is worse than an empty panel, because it
  // is readable and wrong.
  for (const [box, shape] of [['task-detail', { lines: 6 }], ['task-history', { cards: 2 }], ['artifact', { cards: 2 }]]) {
    if (!$(box)) continue
    fill($(box), null)
    waiting(box, shape)
  }
  setText($('artifact-context'), '')

  // THE SIGNATURES TOO, or the paint that follows compares against what it drew
  // for the last task and decides nothing has changed -- leaving the placeholder
  // up for ever, which is a worse failure than the one this replaced.
  //
  // History keeps its own, PER TASK, behind a ten-second guard meant to stop a
  // guest round trip on every draw. Both have to go here: without the first,
  // coming back to a task looked at a moment ago skips the read entirely; without
  // the second, the read happens, matches what was drawn last time, and returns
  // without filling anything.
  for (const key of ['task-detail', 'artifact']) changed(key, null)
  changed('history-' + id, null)
  historyAt = 0

  await settle()
  if (view !== 'tasks') return
  draw()
}

function paintTasks (queued) {
  Promise.all([api('tasks'), api('defined').catch(() => ({ defined: [] }))]).then(([{ tasks }, jobs]) => {
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
    // A decision that has to be sought out is a decision that does not get made.
    // This only ever fires for a job somebody ELSE wrote: one written at the
    // window is approved by whoever wrote it, so the count is exactly "what
    // arrived down the pipe and is waiting on you", which is the case worth a
    // card rather than a number in a corner.
    const unread = (jobs.defined || []).filter(d => !d.approved)
    const lapsed = unread.filter(d => d.lapsed).length
    const waiting = unread.length
    if (changed('approvals', [waiting, lapsed])) {
      fill($('approvals'), waiting
        ? el('div', { className: 'card wants' },
            el('div', { className: 'card-title' },
              el('span', { textContent: `${waiting} job${waiting === 1 ? '' : 's'} waiting for you` }),
              el('span', { className: 'badge warn', textContent: 'needs reading' })),
            el('div', { className: 'card-sub muted', textContent: lapsed
              ? `${waiting - lapsed} never read, ${lapsed} changed since you approved them.`
              : 'Nothing unapproved runs, whoever is asking.' }),
            // TO THE PANE, not to a dialog. The card says how many are waiting;
            // the pane is where they can be read, compared and decided on, and
            // sending somebody to a one-at-a-time reader was most of why ten of
            // them went unread.
            el('button', {
              className: 'btn ok',
              style: 'margin-top:8px',
              textContent: 'Read them',
              onclick: () => {
                const t = document.querySelector('#view-tasks .subtab[data-pane="planned"]')
                if (t) t.click()
              }
            }))
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
            onclick: ev => pickTask(t.id, ev.currentTarget)
          },
          el('div', { className: 'card-title' },
            el('span', {}, el('span', { className: 'muted mono', textContent: '#' + t.number + ' ' }), t.title),
            el('span', { className: `badge ${STATE_BADGE[t.reads] || 'muted'}`, textContent: t.reads })),
          el('div', { className: 'card-sub mono', textContent: t.branch }),
          el('div', { className: 'card-sub' },
            el('span', { className: `badge ${workerOf(t).cls}`, textContent: workerOf(t).label }),
            el('span', { className: 'muted', style: 'margin-left:6px', textContent: t.artifact }))))
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
      el('tr', {}, el('th', { textContent: 'worked by' }),
        el('td', {}, el('span', { className: `badge ${workerOf(task).cls}`, textContent: workerOf(task).label }),
          el('div', { className: 'muted', textContent: workerOf(task).long }))),
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
      // THE WORKER SLOT DECIDES HOW IT STARTS, and until now nothing did.
      //
      // A task written for a person offered "Queue it" and "Give it to a machine
      // now" — both of which dispatch Claude. So the board could hold a task that
      // said VS Code and whose only two buttons handed it to a model, and a
      // person task written for later had no way to be started as itself at all.
      // Same shape as the buttons taken off the machines tab, arrived at from
      // inside a task: the tool could do the thing, so the window offered it,
      // without asking whether it was the thing this task said.
      task.worker === 'person'
        ? el('button', {
            className: 'btn ok',
            textContent: task.machine ? 'Open VS Code again' : 'Work on it in VS Code',
            disabled: !!task.verdict,
            title: task.verdict ? 'This task has been judged' : 'A machine is brought up on its branch with VS Code open in it',
            onclick: () => takeTaskByHand(task, 'editor')
          })
        : task.state === 'queued'
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
      // THE SECOND DOOR ONTO THE SAME TASK. Same machine, same branch, same
      // credential, same finish — a terminal instead of an editor, landed in the
      // checkout, with nothing typed into it. This is what the Terminal tab's
      // machine picker used to be for, minus the part where the work had no
      // task: booting a machine and typing `claude` in its shell was the way
      // this was done by hand before any of it existed, and it is a way of
      // working, not a way of starting work.
      task.worker === 'person'
        ? el('button', {
            className: 'btn',
            textContent: task.machine ? 'Open a terminal again' : 'Work on it in a terminal',
            disabled: !!task.verdict,
            title: task.verdict ? 'This task has been judged' : 'A machine is brought up on its branch and a shell opens here, in the checkout',
            onclick: () => takeTaskByHand(task, 'terminal')
          })
        : null,

      // The other half of the person path: saying it is done. It is the exact
      // counterpart of a worker's exit code, and without it on the task itself
      // the only way to end one was from the machine that happened to be holding
      // it — which is the machines tab deciding a task's fate again.
      task.worker === 'person'
        ? (task.machine
            ? el('button', {
                className: 'btn',
                textContent: 'Finish it',
                title: 'Gives the machine back and puts the task up for a verdict',
                onclick: () => finishTaskByHand(task)
              })
            : null)
        : el('button', {
            className: 'btn',
            textContent: task.machine ? 'Give it out again' : 'Give it to a machine now',
            disabled: !idle.length || !!task.verdict,
            title: !idle.length ? 'No machine is dialled in' : task.verdict ? 'This task has been judged' : 'Skips the queue and uses a machine that is already up',
            onclick: () => giveTask(task, idle)
          }),
      // Only while something is actually running, because that is the only time
      // it means anything — and it is the button somebody wants at the moment
      // they would otherwise be opening a shell on the guest.
      // AND ONLY WHEN THERE IS A RUN TO STOP. A person's task reads as "working"
      // the same way a worker's does, and there is no process on the other end of
      // it -- "Stop it" would have killed nothing and reported the task lost.
      task.reads === 'working' && task.run
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
// PREFILLED WHEN THE WORK CAME FROM SOMEWHERE, which is what an issue is:
// somebody already wrote what they want, and retyping it into a brief is how the
// two drift apart. The dialog is otherwise identical -- a task from an issue is
// a task, and gets the same reason, contract and branch as any other.
function newTask (from = null) {
  Promise.all([
    api('gitBranches'),
    api('prompts').catch(() => ({ prompts: [] })),
    api('jobs').catch(() => ({ jobs: [] }))
  ]).then(([{ branches: known, protected: guarded }, lib, work]) => {
    const taken = new Set((guarded || []).map(g => g.branch))

    // ONE THING, SO NO TABS. This dialog used to carry pre-defined jobs behind a
    // second tab: three clicks in, behind a dropdown, with nothing on screen
    // saying what the thing did. They have a pane of their own now, where one
    // can be read before it is started -- see the Pre-defined sub-tab.
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
            { name: 'title', label: 'Title', value: (from && from.title) || '', placeholder: 'Short enough to read in a list' },
            { name: 'branch', label: 'Branch it delivers on', placeholder: 'fix/the-thing' },
            // THE BRIEF IS THE PROMPT. Writing a task is writing one, which is
            // the whole reason the library exists: pick a kept one and it is
            // filled in below, still as text somebody can change before it goes.
            {
              name: 'promptId',
              label: 'Fill the brief from a prompt (optional)',
              value: '',
              options: [
                { value: '', label: 'none — write it below' },
                ...(lib.prompts || []).map(x => ({ value: x.id, label: `${x.name}${x.approved ? '' : ' — not approved'}` }))
              ]
            },
            { name: 'brief', label: 'The brief — what the worker is actually told', value: (from && from.brief) || '', multiline: true, rows: 10, placeholder: 'Write it as instructions to somebody who cannot ask you a question.' },
            // A JOB IS HOW IT GETS DONE, and it is optional because most tasks do
            // not need one: the queue dispatches a worker with the brief, and that
            // is the ordinary path. A job is for when the doing is itself a script.
            {
              name: 'job',
              label: 'Run it with a job (optional)',
              value: '',
              options: [
                { value: '', label: 'none — the queue dispatches a worker' },
                ...(work.jobs || []).map(x => ({ value: x.id, label: `${x.name}${x.runnable ? '' : ` — ${x.whyNot}`}` }))
              ]
            },
            { name: 'contract', label: 'Contract (a file on this host, optional)', placeholder: 'the rules the worker is given' },
            { name: 'folder', label: 'Folder on the machine (optional)', placeholder: 'defaults to its workspace' }
          ],
          confirm: 'Write it',
          // FILLED IN, NOT LOCKED TO. Choosing a prompt copies its words into the
          // brief and leaves them editable: a task carries what the worker was
          // actually given, so changing it here changes this task and nothing
          // else.
          //
          // AND IT WILL NOT OVERWRITE SOMETHING SOMEBODY TYPED. Filling an empty
          // box is help; replacing a paragraph half-written is the same act and
          // is destructive, and from inside a dropdown the two are
          // indistinguishable. So it fills when the brief is empty or still holds
          // the last thing it filled, and otherwise says why it did not.
          onOpen: inputs => {
            const pick = inputs.promptId
            const brief = inputs.brief
            if (!pick || !brief) return
            let filled = brief.value
            pick.onchange = () => {
              const chosen = (lib.prompts || []).find(x => x.id === pick.value)
              if (!chosen) return
              if (brief.value.trim() && brief.value !== filled) {
                say('The brief has been edited, so it was left alone. Clear it to fill from a prompt.', 'warn')
                return
              }
              brief.value = chosen.text
              filled = chosen.text
            }
          },
          onYes: async values => {
            if (taken.has(values.branch)) throw new Error(`"${values.branch}" is protected here. Work is merged into it, never done on it.`)
            const made = await api('taskCreate', { task: values })
            pickedTask = made.id
            say(`Task "${made.title}" written, delivering on ${made.branch}. Known branches: ${(known || []).length}.`)
          }
        },
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
// ---- the prompt library --------------------------------------------------
//
// The third of three, and the one the other two are made of:
//
//     task <- pre-defined <- prompt
//
// A task is one occasion. A pre-defined task is the standing intention to do
// that job. A prompt is the instruction itself -- the part worth improving, and
// the part worth having exactly one of.
//
// FILLED IN FROM, NOT POINTED AT. Writing a task copies the text; the task then
// carries what the worker was actually given, and editing the library afterwards
// cannot rewrite history somebody is judging against. That is the same reason a
// task keeps its own contract rather than a path to one.
let pickedPrompt = been.get('prompt', null)

function paintPrompts () {
  if (view !== 'tasks' || taskPane !== 'prompts') return
  waiting('prompts-list', { cards: 3 })
  waiting('prompt-detail', { lines: 8 })
  paintPromptsNow()
}

async function paintPromptsNow () {
  await settle()
  if (view !== 'tasks' || taskPane !== 'prompts') return

  api('prompts').then(({ prompts, note }) => {
    if (!prompts.some(x => x.id === pickedPrompt)) {
      pickedPrompt = prompts.length ? prompts[0].id : null
      been.set('prompt', pickedPrompt)
    }
    setText($('prompts-context'), prompts.length ? `— ${prompts.length} kept` : '— none yet')
    setText($('prompts-note'), note)

    if (changed('prompts', [prompts, pickedPrompt])) {
      fill($('prompts-list'), prompts.length
        ? prompts.map(x => el('div', {
            className: `card pick${x.id === pickedPrompt ? ' on' : ''}`,
            onclick: () => {
              pickedPrompt = x.id
              been.set('prompt', pickedPrompt)
              changed('prompts', null); changed('prompt-detail', null)
              paintPrompts()
            }
          },
          el('div', { className: 'card-title' }, el('span', { className: 'grow', textContent: x.name })),
          x.about ? el('div', { className: 'card-sub muted', textContent: x.about }) : null,
          el('div', { className: 'card-sub muted', textContent: x.edited ? `edited ${ago(x.edited)}` : `written ${ago(x.written)}` })))
        : el('p', { className: 'empty', textContent: 'Nothing kept yet. Write one the moment you would type the same brief a second time.' }))
    }

    const one = prompts.find(x => x.id === pickedPrompt) || null
    if (changed('prompt-detail', one)) paintPrompt(one)
  }).catch(oops)
}

function paintPrompt (x) {
  if (!x) return fill($('prompt-detail'), el('p', { className: 'empty', textContent: 'Pick one on the left, or write one.' }))

  fill($('prompt-detail'),
    el('div', { className: 'card-title' },
      el('span', { className: 'grow', textContent: x.name }),
      el('span', { className: 'badge muted', textContent: x.id })),
    el('div', { className: 'card-sub muted', textContent: [
      x.edited ? `edited ${ago(x.edited)}` : `written ${ago(x.written)}`,
      `hash ${x.hash}`
    ].join(' · ') }),
    x.about ? el('p', { className: 'note', textContent: x.about }) : null,

    el('div', { className: 'row', style: 'margin-top:8px' },
      // THE ACT THIS LIBRARY EXISTS FOR. Everything else here is upkeep.
      el('button', {
        className: 'btn small ok',
        textContent: 'Write a task from it',
        title: 'Opens the task dialog with this as the brief',
        onclick: () => newTask({ title: x.name, brief: x.text })
      }),
      el('button', { className: 'btn small', textContent: 'Edit', onclick: () => writePrompt(x) }),
      el('button', {
        className: 'btn small danger',
        textContent: 'Throw it away',
        onclick: () => ask({
          title: `Throw away "${x.name}"?`,
          plain: [
            'It leaves the library.',
            // The thing worth saying, because "delete" sounds bigger than it is.
            'Every task written from it keeps the text it was given — a task carries its own copy, so nothing that already went out changes.'
          ],
          confirm: 'Throw it away',
          danger: true,
          onYes: async () => {
            await api('promptForget', { id: x.id })
            say(`"${x.name}" is out of the library.`, 'warn')
            pickedPrompt = null
            changed('prompts', null); changed('prompt-detail', null)
            return draw()
          }
        })
      })),

    el('div', { style: 'margin-top:10px' }, codeBlock(x.text, 'text', { lines: 16 })))
}

// Written or rewritten, in the one dialog everything asks through.
function writePrompt (x = null) {
  ask({
    title: x ? `Edit "${x.name}"` : 'Write a prompt',
    plain: [
      'This is what a worker is told. Write it as instructions to somebody who cannot ask you a question.',
      x
        ? 'Editing it changes the library only. Tasks already written from it keep the text they were given.'
        : 'It is kept for this computer rather than for a workspace, because an instruction is not about one folder of repositories.'
    ],
    fields: [
      { name: 'name', label: 'Name', value: x ? x.name : '', placeholder: 'Short enough to recognise in a list' },
      { name: 'about', label: 'What it is for (optional)', value: x && x.about ? x.about : '', placeholder: 'One line, so somebody else knows when to reach for it' },
      { name: 'text', label: 'The prompt', value: x ? x.text : '', multiline: true, rows: 14, placeholder: 'Read the README and the code, and say where they disagree.' }
    ],
    confirm: x ? 'Save it' : 'Write it',
    onYes: async f => {
      const saved = await api('promptSave', { id: x ? x.id : undefined, name: f.name, about: f.about, text: f.text })
      pickedPrompt = saved.id
      been.set('prompt', pickedPrompt)
      say(saved.created ? `"${saved.name}" kept.` : `"${saved.name}" saved.`)
      changed('prompts', null); changed('prompt-detail', null)
      return draw()
    }
  })
}

$('prompt-new').onclick = () => writePrompt()

// ---- jobs, and the prompts they are given -------------------------------
//
//     task <- job <- prompt
//
// A job is a SCRIPT. Not a form with a branch in it -- a Node file that decides
// what to do with a prompt: write a task from it and queue it, run it across
// three repositories, dispatch it and then assert something about what came
// back. The drills that used to be checked into this repository were one kind of
// job, and the only thing wrong with them was that they were the only kind.
//
// BOTH HALVES ARE APPROVED, and the pane says which half is stopping a run. The
// script is a program that runs as you; the prompt is what a worker is actually
// told. Either can be edited after the other was read, and each hashes the thing
// that will really be used -- the file's bytes, and the words.
let pickedJob = been.get('job', null)
let jobTag = been.get('job-tag', null)
let jobsNow = []
let promptsNow = []

function paintJobs () {
  if (view !== 'tasks' || taskPane !== 'planned') return
  waiting('planned-list', { cards: 3 })
  waiting('planned-detail', { lines: 8 })
  paintJobsNow()
}

async function paintJobsNow () {
  await settle()
  if (view !== 'tasks' || taskPane !== 'planned') return

  api('jobs').then(v => {
    jobsNow = v.jobs || []
    promptsNow = v.prompts || []
    const shown = jobTag ? jobsNow.filter(j => (j.tags || []).includes(jobTag)) : jobsNow
    const stuck = jobsNow.filter(j => !j.runnable).length

    setText($('planned-context'), jobsNow.length
      ? `— ${jobsNow.length}${stuck ? `, ${stuck} not runnable` : ''}`
      : '— none yet')
    setText($('planned-note'), v.note || '')

    if (!shown.some(j => j.id === pickedJob)) {
      pickedJob = shown.length ? shown[0].id : null
      been.set('job', pickedJob)
    }

    if (changed('planned', [shown, pickedJob, jobTag, v.tags])) {
      fill($('planned-list'),
        // TAGS, as a filter rather than as decoration. A drill, a maintenance
        // job and a reading job want to be found separately, and a flat list of
        // forty is the state the ten drills were already in.
        (v.tags || []).length
          ? el('div', { className: 'chips' },
              el('button', {
                className: `chip linky-chip${jobTag ? '' : ' on'}`,
                textContent: `all ${jobsNow.length}`,
                onclick: () => { jobTag = null; been.set('job-tag', null); changed('planned', null); paintJobs() }
              }),
              ...v.tags.map(t => el('button', {
                className: `chip linky-chip${jobTag === t.tag ? ' on' : ''}`,
                textContent: `${t.tag} ${t.n}`,
                onclick: () => { jobTag = t.tag; been.set('job-tag', t.tag); changed('planned', null); paintJobs() }
              })))
          : null,
        shown.length
          ? shown.map(j => el('div', {
              className: `card pick${j.id === pickedJob ? ' on' : ''}`,
              onclick: () => {
                pickedJob = j.id
                been.set('job', pickedJob)
                changed('planned', null); changed('planned-detail', null)
                paintJobs()
              }
            },
            el('div', { className: 'card-title' },
              el('span', { className: 'grow', textContent: j.name }),
              el('span', {
                className: `badge ${j.runnable ? 'ok' : j.lapsed ? 'bad' : 'warn'}`,
                textContent: j.runnable ? 'ready' : j.lapsed ? 'edited' : 'not approved'
              })),
            j.about ? el('div', { className: 'card-sub muted', textContent: j.about }) : null,
            el('div', { className: 'card-sub muted', textContent: `${j.lines} line${j.lines === 1 ? '' : 's'}${(j.tags || []).length ? ` · ${j.tags.join(', ')}` : ''}` })))
          : el('p', { className: 'empty', textContent: jobTag
              ? 'Nothing with that tag.'
              : 'No jobs yet. A job is a script that takes a prompt and does something with it — write one with +.' }))
    }

    const one = shown.find(j => j.id === pickedJob) || null
    if (changed('planned-detail', one)) paintJob(one)
  }).catch(oops)
}

function paintJob (j) {
  if (!j) return fill($('planned-detail'), el('p', { className: 'empty', textContent: 'Pick one on the left, or write one with +.' }))

  // The script is not in the list payload -- it is long and the list is a list.
  api('job', { id: j.id }).then(full => {
    fill($('planned-detail'),
      el('div', { className: 'card-title' },
        el('span', { className: 'grow', textContent: j.name }),
        el('span', {
          className: `badge ${j.runnable ? 'ok' : j.lapsed ? 'bad' : 'warn'}`,
          textContent: j.runnable ? 'ready to run' : j.whyNot
        })),
      el('div', { className: 'card-sub muted', textContent: [
        j.edited ? `edited ${ago(j.edited)}` : `written ${ago(j.written)}`,
        j.approvedAt ? `approved ${ago(j.approvedAt)} by ${j.approvedBy}` : 'never approved',
        `hash ${j.hash}`
      ].join(' · ') }),
      j.about ? el('p', { className: 'note', textContent: j.about }) : null,
      (j.tags || []).length ? el('div', { className: 'badges' }, ...j.tags.map(t => el('span', { className: 'badge muted', textContent: t }))) : null,

      // WHICH HALF IS STOPPING IT, named. "Not runnable" with two possible
      // causes is a state somebody has to go and investigate; this says which.
      j.whyNot ? el('p', { className: 'note warn', textContent: `It will not run: ${j.whyNot}.` }) : null,

      el('div', { className: 'carries', style: 'margin-top:10px' },
        el('div', { className: 'group-part' },
          el('span', { textContent: 'run with the prompt' }),
          el('span', {}, j.prompt
            ? el('span', { className: j.prompt.approved ? '' : 'warn', textContent: `${j.prompt.name}${j.prompt.approved ? '' : ' — not approved'}` })
            : el('span', { className: 'muted', textContent: j.promptId ? `${j.promptId} — gone` : 'none, it is chosen when you run it' })))),

      el('div', { className: 'row', style: 'margin-top:10px' },
        el('button', {
          className: 'btn small ok',
          textContent: 'Run it',
          disabled: !j.runnable,
          title: j.runnable ? 'Runs it now, against the workspace that is open' : j.whyNot,
          onclick: () => runJob(j)
        }),
        el('button', { className: 'btn small', textContent: 'Edit', onclick: () => writeJob(full) }),
        j.approved
          ? el('button', {
              className: 'btn small',
              textContent: 'Withdraw approval',
              title: 'It stops being runnable until somebody reads it again',
              onclick: async () => {
                try {
                  await api('jobWithdraw', { id: j.id })
                  say(`"${j.name}" will not run until it is approved again.`, 'warn')
                  changed('planned', null); changed('planned-detail', null)
                  return draw()
                } catch (e) { oops(e) }
              }
            })
          : el('button', {
              className: 'btn small ok',
              textContent: 'Approve it',
              title: 'Say the script is fit to run, having read it',
              onclick: () => ask({
                title: `Approve "${j.name}"?`,
                plain: [
                  'It becomes runnable. This is a program, and running it runs as you.',
                  'Approval is against the script as it is now — any edit takes it back automatically.'
                ],
                fields: [{ name: 'note', label: 'A note, for whoever reads this later (optional)', value: '' }],
                confirm: 'I have read it',
                onYes: async ({ note }) => {
                  await api('jobApprove', { id: j.id, note })
                  say(`"${j.name}" approved.`)
                  changed('planned', null); changed('planned-detail', null)
                  return draw()
                }
              })
            }),
        el('button', {
          className: 'btn small danger',
          textContent: 'Throw it away',
          onclick: () => ask({
            title: `Throw away "${j.name}"?`,
            plain: [
              'The job and its script are deleted. This cannot be undone from here.',
              'Anything it already did — tasks it wrote, branches it cut — is untouched.'
            ],
            cost: 'Writing it again means writing it again.',
            confirm: 'Throw it away',
            danger: true,
            onYes: async () => {
              await api('jobForget', { id: j.id })
              say(`"${j.name}" is gone, script and all.`, 'warn')
              pickedJob = null
              changed('planned', null); changed('planned-detail', null)
              return draw()
            }
          })
        })),

      el('div', { style: 'margin-top:10px' }, codeBlock(full.code || '', 'javascript', { lines: 20 })))
  }).catch(oops)
}

// RUNNING ONE NAMES WHAT IT WILL ACT ON, and lets the prompt be chosen here: a
// job is the part that does not change and the prompt is the part that does, so
// picking one at the moment of running is the whole point of separating them.
function runJob (j) {
  const here = latest.workspace
  const usable = promptsNow.filter(p => p.approved)
  ask({
    title: `Run "${j.name}"?`,
    plain: [
      here ? `It runs against "${here.name}" — ${here.dir}` : 'No workspace is open, so it will be refused.',
      'It drives the same actions a person does: it can write a task, cut a branch, or borrow a machine. Everything it does appears in the live log.',
      usable.length ? null : 'No approved prompt is available. A job that reads one will be refused.'
    ].filter(Boolean),
    cost: 'Anything it leaves behind is left behind. Nothing here undoes it afterwards.',
    fields: [{
      name: 'promptId',
      label: 'With which prompt',
      value: j.promptId || (usable[0] || {}).id || '',
      options: [
        { value: '', label: 'none — the job reads no prompt' },
        ...usable.map(p => ({ value: p.id, label: p.name }))
      ]
    }],
    confirm: 'Run it',
    onYes: async ({ promptId }) => {
      showTab('live')
      say(`Running "${j.name}" — watch the live log.`)
      const out = await api('jobRun', { id: j.id, promptId: promptId || undefined })
      say(out.ok
        ? `"${j.name}" finished in ${out.seconds}s.`
        : `"${j.name}" failed after ${out.seconds}s — ${out.error}`,
      out.ok ? 'ok' : 'bad')
    }
  })
}

// Writing one. The script is the point, so it gets an editor rather than a box.
function writeJob (j = null) {
  let editor = null
  ask({
    title: j ? `Edit "${j.name}"` : 'Write a job',
    plain: [
      'A job is a Node script. It is handed one object: okc, prompt, log, shell, artifact, assert and tags.',
      j
        ? 'Saving it takes its approval back, because what was approved is no longer what will run.'
        : 'Writing it here approves it — you are reading it as you write it. One written by a model over the command line waits for you instead.'
    ],
    fields: [
      { name: 'name', label: 'Name', value: j ? j.name : '' },
      { name: 'about', label: 'What it is for (optional)', value: j && j.about ? j.about : '' },
      { name: 'tags', label: 'Tags, comma separated', value: j && j.tags ? j.tags.join(', ') : '', placeholder: 'drill, maintenance, reading' },
      {
        name: 'promptId',
        label: 'The prompt it is usually run with (optional)',
        value: j && j.promptId ? j.promptId : '',
        options: [{ value: '', label: 'none — chosen when it is run' }, ...promptsNow.map(p => ({ value: p.id, label: p.name }))]
      }
    ],
    confirm: j ? 'Save it' : 'Write it',
    onYes: async f => {
      const code = editor ? editor.getValue() : undefined
      const saved = await api('jobSave', { id: j ? j.id : undefined, ...f, code })
      pickedJob = saved.id
      been.set('job', pickedJob)
      say(saved.created ? `"${saved.name}" written.` : `"${saved.name}" saved${saved.approved ? '' : ' — it needs approving again'}.`)
      changed('planned', null); changed('planned-detail', null)
      return draw()
    }
  })

  // Appended after the dialog is up, the way every other dialog carrying code
  // does it -- `ask` builds fields, and a code editor is not a field.
  const body = document.querySelector('.dlg-body')
  if (body) {
    body.append(el('label', { textContent: 'The script' }))
    body.append(editorBlock(j ? j.code : JOB_STARTER, 'javascript', { lines: 16, edit: true, onReady: ed => { editor = ed } }))
  }
}

// What a new one starts as, so an empty editor is never the first thing seen.
// It names every part of the API in a shape that runs.
const JOB_STARTER = `'use strict'

// A job. It is given one object and everything it can do is on it.
//
//   okc(action, args)   every action this app has, with every refusal
//   prompt              the prompt it was run with: { id, name, text }
//   log(line)           into the live log, tagged with this job
//   shell(name, cmd)    a command on a machine
//   artifact(file)      hand a file back, kept with the run
//   assert              refuses / needs / equal, for a job that checks something
//   tags                what this job was tagged with
module.exports = async ({ okc, prompt, log }) => {
  log('starting')

  const task = await okc('taskCreate', {
    task: {
      title: prompt ? prompt.name : 'A job wrote this',
      brief: prompt ? prompt.text : 'no prompt was given',
      branch: 'jobs/something'
    }
  })

  log('wrote task #' + task.number)
  return { wrote: task.id }
}
`

$('defined-new').onclick = () => writeJob()


