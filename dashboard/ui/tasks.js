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
            { name: 'title', label: 'Title', value: (from && from.title) || '', placeholder: 'Short enough to read in a list' },
            { name: 'branch', label: 'Branch it delivers on', placeholder: 'fix/the-thing' },
            { name: 'brief', label: 'The brief — what the worker is actually told', value: (from && from.brief) || '', multiline: true, rows: 10, placeholder: 'Write it as instructions to somebody who cannot ask you a question.' },
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
// ---- what is defined, rather than what is happening ---------------------
//
// A pre-defined task is not a task. It is a DEFINITION of a job -- a prompt, or a
// script, written once to do one thing -- approved once by a person who read it,
// and run whenever it is wanted. The board next to it is work: written for an
// occasion, given out, delivered, judged, and then done with. These outlive the
// occasion, which is the whole point of them.
//
// WHAT IS REGISTERED TODAY IS DRILLS, and that is a fact about this moment rather
// than about the shape. They are jobs that happen to assert something; a job that
// reads a repository and reports, or one that applies a known fix wherever it
// finds it, is the same object with the same approval and the same run. Naming
// this pane "tests" would have written that limit into the window.
//
// APPROVAL IS THE POINT, and it matters more the less test-like these get. A
// model may write one; only a person may say it is fit to run, and `plannedRun`
// refuses anything unapproved. A definition that does work rather than asserting
// makes that boundary load-bearing rather than tidy.
//
// Until now the only ways in were a nudge card that appears when something is
// waiting, and the write-a-task dialog three clicks in. So the ordinary state --
// ten definitions, all approved, nothing waiting -- had no surface at all, and
// "what does this app already know how to do" was a question you could only
// answer from a terminal.
let taskPane = been.get('task-pane', 'board')

document.querySelectorAll('#view-tasks .subtab[data-pane]').forEach(t => {
  t.onclick = () => {
    taskPane = t.dataset.pane
    been.set('task-pane', taskPane)
    document.querySelectorAll('#view-tasks .subtab[data-pane]').forEach(x => x.classList.toggle('active', x === t))
    document.querySelectorAll('#view-tasks .pane').forEach(x => x.classList.toggle('active', x.id === `pane-${taskPane}`))
    paintPlanned()
  }
})
;(() => {
  const t = document.querySelector(`#view-tasks .subtab[data-pane="${taskPane}"]`)
  if (!t) { taskPane = 'board'; return }
  document.querySelectorAll('#view-tasks .subtab[data-pane]').forEach(x => x.classList.toggle('active', x === t))
  document.querySelectorAll('#view-tasks .pane').forEach(x => x.classList.toggle('active', x.id === `pane-${taskPane}`))
})()

// WHAT EACH STATE MEANS, said as the sentence rather than the flag. "Approved" is
// not one thing: a definition can be approved as it stands, approved and then
// EDITED since -- which is the dangerous one, because it reads as approved and is
// not what anybody read -- or never read at all.
const definitionState = t => t.lapsed
  ? { cls: 'bad', label: 'changed since you approved it', why: 'Somebody has edited this since it was read. It will not run until it is read again.' }
  : t.approved
    ? { cls: 'ok', label: 'approved', why: null }
    : { cls: 'warn', label: 'never read', why: 'Written by a model. Nothing runs until a person has read it and said so.' }

function paintPlanned () {
  if (view !== 'tasks' || taskPane !== 'planned') return
  waiting('planned-list', { cards: 3 })
  paintPlannedNow()
}

async function paintPlannedNow () {
  await settle()
  if (view !== 'tasks' || taskPane !== 'planned') return

  api('planned').then(plan => {
    const suites = plan.suites || []
    const all = suites.flatMap(s => s.tests)
    const waitingOn = all.filter(t => !t.approved || t.lapsed).length

    setText($('planned-context'), all.length
      ? `— ${all.length} in ${suites.length} suite${suites.length === 1 ? '' : 's'}${waitingOn ? `, ${waitingOn} needing you` : ''}`
      : '— none registered')
    setText($('planned-note'), plan.note || '')

    if (!changed('planned', suites)) return

    fill($('planned-list'), suites.length
      ? suites.map(su => el('div', { className: 'carries' },
          el('div', { className: 'carries-head' },
            el('span', { textContent: su.name }),
            el('span', { className: 'muted', textContent: `${su.tests.length} defined` })),
          ...su.tests.map(t => {
            const st = definitionState(t)
            return el('div', { className: 'card' },
              el('div', { className: 'card-title' },
                el('span', { className: 'grow', textContent: t.name }),
                el('span', { className: `badge ${st.cls}`, textContent: st.label })),
              // WHEN it was approved, because "approved" with no date is a claim
              // nobody can weigh against a definition that has been sitting for
              // months.
              el('div', { className: 'card-sub muted', textContent: [
                t.at ? `read ${ago(t.at)}` : 'never read',
                `fingerprint ${t.fingerprint}`
              ].join(' · ') }),
              st.why ? el('p', { className: 'note', textContent: st.why }) : null,
              t.note ? el('div', { className: 'card-sub', textContent: `"${t.note}"` }) : null,
              // A REQUEST IS SOMEBODY ASKING, and it is the one thing here that
              // arrives from outside the window -- a session that wrote a
              // definition may ask for it to be read, and may not read it itself.
              t.request ? el('p', { className: 'note warn', textContent: `Asked to be read: ${t.request}` }) : null,
              el('div', { className: 'row', style: 'margin-top:8px' },
                el('button', {
                  className: 'btn small',
                  textContent: st.cls === 'ok' ? 'Read it again' : 'Read it',
                  title: 'Opens the definition, in full, with what it would do',
                  onclick: () => readDefinition(t.name)
                })))
          })))
      : el('p', { className: 'empty', textContent: 'No jobs are defined yet. A pre-defined task is a job written once — declared in tasks/planned.js — and run whenever it is wanted.' }))
  }).catch(oops)
}

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
