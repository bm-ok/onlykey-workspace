'use strict'

// The virtual machines this app made.
//
// Part of the window. See ui/load.js for the order these are read in and why
// the order matters.

// ---- the machines ----------------------------------------------------
//
// Only machines this app made ever appear here. Anything else on the host is
// invisible to every action, because these actions can delete one.

let picked = been.get('vm', null)
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

// Said only when it is true, and only in the places that have just asked. A
// machine on a branch it may not push is not in danger -- the push refuses --
// but its work has nowhere to go, and nothing said so until somebody tried.
const adriftLines = holds => holds.adrift ? [holds.adrift] : []

const deleteVm = v => api('vmHolds', { name: v.name })
  .catch(() => ({ asked: false, why: 'asking it failed.' }))
  .then(holds => ask({
    title: `Delete ${v.name}?`,
    plain: [
      'No other virtual machine on this computer is touched.',
      holdingLine(holds),
      ...adriftLines(holds)
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
    'Tags say what KIND of machine this is, so work can ask for a kind rather than a name — a task tagged "test" goes to a machine tagged "test" and waits rather than taking another. A task with no tag still takes this machine: a tag adds a way to be asked for, it does not hold a machine back.',
    'Everything else about a machine is settled when it is made.'
  ],
  fields: [
    { name: 'description', label: 'Note', value: v.description || '', placeholder: 'what this one is for' },
    // COMMA SEPARATED, AND FREE TEXT. The tags that exist are the tags on the
    // machines — there is no list to pick from and nothing to keep in step, and
    // a tag stops existing when the last machine carrying it does. The action
    // lower-cases and de-duplicates, so "Test, test" is one tag.
    {
      name: 'tags',
      label: 'Tags (optional, comma separated)',
      value: (v.tags || []).join(', '),
      placeholder: 'test, gpu, on-the-bench',
      hint: 'Work can ask for one of these. Leave it empty and this machine takes any work that asks for no particular kind.'
    }
  ],
  confirm: 'Save',
  // Deleting is the other reason to open this, and it is deliberately not the
  // confirm: it asks again on its own screen, where it can state what it costs.
  extra: { label: 'Delete it', danger: true, onClick: () => deleteVm(v) },
  onYes: async f => {
    await api('vmDescribe', { name: v.name, description: f.description })
    const now = await api('vmTags', { name: v.name, tags: f.tags || '' })
    say((now.tags || []).length
      ? `${v.name} saved — tagged ${now.tags.join(', ')}`
      : `${v.name} saved, carrying no tags`)
  }
})

// The card carries identity, its note, state, and the way in to both settling that
// note and deleting it. Everything else lives in the one Actions panel rather than
// being repeated per row.
const vmCard = v => el('div', {
  className: `card pick${picked === v.name ? ' on' : ''}`,
  onclick: () => { picked = v.name; been.set('vm', picked); paintVms() }
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
    }),
    // Only when it is being kept back, because that is the surprising state.
    // A badge on every machine saying it is available would be noise on the
    // normal case and would make the exception harder to see, not easier.
    v.forTasks === false ? el('span', { className: 'badge warn', textContent: 'not for tasks' }) : null,

    // WHAT KIND OF MACHINE IT IS, when somebody has said. Shown on the card
    // rather than only in its dialog: a tag is the reason work goes to this
    // machine and not another one, so "why did that run here" has to be
    // answerable from the list rather than by opening four dialogs.
    //
    // Muted, because a tag is not a state — nothing is wrong or right about
    // carrying one, and it must not compete with the badges that say whether
    // this machine can be used at all.
    // Except the one tag that is not a label. A supervisor is not a kind of
    // runner work can be sent to — it is the machine that decides what work
    // there is — so it says so rather than sitting muted among the others.
    ...(v.tags || []).map(t => t === 'supervisor'
      ? el('span', { className: 'badge run', textContent: 'supervisor', title: 'It decides what work to give, and is never given a task itself' })
      : el('span', { className: 'badge muted', textContent: t, title: `Work asking for "${t}" can be given to this machine` })),

    // WHY THE QUEUE WILL NOT TAKE IT, in the queue's own words.
    //
    // `ready` is a badge about PROVISIONING -- built, set up, has a base
    // snapshot -- and it was being read as ready for work, which is a different
    // question with a different answer. A machine still claiming a branch is
    // fully provisioned and is not available, and the card said `poweroff ready`,
    // identical to a machine that genuinely was.
    //
    // The sentence is not composed here. The queue already decides this and
    // already words it, so this renders that answer rather than a second opinion
    // that can drift from it -- which is the same mistake this tab has now made
    // twice, once about a credential and once about a claim.
    queueWhy(v) ? el('span', { className: 'badge warn', textContent: queueWhy(v), title: 'the queue will not take this machine while it is true' }) : null))

