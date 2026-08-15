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
    // REBUILT ON ENTRY, so the dropdowns are what the libraries say now.
    // paintAddTaskNow refuses to rebuild otherwise, because it must not swallow
    // what somebody has typed -- so arriving at the pane is the one moment it is
    // safe, and the only moment it is needed.
    if (taskPane === 'add') addBuiltFor = null
    paintAddTask()
    paintJobs()
    paintPrompts()
    paintContracts()
  }
})
;(() => {
  const t = document.querySelector(`#view-tasks .subtab[data-pane="${taskPane}"]`)
  if (!t) { taskPane = 'board'; return }
  document.querySelectorAll('#view-tasks .subtab[data-pane]').forEach(x => x.classList.toggle('active', x === t))
  document.querySelectorAll('#view-tasks .pane').forEach(x => x.classList.toggle('active', x.id === `pane-${taskPane}`))
})()

// GOING TO THE OTHER HALF.
//
// A job names the prompt it runs with, and a prompt is named by the jobs that
// use it. They live in different sub-tabs, so a panel that says which one is
// stopping a run used to leave the reader to do the lookup themselves: read the
// name, switch tab, find it in a list. Both directions are a click now, because
// a screen that knows the answer should be able to go to it.
//
// THROUGH THE TAB'S OWN CLICK, rather than setting the four things a switch sets.
// The handler above is the one place that knows how to change sub-tab; a second
// copy here would be the one that stops being updated.
const showPane = pane => {
  const tab = document.querySelector(`#view-tasks .subtab[data-pane="${pane}"]`)
  if (tab) tab.click()
}

// Selected BEFORE the switch, so the pane paints with it already picked rather
// than painting whatever was there and then moving.
function showPrompt (id) {
  pickedPrompt = id
  been.set('prompt', id)
  forget('prompts'); forget('prompt-detail')
  showPane('prompts')
}

function showJob (id) {
  pickedJob = id
  been.set('job', id)
  forget('jobs'); forget('jobs-detail')
  showPane('jobs')
}

function showContract (id) {
  pickedContract = id
  been.set('contract', id)
  forget('contracts'); forget('contract-detail')
  showPane('contracts')
}

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

// WHO IS EXPECTED TO DO IT, from the job slot rather than the worker slot.
//
// A job is the automated part of a task. Without one, nothing runs and the
// machine is set up and handed over — so a jobless task is a task somebody does,
// by construction. `worker: 'person'` still counts, for tasks written before the
// form existed and for anything set from the command line.
//
// This was `worker === 'person'` alone, and the form that writes tasks cannot set
// `worker` — so every task was 'claude' and the two doors appeared on none of
// them.
const byHand = t => !!t && (t.worker === 'person' || (!t.job && !t.shell))

// Whether there is already a machine up for it, waiting. The queue leaves a
// jobless task's machine running and claimed; reaching for `taskWorkOn` then
// would take ANOTHER one and leave the first set up and abandoned.
const openable = t => !!t && !!t.machine && t.state === 'given'

// A shell on the machine already holding this task. The action answers where the
// machine is; the terminal is opened here, because there is no terminal on the
// far side of an action — the same split `takeTaskByHand` makes.
function openTerminalOn (task) {
  showTab('terminal')
  return openShell(task.machine, { what: `#${task.number}`, cwd: task.folder || undefined, task: task.id })
    .then(() => say(`A shell is open on ${task.machine}.`))
    .catch(e => say(`${task.machine} is up, but the shell did not open: ${e.message}`, 'bad'))
}

const taskKey = t => t && [
  t.number,
  t.id, t.title, t.branch, t.state, t.reads, t.machine || '', t.run || '', t.worker || '',
  t.delivered, t.artifact, t.contract || '', t.contractId || '', (t.verdict && t.verdict.call) || '',
  // The three ties and whether a worker has run. Missed here, the panel would
  // keep saying "to be done by" after one had — which is the exact failure this
  // signature exists to prevent, in the row that was just fixed for lying.
  t.job || '', t.promptId || '', !!t.usedClaude,
  // How many machines have had it. `machine` alone cannot say: it is cleared
  // when one is put away, so a finished task and an untouched one both read
  // "nobody yet".
  (t.attempts || []).length
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
  for (const [box, shape] of [['task-detail', { lines: 6 }], ['task-history', { cards: 2 }], ['artifact', { cards: 2 }], ['handed', { cards: 1 }]]) {
    if (!$(box)) continue
    fill($(box), null)
    waiting(box, shape)
  }
  setText($('artifact-context'), '')
  setText($('handed-context'), '')

  // THE SIGNATURES TOO, or the paint that follows compares against what it drew
  // for the last task and decides nothing has changed -- leaving the placeholder
  // up for ever, which is a worse failure than the one this replaced.
  //
  // History keeps its own, PER TASK, behind a ten-second guard meant to stop a
  // guest round trip on every draw. Both have to go here: without the first,
  // coming back to a task looked at a moment ago skips the read entirely; without
  // the second, the read happens, matches what was drawn last time, and returns
  // without filling anything.
  for (const key of ['task-detail', 'artifact']) forget(key)
  forget('history-' + id)
  historyAt = 0

  await settle()
  if (view !== 'tasks') return
  draw()
}

