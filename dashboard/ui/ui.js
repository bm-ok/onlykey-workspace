'use strict'

// The window. Three tabs: the machines, the live log, and every action the server
// has. How a machine gets set up is not one of them -- that is internal, and lives
// in provision/ as shell scripts.
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
const app = require('./server')
const liveLog = require('./core/log')

const api = async (name, args = {}) => {
  const action = app.actions[name]
  if (!action) throw new Error(`No action called "${name}"`)
  return action.run(args)
}

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

const setText = (node, text) => { if (node.textContent !== text) node.textContent = text }

// Everything any machine panel reads, including what its click handlers close
// over: `running` decides whether a button starts or stops, and `description`
// is carried into the configure dialog.
const vmKey = v => v && [v.name, v.state, v.stage, v.live, v.running, v.connected, v.baseSnapshot, v.description || '', v.branch || '']

// ---- the notice bar ---------------------------------------------------

let noticeTimer
function say (text, kind = 'ok') {
  const bar = $('notice')
  bar.className = `notice ${kind}`
  fill(bar,
    el('span', { textContent: text }),
    el('button', { className: 'notice-x', textContent: '×', onclick: () => bar.classList.add('hidden') }))
  clearTimeout(noticeTimer)
  if (kind === 'ok') noticeTimer = setTimeout(() => bar.classList.add('hidden'), 6000)
}
const oops = e => say(e.message, 'bad')

// ---- tabs -------------------------------------------------------------