// What the queue says about a machine, when that is not already on the card.
//
// "Kept back" has its own badge and "installing" is the stage, so repeating
// either would be the same fact twice with different wording.
function queueWhy (v) {
  const said = queueSays.get(v.name)
  if (!said || said.free || !said.why) return null
  if (v.forTasks === false || v.stage === 'installing') return null
  return said.why
}

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

  const pooled = v.forTasks !== false

  fill(box, el('div', { className: 'row' },
    // Whether the queue may have this machine. Beside the other things you do to
    // a machine rather than buried in its settings, because it is the answer to
    // "why has nothing picked this up" and to "why did that get wiped" -- and
    // both are asked while looking at exactly this panel.
    el('button', {
      className: `btn ${pooled ? '' : 'ok'}`,
      textContent: pooled ? 'Keep it back from tasks' : 'Let tasks use it',
      title: pooled
        ? 'The queue may roll this back and give it work when it is free'
        : 'The queue will not touch this machine',
      onclick: () => api('vmForTasks', { name: v.name, enabled: !pooled })
        .then(r => { say(r.note); return draw() }).catch(oops)
    }),

    el('button', {
      className: 'btn ok',
      textContent: v.running ? 'Shut it down' : 'Start it',
      disabled: !v.live,
      title: v.live ? '' : 'VirtualBox has no machine by this name any more',
      onclick: go(v.running ? 'vmStop' : 'vmStart', { name: v.name }, v.running ? 'Asked it to shut down' : 'Starting it')
    }),

    // Only when it is on a branch, because that is the only time the question
    // exists — and it is asked as "why is this machine stuck", which is this
    // panel's question rather than the branch list's.
    v.branch
      ? el('button', {
          className: 'btn',
          textContent: `Let go of ${v.branch}`,
          disabled: !v.connected,
          title: v.connected
            ? 'Only if it is holding nothing — it will be asked'
            : 'It has to be dialled in to be asked what it is holding',
          onclick: () => ask({
            title: `Let ${v.name} off ${v.branch}?`,
            plain: [
              'The machine is asked what it is holding first, and this is refused if anything is uncommitted or unpushed.',
              'Nothing on the machine changes. It stops being the machine that owns this branch, so another one can take it and this one can be given other work.',
              'Anything it already pushed is here and is not touched.'
            ],
            confirm: 'Let it go',
            onYes: async () => {
              const r = await api('vmRelease', { name: v.name })
              say(r.note || `${v.name} let go of ${r.was}.`)
            }
          })
        })
      : null,

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

    // "Take a snapshot" was here, among the things you do to a MACHINE. It is
    // not one: it captures the machine's CURRENT STATE, which is a specific
    // thing with a specific place in the snapshot tree, and that is where the
    // button now lives -- on the card for the state it copies. See
    // currentStateNode. This panel kept a button whose object was somewhere
    // else on the screen entirely.

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
    // ITS CONSOLE, WHICH IS THE OTHER HALF OF "SEE ITS SCREEN".
    //
    // A screenshot is one moment and a picture of it — you cannot search it,
    // scroll back through it, or read what went past before you looked. The
    // console is the whole boot as text, and it is being written whether or not
    // anybody is watching.
    //
    // Offered even when the machine is off, because that is when it is most
    // useful: the console of a machine that would not come up is the record of
    // why, and it outlives the machine being switched off.
    el('button', {
      className: 'btn',
      textContent: 'Read its console',
      title: v.serial
        ? 'The whole boot, as text, live — in the Terminal tab'
        : 'Nothing is capturing this machine\'s console. Turn it on with vmSerial while it is off',
      disabled: !v.serial,
      onclick: () => watchInstall(v.name, { show: false }).then(s => {
        showTab('terminal')
        if (s) showShell(s)
      })
    }),

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

    // "Open in VS Code" WAS HERE, and it is deliberately gone.
    //
    // It opened an editor on a MACHINE, which meant choosing a branch from a
    // machine that had none, or carrying on with whatever one it happened to
    // hold -- and either way no task existed, so the work had no brief, no
    // attempts, no verdict and nothing recording that it happened. That is the
    // hole the human path was outside of, and it is not one to leave a second
    // door open into.
    //
    // Work is started from a BRANCH now: Branches -> Work on it, which makes
    // a task, borrows a machine, sets it up, and opens it in whichever of VS
    // Code or a terminal was asked for.
    // The chain is the same as a worker's and the board says who did it.
    //
    // `vmEditor` remains an action, listed with everything else in All actions.
    // Removing a button is not the same as removing what it did.

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

  // The other panel that reads something real before it can say anything: this
  // one asks VBoxManage and then the machine's own config file.
  waiting('snapshots', { cards: 2 })

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
  //
  // The rest arrived with the current-state card, which reads facts about the
  // MACHINE and not only about its snapshots: when it last dialled in, whether
  // it is live, and which snapshot the queue treats as its base.
  if (!changed('snapshots', [v.name, v.running, v.live, v.state, v.reported, v.cleanSince, v.baseSnapshot, s])) return

  // INDENTED, BECAUSE SNAPSHOTS ARE A TREE.
  //
  // Five in a line and five taken from the same moment arrived here as the same
  // flat list, and they are completely different situations: one is a history,
  // the other is five alternatives branching off one point. VirtualBox's own
  // window has always drawn this; the depth was in the data all along and was
  // being parsed away.
  //
  // The current one is marked from `x.current`, which VirtualBox reports as a
  // NODE. Comparing names would mark both of two snapshots that share one -- and
  // it allows that, which this project has already been caught by.
  // No "none yet" branch any more: a machine with no snapshots still has a
  // current state, and that card is now the only place a first snapshot can be
  // taken from.
  //
  // The indent is only written when there IS one, because the connector rule
  // keys off the attribute being present -- and a root at `margin-left:0px`
  // would be given a line joining it to a parent it does not have.
  fill($('snapshots'),
    [...s.snapshots.map(x => el('div', { className: 'card snap', ...(x.depth ? { style: `margin-left:${x.depth * 18}px` } : {}) },
        el('div', { className: 'card-title' },
          el('span', { className: 'mono', textContent: x.name }),
          // "On this one" was here. It is not needed any more: the current state
          // is its own card, hanging off the snapshot it came from, so where the
          // machine is is shown by POSITION rather than asserted by a label on a
          // different card.

          // The dashboard's own idea, which is not VirtualBox's: the point the
          // queue returns a machine to. Worth marking here because it is the one
          // snapshot whose deletion changes what the queue can do.
          x.name === v.baseSnapshot ? el('span', { className: 'badge ok', textContent: 'base' }) : null),
        // When, which VBoxManage does not report and which is most of what
        // somebody is asking: which of these is the one from before it broke.
        x.taken ? el('div', { className: 'card-sub', textContent: `${new Date(x.taken).toLocaleString()} — ${ago(x.taken)}` }) : null,
        x.description ? el('div', { className: 'card-sub', textContent: x.description }) : null,
        el('div', { className: 'row', style: 'margin-top:8px' },
          // NOT OFFERED ON THE ONE THE MACHINE IS ALREADY ON, because there it
          // is the same act as throwing away the current state -- and that is
          // offered on the current state's own card, where its object is. Two
          // buttons in different places doing one thing is how somebody ends up
          // unsure which of them they actually want.
          x.current ? null : el('button', {
            className: 'btn',
            // "Here", because the tree makes position mean something now: this
            // is the node the machine is moved to, and everything below it is
            // what that discards.
            textContent: 'Revert to here',
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
                ...adriftLines(holds),
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
          }),

          // Throwing one away had no button at all, which is how a machine
          // ends up with two snapshots called the same thing and no way to
          // resolve it from the window.
          el('button', {
            className: 'btn danger',
            // Names what it deletes. "Throw it away" beside "go back to it" left
            // "it" doing two jobs in one row -- the snapshot, or everything
            // since it -- and those are opposite operations.
            textContent: 'Delete this snapshot',
            disabled: v.running,
            title: v.running ? 'Shut it down first' : '',
            onclick: () => ask({
              title: `Throw away "${x.name}"?`,
              plain: [
                'The snapshot goes; the machine keeps its current disk. What was recorded at that point is merged into what came after it.',
                x.name === v.baseSnapshot
                  ? `This is ${v.name}'s base — the point the queue returns it to. Without one it cannot be made clean, so the queue will stop using it.`
                  : 'This is not the base snapshot, so nothing the queue relies on changes.'
              ],
              cost: `There is no way back to "${x.name}" afterwards.`,
              confirm: 'Throw it away',
              danger: true,
              onYes: () => api('vmSnapshotDelete', { name: v.name, title: x.name })
                .then(() => say(`"${x.name}" is gone.`))
            })
          })))),

      // The machine as it is NOW, under the snapshot it came from.
      //
      // VirtualBox's window ends the tree with this and marks it "(changed)".
      // That flag is an API property its GUI reads and VBoxManage does not
      // report -- but the flag is not the only way to know, and this host has
      // better evidence than a flag anyway: THE MACHINE DIALLED IN AFTER THE
      // SNAPSHOT WAS TAKEN. It booted and wrote to its disk, and we logged the
      // moment it did. That is first-hand, not inferred.
      //
      // It stays changed until the disk is either thrown away, by going back to
      // a snapshot, or captured, by taking a new one.
      currentStateNode(v, s)
      ].filter(Boolean))
}

// "3 days ago", because a date alone does not answer which of these is old.
// The same shape as `ago`, forwards. A credential's remaining life is the thing
// somebody wants read at a glance, and "expires 2026-09-10T07:10:35.745Z" is a
// fact nobody subtracts today's date from in their head.
function lasts (ms) {
  const secs = Math.round(Math.abs(ms) / 1000)
  const [n, unit] = secs < 90 ? [secs, 'second']
    : secs < 5400 ? [Math.round(secs / 60), 'minute']
      : secs < 172800 ? [Math.round(secs / 3600), 'hour']
        : [Math.round(secs / 86400), 'day']
  return `${n} ${unit}${n === 1 ? '' : 's'}`
}

function ago (when) {
  const secs = Math.max(0, Math.round((Date.now() - Date.parse(when)) / 1000))
  const [n, unit] = secs < 90 ? [secs, 'second']
    : secs < 5400 ? [Math.round(secs / 60), 'minute']
      : secs < 172800 ? [Math.round(secs / 3600), 'hour']
        : [Math.round(secs / 86400), 'day']
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`
}

// Where the machine actually is, at the end of the tree.
//
// CHANGED IS KNOWN RATHER THAN GUESSED. The machine dialled in at a moment this
// host recorded; if that is after the current snapshot was taken, it booted and
// wrote to its disk since, and the disk has moved on. No flag from VirtualBox is
// needed to say so, and none is available -- `currentStateModified` is an API
// property its GUI reads and VBoxManage does not report.
//
// The reverse is NOT claimed. Never having heard from a machine is not evidence
// that nothing ran on it, only that nothing reached us, so that case says what
// it knows and stops.
// A machine with NO snapshots still has a current state -- it is the whole of
// what the machine is, with nothing recorded behind it. Returning nothing here
// would have taken the only way to snapshot a fresh machine with it, since that
// button now lives on this card.
function currentStateNode (v, s) {
  const on = s.snapshots.find(x => x.current) || null

  // Since WHEN the disk last matched a snapshot -- which is not simply when that
  // snapshot was taken. Reverting puts the disk back without moving the
  // snapshot, and taking one brings the snapshot to the disk; both leave the
  // machine clean, and both happen long after `taken`. Measured from the later
  // of the two, or a reverted machine reads as changed for ever on the strength
  // of a dial-in from before it was put back.
  const clean = [on && on.taken, v.cleanSince].filter(Boolean).sort().pop()
  const heardAfter = !!(on && v.reported && clean && Date.parse(v.reported) > Date.parse(clean))
  const indent = on ? (on.depth + 1) * 18 : 0

  return el('div', {
    className: `card snap current${heardAfter ? ' changed' : ''}`,
    ...(indent ? { style: `margin-left:${indent}px` } : {})
  },
    el('div', { className: 'card-title' },
      el('span', { textContent: 'Current state' }),
      heardAfter ? el('span', { className: 'badge warn', textContent: 'changed' }) : null,
      el('span', { className: `badge ${v.running ? 'ok' : ''}`, textContent: v.running ? 'running' : v.state })),
    el('div', { className: 'card-sub', textContent: !on
      ? 'There are no snapshots, so this is the whole of the machine with nothing recorded behind it. Nothing can be gone back to until one is taken.'
      : heardAfter
        ? `It dialled in ${ago(v.reported)}, after "${on.name}" was taken — so it has booted and written to its disk since. That stays true until this is either captured as a snapshot of its own, or reverted to "${on.name}" and discarded.`
        // Named by what actually happened. "Since it was taken" is wrong about a
        // machine that was put BACK an hour ago and right about one that has sat
        // untouched since the snapshot -- and the difference is the whole reason
        // this reads as clean.
        : `Nothing here has heard from it since ${clean === v.cleanSince ? `it was put back to "${on.name}" ${ago(clean)}` : `"${on.name}" was taken`}. That is not proof nothing ran on it — only that nothing reached this host.` }),

    // CAPTURING IT IS AN ACTION ON THIS, not on the machine in general, so the
    // button is on the card for the thing it copies rather than in a row of
    // buttons about a machine. It was in that row, with its object somewhere
    // else on the screen entirely -- and the sentence directly above says "or
    // captured, by taking a new one" while offering no way to do it.
    //
    // A snapshot with no title is one nobody can choose between later, so the
    // title is asked for rather than generated.
    el('div', { className: 'row', style: 'margin-top:8px' },
      el('button', {
        className: 'btn',
        textContent: 'Take a snapshot of it',
        // Off only. A running machine would have its memory stored beside its
        // disk, and the server refuses it for that reason -- said here so the
        // answer arrives before the dialog is filled in rather than after.
        disabled: !v.live || v.running,
        title: v.running ? 'Shut it down first — a snapshot of a running machine stores its memory too, which makes it enormous' : '',
        onclick: () => ask({
          title: `Snapshot ${v.name} as it is now`,
          plain: [
            'A snapshot is a point you can come back to.',
            'Taking one changes nothing about the machine as it is now.',
            !on
              ? 'It is the first, so it becomes the root of this machine\'s tree.'
              : heardAfter
                ? `It goes under "${on.name}", which is where the machine currently is, and becomes the point it comes back to instead.`
                : `It goes under "${on.name}", which is where the machine currently is.`
          ],
          fields: [
            { name: 'title', label: 'Title for this snapshot', value: v.baseSnapshot ? '' : 'base', placeholder: 'clean install' },
            { name: 'description', label: 'What is true at this point — optional', placeholder: 'operating system installed, nothing else' }
          ],
          confirm: 'Take it',
          onYes: f => api('vmSnapshotTake', { name: v.name, title: f.title, description: f.description })
            .then(() => say(`Snapshot "${f.title}" taken`))
        })
      }),

      // AND THROWING IT AWAY, which is the current state's own destructive act.
      //
      // It used to be "go back to it" on the snapshot the machine was already
      // on, which is the same operation described from the wrong end -- the
      // machine does not move, the changes since are discarded. Said as what it
      // does to the thing it does it to.
      //
      // Only when there is something to discard: with nothing recorded behind
      // it there is nowhere to go, and if nothing has run since the snapshot
      // there is nothing to throw.
      on && heardAfter
        ? el('button', {
            className: 'btn danger',
            // NAMES WHERE IT GOES, not what it destroys. "Throw it away" is
            // accurate about the current state and says nothing about where the
            // machine ends up -- which is the thing somebody needs to know
            // before pressing it, and it is right there in the tree above.
            textContent: `Revert to ${on.name}`,
            disabled: v.running,
            title: v.running ? 'Shut it down first — VirtualBox will not restore a snapshot while it is running' : '',
            onclick: () => api('vmHolds', { name: v.name })
              .catch(() => ({ asked: false, why: 'asking it failed.' }))
              .then(holds => ask({
                title: `Revert ${v.name} to "${on.name}"?`,
                plain: [
                  `${v.name} goes back to "${on.name}" and stays there. The snapshot is not touched.`,
                  holdingLine(holds),
                  ...adriftLines(holds),
                  `What ${v.name} is allowed to push goes back with it — to whatever was set when "${on.name}" was taken.`
                ],
                cost: `Everything that changed on ${v.name} since ${ago(on.taken)} is discarded.`,
                confirm: `Revert to ${on.name}`,
                danger: true,
                onYes: () => api('vmSnapshotRestore', { name: v.name, title: on.name })
                  .then(r => say(r.branch
                    ? `Back at "${on.name}" — ${v.name} may push ${r.branch}`
                    : `Back at "${on.name}" — ${v.name} may push nothing until it is set up again`))
              })).catch(oops)
          })
        : null))
}

// Getting from a machine to the thing it is entangled with.
//
// The tab knew about none of these. Branches links into Tasks; this linked
// nowhere, so going from "runner2 is stuck" to the branch it is stuck on meant
// switching tabs and picking the same machine out of a second list. That is the
// same "three places knew and none of them met" problem, at the machine end.
const goToBranch = branch => {
  $('branch-find').value = branch
  forget('branches')
  // The tab AND the pane: branch cuts live under Repositories now, and
  // switching only the view lands on whichever of its eleven panes was last
  // open — which is not the one holding the branch just asked for.
  showPane('branchcuts', 'repos')
  paintBranches()
}
const goToTask = id => { pickedTask = id; been.set('task', id); showTab('tasks') }
const goToShell = (name, opts) => { showTab('terminal'); return openShell(name, opts).catch(oops) }

// What this machine is doing, and what is standing in its way.
//
// IT WAS A SPEC SHEET. Eight of its thirteen rows -- memory, processors, disk,
// network, user, installer image, hostname, when it was made -- cannot change
// after the machine exists, and they had the widest panel in the window. The one
// fact that decides everything, the branch it claims, was row five and worded as
// a permission.
//
// The tab was built when a machine WAS the product, so it answers "what is this
// machine". Tasks, branches, a terminal and a credential store arrived since,
// and the question became "what is this machine doing, and what is in the way".
// The spec is still here, one click away, because it is what people copy values
// out of -- it is just no longer the answer to a question nobody asked.
function paintDetails () {
  const v = latest.vms.find(x => x.name === picked)
  const box = $('details')
  if (!v) {
    if (changed('details', null)) fill(box, el('p', { className: 'empty', textContent: 'No machine selected.' }))
    return
  }

  const spec = v.spec || {}
  const facts = (v.agent && v.agent.facts) || {}
  const doing = queueBusy.get(v.name) || null
  const said = queueSays.get(v.name)
  const claimed = doing ? taskById(doing) : null

  // Live first, and in the order the questions are actually asked.
  const now = [
    ['power', v.running ? 'running' : v.state],
    ['reachable', v.connected
      ? `dialled in ${new Date(v.agent.since).toLocaleTimeString()}, from ${v.agent.from}`
      : v.lastAddress ? `not dialled in — last seen at ${v.lastAddress}` : 'never dialled in'],
    // Booted is not usable, and the agent reports the difference on every beat.
    // It decided whether a sign-in or an editor would work at all, and until now
    // it was collected and never shown.
    // WHAT IT WAS BUILT AS, which is not the same question and is answerable
    // with the machine switched off. Decided when it was made and never after —
    // there is no button for it here on purpose, because a machine installed
    // without a desktop has no X on it at all, and a flag saying otherwise would
    // be a lie that took twenty-five minutes to find out about.
    ['built with', v.desktopWanted ? 'a desktop' : 'no display — a terminal-only runner'],

    // WHAT IT IS FOR, and it is worth a row of its own because it changes what
    // every other row on this card means. A supervisor is never given a task, so
    // "doing: nothing" is its resting state rather than a machine going spare.
    v.supervisor
      ? ['what it is', 'a supervisor — it decides what work to give, and is never given any']
      : null,

    // WHAT VIRTUALBOX CANNOT SAY WITHOUT THE GUEST ADDITIONS. Its memory metrics
    // come from the additions, so the graph is empty for every machine built
    // without them — which is now every runner with no desktop. The machine
    // knows, and it says so on every beat.
    v.connected && v.agent && v.agent.facts && v.agent.facts.memoryUsedMB != null
      ? ['memory', `${v.agent.facts.memoryUsedMB} MB used${v.agent.facts.memoryTotalMB ? ` of ${v.agent.facts.memoryTotalMB}` : ''}`]
      : null,

    // And whether that desktop is actually up, which the agent reports on every
    // beat. Booted is not usable: this is what decides whether a sign-in or an
    // editor would work at all. Not asked of a machine that never had one.
    v.connected && v.desktopWanted
      ? ['desktop', v.desktop ? 'up — anything needing a screen will work' : 'not up yet']
      : null,

    ['doing', doing
      ? link(claimed ? `#${claimed.number} ${claimed.title}` : doing, () => goToTask(doing))
      : 'nothing'],
    // The queue's own words, again, rather than a second opinion.
    ['the queue', said ? (said.free ? 'free — the next task can take it' : said.why) : 'unknown'],

    ['claims a branch', v.branch
      ? link(v.branch, () => goToBranch(v.branch))
      : 'nothing — it is free to be given any'],

    // Never shown on this tab before. It is what stops a snapshot being taken,
    // and it survived a host restart on a powered-off machine without this panel
    // mentioning it once.
    ['worker credential', v.holdsCredential
      ? 'holding one — it cannot be snapshotted until that is taken back'
      : 'none, which is the resting state'],

    ['resets to', v.baseSnapshot || 'no base snapshot yet — it cannot be made clean'],

    // WHAT KIND OF MACHINE THIS IS, and it belongs among the facts that decide
    // whether work comes here rather than among the ones about how it was built.
    // A tag is the reason a task landed on this machine and not another, so
    // "why did that run here" has to be answerable from this panel.
    //
    // Said either way. An empty row is not noise here: "no tags" is the state
    // that means this machine takes any untagged work, which is a fact somebody
    // is checking when they wonder why it keeps being chosen.
    ['tags', (v.tags || []).length
      ? `${v.tags.join(', ')} — work asking for ${v.tags.length === 1 ? 'that' : 'one of those'} can be given to it, and untagged work still can`
      : 'none — it takes work that asks for no particular kind of machine'],

    ['last heard from', v.reported ? new Date(v.reported).toLocaleString() : 'never'],
    v.connected ? ['it says it is', facts.hostname ? `${facts.hostname} — ${facts.system || ''}` : 'unknown'] : null,
    v.connected ? ['its addresses', (facts.addresses || []).join(', ') || 'unknown'] : null
  ].filter(Boolean)

  const made = [
    ['made', new Date(v.created).toLocaleString()],
    ['memory', `${spec.memoryMB} MB`],
    ['processors', String(spec.cpus)],
    ['disk', `${Math.round((spec.diskMB || 0) / 1024)} GB`],
    ['network', spec.network === 'bridged' ? `bridged${spec.bridge ? ` on ${spec.bridge}` : ''}` : `nat, ssh on 127.0.0.1:${spec.sshPort}`],
    ['user', spec.user],
    ['installer image', spec.iso ? spec.iso.split(/[\\/]/).pop() : 'none'],
    ['hostname', spec.hostname],
    ['stage', v.stage]
  ]

  // Signed on the TEXT of every row rather than on the nodes, since a link is an
  // object and would never compare equal -- which would repaint this panel three
  // times a second and take the selection out of anything being copied.
  const sign = [...now, ...made].map(([k, val]) => `${k}=${typeof val === 'string' ? val : val.textContent}`)
  if (!changed('details', [v.name, sign])) return

  const table = rows => el('table', { className: 'kv' }, ...rows.map(([k, val]) =>
    el('tr', {}, el('th', { textContent: k }),
      el('td', { className: 'mono' }, typeof val === 'string' ? document.createTextNode(val) : val))))

  fill(box,
    table(now),

    // The ways out of this panel, beside the facts that send you there.
    //
    // "OPEN A SHELL" WAS HERE AND IS NOT ANY MORE, for the same reason the
    // editor button went: a shell opened to WORK in belongs to the branch the
    // work is on, and this panel is about a machine. Offered here it is a way
    // into a machine with no task and no branch, which is the shape of the hole
    // the human path used to sit outside of.
    //
    // A shell for DIAGNOSING a machine is a different thing and still exists --
    // the Terminal tab, which is about machines, and `vmShell` for when the agent
    // has stopped answering. That one is the back door and should not be behind a
    // branch, because the case it is for is a machine that has no working branch
    // at all.
    el('div', { className: 'row', style: 'margin-top:10px' },
      v.branch ? el('button', { className: 'btn', textContent: 'Its branch', onclick: () => goToBranch(v.branch) }) : null,
      doing ? el('button', { className: 'btn', textContent: 'Its task', onclick: () => goToTask(doing) }) : null,
      // Nothing at all is better than a button that leads somewhere it should
      // not, but a panel with an empty row reads as something failing to render.
      !v.branch && !doing
        ? el('span', { className: 'muted', textContent: 'Not on a branch and not running anything — nothing to go to.' })
        : null),

    // Closed, because it answers a question asked once: what was this made with.
    el('details', { className: 'spec' },
      el('summary', { textContent: 'How it was made' }),
      table(made)))
}