function paintTasks (queued) {
  Promise.all([api('tasks'), api('jobs').catch(() => ({ jobs: [] }))]).then(([{ tasks }, work]) => {
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
    const unread = (work.jobs || []).filter(j => !j.approved)
    const lapsed = unread.filter(j => j.lapsed).length
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
                const t = document.querySelector('#view-tasks .subtab[data-pane="jobs"]')
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
          // A BADGE FOR WHAT HAPPENED, NOT FOR WHAT IS PLANNED.
          //
          // This carried the worker — "Claude" on every row, because that is the
          // default and is set before anything runs. A column of identical
          // badges predicting the same thing about work that has not started is
          // a column that costs a glance and returns nothing.
          //
          // Now it appears only when a worker actually ran, which makes it worth
          // reading: the rows with it are the ones Claude touched.
          el('div', { className: 'card-sub' },
            t.usedClaude ? el('span', { className: 'badge run', textContent: 'Claude' }) : null,
            el('span', { className: 'muted', style: t.usedClaude ? 'margin-left:6px' : '', textContent: t.artifact }))))
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
      // "BRANCH CUT", because that is what it is. A task works in a cut, which
      // is where the label everywhere else on this screen already agreed —
      // this row was the last one still calling it a branch, which is the
      // broader word and the one that stopped meaning anything.
      el('tr', {}, el('th', { textContent: 'branch cut' }), el('td', { className: 'mono', style: 'user-select:text', textContent: task.branch })),
      el('tr', {}, el('th', { textContent: 'state' }), el('td', {}, el('span', { className: `badge ${STATE_BADGE[task.reads] || 'muted'}`, textContent: task.reads }))),
      // ONE QUESTION WITH A YES OR A NO, rather than a name for who it is for.
      //
      // This row named the worker — "worked by Claude" — which was wrong twice
      // over. It was a prediction in the past tense on a draft nobody had
      // touched; and naming a worker is the wrong question anyway, because a
      // task can be done by a person, and a person's task may or may not have
      // had Claude anywhere near it. What somebody wants to know afterwards is
      // whether it did.
      //
      // `usedClaude` is set when a worker actually runs, from the two ends that
      // can know: the queue on the plain path, where dispatch writes `claude -p`
      // into the run script, and the /session handler on the job path, where a
      // transcript arriving is the only proof a job started one.
      //
      // The three answers are different states, not two. "No, and nothing has
      // run" and "no, and something ran without one" are opposite facts about a
      // finished task.
      el('tr', {}, el('th', { textContent: 'used Claude' }),
        el('td', {},
          el('span', {
            className: `badge ${task.usedClaude ? 'ok' : 'muted'}`,
            textContent: task.usedClaude ? 'yes' : 'no'
          }),
          // NOTHING UNDERNEATH WHILE THE ANSWER IS "NO, NOTHING HAS RUN". That
          // sentence carried the worker plan back in through the side door —
          // "Claude, run by the queue on a machine" — which is the prediction
          // this row was rewritten to stop making. "No" and an empty row below
          // it is the whole of what is true about a task nothing has touched.
          //
          // The other two answers earn a line, because each says something the
          // badge cannot: that a worker ran, or that something ran and was not
          // one.
          task.usedClaude
            ? el('div', { className: 'muted', textContent: 'A worker ran on a machine for this task.' })
            : (task.attempts || []).length
                ? el('div', { className: 'muted', textContent: 'It has been on a machine and no worker ran — the work was a script or a shell, or somebody did it by hand.' })
                : null)),
      // "GIVEN TO" IS GONE. It said where the task is right now, and the queue
      // clears it the moment a machine is put away — so it read "nobody yet" for
      // a task that had been through three machines and finished, which is the
      // same words a task that has never left this host gets. A field that is
      // right for the ninety seconds a machine is working and misleading either
      // side of that is not worth a row. Which machines have had it is the row
      // below; which one is working on it right now is on the machines tab, and
      // in the banner while it matters.
      el('tr', {}, el('th', { textContent: 'run' }), el('td', { className: 'mono', textContent: task.run || '—' })),

      // HAS IT BEEN ON A MACHINE, which the panel could not answer.
      //
      // "given to" is where it is NOW and is cleared when a machine is put away,
      // so a task that has been through three machines and finished reads
      // "nobody yet" — identical to one that has never left this host. That is
      // the difference between a first attempt and a fourth, and it changes what
      // the next run means: a task that has been in a VM has a session to carry
      // on from and a branch that may already have commits on it.
      //
      // Read off the attempts rather than stored, because the attempts are the
      // record and a second copy of a fact is a second copy to disagree.
      (() => {
        const been = task.attempts || []
        const machines = [...new Set(been.map(a => a.machine).filter(Boolean))]
        const failed = been.filter(a => a.failed).length
        return el('tr', {}, el('th', { textContent: 'been in a VM' }),
          el('td', {}, been.length
            ? el('span', {},
                el('span', { className: 'badge ok', textContent: `${been.length} time${been.length === 1 ? '' : 's'}` }),
                el('div', { className: 'muted', textContent:
                  `${machines.length ? machines.join(', ') : 'a machine'}${failed ? ` · ${failed} of them failed before the work started` : ''}` }))
            : el('span', { className: 'muted', textContent: 'never — it has not been on a machine' })))
      })(),

      // THE THREE THINGS TIED TO IT, which the panel never said. A task carries
      // a job, a prompt and a contract, and the only one of them on screen was
      // the contract — so a task written from a prompt, to be run by a job,
      // looked identical to one typed from nothing.
      el('tr', {}, el('th', { textContent: 'job' }),
        el('td', {}, task.job
          ? el('button', {
              className: 'linky',
              textContent: task.job,
              title: 'Read the script that will run',
              onclick: () => { pickedJob = task.job; been.set('job', pickedJob); forget('jobs'); forget('jobs-detail'); showPane('jobs') }
            })
          : el('span', { className: 'muted', textContent: 'none — the machine is set up on the branch cut and left running for you' }))),
      el('tr', {}, el('th', { textContent: 'prompt' }),
        el('td', {}, task.promptId
          ? el('button', {
              className: 'linky',
              textContent: task.promptName || task.promptId,
              title: 'The library entry the brief was filled in from. The task carries its own copy.',
              onclick: () => showPrompt(task.promptId)
            })
          : el('span', { className: 'muted', textContent: 'none — the brief was written here' }))),
      // Said whether or not there is one, because "no rules" is the dangerous
      // reading and it is also the silent one: a task with no contract looks
      // exactly like a task with one from everywhere except here.
      // THE RULES IT CARRIES, not the name of a library entry it came from. A
      // task written under a contract copied the words, so this reads them off
      // the task rather than looking the contract up — which is the point: the
      // library may have moved on, and what this task went out under did not.
      el('tr', {}, el('th', { textContent: 'contract' }),
        el('td', {}, task.rules
          ? [
              el('span', { textContent: task.contractName || task.contractId || 'the rules it was given' }),
              el('button', {
                className: 'linky',
                style: 'margin-left:8px',
                textContent: 'read them',
                title: 'The words this task carries, as the worker gets them',
                onclick: () => ask({
                  title: `The rules for #${task.number}`,
                  plain: [`Carried by this task, as it was written. Editing "${task.contractName || task.contractId}" in the library since then has not changed these.`],
                  confirm: 'Done',
                  onYes: async () => {},
                  onOpen: () => {
                    const body = document.querySelector('.dlg-body')
                    if (body) body.append(markdownBlock(task.rules))
                  }
                })
              })
            ]
          : task.contract
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
      // A TASK WITH NO JOB IS A TASK SOMEBODY DOES, so it gets the two doors.
      //
      // This was gated on `worker === 'person'`, and the form that writes tasks
      // cannot set `worker` — so every task was `claude` and these buttons
      // appeared on none of them. The job slot is the honest test now: a job is
      // the automated part of a task, and a task without one is waiting for a
      // person by construction.
      //
      // WHEN A MACHINE IS ALREADY UP FOR IT, THIS OPENS THAT ONE. The queue
      // leaves a jobless task's machine running and claimed; `taskWorkOn` takes
      // ANOTHER machine, which would leave the first sitting there set up and
      // abandoned. So the button reaches straight for the one already waiting.
      byHand(task)
        ? el('button', {
            className: 'btn ok',
            textContent: openable(task) ? `Open ${task.machine} in VS Code` : 'Work on it in VS Code',
            disabled: !!task.verdict,
            title: task.verdict
              ? 'This task has been judged'
              : openable(task)
                  ? `${task.machine} is already set up on ${task.branch}`
                  : 'A machine is brought up on its branch with VS Code open in it',
            onclick: () => openable(task)
              ? api('vmEditor', { name: task.machine, folder: task.folder || undefined })
                  .then(r => say(r.note || `VS Code is opening on ${task.machine}.`)).catch(oops)
              : takeTaskByHand(task, 'editor')
          })
        : null,

      // QUEUEING IS ITS OWN QUESTION, not the other half of "do it by hand".
      //
      // These were the else-branches of the button above, so widening that to
      // every jobless task took them away — and #35 sat queued, unable to be
      // picked up because both machines were borrowed, with nothing on screen
      // offering to take it back out. A task can be queued AND workable by hand;
      // they are different acts and the panel should carry both.
      task.state === 'queued'
        ? el('button', {
            className: 'btn',
            textContent: 'Take it out of the queue',
            onclick: async () => { await api('taskUnqueue', { id: task.id }); say(`#${task.number} is back to a draft.`); draw() }
          })
        : task.state === 'given'
          ? null
          : el('button', {
              className: 'btn ok',
              textContent: 'Queue it',
              disabled: !!task.verdict,
              title: task.verdict
                ? 'This task has been judged'
                : task.job
                    ? 'The next free machine takes it, runs the job, and shuts down'
                    : 'The next free machine is set up on the branch cut and left running for you',
              onclick: () => queueTask(task)
            }),
      // THE SECOND DOOR ONTO THE SAME TASK. Same machine, same branch, same
      // credential, same finish — a terminal instead of an editor, landed in the
      // checkout, with nothing typed into it. This is what the Terminal tab's
      // machine picker used to be for, minus the part where the work had no
      // task: booting a machine and typing `claude` in its shell was the way
      // this was done by hand before any of it existed, and it is a way of
      // working, not a way of starting work.
      byHand(task)
        ? el('button', {
            className: 'btn',
            textContent: openable(task) ? `Open a terminal on ${task.machine}` : 'Work on it in a terminal',
            disabled: !!task.verdict,
            title: task.verdict ? 'This task has been judged' : 'A shell opens here, in the checkout on the machine',
            onclick: () => openable(task) ? openTerminalOn(task) : takeTaskByHand(task, 'terminal')
          })
        : null,

      // The other half of the person path: saying it is done. It is the exact
      // counterpart of a worker's exit code, and without it on the task itself
      // the only way to end one was from the machine that happened to be holding
      // it — which is the machines tab deciding a task's fate again.
      byHand(task)
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
      // NOT WHILE ANYTHING IS IN FLIGHT.
      //
      // Throwing a task away removes the record and leaves everything it
      // started: a machine claiming its branch, a run still going, a worker
      // mid-sentence. Nothing then accounts for any of it — the queue is
      // waiting on a task that no longer exists, and the machine is out of
      // service with nothing on the board explaining why.
      //
      // Queued counts too. The next tick is at most fifteen seconds away, so
      // "queued" is "about to be on a machine", and deleting it in that window
      // is the same act with better timing.
      //
      // Disabled rather than hidden, with the reason in the title: a button
      // that vanishes reads as a missing feature, and the answer here is "not
      // yet" rather than "not available".
      el('button', {
        className: 'btn danger',
        textContent: 'Throw it away',
        disabled: task.state === 'queued' || task.state === 'given',
        title: task.state === 'queued'
          ? 'It is in the queue and a machine may pick it up within seconds. Take it out of the queue first.'
          : task.state === 'given'
            ? `It is out on ${task.machine || 'a machine'}. Finish it, or give the machine back, and then it can be thrown away.`
            : 'The task is removed. Its branch, its files and its logs are untouched.',
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
    const badge = a => a.state === 'running' || a.state === 'setUp' ? 'run'
      : a.state === 'lost' ? 'bad'
        : a.state === 'ended' || a.state === 'never started' ? 'muted'
          : a.exit === 0 ? 'ok' : 'bad'
    // SET UP IS A LIVE STATE, and it read as the deadest one there is. A task
    // with no job leaves its machine running and waiting; the attempt has no run
    // because nothing was run, and "the machine no longer has it" appeared
    // directly above a button offering to open that machine.
    const said = a => a.state === 'setUp' ? 'set up and waiting for you'
      : a.state === 'never started' ? 'never started — nothing was dispatched'
        : a.state === 'gone' ? 'the machine no longer has it'
          : a.state === 'ended' ? 'ended — its machine has been put away'
            : a.state || 'unknown'
    // AN ATTEMPT IS A RUN, and a task with no job has none.
    //
    // This listed every attempt as a card with a run id, a log button and a
    // verdict — a shape that only means anything when something was dispatched.
    // For a jobless task the "attempts" are hand-overs: a machine was set up and
    // given to somebody. Drawing those as failed runs with no logs was the panel
    // describing one thing in another thing's vocabulary, and it read as three
    // broken runs when nothing had gone wrong at all.
    //
    // Which machines have had it is the "been in a VM" row on the panel beside
    // this, and that is the honest home for it.
    const ran = p.attempts.filter(a => a.run)
    const handed = p.attempts.filter(a => !a.run)

    fill(box2,
      ran.length
        ? ran.map((a, i) => el('div', { className: 'card' },
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
              // "No log was kept" reads as something lost. For an attempt that
              // never ran there was never one to keep, which is a different
              // sentence and not a fault.
              : el('div', { className: 'card-sub muted', textContent: a.state === 'running'
                  ? 'still going; the log is kept when it ends'
                  : a.state === 'setUp'
                      ? 'nothing ran, so there is no log — the machine is yours'
                      : a.state === 'lost' || a.state === 'never started'
                          ? 'nothing ran, so there is no log'
                          : 'no log was kept for this attempt' })))
        // No runs. Say which it is: set up and waiting, set up and since given
        // back, or never given out at all. Three different facts that all used
        // to arrive as "never given out".
        : el('p', { className: 'empty', textContent: handed.length
            ? (handed.some(a => a.state === 'setUp')
                ? `Nothing has run — this task has no job. A machine was set up for you ${handed.length === 1 ? 'once' : `${handed.length} times`}; the buttons below open it.`
                : `Nothing has run. A machine was set up for it ${handed.length === 1 ? 'once' : `${handed.length} times`} and has since been given back.`)
            : (p.why || 'never given out') }),

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
    if (body) body.append(codeBlock(l.text || '(nothing)', 'markdown'))
  }).catch(oops)
}

// What actually arrived, read the way a pull request is read.
function paintArtifact (task) {
  setText($('artifact-context'), task ? `— ${task.branch}` : '')
  if (!task) {
    if (changed('artifact', null)) {
      fill($('artifact'), el('p', { className: 'empty', textContent: 'Select a task.' }))
      // Both panels, or the second keeps showing the last task's files under a
      // heading that no longer refers to anything.
      fill($('handed'), el('p', { className: 'empty', textContent: 'Select a task.' }))
      setText($('handed-context'), '')
    }
    return
  }

  // BOTH KINDS OF ARTIFACT, because a task can deliver either.
  //
  // This panel read the branch and nothing else, so a run that handed a file
  // back showed "nothing has arrived on this branch yet" while the file sat on
  // this host — true about the branch, and the opposite of the truth about the
  // task. The first job to hand something over said exactly that, and the only
  // way to find what it produced was a path in a note.
  Promise.all([
    api('taskArtifact', { id: task.id }),
    api('taskFiles', { id: task.id }).catch(() => ({ files: [] })),
    api('session', { id: task.id }).catch(() => ({ has: false }))
  ]).then(([art, handed, memory]) => {
    if (!changed('artifact', [task.id, art, handed, memory])) return

    const carrying = art.repos.filter(r => !r.missing && !r.empty)
    const kept = handed.files || []

    // ITS OWN PANEL, not another card in the list of repositories. Sitting in
    // that list it read as though it were one of them, when it is the opposite
    // thing: a repository card is about commits a branch holds, and this is
    // about a file no branch could hold, which is the entire reason handing one
    // back exists.
    setText($('handed-context'), kept.length
      ? `— ${kept.length} file${kept.length === 1 ? '' : 's'}, ${kept.reduce((n, f) => n + (f.bytes || 0), 0) >= 1048576
          ? `${(kept.reduce((n, f) => n + (f.bytes || 0), 0) / 1048576).toFixed(1)} MB`
          : `${Math.max(1, Math.round(kept.reduce((n, f) => n + (f.bytes || 0), 0) / 1024))} KB`}`
      : '')

    fill($('handed'), kept.length
      ? kept.map(f => el('div', { className: 'card' },
        el('div', { className: 'card-title' },
          el('span', { className: 'grow mono', textContent: f.name || f.file }),
          el('span', { className: 'badge ok', textContent: f.bytes >= 1048576 ? `${(f.bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(f.bytes / 1024))} KB` })),
        el('div', { className: 'card-sub muted', textContent: `handed over ${ago(f.kept)}${f.run ? ` by ${f.run}` : ''}` }),
        el('div', { className: 'card-sub muted mono', style: 'user-select:text', textContent: f.path }),
        el('div', { className: 'row', style: 'margin-top:8px' },
          el('button', {
            className: 'btn small ok',
            textContent: 'Read it',
            title: 'Show it here, if it is text',
            onclick: () => readHandedFile(task, f)
          }),
          el('button', {
            className: 'btn small',
            textContent: 'Show in folder',
            title: 'Open the folder it is in, with it selected',
            onclick: () => {
              if (!host.showInFolder(f.path)) say('This window cannot open a file manager here.', 'bad')
            }
          }),
          el('button', {
            className: 'btn small danger',
            textContent: 'Throw it away',
            onclick: () => ask({
              title: `Throw away "${f.name || f.file}"?`,
              plain: [
                'Only the file. The task, its branch and its log are untouched.',
                'The machine that made it was rolled back, so this is the only copy.'
              ],
              cost: 'It cannot be produced again without running the task again.',
              confirm: 'Throw it away',
              danger: true,
              onYes: async () => {
                await api('taskFileForget', { id: task.id, file: f.file })
                say(`"${f.name || f.file}" is gone.`, 'warn')
                forget('artifact')
                return draw()
              }
            })
          }))))
      // SAID WHEN THERE IS NOTHING, rather than left blank. An empty panel and a
      // panel whose answer is "none" look identical and mean opposite things --
      // and here the difference is whether a run was supposed to produce
      // something, so it says how one would.
      : el('p', { className: 'empty', textContent: 'Nothing was handed over. A run hands a file back by calling "okc-artifact <file>", which is on its PATH — or, from a job, by awaiting artifact(file).' }))

    // WHAT THE WORKER REMEMBERS, as the third kind of thing a task carries.
    //
    // It belongs here rather than in the task's own detail panel because it is
    // the same class of thing as the two above it: something that survived a
    // machine being rolled back. The difference is that this one is not read
    // here -- it is a folder in a gzip, and the Sessions tab is where it is
    // looked at and thrown away.
    if (memory.has) {
      $('handed').append(el('div', { className: 'card', style: 'margin-top:8px' },
        el('div', { className: 'card-title' },
          el('span', { className: 'grow', textContent: 'what the worker remembers' }),
          el('span', { className: 'badge ok', textContent: `${memory.runs || 1} run${memory.runs === 1 ? '' : 's'}` })),
        el('div', { className: 'card-sub muted', textContent: `${memory.bytes >= 1048576 ? `${(memory.bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(memory.bytes / 1024))} KB`} · kept ${ago(memory.kept)}${memory.machine ? ` from ${memory.machine}` : ''}` }),
        memory.id ? el('div', { className: 'card-sub muted mono', textContent: memory.id }) : null,
        el('div', { className: 'card-sub muted', textContent: 'Put back on whichever machine picks this task up next, so the next run carries on instead of starting over.' }),
        el('div', { className: 'row', style: 'margin-top:8px' },
          el('button', {
            className: 'btn small',
            textContent: 'Open in Sessions',
            // By uid, which is what the Sessions tab keys on, and set before the
            // switch so that pane paints with it already picked.
            onclick: () => {
              pickedSession = memory.uid || null
              been.set('session', pickedSession)
              forget('sessions'); forget('session-detail')
              showTab('sessions')
              return draw()
            }
          }))))
    }

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

// A handed-back file, read where it arrived.
//
// The mode is guessed from the name only for colouring; the refusal to render
// something that is not text happens on the other side, by looking at the bytes.
function readHandedFile (task, f) {
  const name = String(f.name || f.file)
  const ext = (name.split('.').pop() || '').toLowerCase()
  const mode = ext === 'md' ? 'markdown' : ext === 'js' || ext === 'json' ? 'javascript' : ext === 'diff' || ext === 'patch' ? 'diff' : 'text'

  api('taskFileRead', { id: task.id, file: f.file }).then(({ text }) => {
    ask({
      title: name,
      plain: [
        `Handed over by ${f.run || 'a run'} for #${task.number}, and kept on this host.`,
        mode === 'markdown'
          // Said, because it is not obvious that a rendered view is showing
          // somebody else's document with its teeth taken out.
          ? 'Rendered in a frame that cannot run anything and cannot reach the network — this came off a machine.'
          : null
      ].filter(Boolean),
      confirm: 'Done',
      onYes: async () => {}
    })
    const body = document.querySelector('.dlg-body')
    if (body) body.append(mode === 'markdown' ? markdownBlock(text) : codeBlock(text, mode, { max: DIFF_LID }))
  }).catch(oops)
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
    if (body) body.append(codeBlock(diff || 'no changes', 'diff', { max: DIFF_LID }))
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
// ---- writing one, in a pane of its own -----------------------------------
//
// This was a modal, and it outgrew one. A task now names a prompt, a job and a
// contract that answer each other as they are chosen — pick the prompt and two
// other fields fill themselves in — and a dialog is the wrong shape for
// something you READ while filling it in. It covered the board it was about, it
// had to be finished or thrown away, and there was nowhere to put the rules the
// worker will be held to while you write the words that have to hold to them.
//
// So: a pane. The form on the left, and on the right what this task will
// actually carry.
//
// PREFILLED WHEN THE WORK CAME FROM SOMEWHERE — an issue, or a prompt somebody
// was reading. Somebody already wrote what they want, and retyping it into a
// brief is how the two drift apart.
let addPrefill = null
// What the form was last built from. The draw loop comes round every few
// seconds and this pane is a form somebody is typing into: rebuilding it on a
// tick would swallow what they had written, which is the one thing a form must
// never do. So it is built once per visit, and only the preview beside it moves.
let addBuiltFor = null

function newTask (from = null) {
  addPrefill = from
  // THE TAB AS WELL AS THE PANE. This is called from Branches and from
  // Repositories too, where switching only the sub-tab moves a pane nobody is
  // looking at and leaves the caller's screen exactly as it was — which reads as
  // a button that does nothing.
  showTab('tasks')
  showPane('add')
}

function paintAddTask () {
  if (view !== 'tasks' || taskPane !== 'add') return
  waiting('add-form', { lines: 6 })
  paintAddTaskNow()
}

async function paintAddTaskNow () {
  await settle()
  if (view !== 'tasks' || taskPane !== 'add') return

  const token = JSON.stringify(addPrefill)
  if (addBuiltFor === token) return
  addBuiltFor = token
  const from = addPrefill

  Promise.all([
    api('gitBranches'),
    api('prompts').catch(() => ({ prompts: [] })),
    api('jobs').catch(() => ({ jobs: [] })),
    api('lines').catch(() => ({ groups: [] }))
  ]).then(([{ branches: known, protected: guarded }, lib, work, lines]) => {
    if (view !== 'tasks' || taskPane !== 'add') return
    const taken = new Set((guarded || []).map(g => g.branch))
    contractsNow = lib.contracts || contractsNow

    setText($('add-context'), from
      ? (from.branch ? `— on ${from.branch}` : '— from what you were reading')
      : '')
    setText($('add-note'), 'A task is what a worker is told, and the branch it delivers on. That branch is the artifact: it is what comes back, and what gets judged. Nothing is given out yet — writing a task touches no machine.')

    const nameOf = b => (typeof b === 'string' ? b : b && b.name) || ''
    // BRANCH CUTS, WHICH IS NOT THE SAME AS BRANCHES.
    //
    // A workspace holds branches from three sources: ones cut here with a reason
    // and a starting point, the repositories' own default branches, and whatever
    // somebody made by hand. Only the first are cuts, and this list offered all
    // three — so `master` and `version2` appeared as places to do work, which is
    // how a form about work ends up naming the repository's trunk.
    //
    // `cut` is the record of the act, kept when branchCreate made it. See
    // repos/branches.js.
    // AND PROTECTED WINS. A branch that was cut here and has since been made a
    // line is a line: that is what making one MEANT. It keeps its cut record
    // because the record is of an act that happened, not of what the branch is
    // now — so `cut` alone still offered it, and the list came out one too long.
    const isCut = b => b && b.cut && !b.protected
    const cuts = (known || []).filter(isCut).map(nameOf).sort()
    // LINES ARE NOT OFFERED HERE AT ALL, and the read-only machinery behind them
    // stays anyway. A machine set up on a line is refused its push by the host's
    // hook and told so by a pre-push hook in the guest — that is true however
    // the machine got there, and it is not this form's business to be the only
    // thing preventing it.

    const { rows, inputs } = buildFields([
      { name: 'title', label: 'Title', value: (from && from.title) || '', placeholder: 'Short enough to read in a list' },
      // A TASK DELIVERS ON A CUT, NOT ON A LINE, and this field offered lines.
      //
      // They are different things and the form conflated them. A line is a named
      // point in the work -- one branch per repository -- and it is PROTECTED:
      // work is merged into it, never done on it. A cut is a branch made across
      // the repositories to do work on. Offering lines here read as "deliver
      // onto this line", which is the one thing that must not happen.
      //
      // So: pick a cut that exists, or name a new one. The two fields below are
      // the "or" -- and only one of them is read, which the preview says.
      // ONE FIELD, BECAUSE THEY WERE ALWAYS ONE QUESTION.
      //
      // This was three: a branch to deliver on, a box to name a new one, and a
      // cut to make it from. But working in a cut and delivering to a cut are
      // the same act — the work goes where the work is — so the form was asking
      // one thing three ways and making the reader reconcile them.
      //
      // A line is not offered. A line is protected: work is merged into one and
      // never done on one, so offering lines here read as "start work on a
      // line", which is the thing that must not happen, and it is what this form
      // said for two revisions. Cutting a branch is the Branches tab's job,
      // where naming what it is for and what it starts from is the whole act
      // rather than two more dropdowns on a form about something else.
      {
        name: 'branch',
        label: 'Work in this Branch Cut',
        // FILLED IN WHEN THE WORK CAME FROM A CUT. Arriving here from "Work on
        // it" on the Branches tab, the cut is the one thing already decided —
        // asking for it again would be asking somebody to repeat themselves.
        value: (from && from.branch) || '',
        options: [
          { value: '', label: cuts.length ? 'pick the cut this work belongs to' : 'there are no cuts yet — make one on the Branches tab' },
          ...cuts.map(b => ({ value: b, label: b }))
        ]
      },
      // THE BRIEF IS THE PROMPT. Writing a task is writing one, which is the
      // whole reason the library exists: pick a kept one and it is filled in
      // below, still as text somebody can change before it goes.
      {
        name: 'promptId',
        label: 'Fill the brief from a prompt (optional)',
        value: '',
        options: [
          { value: '', label: 'none — write it below' },
          ...(lib.prompts || []).map(x => ({ value: x.id, label: `${x.name}${x.approved ? '' : ' — not approved'}` }))
        ]
      },
      { name: 'brief', label: 'The brief — what the worker is actually told', value: (from && from.brief) || '', multiline: true, rows: 8, placeholder: 'Write it as instructions to somebody who cannot ask you a question.' },
      // A JOB IS THE AUTOMATED PART OF A TASK, and choosing none is a real
      // choice rather than a default.
      //
      // "None" used to mean "the queue dispatches a worker with the brief",
      // which made running Claude the consequence of not deciding anything —
      // somebody queued a task and got a machine booted, a credential placed, a
      // worker run over their branch and the machine rolled back, having asked
      // for none of it.
      //
      // Now: a job runs, and without one the machine is brought up, set up on
      // the branch cut, and left running for whoever wrote the task.
      {
        name: 'job',
        label: 'Which job runs it (optional)',
        value: '',
        options: [
          { value: '', label: 'none — set the machine up and leave it running for me' },
          ...(work.jobs || []).map(x => ({ value: x.id, label: `${x.name}${x.runnable ? '' : ` — ${x.whyNot}`}` }))
        ]
      },
      // THE RULES, FROM THE LIBRARY, not a path typed from memory. This was a
      // text box wanting a file on this host, which is why the field went
      // unused: the rules a run was governed by lived outside everything that
      // governs runs. Only approved ones are offered — an unapproved contract
      // in a dropdown is a thing somebody picks.
      {
        name: 'contractId',
        label: 'Under which contract (optional)',
        value: '',
        options: [
          { value: '', label: 'none — the worker gets no rules' },
          ...contractsNow.filter(c => c.approved).map(c => ({ value: c.id, label: c.name }))
        ]
      },
      { name: 'folder', label: 'Folder on the machine (optional)', placeholder: 'defaults to its workspace' }
    ])

    const err = el('p', { className: 'dlg-err hidden' })
    const write = el('button', { className: 'btn ok', textContent: 'Write it' })
    const clear = el('button', { className: 'btn', textContent: 'Start over' })

    // THE BUTTON STAYS ON THE SCREEN. The brief is a twelve-row box by
    // temperament and the pane is as tall as the window, so at full size the one
    // control that does anything sat below the fold -- which is the exact fault
    // this window already learned about dialogs, in a pane instead. Eight rows,
    // and the box is still draggable for anybody writing an essay.
    fill($('add-form'), ...rows, err, el('div', { className: 'row', style: 'margin-top:10px' }, write, clear))

    // ---- what it will carry, beside what is being written ------------------
    //
    // The rules are the reason this pane has two columns. A brief saying
    // "refactor across every repository" under rules saying "touch nothing you
    // were not asked about" is a contradiction, and it is only ever visible
    // when the two are on one screen. In a modal there was nowhere to put them.

    const preview = () => {
      const rules = contractsNow.find(c => c.id === inputs.contractId.value) || null
      const job = (work.jobs || []).find(j => j.id === inputs.job.value) || null
      const branch = inputs.branch.value
      fill($('add-preview'),
        el('div', { className: 'card-title' }, el('span', { className: 'grow', textContent: 'What this task will carry' })),

        el('div', { className: 'carries', style: 'margin-top:10px' },
          // WORKS IN, AND DELIVERS TO. One line, because it is one fact: the
          // work goes where the work is. Only cuts are on the list, so there is
          // no read-only case to report here — a line cannot be picked.
          el('div', { className: 'group-part' },
            el('span', { textContent: 'works in' }),
            el('span', {}, branch
              ? el('span', { textContent: branch })
              : el('span', { className: 'muted', textContent: 'pick the cut this work belongs to' }))),
          el('div', { className: 'group-part' },
            el('span', { textContent: 'done by' }),
            el('span', {}, job
              ? el('span', { className: job.runnable ? '' : 'warn', textContent: `${job.name}${job.runnable ? '' : ` — ${job.whyNot}`}` })
              : el('span', { className: 'muted', textContent: 'nothing — the machine is set up and left running for you' }))),
          el('div', { className: 'group-part' },
            el('span', { textContent: 'held to' }),
            el('span', {}, rules
              ? el('span', { textContent: rules.name })
              : el('span', { className: 'warn', textContent: 'nothing — the worker gets no rules' })))),

        rules
          ? el('div', { style: 'margin-top:10px' }, codeBlock(rules.text, 'markdown'))
          : el('p', { className: 'note warn', style: 'margin-top:10px' }, 'No contract chosen. A worker with no rules is not a worker doing as it likes — it is one that was never told what it may not do, and nothing afterwards can tell that apart from rules that failed to load.'))
    }
    preview()
    inputs.contractId.onchange = preview
    inputs.job.onchange = preview
    inputs.branch.onchange = preview

    // FILLED IN, NOT LOCKED TO. Choosing a prompt copies its words into the
    // brief and leaves them editable: a task carries what the worker was
    // actually given, so changing it here changes this task and nothing else.
    //
    // AND IT WILL NOT OVERWRITE SOMETHING SOMEBODY TYPED. Filling an empty box
    // is help; replacing a paragraph half-written is the same act and is
    // destructive, and from inside a dropdown the two are indistinguishable. So
    // it fills when the brief is empty or still holds the last thing it filled,
    // and otherwise says why it did not.
    const pick = inputs.promptId
    const brief = inputs.brief
    const jobPick = inputs.job
    const rulePick = inputs.contractId
    let filled = brief.value
    let filledJob = jobPick.value
    let filledRule = rulePick.value

    pick.onchange = () => {
      const chosen = (lib.prompts || []).find(x => x.id === pick.value)
      if (!chosen) return

      if (!brief.value.trim() || brief.value === filled) {
        brief.value = chosen.text
        filled = chosen.text
      } else {
        say('The brief has been edited, so it was left alone. Clear it to fill from a prompt.', 'warn')
      }

      // AND THE CONTRACT IT RUNS UNDER, which is not the convenience the job is.
      // A prompt names its contract because the words have to hold to those
      // rules — so a task written from that prompt and NOT under those rules is
      // the one combination the pairing exists to prevent. Still only filled in
      // rather than locked: a task is one occasion, and somebody may mean to run
      // this occasion differently.
      const under = chosen.contractId || ''
      if (!rulePick.value || rulePick.value === filledRule) {
        // Only if it is actually on offer. The dropdown carries approved
        // contracts only, so a prompt whose rules have lapsed would otherwise be
        // "filled in" with a value that silently does not exist and reads as none.
        if (!under || [...rulePick.options].some(o => o.value === under)) {
          rulePick.value = under
          filledRule = under
        } else {
          say(`"${chosen.name}" runs under a contract that is not approved, so it was not filled in.`, 'warn')
        }
      }

      // AND THE JOB THAT USES IT, because the pairing is the thing. A job names
      // the prompt it runs with, so picking the prompt has already answered
      // "which job" in every case where the answer is not "none" — and leaving
      // the reader to find it in the dropdown by name is asking them to redo a
      // lookup the screen just did.
      const tied = (work.jobs || []).filter(j => j.promptId === chosen.id)
      if (tied.length && (!jobPick.value || jobPick.value === filledJob)) {
        jobPick.value = tied[0].id
        filledJob = tied[0].id
        if (tied.length > 1) say(`${tied.length} jobs use that prompt — "${tied[0].name}" was filled in. Change it below if you meant another.`)
      }

      preview()
    }

    clear.onclick = () => { addPrefill = null; addBuiltFor = null; paintAddTask() }

    write.onclick = async () => {
      write.disabled = true
      err.classList.add('hidden')
      try {
        const values = {}
        for (const k in inputs) values[k] = inputs[k].value.trim()

        // THIS FORM DOES NOT MAKE BRANCHES. It did for one revision, and that
        // was the wrong shape: writing a task and cutting a branch are two acts
        // with different consequences, and folding them together meant a form
        // about work quietly created something across every repository. The cut
        // exists first, made on the Branches tab where naming what it is for and
        // what it starts from is the whole act.
        //
        // Which also means the refusal that prompted all this cannot happen: a
        // branch that does not exist is not on the list, so it cannot be named.
        if (!values.branch) throw new Error('Pick the branch cut this work belongs to. If there is not one yet, cut it on the Branches tab.')

        // The prompt's NAME as well as its id, so a task can still say where its
        // brief came from after the library entry is gone. The same reason the
        // contract's name is carried.
        const cameFrom = (lib.prompts || []).find(p => p.id === values.promptId)
        if (cameFrom) values.promptName = cameFrom.name

        const made = await api('taskCreate', { task: values })
        pickedTask = made.id
        been.set('task', pickedTask)
        say(`Task "${made.title}" written, delivering on ${made.branch}. Known branches: ${(known || []).length}.`)
        // ONTO THE BOARD, because the task now exists and this pane is about one
        // that does not. Leaving the filled-in form up after it was written is
        // how somebody writes the same task twice.
        addPrefill = null
        addBuiltFor = null
        showPane('board')
        return draw()
      } catch (e) {
        err.textContent = e.message
        err.classList.remove('hidden')
        write.disabled = false
      }
    }
  }).catch(e => { addBuiltFor = null; oops(e) })
}


// Reading a definition, and deciding about it.
//
// THE DEFINITION IS ON THE SCREEN. That is the whole of this dialog: approving
// something you have not read is not approval, and a button that says "approve"
// beside a name is a button that gets pressed without anybody having looked. So
// the source of what will actually run is here, and the button is underneath it.
//
// Only in the window. `jobApprove` refuses over the socket, because that is
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
// The contracts, kept from the last paint so the write dialog can offer them
// without a round trip while it is opening. Same as promptsNow, for the same
// reason: a dropdown that fills in a moment later is a dropdown somebody has
// already scrolled past.
let contractsNow = []

function paintPrompts () {
  if (view !== 'tasks' || taskPane !== 'prompts') return
  waiting('prompts-list', { cards: 3 })
  waiting('prompt-detail', { lines: 8 })
  paintPromptsNow()
}

async function paintPromptsNow () {
  await settle()
  if (view !== 'tasks' || taskPane !== 'prompts') return

  // The jobs too, only to say which ones use each prompt. Allowed to fail and
  // still paint: prompts are kept for this computer and jobs belong to a
  // workspace, so with none open the library is still readable and the answer to
  // "what uses this" is simply nothing.
  Promise.all([api('prompts'), api('jobs').catch(() => ({ jobs: [] }))]).then(([{ prompts, contracts, note }, work]) => {
    contractsNow = contracts || []
    const usersOf = id => (work.jobs || []).filter(j => j.promptId === id)

    if (!prompts.some(x => x.id === pickedPrompt)) {
      pickedPrompt = prompts.length ? prompts[0].id : null
      been.set('prompt', pickedPrompt)
    }
    const waitingOn = prompts.filter(x => !x.approved || x.lapsed).length
    setText($('prompts-context'), prompts.length
      ? `— ${prompts.length} kept${waitingOn ? `, ${waitingOn} waiting to be approved` : ''}`
      : '— none yet')
    setText($('prompts-note'), note)

    if (changed('prompts', [prompts, pickedPrompt])) {
      fill($('prompts-list'), prompts.length
        ? prompts.map(x => el('div', {
            className: `card pick${x.id === pickedPrompt ? ' on' : ''}`,
            onclick: () => {
              pickedPrompt = x.id
              been.set('prompt', pickedPrompt)
              forget('prompts'); forget('prompt-detail')
              paintPrompts()
            }
          },
          el('div', { className: 'card-title' },
            el('span', { className: 'grow', textContent: x.name }),
            el('span', promptBadge(x))),
          x.about ? el('div', { className: 'card-sub muted', textContent: x.about }) : null,
          el('div', { className: 'card-sub muted', textContent: x.edited ? `edited ${ago(x.edited)}` : `written ${ago(x.written)}` })))
        : el('p', { className: 'empty', textContent: 'Nothing kept yet. Write one the moment you would type the same brief a second time.' }))
    }

    const one = prompts.find(x => x.id === pickedPrompt) || null
    // The jobs are part of the signature, or approving one would leave the
    // "used by" line showing the state it had before.
    const used = one ? usersOf(one.id) : []
    if (changed('prompt-detail', [one, used])) paintPrompt(one, used)
  }).catch(oops)
}

// The same ladder as a job's, for the half that is words rather than code — and
// like a job's it has a rung that is not about this thing at all: a prompt runs
// under a contract, and rules that are not ready stop it just as surely as words
// that are not approved. Saying "not approved" for that would send somebody to
// the prompt to find it perfectly approved.
const promptBadge = x => x.lapsed
  ? { className: 'badge bad', textContent: 'edited' }
  : !x.approved
      ? { className: 'badge warn', textContent: 'not approved' }
      : x.usable === false
        ? { className: 'badge warn', textContent: x.missingContract ? 'contract gone' : 'contract waiting' }
        : { className: 'badge ok', textContent: 'approved' }

function paintPrompt (x, used = []) {
  if (!x) return fill($('prompt-detail'), el('p', { className: 'empty', textContent: 'Pick one on the left, or write one.' }))

  fill($('prompt-detail'),
    el('div', { className: 'card-title' },
      el('span', { className: 'grow', textContent: x.name }),
      el('span', promptBadge(x)),
      el('span', { className: 'badge muted', textContent: x.id })),
    el('div', { className: 'card-sub muted', textContent: [
      x.edited ? `edited ${ago(x.edited)}` : `written ${ago(x.written)}`,
      x.approved ? `approved ${ago(x.approvedAt)} by ${x.approvedBy}` : 'never approved',
      `hash ${x.hash}`
    ].join(' · ') }),
    x.about ? el('p', { className: 'note', textContent: x.about }) : null,
    x.lapsed
      ? el('p', { className: 'note bad', textContent: 'It was edited after it was approved, so it is waiting to be read again — what was approved is not what would be sent.' })
      : null,

    x.whyNot && x.approved
      ? el('p', { className: 'note warn', textContent: `It will not be sent: ${x.whyNot}.` })
      : null,

    // THE RULES IT RUNS UNDER, beside the words that have to hold to them.
    //
    // The contract hangs off the prompt rather than off the job because this is
    // the pairing somebody reads: a brief saying "refactor across every
    // repository" under rules saying "touch nothing you were not asked about"
    // is a contradiction that is only visible when the two are on one screen —
    // and the moment that matters is while approving, which is here.
    el('div', { className: 'carries', style: 'margin-top:10px' },
      el('div', { className: 'group-part' },
        el('span', { textContent: 'under the contract' }),
        el('span', {}, x.contract
          ? [
              el('button', {
                className: 'linky',
                textContent: x.contract.name,
                title: x.contract.approved ? 'Read the rules' : 'Read the rules, and approve them if they are fit',
                onclick: () => showContract(x.contract.id)
              }),
              x.contract.approved ? null : el('span', { className: 'warn', textContent: ' — not approved' })
            ]
          : el('span', { className: x.missingContract ? 'warn' : 'muted', textContent: x.missingContract ? `${x.contractId} — gone` : 'none — the worker gets no rules' }))),

      el('div', { className: 'group-part' },
        el('span', { textContent: 'used by' }),
        el('span', {}, used.length
          ? used.flatMap((j, n) => [
              n ? el('span', { className: 'muted', textContent: ', ' }) : null,
              el('button', {
                className: 'linky',
                textContent: j.name,
                title: j.runnable ? 'Ready to run' : `It will not run: ${j.whyNot}`,
                onclick: () => showJob(j.id)
              })
            ])
          : el('span', { className: 'muted', textContent: 'no job — a prompt is worth keeping on its own, and a task can be written from it directly' })))),

    el('div', { className: 'row', style: 'margin-top:8px' },
      // APPROVING IT IS DONE HERE OR NOWHERE. The action refuses over the wire
      // on purpose — a model may write a prompt and may not approve its own —
      // and for a while there was no button either, so a prompt written by a
      // model could never become approved at all and the job that needed it sat
      // there saying why for ever. A refusal with no way through is not a
      // boundary, it is a dead end.
      x.approved && !x.lapsed
        ? el('button', {
            className: 'btn small',
            textContent: 'Withdraw approval',
            title: 'Nothing is deleted — jobs that use it stop being runnable',
            onclick: async () => {
              try {
                await api('promptWithdraw', { id: x.id })
                say(`"${x.name}" will not be sent until it is approved again.`, 'warn')
                forget('prompts'); forget('prompt-detail')
                return draw()
              } catch (e) { oops(e) }
            }
          })
        : el('button', {
            className: 'btn small ok',
            textContent: x.lapsed ? 'Approve it again' : 'Approve it',
            title: 'Say it is fit to be sent to a worker, having read it',
            onclick: () => ask({
              title: `Approve "${x.name}"?`,
              plain: [
                'This is the text a worker is actually handed. Read it as instructions to somebody who cannot ask you a question.',
                'Approval is against the words as they are now — any edit takes it back automatically.'
              ],
              fields: [{ name: 'note', label: 'A note, for whoever reads this later (optional)', value: '' }],
              confirm: 'I have read it',
              onYes: async ({ note }) => {
                await api('promptApprove', { id: x.id, note })
                say(`"${x.name}" approved.`)
                forget('prompts'); forget('prompt-detail')
                forget('jobs'); forget('jobs-detail')
                return draw()
              }
            })
          }),
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
            forget('prompts'); forget('prompt-detail')
            return draw()
          }
        })
      })),

    el('div', { style: 'margin-top:10px' }, codeBlock(x.text, 'text')))
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
      { name: 'text', label: 'The prompt', value: x ? x.text : '', multiline: true, rows: 14, placeholder: 'Read the README and the code, and say where they disagree.' },
      // BOUND HERE, so the words and the rules they must hold to are chosen in
      // one act. Changing it counts as an edit and takes the approval back —
      // swapping the rules under a brief changes what was agreed to as much as
      // rewriting a sentence does, and more quietly, since the words look
      // identical afterwards.
      {
        name: 'contractId',
        label: 'Under which contract',
        value: x && x.contractId ? x.contractId : '',
        options: [
          { value: '', label: 'none — the worker gets no rules' },
          ...contractsNow.map(c => ({ value: c.id, label: `${c.name}${c.approved ? '' : ' — not approved'}` }))
        ]
      }
    ],
    confirm: x ? 'Save it' : 'Write it',
    onYes: async f => {
      const saved = await api('promptSave', { id: x ? x.id : undefined, name: f.name, about: f.about, text: f.text, contractId: f.contractId || '' })
      pickedPrompt = saved.id
      been.set('prompt', pickedPrompt)
      say(saved.created ? `"${saved.name}" kept.` : `"${saved.name}" saved.`)
      forget('prompts'); forget('prompt-detail')
      return draw()
    }
  })
}