let view = 'ops'
document.querySelectorAll('.tab').forEach(b => {
  b.onclick = () => {
    view = b.dataset.view
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === b))
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`))
    if (view === 'live') clearBadge()
  }
})
const showTab = name => document.querySelector(`.tab[data-view="${name}"]`).click()

// ---- the dialog ------------------------------------------------------
//
// One dialog, used by everything. In-page rather than native confirm() because it
// carries what a native one cannot: what the action does in plain words, what it
// costs when that cannot be undone, and any fields it needs. A confirm() would
// reduce all of that to a sentence and an OK button.

// `extra` is a second way out: one more button beside the confirm, for a dialog
// where the other thing you might have come to do is not a variation of the
// confirm but its opposite. It closes this dialog and does its own asking, so
// something irreversible still states its cost on its own screen rather than
// borrowing the consent given to whatever was on this one.
function ask ({ title, plain, cost, fields = [], confirm, danger, onYes, extra }) {
  const errBox = el('p', { className: 'dlg-err hidden' })
  const inputs = {}

  const yes = el('button', { className: `btn ${danger ? 'danger' : 'ok'}`, textContent: confirm })
  const no = el('button', { className: 'btn', textContent: 'Never mind' })
  const other = extra
    ? el('button', {
        className: `btn ${extra.danger ? 'danger' : ''}`,
        textContent: extra.label,
        onclick: () => { close(); extra.onClick() }
      })
    : null

  const overlay = el('div', { className: 'dlg-overlay' },
    el('div', { className: 'dlg' },
      el('div', { className: 'dlg-title', textContent: title }),
      plain && plain.length
        ? el('div', {},
            el('div', { className: 'dlg-heading', textContent: 'What this does' }),
            el('ul', {}, ...plain.map(p => el('li', { textContent: p }))))
        : null,
      cost ? el('div', { className: 'dlg-cost' }, el('strong', { textContent: 'Cannot be undone: ' }), cost) : null,
      ...fields.map(f => {
        // A list of real choices beats a path to type out, and it cannot be typed
        // wrong.
        const input = f.options
          ? el('select', {}, ...f.options.map(o =>
              el('option', { value: o.value, textContent: o.label, selected: o.value === f.value })))
          : el('input', { placeholder: f.placeholder || '', value: f.value || '', type: f.type || 'text' })
        inputs[f.name] = input
        return el('div', {}, el('label', { textContent: f.label }), input)
      }),
      errBox,
      el('div', { className: 'dlg-actions' }, no, other, yes)))

  const close = () => overlay.remove()
  no.onclick = close
  overlay.onclick = e => { if (e.target === overlay) close() }
  yes.onclick = async () => {
    yes.disabled = true
    try {
      const values = {}
      for (const k in inputs) values[k] = inputs[k].value.trim()
      await onYes(values)
      close()
      await draw()
    } catch (e) {
      errBox.textContent = e.message
      errBox.classList.remove('hidden')
      yes.disabled = false
    }
  }
  document.body.append(overlay)
  const first = Object.values(inputs)[0]
  ;(first || yes).focus()
}

// A picture, shown at the size it was taken and no larger.
//
// Read here rather than sent through the action, because this window is on the
// same machine that wrote the file -- so the action returns a path, which is
// what the command line wants anyway, and the two callers each take the form
// that suits them instead of one carrying a megabyte of base64 for the other.
//
// A data URI rather than file://, which an app page loaded from disk treats as a
// different origin and refuses often enough not to rely on.
function showImage ({ title, file, note }) {
  const fsMod = require('node:fs')
  let src
  try {
    src = `data:image/png;base64,${fsMod.readFileSync(file).toString('base64')}`
  } catch (e) {
    return oops(new Error(`The picture was taken but could not be read back: ${e.message}`))
  }

  const close = () => overlay.remove()
  const overlay = el('div', { className: 'dlg-overlay' },
    el('div', { className: 'dlg', style: 'max-width: 90vw' },
      el('div', { className: 'dlg-title', textContent: title }),
      el('img', { src, style: 'max-width:100%; max-height:70vh; display:block; border:1px solid var(--line); border-radius:6px' }),
      // Said, and selectable, because the whole point of keeping the file is
      // being able to go and find it.
      el('p', { className: 'note mono', style: 'margin-top:10px; user-select:text', textContent: file }),
      note ? el('p', { className: 'note', textContent: note }) : null,
      el('div', { className: 'dlg-actions' }, el('button', { className: 'btn', textContent: 'Close', onclick: close }))))

  overlay.onclick = e => { if (e.target === overlay) close() }
  document.body.append(overlay)
}

// ---- the machines ----------------------------------------------------
//
// Only machines this app made ever appear here. Anything else on the host is
// invisible to every action, because these actions can delete one.

let picked = null
let latest = { available: false, vms: [] }

// What the machine is holding, said in the dialog that would destroy it.
//
// Asked first and awaited, so the sentence is in front of the person BEFORE they
// decide rather than in the log afterwards. It costs a second on a machine that
// is dialled in and nothing at all on one that is not.
//
// Three different sentences, because there are three different situations and
// only one of them is "nothing to lose". A machine that could not be asked is
// the important one: it is off, which is exactly the state of a machine nobody
// has looked at recently, and reporting that as "nothing" would be this app
// asserting something it never checked.
const holdingLine = holds => holds.asked
  ? (holds.summary ? `${holds.summary} — all of it goes.` : 'It is holding nothing that is not already here.')
  : `It could not be asked what it is holding: ${holds.why} So this may be discarding work that exists nowhere else.`

const deleteVm = v => api('vmHolds', { name: v.name })
  .catch(() => ({ asked: false, why: 'asking it failed.' }))
  .then(holds => ask({
    title: `Delete ${v.name}?`,
    plain: [
      'No other virtual machine on this computer is touched.',
      holdingLine(holds)
    ],
    cost: `${v.name} and its disks are deleted, and it is removed from this list.`,
    confirm: 'Delete it',
    danger: true,
    onYes: () => api('vmRemove', { name: v.name }).then(() => {
      if (picked === v.name) picked = null
      say(`${v.name} deleted`)
    })
  }))

// What a machine is for is the question a column of names cannot answer, and it is
// not derivable from anything -- so it is asked for and kept, and it belongs on the
// row rather than behind a selection.
const configVm = v => ask({
  title: `Configure ${v.name}`,
  plain: [
    'The note is yours: it appears beside this machine in the list and changes nothing about the machine.',
    'Everything else about a machine is settled when it is made.'
  ],
  fields: [{ name: 'description', label: 'Note', value: v.description || '', placeholder: 'what this one is for' }],
  confirm: 'Save',
  // Deleting is the other reason to open this, and it is deliberately not the
  // confirm: it asks again on its own screen, where it can state what it costs.
  extra: { label: 'Delete it', danger: true, onClick: () => deleteVm(v) },
  onYes: f => api('vmDescribe', { name: v.name, description: f.description })
    .then(() => say(f.description ? `Note saved for ${v.name}` : `Note cleared for ${v.name}`))
})

// The card carries identity, its note, state, and the way in to both settling that
// note and deleting it. Everything else lives in the one Actions panel rather than
// being repeated per row.
const vmCard = v => el('div', {
  className: `card pick${picked === v.name ? ' on' : ''}`,
  onclick: () => { picked = v.name; paintVms() }
},
  el('div', { className: 'card-title' },
    el('span', { className: 'mono', textContent: v.name }),
    el('button', {
      className: 'cog',
      title: `Configure ${v.name}`,
      textContent: '⚙',
      // Or selecting the row would also fire, and a click meant for this would
      // change what the panels are pointing at underneath the dialog.
      onclick: e => { e.stopPropagation(); configVm(v) }
    })),
  v.description ? el('div', { className: 'card-sub', textContent: v.description }) : null,
  el('div', { className: 'badges' },
    el('span', { className: `badge ${v.running ? 'ok' : ''}`, textContent: v.running ? 'running' : v.state }),
    // Two badges, not three. There was a separate "connected" one beside this,
    // on the condition `v.connected` -- but the stage IS "connected" whenever
    // that is true, since stageOf tests the channel before anything else. So it
    // never read as emphasis, only ever as the same word twice in a row. What
    // the extra badge was carrying was its colour, and dialled in being a
    // stronger statement than running is worth the green, so the stage takes it.
    el('span', {
      className: `badge ${v.stage === 'connected' || v.stage === 'ready' ? 'ok' : v.stage === 'defined' ? 'bad' : 'run'}`,
      textContent: v.stage
    })))

function vmActions () {
  const box = $('machine-actions')
  const v = latest.vms.find(x => x.name === picked)
  const go = (name, args, msg) => () => { showTab('live'); api(name, args).then(() => { say(msg); return draw() }).catch(oops) }

  setText($('actions-context'), v ? `— ${v.name}` : '— nothing selected')
  if (!v) {
    if (changed('actions', null)) fill(box, el('p', { className: 'empty', textContent: 'Pick a machine on the left, or make one with the + above it.' }))
    return
  }

  // Every button below is built from these: `running`, `live` and `baseSnapshot`
  // decide what is shown and what is disabled, and `running` is also read by a
  // click handler, where it picks between stopping and starting. A button left
  // standing with a stale one would do the wrong thing without saying so, which
  // is why the signature is the whole of vmKey rather than only what is visible.
  if (!changed('actions', vmKey(v))) return

  fill(box, el('div', { className: 'row' },
    el('button', {
      className: 'btn ok',
      textContent: v.running ? 'Shut it down' : 'Start it',
      disabled: !v.live,
      title: v.live ? '' : 'VirtualBox has no machine by this name any more',
      onclick: go(v.running ? 'vmStop' : 'vmStart', { name: v.name }, v.running ? 'Asked it to shut down' : 'Starting it')
    }),

    v.running
      ? el('button', {
          className: 'btn danger',
          textContent: 'Power off',
          onclick: () => ask({
            title: `Pull the power on ${v.name}?`,
            plain: ['This is the plug, not the button.'],
            cost: 'Anything it was part-way through writing may be left unfinished.',
            confirm: 'Power off',
            danger: true,
            onYes: () => api('vmStop', { name: v.name, force: true })
          })
        })
      : null,

    // A snapshot with no title is one nobody can choose between later, so the
    // title is asked for rather than generated.
    el('button', {
      className: 'btn',
      textContent: 'Take a snapshot',
      // Off only. A running machine would have its memory stored too, and the
      // server refuses it for that reason -- this is the same rule said early, so
      // the answer arrives before the dialog is filled in rather than after.
      disabled: !v.live || v.running,
      title: v.running ? 'Shut it down first — a snapshot of a running machine stores its memory too, which makes it enormous' : '',
      onclick: () => ask({
        title: `Snapshot ${v.name}`,
        plain: ['A snapshot is a point you can come back to.', 'Taking one changes nothing about the machine as it is now.'],
        fields: [
          { name: 'title', label: 'Title for this snapshot', value: v.baseSnapshot ? '' : 'base', placeholder: 'clean install' },
          { name: 'description', label: 'What is true at this point — optional', placeholder: 'operating system installed, nothing else' }
        ],
        confirm: 'Take it',
        onYes: f => api('vmSnapshotTake', { name: v.name, title: f.title, description: f.description })
          .then(() => say(`Snapshot "${f.title}" taken`))
      })
    }),

    // "Install the operating system" and "Set it up again" were here. Both remain
    // as actions -- vmInstall and vmSetupAgain -- and the All actions tab still
    // lists them, because removing a button is not the same as removing what it
    // did. Making a machine still installs on its own, which was always the path
    // these two were the retry for.

    // Only when it is dialled in, because that is where the address comes from.
    // Disabled rather than hidden while it is not: a button that vanishes reads
    // as a feature that does not exist, and the reason is worth saying.
    // The only way to see a machine that is not talking yet -- which is most of
    // an install, and exactly when somebody wants to know whether it is working.
    el('button', {
      className: 'btn',
      textContent: 'See its screen',
      disabled: !v.running,
      title: v.running ? '' : 'It has to be running to have a screen',
      onclick: () => api('vmScreenshot', { name: v.name })
        .then(r => showImage({
          title: `${v.name}, just now`,
          file: r.file,
          note: 'Kept, not just shown — the path is in the live log too.'
        }))
        .catch(oops)
    }),

    // ONE button, and it asks a question only once.
    //
    // A machine on a branch stays on it until it is clean, so there is nothing
    // to decide on the way back in: opening again just opens. There was briefly
    // a second button for moving to another branch, and it was a mistake --
    // switching is how half-finished work stops being anywhere, sitting on a
    // branch the machine may no longer push with nothing saying so. The way off
    // a branch is back to a snapshot from before it, which is an action that
    // states what it discards.
    //
    // The setup still runs on the way in, because it is safe to -- it never
    // resets the machine's copy -- and it repairs a workspace that is not there,
    // which is exactly the state a machine is in after being rolled back.
    v.connected && v.branch
      ? el('button', {
          className: 'btn',
          textContent: 'Open in VS Code',
          title: `${v.name} is on ${v.branch}, and stays there until it is clean`,
          onclick: () => {
            showTab('live')
            return api('vmWorkspace', { name: v.name, branch: v.branch })
              .then(() => api('vmEditor', { name: v.name }))
              .then(r => say(`${v.name} is on ${v.branch} — VS Code opened ${r.opened}`))
              .catch(oops)
          }
        })
      : el('button', {
          className: 'btn',
          textContent: 'Open in VS Code',
          disabled: !v.connected,
          title: v.connected ? '' : 'It has to be dialled in — that is where its address comes from',
          onclick: () => api('gitBranches').then(({ repos, branches }) => {
            // Two questions, kept apart, because the way out of each is
            // different. A branch may not be AVAILABLE -- protected, or another
            // machine has it -- and then the answer is to pick another one. Or
            // it may not be RECLAIMABLE, meaning a checkout here has uncommitted
            // work in it, and then the answer is in that working tree and this
            // choice was fine.
            const open = branches.filter(b => b.usable)
            const taken = branches.filter(b => !b.available)
            const stuck = branches.filter(b => b.available && !b.reclaimable)

            return ask({
              title: `Open ${v.name} in VS Code?`,
              plain: [
                `It sets up a workspace on ${v.name} holding ${repos.length ? repos.join(', ') : 'the workspace repositories'}, all on one branch, pointed back here.`,
                'Pick a branch to carry on with, or type a name to start new work.',
                'Nothing lands on a default branch: the branch is cut here first and the machine arrives with it already checked out.',
                // Asked once, and said so while it is still a free choice. After
                // this the machine is on that branch until it is rolled back to a
                // point from before it, which is the only way off.
                `${v.name} stays on whichever you pick until it goes back to a snapshot from before it.`,
                // What is missing from the list, and why -- otherwise a branch
                // somebody knows exists is simply absent, which reads as a bug.
                ...taken.map(b => b.protected
                  ? `${b.name} is not offered: it is the default branch, and work is merged into it here rather than done on it.`
                  : `${b.name} is not offered: ${b.heldBy} is working on it.`),
                // Said differently on purpose. This one is not about the branch
                // at all -- it is available, and something in a working tree
                // here is in the way of using it.
                ...stuck.map(b => `${b.name} is free, but ${b.blocked.join(' ')}`),
                'Then a new window opens on it; this one is not replaced.'
              ],
              fields: [
                {
                  name: 'existing',
                  label: open.length ? 'Carry on with' : 'Nothing to carry on with — type a name below',
                  value: '',
                  options: [
                    { value: '', label: open.length ? '— start a new one —' : 'none available' },
                    ...open.map(b => ({
                      value: b.name,
                      // What a name means is which repositories are on it, so
                      // that is said here rather than discovered after picking.
                      label: b.missing.length ? `${b.name} — in ${b.in.join(', ')}` : `${b.name} — all of them`
                    }))
                  ]
                },
                { name: 'fresh', label: 'Or a new branch', placeholder: 'fix/the-thing' }
              ],
              confirm: 'Set it up and open it',
              onYes: async f => {
                const branch = f.fresh.trim() || f.existing
                if (!branch) throw new Error('Pick a branch to carry on with, or type a name for a new one.')

                showTab('live')
                // Two calls, because they fail differently and only one of them
                // is slow: setting up clones over the network, opening does not.
                // If the setup fails there is nothing worth opening, and the
                // reason is in the log rather than behind an editor window.
                const w = await api('vmWorkspace', { name: v.name, branch })
                const r = await api('vmEditor', { name: v.name })
                say(`${v.name} is on ${w.branch} — VS Code opened ${r.opened}`)
              }
            })
          }).catch(oops)
        }),

    v.live && !v.baseSnapshot
      ? el('button', {
          className: 'btn',
          textContent: 'Make a clean starting point',
          onclick: () => ask({
            title: `Snapshot ${v.name} as a clean starting point?`,
            plain: [
              'It shuts the machine down, takes the snapshot, and starts it again.',
              'Shut down first because that is what makes the snapshot small and clean — a running one would store its memory too.',
              'Afterwards you can return the machine to exactly this state whenever you like.'
            ],
            fields: [{ name: 'title', label: 'Call it', value: 'base' }],
            confirm: 'Do it',
            onYes: f => {
              showTab('live')
              return api('vmBaseSnapshot', { name: v.name, title: f.title || 'base' })
                .then(() => say(`"${f.title || 'base'}" taken; ${v.name} can be returned to it`))
            }
          })
        })
      : null,

    el('button', { className: 'btn danger', textContent: 'Delete it', onclick: () => deleteVm(v) })))
}

// Listed rather than hidden behind a dialog, because which snapshots exist is the
// question you have before you decide to restore one.
async function paintSnapshots () {
  const v = latest.vms.find(x => x.name === picked)
  if (!v || !v.live) {
    setText($('snap-context'), '')
    if (changed('snapshots', null)) fill($('snapshots'), el('p', { className: 'empty', textContent: 'No machine selected.' }))
    return
  }

  let s
  try {
    s = await api('vmSnapshots', { name: v.name })
  } catch {
    setText($('snap-context'), '')
    if (changed('snapshots', 'unreadable')) fill($('snapshots'), el('p', { className: 'empty', textContent: 'Could not read its snapshots.' }))
    return
  }

  setText($('snap-context'), `— ${s.snapshots.length}`)
  // `running` is in here because the buttons below are disabled by it. It is not
  // shown anywhere in this panel, which is exactly why it is easy to leave out --
  // and leaving it out would freeze the buttons in whatever state the machine
  // was in when the list was last drawn.
  if (!changed('snapshots', [v.name, v.running, s])) return

  fill($('snapshots'), s.snapshots.length
    ? s.snapshots.map(x => el('div', { className: 'card' },
        el('div', { className: 'card-title' },
          el('span', { className: 'mono', textContent: x.name }),
          x.name === s.current ? el('span', { className: 'badge run', textContent: 'on this one' }) : null),
        el('div', { className: 'row', style: 'margin-top:8px' },
          el('button', {
            className: 'btn',
            textContent: 'Go back to it',
            // VirtualBox will not restore under a running machine, and the
            // server says so -- but only after the dialog has been read and
            // confirmed, which is the wrong end. Said here instead, before the
            // question about discarding work has even been asked.
            disabled: v.running,
            title: v.running ? 'Shut it down first — VirtualBox will not restore a snapshot while it is running' : '',
            onclick: () => api('vmHolds', { name: v.name })
              .catch(() => ({ asked: false, why: 'asking it failed.' }))
              .then(holds => ask({
              title: `Go back to "${x.name}"?`,
              plain: [
                'The machine must be shut down for this.',
                // The same sentence the delete dialog uses, for the same reason:
                // this discards the disk, and what is on the disk is the
                // question. A machine that has to be shut down before restoring
                // is often already off, which is precisely when it cannot be
                // asked -- so that case says so rather than saying nothing.
                holdingLine(holds),
                // The permission moves with the disk, and it is not obvious that
                // it does. Worth saying here, because going back to a point from
                // before any work started is how a machine ends up allowed to
                // push a branch it no longer has.
                `What ${v.name} is allowed to push goes back with it — to whatever was set when "${x.name}" was taken.`
              ],
              cost: `Everything that changed on ${v.name} since "${x.name}" is discarded.`,
              confirm: 'Go back to it',
              danger: true,
              onYes: () => api('vmSnapshotRestore', { name: v.name, title: x.name })
                .then(r => say(r.branch
                  ? `Back at "${x.name}" — ${v.name} may push ${r.branch}`
                  : `Back at "${x.name}" — ${v.name} may push nothing until it is set up again`))
              })).catch(oops)
          }))))
    : el('p', { className: 'empty', textContent: 'None yet.' }))
}

function paintDetails () {
  const v = latest.vms.find(x => x.name === picked)
  const box = $('details')
  if (!v) {
    if (changed('details', null)) fill(box, el('p', { className: 'empty', textContent: 'No machine selected.' }))
    return
  }

  const spec = v.spec || {}
  const rows = [
    ['stage', v.stage],
    ['state', v.state],
    ['made', new Date(v.created).toLocaleString()],
    ['snapshot to reset to', v.baseSnapshot || 'none yet'],
    // What it may push, which is a different question from what it has checked
    // out -- that one only the machine knows, and this is the one that is
    // enforced.
    ['may push', v.branch || 'nothing yet'],
    ['last heard from', v.reported ? new Date(v.reported).toLocaleString() : 'never'],
    ['memory', `${spec.memoryMB} MB`],
    ['processors', String(spec.cpus)],
    ['disk', `${Math.round((spec.diskMB || 0) / 1024)} GB`],
    ['network', spec.network === 'bridged' ? `bridged${spec.bridge ? ` on ${spec.bridge}` : ''}` : `nat, ssh on 127.0.0.1:${spec.sshPort}`],
    ['user', spec.user],
    ['installer image', spec.iso ? spec.iso.split(/[\\/]/).pop() : 'none'],
    ['hostname', spec.hostname]
  ]

  if (v.connected && v.agent) {
    const facts = v.agent.facts || {}
    rows.push(
      ['dialled in', `${new Date(v.agent.since).toLocaleTimeString()}, from ${v.agent.from}`],
      ['it says it is', facts.hostname ? `${facts.hostname} — ${facts.system || ''}` : 'unknown'],
      ['its addresses', (facts.addresses || []).join(', ') || 'unknown'])
  }

  // The rows themselves are the signature: they are already the finished strings,
  // so nothing this panel shows can move without the signature moving with it.
  // This is the table people copy values out of, so it must hold still.
  if (!changed('details', [v.name, rows])) return

  fill(box, el('table', { className: 'kv' }, ...rows.map(([k, val]) =>
    el('tr', {}, el('th', { textContent: k }), el('td', { className: 'mono', textContent: String(val) })))))
}

function paintVms () {
  // `picked` is in the signature because it decides which card is highlighted.
  if (changed('vms', [latest.available, picked, latest.vms.map(vmKey)])) {
    fill($('vms'), latest.vms.length
      ? latest.vms.map(vmCard)
      : el('p', { className: 'empty', textContent: latest.available ? 'None yet. The + above makes one.' : 'VirtualBox was not found.' }))
  }
  vmActions()
  paintDetails()
  paintSnapshots().catch(() => {})
}

// The settings are the previous version's, which were arrived at by running it:
// 8 GB, 4 cpus, 60 GB, a named LTS image type, and bridged networking so the
// guest can reach this app to fetch its scripts.
$('add-vm-open').onclick = () => Promise.all([api('vmIsos'), api('hostKeys')]).then(([isos, { keys }]) => ask({
  title: 'Make a virtual machine',
  plain: [
    'It makes the machine and its disk, then starts it and installs the operating system on its own.',
    'As that finishes it fetches its own setup scripts from here and runs them, reporting into the live log.',
    'It takes a long while, and a window will open so you can watch.',
    'Only machines made here ever appear in this list, and nothing else on this computer is touched.'
  ],
  fields: [
    { name: 'name', label: 'Name', placeholder: 'dev1' },
    {
      name: 'iso',
      label: isos.length ? 'Installer image' : 'Installer image — VirtualBox knows of none, so type a path',
      value: isos.length ? isos[0].location : '',
      options: isos.length ? [{ value: '', label: 'none for now' }, ...isos.map(i => ({ value: i.location, label: i.name }))] : undefined,
      placeholder: 'C:\\path\\to\\ubuntu.iso'
    },
    { name: 'memoryMB', label: 'Memory, in MB', value: '8192', type: 'number' },
    { name: 'cpus', label: 'Processors', value: '4', type: 'number' },
    { name: 'diskMB', label: 'Disk, in MB', value: '61440', type: 'number' },
    {
      name: 'network',
      label: 'Network',
      value: 'bridged',
      options: [
        { value: 'bridged', label: 'bridged — it can reach this app' },
        { value: 'nat', label: 'nat — private, with a forwarded ssh port' }
      ]
    },
    { name: 'user', label: 'User to create', value: 'okc' },
    { name: 'password', label: 'Its password', value: 'okc' },
    {
      name: 'sshKey',
      label: keys.length ? 'Authorise one of your ssh keys on it' : 'Your public ssh key — none found on this machine, so paste one',
      value: keys.length ? keys[0].key : '',
      options: keys.length
        ? [...keys.map(k => ({ value: k.key, label: `${k.file} — ${k.comment}` })), { value: '', label: 'none, use the password' }]
        : undefined,
      placeholder: 'ssh-ed25519 AAAA...'
    }
  ],
  confirm: 'Make it',

  // Make, then install. Two actions rather than one, because they fail differently
  // and the second is the one that takes half an hour: if the install will not
  // start, the machine still exists and the button to try again is right there.
  onYes: async f => {
    showTab('live')
    await api('vmCreate', { vm: { ...f, memoryMB: Number(f.memoryMB), cpus: Number(f.cpus), diskMB: Number(f.diskMB) } })
    picked = f.name

    if (!f.iso) {
      say(`${f.name} made. It has no installer image, so there is nothing to install yet.`)
      return
    }

    await api('vmInstall', { name: f.name })
    say(`${f.name} is installing and will set itself up. Watch it here.`)
  }
})).catch(oops)

// ---- All actions -----------------------------------------------------

async function paintActions () {
  const { actions } = await api('actions')
  fill($('action-list'), actions.map(a => el('div', { className: 'act' },
    el('code', { textContent: a.name }),
    el('span', { className: 'about', textContent: a.about }),
    el('span', { className: 'takes', textContent: a.takes.length ? a.takes.join(', ') : '' }))))
}

// ---- Live ------------------------------------------------------------

const lines = []
const off = new Set()
let follow = true
let find = ''
let unseen = 0
let unseenBad = false

const clearBadge = () => {
  unseen = 0
  unseenBad = false
  $('live-badge').classList.add('hidden')
}

const shown = e => !e.tags.some(t => off.has(t)) &&
  (!find || e.text.toLowerCase().includes(find) || e.tags.some(t => t.includes(find)))

const lineNode = e => el('div', { className: `line ${e.level}` },
  el('span', { className: 't', textContent: e.at.slice(11, 19) }),
  el('span', { className: 'g', textContent: e.tags.join(' ') }),
  el('span', { className: 'm', textContent: e.text }))

function paintLog () {
  const box = $('live')
  const visible = lines.filter(shown)
  const slice = visible.slice(-800)

  // An entry never changes after it is logged, so the ids in view say exactly
  // what is drawn. Worth guarding twice over: this runs per line rather than per
  // poll, and refilling the box also sent the scrollback to the top, so reading
  // anything above the fold during an install was impossible.
  if (changed('log', slice.map(e => e.id))) {
    fill(box, slice.map(lineNode))
    if (follow) box.scrollTop = box.scrollHeight
  } else if (follow) {
    box.scrollTop = box.scrollHeight
  }

  setText($('live-context'), `— ${visible.length} of ${lines.length} lines`)

  const counts = new Map()
  for (const e of lines) for (const t of e.tags) counts.set(t, (counts.get(t) || 0) + 1)
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1])
  if (!changed('logTags', [ordered, [...off].sort()])) return

  fill($('log-tags'), ordered
    .map(([tag, n]) => el('button', {
      className: 'chip' + (off.has(tag) ? '' : ' on'),
      onclick: () => { off.has(tag) ? off.delete(tag) : off.add(tag); paintLog() }
    }, tag, el('b', { textContent: String(n) }))))
}

$('log-follow').onchange = e => { follow = e.target.checked; paintLog() }
$('log-find').oninput = e => { find = e.target.value.trim().toLowerCase(); paintLog() }
$('log-clear').onclick = () => api('logClear').then(() => { lines.length = 0; paintLog() }).catch(oops)

// Anything that happened to a machine may have changed what the list should say --
// a guest reporting in, a machine starting, one being deleted from elsewhere. It
// was only guest lines before, so a machine deleted by another client sat in the
// list looking alive until something else forced a redraw.
//
// Debounced, because creating a machine logs a couple of dozen lines in a second
// and each one would otherwise mean asking VirtualBox for the whole list again.
let refreshSoon
const refresh = () => {
  clearTimeout(refreshSoon)
  refreshSoon = setTimeout(() => draw().catch(() => {}), 400)
}

function onLine (e) {
  lines.push(e)
  if (lines.length > 2000) lines.splice(0, lines.length - 2000)
  paintLog()

  if (e.tags.includes('vm') || e.tags.includes('guest')) refresh()

  if (view !== 'live') {
    unseen++
    if (e.level === 'bad') unseenBad = true
    const badge = $('live-badge')
    badge.textContent = String(unseen)
    badge.className = `tab-badge${unseenBad ? ' bad' : ''}`
  }
}

// Says so in the same log as everything else, which also proves the window and the
// server are sharing one node context rather than each holding its own copy.
liveLog.on('window').good('window opened')

// Everything already logged, then everything from here on.
lines.push(...liveLog.all())
paintLog()
liveLog.subscribe(onLine)
$('link-dot').classList.add('live')

// ---- draw ------------------------------------------------------------

async function drawOnce () {
  const [list, status] = await Promise.all([api('vmList'), api('status')])
  latest = list

  // Reconcile the selection against what actually exists, every time, before
  // anything that depends on it is painted.
  //
  // The previous dashboard had a bug worth not repeating: with machines present it
  // never selected one at startup, so the panels rendered as though nothing were
  // selected and clicking the already-selected machine was the only way to get a
  // correct page. Two causes look alike -- nothing selected yet, and something
  // selected that no longer exists -- and both leave the panels stranded until a
  // click. So: after loading, the selection names a machine in the list, or is
  // null because the list is empty.
  if (!latest.vms.some(v => v.name === picked)) {
    picked = latest.vms.length ? latest.vms[0].name : null
  }

  // A path worth copying, so it must not be replaced under a selection.
  setText($('vbox-path'), status.virtualbox || '')
  setText($('topright'), latest.vms.length
    ? `${latest.vms.length} machine${latest.vms.length === 1 ? '' : 's'} this app made`
    : 'no machines yet')

  const gone = latest.vms.filter(v => !v.live)
  // Only the dirty ones. A repository sitting on a review branch with nothing
  // uncommitted is stepped off automatically the moment the branch is needed, so
  // saying anything about it would be noise about something already handled.
  const stuck = (status.repos || []).filter(r => !r.clean)

  // Everything the banner can say, built as one list rather than three
  // conditionals. The previous version wrote the machines in and then, if
  // VirtualBox was missing, REPLACED them -- so the more serious problem hid the
  // other one instead of joining it.
  const trouble = [
    !status.virtualbox
      ? ['VirtualBox was not found. ', 'Nothing here can make or start a machine until it is installed.']
      : null,
    ...gone.map(v => [
      `${v.name} is in this list but VirtualBox has no such machine. `,
      'It was deleted elsewhere, or never finished being made. Delete it here to tidy up.'
    ]),
    ...stuck.map(r => [
      `${r.repo} is on "${r.on}" here with uncommitted changes. `,
      `A machine working on "${r.on}" cannot push while that is true, and its own error will not say why. Commit or discard them, or put ${r.repo} back on ${r.home}.`
    ])
  ].filter(Boolean)

  $('trouble').classList.toggle('hidden', !trouble.length)
  if (changed('trouble', trouble)) {
    fill($('trouble'), trouble.map(([bold, rest]) => el('div', {},
      el('strong', { textContent: bold }),
      el('span', { textContent: rest }))))
  }

  paintVms()
}

// ---- right-click, and devtools ---------------------------------------
//
// NW.js ships no context menu at all, so right-click does nothing until one is
// built. This works now only because the page is opened from disk: a page loaded
// over http is a "remote" page and gets none of the nw.* APIs, whatever it is
// whitelisted for, so there was no way to open an inspector from one.

// ---- capture ----------------------------------------------------------
//
// Ctrl+Shift+D copies what is on screen -- the rendered DOM, not the source -- to
// the clipboard, and saves the same thing to state/capture.html.

async function capture () {
  const css = [...document.styleSheets].map(sheet => {
    try { return [...sheet.cssRules].map(r => r.cssText).join('\n') } catch { return '' }
  }).join('\n')

  const html = `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>captured</title>\n<style>\n${css}\n</style>\n</head>\n${document.body.outerHTML}\n</html>\n`

  try { await navigator.clipboard.writeText(html) } catch { /* the file still gets written */ }
  try {
    const { file, bytes } = await api('capture', { html })
    say(`Copied to the clipboard, and saved ${bytes} bytes to ${file}`)
  } catch (err) {
    oops(err)
  }
}

document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
    e.preventDefault()
    capture()
  }
})

// ---- staying in sync -------------------------------------------------
//
// Two things keep the window honest, because either alone is not enough.
//
// The log covers anything this app did: it reacts at once, so a machine created or
// deleted shows up immediately -- including when another client did it.
//
// The poll covers everything else, and there is plenty of it. A machine finishing
// its install and powering itself off logs nothing here. Nor does starting or
// stopping one in VirtualBox directly, or a snapshot taken outside. Without this
// the window would show a machine as running long after it stopped.
//
// One draw at a time. A draw asks VirtualBox about every machine, so overlapping
// them would multiply that for no benefit -- a request arriving mid-draw is
// remembered and run once the current one finishes.
let drawing = false
let drawAgain = false

async function draw () {
  if (drawing) { drawAgain = true; return }
  drawing = true
  try {
    await drawOnce()
  } finally {
    drawing = false
    if (drawAgain) { drawAgain = false; draw() }
  }
}

// Faster while something is happening, slower when nothing is. An install runs for
// twenty minutes and its interesting moments are at the end, so a fixed slow poll
// would make the finish look late; a fixed fast one would ask VirtualBox about
// idle machines all day.
async function sync () {
  // Nothing to keep in sync with while the window is not being looked at.
  if (!document.hidden) await draw().catch(() => {})
  const busy = latest.vms.some(v => v.running || v.stage === 'installing')
  setTimeout(sync, busy ? 3000 : 12000)
}

paintActions().catch(oops)
draw().then(sync).catch(e => say(e.message, 'bad'))