// A fact you can follow. Deliberately a button rather than an anchor: there is
// nowhere to navigate to, and an <a href> in an app page is how a window ends up
// replacing itself with a broken URL.
const link = (text, onclick) => el('button', { className: 'linky mono', textContent: text, onclick })

// From the list the Tasks tab already fetched. Asking the `tasks` action again
// here would read every branch out of git a second time on every draw, which is
// the thing queueState exists to avoid.
const taskById = id => (taskList || []).find(t => t.id === id) || null

// WHICH HALF OF RUNNERS IS OPEN. The machines themselves, or what a worker on
// one remembered. See paneSwitcher in ui/tasks.js.
let runnerPane = been.get('runner-pane', 'machines')
paneSwitcher('view-runners', () => runnerPane, p => { runnerPane = p; been.set('runner-pane', p) }, () => {
  paintVms()
  paintGuests()
  paintSessions()
})

function paintVms () {
  if (view !== 'runners' || runnerPane !== 'machines') return
  // `picked` is in the signature because it decides which card is highlighted.
  // The queue's verdict is part of the signature, or a machine that became
  // unavailable would keep the card it was drawn with.
  if (changed('vms', [latest.available, latest.unreachable || '', picked, latest.vms.map(v => [vmKey(v), queueWhy(v)])])) {
    fill($('vms'), latest.vms.length
      ? latest.vms.map(vmCard)
      // THREE DIFFERENT NOTHINGS, and they were two. Installed with no machines
      // yet, not installed at all, and installed but not answering are separate
      // situations with separate answers, and the third one used to read as the
      // second -- "VirtualBox was not found" said of a VirtualBox sitting right
      // there, wedged, which sends somebody to reinstall a thing that is fine.
      : latest.unreachable
        ? el('div', {},
            el('p', { className: 'empty bad', textContent: 'VirtualBox is not answering.' }),
            el('p', { className: 'empty', textContent: latest.unreachable }),
            el('p', { className: 'empty', textContent: 'Everything else here still works — a task list and a branch are read from this host, not from a machine.' }))
        : el('p', { className: 'empty', textContent: latest.available ? 'None yet. The + above makes one.' : 'VirtualBox was not found.' }))
  }
  vmActions()
  paintDetails()
  paintSnapshots().catch(() => {})
}