$('prompt-new').onclick = () => writePrompt()

// ---- the contract library ------------------------------------------------
//
// The rules a worker is given, as opposed to the brief. The same shape as the
// prompts pane on purpose: it is the same kind of thing -- text somebody has to
// read, approve, and be told about when it changes -- and two libraries that
// behave differently would be two things to learn for no reason.
//
// See tasks/contracts.js for why this stopped being a path to a file on disk.
let pickedContract = been.get('contract', null)

const contractBadge = c => c.lapsed
  ? { className: 'badge bad', textContent: 'edited' }
  : c.approved
    ? { className: 'badge ok', textContent: 'approved' }
    : { className: 'badge warn', textContent: 'not approved' }

function paintContracts () {
  if (view !== 'tasks' || taskPane !== 'contracts') return
  waiting('contracts-list', { cards: 3 })
  waiting('contract-detail', { lines: 8 })
  paintContractsNow()
}

async function paintContractsNow () {
  await settle()
  if (view !== 'tasks' || taskPane !== 'contracts') return

  // The prompts too, only to say which run under each. A contract with nothing
  // under it is not a fault — it is one somebody wrote before the brief that
  // needs it — so this never fails the paint.
  Promise.all([api('contracts'), api('prompts').catch(() => ({ prompts: [] }))]).then(([{ contracts, note }, lib]) => {
    const boundTo = id => (lib.prompts || []).filter(p => p.contractId === id)

    if (!contracts.some(c => c.id === pickedContract)) {
      pickedContract = contracts.length ? contracts[0].id : null
      been.set('contract', pickedContract)
    }
    const waitingOn = contracts.filter(c => !c.approved || c.lapsed).length
    setText($('contracts-context'), contracts.length
      ? `— ${contracts.length} kept${waitingOn ? `, ${waitingOn} waiting to be approved` : ''}`
      : '— none yet')
    setText($('contracts-note'), note)

    if (changed('contracts', [contracts, pickedContract])) {
      fill($('contracts-list'), contracts.length
        ? contracts.map(c => el('div', {
            className: `card pick${c.id === pickedContract ? ' on' : ''}`,
            onclick: () => {
              pickedContract = c.id
              been.set('contract', pickedContract)
              forget('contracts'); forget('contract-detail')
              paintContracts()
            }
          },
          el('div', { className: 'card-title' },
            el('span', { className: 'grow', textContent: c.name }),
            el('span', contractBadge(c))),
          c.about ? el('div', { className: 'card-sub muted', textContent: c.about }) : null,
          el('div', { className: 'card-sub muted', textContent: `${c.lines} line${c.lines === 1 ? '' : 's'} · ${c.edited ? `edited ${ago(c.edited)}` : `written ${ago(c.written)}`}` })))
        : el('p', { className: 'empty', textContent: 'Nothing kept yet. A contract is what a worker may and may not do while it works — the same rules for a hundred different briefs.' }))
    }

    const one = contracts.find(c => c.id === pickedContract) || null
    const under = one ? boundTo(one.id) : []
    if (changed('contract-detail', [one, under])) paintContract(one, under)
  }).catch(oops)
}

