'use strict'

// What workers remember.
//
// Part of the window. See ui/load.js for the order these are read in and why the
// order matters.
//
// THE TAB EXISTS BECAUSE THE THING IT SHOWS USED TO NOT EXIST. A machine is
// rolled back when its work ends, and a worker's memory went with it -- so a
// task given out twice was two strangers rather than one worker having a second
// go. It is copied here when a run ends and put back before the next one starts;
// this is where you can see that happening, and stop it when a conversation has
// gone somewhere you do not want it carrying on from.
//
// One sub-tab today. It is a sub-tab rather than a bare pane because there is
// more than one kind of memory in this system already -- a machine's own state,
// a workspace's -- and the one being shown should say which it is rather than
// being "sessions, obviously".
let pickedSession = been.get('session', null)

function paintSessions () {
  if (view !== 'sessions') return
  waiting('sessions-list', { cards: 3 })
  waiting('session-detail', { lines: 6 })
  paintSessionsNow()
}

async function paintSessionsNow () {
  await settle()
  if (view !== 'sessions') return

  api('sessions').then(({ sessions, bytes, note }) => {
    if (!sessions.some(s => s.uid === pickedSession)) {
      pickedSession = sessions.length ? sessions[0].uid : null
      been.set('session', pickedSession)
    }

    setText($('sessions-context'), sessions.length
      ? `— ${sessions.length}, ${bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`}`
      : '— none yet')
    setText($('sessions-note'), note)

    if (changed('sessions', [sessions, pickedSession])) {
      fill($('sessions-list'), sessions.length
        ? sessions.map(s => el('div', {
            className: `card pick${s.uid === pickedSession ? ' on' : ''}`,
            onclick: () => {
              pickedSession = s.uid
              been.set('session', pickedSession)
              forget('sessions'); forget('session-detail')
              paintSessions()
            }
          },
          el('div', { className: 'card-title' },
            el('span', { className: 'grow', textContent: s.number ? `#${s.number} ${s.title || s.task || ''}`.trim() : (s.taskId || s.uid) }),
            // A task that was thrown away leaves its memory behind on purpose --
            // what was produced outlives the note about it. Said, because a row
            // pointing at nothing otherwise reads as a fault.
            s.orphaned ? el('span', { className: 'badge muted', textContent: 'task gone' }) : null),
          el('div', { className: 'card-sub muted', textContent: `${s.runs || 1} run${s.runs === 1 ? '' : 's'} · ${s.bytes >= 1048576 ? `${(s.bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(s.bytes / 1024))} KB`}` }),
          el('div', { className: 'card-sub muted', textContent: `last kept ${ago(s.kept)}${s.machine ? ` from ${s.machine}` : ''}` })))
        : el('p', { className: 'empty', textContent: 'Nothing yet. A worker started by a job hands its memory back when it finishes, and gets it again the next time that task runs.' }))
    }

    const one = sessions.find(s => s.uid === pickedSession) || null
    if (changed('session-detail', one)) paintSession(one)
  }).catch(oops)
}