$('add-task-open').onclick = newTask
// Caught here because newBranch reads the baselines before it can draw itself,
// and a dialog that fails to open must say so rather than not appearing.
$('add-branch-open').onclick = () => newBranch().catch(oops)
$('add-group-open').onclick = newGroup
// `term-open` and `term-machine` were wired here. They were the machine picker
// and its button, and they are gone: a terminal is started from a task now. The
// sign-in line follows the front tab instead of the picker, which is repainted
// by showShell rather than by an onchange.
$('prcuts-refresh').onclick = () => refreshCuts()
// The + opens the editor too, with nothing loaded. A dialog asking for a title
// and a description, next to a pane built for writing exactly those, would be
// the second editor again.
$('add-prcut-open').onclick = () => {
  showPane('templates', 'repos')
}
$('repos-check').onclick = () => api('repositoriesCheck')
  .then(r => { forget('repos'); say(r.note, r.repos.some(x => x.reachable !== true || x.why) ? 'bad' : undefined); return draw() })
  .catch(oops)
$('term-close').onclick = () => closeShell(active)
// Repainted on the spot rather than on the next draw, because a filter that
// takes up to three seconds to answer reads as one that did not work.
$('branch-find').oninput = () => { forget('branches'); paintBranches() }
window.addEventListener('resize', () => {
  if (view !== 'terminal') return
  sizeTerminal()
  if (active) { try { active.fit.fit() } catch { /* not laid out */ } }
})

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
    // THE SERVER IMAGE IS THE ONE TO USE, and the address is here because this
    // is where somebody is standing when they need it. A desktop image is not
    // wrong, it is redundant: the box below installs a small desktop on a server
    // machine, and a desktop image arrives with a large one already on it.
    {
      name: 'iso',
      label: isos.length ? 'Installer image' : 'Installer image — VirtualBox knows of none, so type a path',
      value: isos.length ? isos[0].location : '',
      options: isos.length ? [{ value: '', label: 'none for now' }, ...isos.map(i => ({ value: i.location, label: i.name }))] : undefined,
      placeholder: 'C:\\path\\to\\ubuntu-24.04.4-live-server-amd64.iso',
      hint: 'Ubuntu server, downloaded once and kept: https://releases.ubuntu.com/releases/24.04.4/ubuntu-24.04.4-live-server-amd64.iso — it installs in about twelve minutes, against twenty-five for a desktop image.'
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
    // DECIDED HERE OR NEVER, which is why it is on this form and nowhere else.
    //
    // The machine is installed from the server image either way; ticking this
    // adds Xorg, a window manager and a display manager that logs itself in. A
    // machine with no desktop boots in a fraction of the time and idles on a
    // fraction of the memory, which is what a runner holding a terminal wants —
    // and two machines coming up at once is what wedges this host.
    //
    // It cannot be changed afterwards. What a machine was built to be is a fact
    // about that build: flipping a flag later would say "desktop" about a
    // machine with no X on it at all. The card shows what it was made as.
    {
      name: 'desktop',
      label: 'Give it a desktop',
      type: 'checkbox',
      value: false,
      hint: 'Off is a terminal-only runner: no display manager, no session, a fraction of the memory. On installs a small desktop that logs itself in, for a machine somebody is going to sit at. This cannot be changed later.'
    },
    // WHAT THIS MACHINE IS FOR, and it is the one kind that is not a runner.
    //
    // A supervisor runs Claude Code to decide what work to give and asks this
    // dashboard for it. It is never given a task — the queue skips it, by the
    // tag this ticks on — so it clones nothing, builds nothing, and gets none of
    // the project's provisioning: node and Claude Code, and that is all.
    //
    // ALSO DECIDED HERE OR NEVER, like the desktop above, and for a stronger
    // reason: it changes what is installed at first boot AND it is what keeps
    // the machine out of the pool. A supervisor that could be untagged later is
    // a supervisor that gets rolled back to base mid-thought by the first queued
    // task, so vmTags refuses to add or remove it.
    {
      name: 'supervisor',
      label: 'Supervisor machine',
      type: 'checkbox',
      value: false,
      hint: 'Off is an ordinary runner that takes tasks. On makes a machine that decides what work to give instead of doing any: it is permanently out of the queue, holds no repositories, and gets a slim setup — node and Claude Code. This cannot be changed later.'
    },
    // ASKED AT CREATION, unlike the desktop above, and for the opposite reason:
    // this one can be changed whenever you like, from the gear on the card. It
    // is here because the moment somebody is making a second machine is the
    // moment they know what it is FOR — "this one is for the tests", "this one
    // has the hardware" — and a field asked six weeks later is one nobody goes
    // back to fill in.
    {
      name: 'tags',
      label: 'Tags (optional, comma separated)',
      value: '',
      placeholder: 'test, gpu, on-the-bench',
      hint: 'What kind of machine this is, so work can ask for a kind rather than a name. A task tagged "test" goes to a machine tagged "test"; a task with no tag takes any free machine, including this one. Changeable later from the gear on its card.'
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