function paintContract (c, under = []) {
  if (!c) return fill($('contract-detail'), el('p', { className: 'empty', textContent: 'Pick one on the left, or write one.' }))

  fill($('contract-detail'),
    el('div', { className: 'card-title' },
      el('span', { className: 'grow', textContent: c.name }),
      el('span', contractBadge(c)),
      el('span', { className: 'badge muted', textContent: c.id })),
    el('div', { className: 'card-sub muted', textContent: [
      c.edited ? `edited ${ago(c.edited)}` : `written ${ago(c.written)}`,
      c.approved ? `approved ${ago(c.approvedAt)} by ${c.approvedBy}` : 'never approved',
      `hash ${c.hash}`
    ].join(' · ') }),
    c.about ? el('p', { className: 'note', textContent: c.about }) : null,
    c.lapsed
      ? el('p', { className: 'note bad', textContent: 'It was edited after it was approved, so it is waiting to be read again — what was approved is not what would govern a run.' })
      : null,

    // WHAT RUNS UNDER IT, and the way to each. The other half of the link from a
    // prompt to its contract, and the direction that matters when taking an
    // approval back: this is the list of briefs that stop being sendable, said
    // before you do it rather than discovered afterwards one refusal at a time.
    el('div', { className: 'carries', style: 'margin-top:10px' },
      el('div', { className: 'group-part' },
        el('span', { textContent: 'the prompts under it' }),
        el('span', {}, under.length
          ? under.flatMap((p, n) => [
              n ? el('span', { className: 'muted', textContent: ', ' }) : null,
              el('button', {
                className: 'linky',
                textContent: p.name,
                title: p.usable ? 'Ready to send' : `It will not be sent: ${p.whyNot}`,
                onclick: () => showPrompt(p.id)
              })
            ])
          : el('span', { className: 'muted', textContent: 'none yet — rules with nothing under them govern nothing' })))),

    el('div', { className: 'row', style: 'margin-top:8px' },
      c.approved && !c.lapsed
        ? el('button', {
            className: 'btn small',
            textContent: 'Withdraw approval',
            title: 'Nothing is deleted — it stops being offered when a task is written',
            onclick: async () => {
              try {
                await api('contractWithdraw', { id: c.id })
                say(`"${c.name}" will not govern a run until it is approved again.`, 'warn')
                forget('contracts'); forget('contract-detail')
                return draw()
              } catch (e) { oops(e) }
            }
          })
        : el('button', {
            className: 'btn small ok',
            textContent: c.lapsed ? 'Approve it again' : 'Approve it',
            title: 'Say it is fit to govern a run, having read it',
            onclick: () => ask({
              title: `Approve "${c.name}"?`,
              plain: [
                'This is what a worker may and may not do. Read it as limits, and check that what is missing from it is missing on purpose.',
                'Approval is against the words as they are now — any edit takes it back automatically.'
              ],
              fields: [{ name: 'note', label: 'A note, for whoever reads this later (optional)', value: '' }],
              confirm: 'I have read it',
              onYes: async ({ note }) => {
                await api('contractApprove', { id: c.id, note })
                say(`"${c.name}" approved.`)
                forget('contracts'); forget('contract-detail')
                return draw()
              }
            })
          }),
      el('button', { className: 'btn small', textContent: 'Edit', onclick: () => writeContract(c) }),
      el('button', {
        className: 'btn small danger',
        textContent: 'Throw it away',
        onclick: () => ask({
          title: `Throw away "${c.name}"?`,
          plain: [
            'It leaves the library.',
            'Every task already written under it keeps the rules it was given — a task carries its own copy, so nothing that already went out changes.'
          ],
          confirm: 'Throw it away',
          danger: true,
          onYes: async () => {
            await api('contractForget', { id: c.id })
            say(`"${c.name}" is out of the library.`, 'warn')
            pickedContract = null
            forget('contracts'); forget('contract-detail')
            return draw()
          }
        })
      })),

    el('div', { style: 'margin-top:10px' }, codeBlock(c.text, 'markdown')))
}