function paintSession (s) {
  if (!s) return fill($('session-detail'), el('p', { className: 'empty', textContent: 'Pick one on the left.' }))

  fill($('session-detail'),
    el('div', { className: 'card-title' },
      el('span', { className: 'grow', textContent: s.number ? `#${s.number} ${s.title || ''}`.trim() : (s.taskId || s.uid) }),
      el('span', { className: 'badge ok', textContent: `${s.runs || 1} run${s.runs === 1 ? '' : 's'}` })),

    el('table', { className: 'kv' },
      // WHICH CONVERSATION, spelled out, because it is the value a run is
      // resumed with and the one thing somebody would want to check against a
      // transcript by hand.
      el('tr', {}, el('th', { textContent: 'conversation' }),
        el('td', { className: 'mono', style: 'user-select:text', textContent: s.id || 'not recorded' })),
      el('tr', {}, el('th', { textContent: 'task' }),
        el('td', { className: 'mono', textContent: s.taskId || '—' })),
      el('tr', {}, el('th', { textContent: 'branch' }),
        el('td', { className: 'mono', textContent: s.branch || '—' })),
      el('tr', {}, el('th', { textContent: 'last machine' }),
        el('td', { className: 'mono', textContent: s.machine || '—' })),
      el('tr', {}, el('th', { textContent: 'last run' }),
        el('td', { className: 'mono', textContent: s.run || '—' })),
      el('tr', {}, el('th', { textContent: 'folder' }),
        el('td', { className: 'mono', style: 'user-select:text', textContent: s.folder || '—' })),
      el('tr', {}, el('th', { textContent: 'first kept' }),
        el('td', { textContent: s.first ? ago(s.first) : '—' })),
      el('tr', {}, el('th', { textContent: 'last kept' }),
        el('td', { textContent: ago(s.kept) })),
      el('tr', {}, el('th', { textContent: 'size' }),
        el('td', { textContent: s.bytes >= 1048576 ? `${(s.bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(s.bytes / 1024))} KB` })),
      el('tr', {}, el('th', { textContent: 'kept at' }),
        el('td', { className: 'mono', style: 'user-select:text', textContent: s.path }))),

    // WHAT THE WORKER ACTUALLY DID, which is the question a run's log cannot
    // answer. Read out of the archive once, when it arrived -- see `look` in
    // tasks/sessions.js -- so this panel is reading a small object rather than
    // gunzipping ninety kilobytes on a three-second draw loop.
    s.inside
      ? el('div', {},
          el('h2', { textContent: 'What it did' }),
          s.inside.unreadable
            ? el('p', { className: 'note warn', textContent: `The archive is kept, and could not be read to summarise: ${s.inside.unreadable}` })
            : el('table', { className: 'kv' },
              el('tr', {}, el('th', { textContent: 'turns' }),
                el('td', { textContent: `${s.inside.turns}${s.inside.errors ? ` — ${s.inside.errors} of them an API error` : ''}` })),
              el('tr', {}, el('th', { textContent: 'model' }),
                el('td', { className: 'mono', textContent: s.inside.model || 'not recorded' })),
              el('tr', {}, el('th', { textContent: 'tools' }),
                el('td', { textContent: (s.inside.tools || []).length
                  ? s.inside.tools.map(t => `${t.name} ×${t.n}`).join(', ')
                  : 'it ran nothing' })),
              el('tr', {}, el('th', { textContent: 'files touched' }),
                el('td', { className: 'mono', style: 'user-select:text', textContent: (s.inside.touched || []).length
                  ? s.inside.touched.join(', ') + (s.inside.moreTouched ? ` and ${s.inside.moreTouched} more` : '')
                  : 'none' })),
              // Cache reads dwarf the rest by two orders of magnitude and that
              // is the ordinary shape of a resumed conversation -- said plainly
              // so it does not read as a fault.
              el('tr', {}, el('th', { textContent: 'tokens' }),
                el('td', { textContent: s.inside.tokens
                  ? `${s.inside.tokens.in} in, ${s.inside.tokens.out} out, ${s.inside.tokens.cache.toLocaleString()} read from cache`
                  : 'not recorded' })),
              el('tr', {}, el('th', { textContent: 'talked for' }),
                el('td', { textContent: s.inside.from && s.inside.to
                  ? `${Math.max(1, Math.round((Date.parse(s.inside.to) - Date.parse(s.inside.from)) / 1000))}s, ending ${ago(s.inside.to)}`
                  : 'not recorded' })),
              el('tr', {}, el('th', { textContent: 'transcript' }),
                el('td', { className: 'mono', style: 'user-select:text', textContent: s.inside.transcript || '—' }))))
      : null,

    el('h2', { textContent: 'The archive' }),
    el('p', { className: 'note', textContent: 'The whole of the worker\'s ~/.claude, as a gzip — the transcript, which project folder it belongs to, and its settings. It is unpacked onto whichever machine picks this task up next, so the worker carries on instead of meeting the work again.' }),
    el('p', { className: 'note', textContent: 'The credential is deliberately not in it. A machine is handed one on its way up and it is taken back on the way down; a copy riding along in here would be an unsealed one per task.' }),

    el('div', { className: 'row', style: 'margin-top:10px' },
      el('button', {
        className: 'btn small',
        textContent: 'Show in folder',
        title: 'Open the folder it is kept in',
        onclick: () => { if (!host.showInFolder(s.path)) say('This window cannot open a file manager here.', 'bad') }
      }),
      s.taskId
        ? el('button', {
            className: 'btn small',
            textContent: 'Go to the task',
            onclick: () => { pickedTask = s.taskId; been.set('task', pickedTask); showTab('tasks'); return draw() }
          })
        : null,
      el('button', {
        className: 'btn small danger',
        textContent: 'Forget it',
        onclick: () => ask({
          title: `Forget what #${s.number || s.taskId} remembers?`,
          plain: [
            'The next run of this task starts a fresh conversation, with no memory of the ones before it.',
            'The task, its branch, the files it handed over and its logs are all untouched.'
          ],
          cost: 'The transcript of everything this worker was told and decided is deleted from this host, and the machines that made it are long gone.',
          confirm: 'Forget it',
          danger: true,
          onYes: async () => {
            await api('sessionForget', { id: s.taskId })
            say('Forgotten. The next run starts fresh.', 'warn')
            pickedSession = null
            forget('sessions'); forget('session-detail')
            return draw()
          }
        })
      })))
}