function writeContract (c = null) {
  ask({
    title: c ? `Edit "${c.name}"` : 'Write a contract',
    plain: [
      'This is what a worker may and may not do while it works — the limits, not the brief.',
      c
        ? 'Editing it takes its approval back, because what was approved is no longer what would govern a run.'
        : 'It is kept for this computer rather than for a workspace: "do not force-push" names no repository.'
    ],
    fields: [
      { name: 'name', label: 'Name', value: c ? c.name : '', placeholder: 'Short enough to recognise in a list' },
      { name: 'about', label: 'What it is for (optional)', value: c && c.about ? c.about : '', placeholder: 'One line, so somebody else knows when to reach for it' },
      { name: 'text', label: 'The rules', value: c ? c.text : CONTRACT_STARTER, multiline: true, rows: 16 }
    ],
    confirm: c ? 'Save it' : 'Write it',
    onYes: async f => {
      const saved = await api('contractSave', { id: c ? c.id : undefined, name: f.name, about: f.about, text: f.text })
      pickedContract = saved.id
      been.set('contract', pickedContract)
      say(saved.created ? `"${saved.name}" kept.` : `"${saved.name}" saved.`)
      forget('contracts'); forget('contract-detail')
      return draw()
    }
  })
}

// A first one to edit rather than a blank box. Rules are hard to start and easy
// to continue, and a blank box is how a contract ends up being three lines that
// only cover what went wrong last time.
const CONTRACT_STARTER = `# What this worker may and may not do

- Work only on the branch you were given. Never commit to the default branch.
- Do not force-push, and do not rewrite history that is already pushed.
- Do not install anything. If something is missing, say so and stop.
- Do not edit anything outside the repositories in this folder.

# When you are unsure

Say what you were unsure about and what you did instead. A note in the
transcript is worth more than a guess that looks like a decision.

# When you finish

Leave the work on the branch. Say in one paragraph what you changed and what you
did not get to.
`

$('contract-new').onclick = () => writeContract()

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

// WHY IT CANNOT RUN, IN THE BADGE, AND NEVER A REASON THAT IS FALSE.
//
// This used to be `j.runnable ? 'ready' : j.lapsed ? 'edited' : 'not approved'`,
// which quietly made "not approved" the word for every other reason there is. So
// approving a job whose prompt was still waiting put "not approved" on the card
// and "approved 1 second ago by the window" in the panel beside it — the same
// job, at the same moment, on one screen. The card was the one that was wrong,
// and it is the half somebody reads first.
//
// The server already works the reason out as one sentence, in `whyNot`, and both
// halves now come from the same ladder. The badge is the short form; the sentence
// is the title, so hovering gives the whole of it.
const jobBadge = j => j.runnable
  ? { className: 'badge ok', textContent: 'ready' }
  : !j.there
      ? { className: 'badge bad', textContent: 'no script' }
      : j.lapsed
        ? { className: 'badge bad', textContent: 'edited' }
        : !j.approved
          ? { className: 'badge warn', textContent: 'not approved' }
          : j.missingPrompt
            ? { className: 'badge bad', textContent: 'prompt gone' }
            : { className: 'badge warn', textContent: 'prompt waiting' }

function paintJobs () {
  if (view !== 'tasks' || taskPane !== 'jobs') return
  waiting('jobs-list', { cards: 3 })
  waiting('jobs-detail', { lines: 8 })
  paintJobsNow()
}

async function paintJobsNow () {
  await settle()
  if (view !== 'tasks' || taskPane !== 'jobs') return

  api('jobs').then(v => {
    jobsNow = v.jobs || []
    promptsNow = v.prompts || []
    const shown = jobTag ? jobsNow.filter(j => (j.tags || []).includes(jobTag)) : jobsNow
    const stuck = jobsNow.filter(j => !j.runnable).length

    setText($('jobs-context'), jobsNow.length
      ? `— ${jobsNow.length}${stuck ? `, ${stuck} not runnable` : ''}`
      : '— none yet')
    setText($('jobs-note'), v.note || '')

    if (!shown.some(j => j.id === pickedJob)) {
      pickedJob = shown.length ? shown[0].id : null
      been.set('job', pickedJob)
    }

    if (changed('jobs', [shown, pickedJob, jobTag, v.tags])) {
      fill($('jobs-list'),
        // TAGS, as a filter rather than as decoration. A drill, a maintenance
        // job and a reading job want to be found separately, and a flat list of
        // forty is the state the ten drills were already in.
        (v.tags || []).length
          ? el('div', { className: 'chips' },
              el('button', {
                className: `chip linky-chip${jobTag ? '' : ' on'}`,
                textContent: `all ${jobsNow.length}`,
                onclick: () => { jobTag = null; been.set('job-tag', null); forget('jobs'); paintJobs() }
              }),
              ...v.tags.map(t => el('button', {
                className: `chip linky-chip${jobTag === t.tag ? ' on' : ''}`,
                textContent: `${t.tag} ${t.n}`,
                onclick: () => { jobTag = t.tag; been.set('job-tag', t.tag); forget('jobs'); paintJobs() }
              })))
          : null,
        shown.length
          ? shown.map(j => el('div', {
              className: `card pick${j.id === pickedJob ? ' on' : ''}`,
              onclick: () => {
                pickedJob = j.id
                been.set('job', pickedJob)
                forget('jobs'); forget('jobs-detail')
                paintJobs()
              }
            },
            el('div', { className: 'card-title' },
              el('span', { className: 'grow', textContent: j.name }),
              el('span', Object.assign(jobBadge(j), { title: j.whyNot || 'both halves are approved' }))),
            j.about ? el('div', { className: 'card-sub muted', textContent: j.about }) : null,
            el('div', { className: 'card-sub muted', textContent: `${j.lines} line${j.lines === 1 ? '' : 's'}${(j.tags || []).length ? ` · ${j.tags.join(', ')}` : ''}` })))
          : el('p', { className: 'empty', textContent: jobTag
              ? 'Nothing with that tag.'
              : 'No jobs yet. A job is a script that takes a prompt and does something with it — write one with +.' }))
    }

    const one = shown.find(j => j.id === pickedJob) || null
    if (changed('jobs-detail', one)) paintJob(one)
  }).catch(oops)
}

function paintJob (j) {
  if (!j) return fill($('jobs-detail'), el('p', { className: 'empty', textContent: 'Pick one on the left, or write one with +.' }))

  // The script is not in the list payload -- it is long and the list is a list.
  api('job', { id: j.id }).then(full => {
    fill($('jobs-detail'),
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
          // THE OTHER HALF, ONE CLICK AWAY. This line is where somebody finds
          // out that the thing stopping a run is the prompt rather than the
          // script — and until now finding out was the whole of the help: the
          // next move was to read the sentence, switch sub-tab, and pick the
          // prompt out of a list by the name they had just been shown. A panel
          // that names the obstacle should go to it.
          el('span', {}, j.prompt
            ? [
                el('button', {
                  className: 'linky',
                  textContent: j.prompt.name,
                  title: j.prompt.approved ? 'Read it' : 'Read it, and approve it if it is fit to send',
                  onclick: () => showPrompt(j.prompt.id)
                }),
                j.prompt.approved ? null : el('span', { className: 'warn', textContent: ' — not approved' })
              ]
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
                  forget('jobs'); forget('jobs-detail')
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
                  forget('jobs'); forget('jobs-detail')
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
              forget('jobs'); forget('jobs-detail')
              return draw()
            }
          })
        })),

      el('div', { style: 'margin-top:10px' }, codeBlock(full.code || '', 'javascript')))
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
      // WHAT IT ACTUALLY IS, in the dialog that asks permission for it. This
      // said "it drives the same actions a person does: it can write a task,
      // cut a branch, or borrow a machine" — true of the old jobs, which ran
      // here and were handed `okc`. A job runs on a machine now and cannot
      // reach these actions at all, which is the property that makes running
      // one safe. A confirmation is the worst place to be out of date: it is
      // the sentence somebody agrees to.
      'It runs on a machine, not here — so it cannot reach this dashboard\'s actions. It gets a shell, a worker, and a way to hand files back. Everything it says appears in the live log.',
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
      'A job is a Node script, and it runs on a machine. It is handed one object: prompt, claude, log, report, sh, artifact, gitUrl, assert, and where it is.',
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
      forget('jobs'); forget('jobs-detail')
      return draw()
    }
  })

  // Appended after the dialog is up, the way every other dialog carrying code
  // does it -- `ask` builds fields, and a code editor is not a field.
  const body = document.querySelector('.dlg-body')
  if (body) {
    body.append(el('label', { textContent: 'The script' }))
    body.append(editorBlock(j ? j.code : JOB_STARTER, 'javascript', { edit: true, onReady: ed => { editor = ed } }))
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

$('job-new').onclick = () => writeJob()


