'use strict'

// The Claude identities this host holds.
//
// Part of the window. See ui/load.js for the order these are read in.
//
// THE SAME TEMPLATE AS THE MACHINES BESIDE IT: a list you pick from, what is
// known about the one picked, and what it has been part of. An identity is not a
// machine, but the question somebody arrives with is the same shape — which ones
// are there, what is this one, and what has it done.
//
// TWO PANES, ONE PAINTER. A guest is lent to a machine while it works; a
// supervisor is the sign-in this host decides work with and is never lent
// anywhere. They are the same object with a different role — see core/guests.js —
// so this is written once and told which pane it is drawing, the way paneSwitcher
// is one switcher told which tab it is for. Two copies would be two copies that
// drift, and the second would be the one nobody remembers to fix.
//
// NOTHING HERE EVER SHOWS A TOKEN. The actions do not hand one back; this draws
// a name, a date, a fingerprint and a holder. That is the rule the Keys tab was
// built to, and it is what makes these panes safe to photograph.

// Two selections, remembered apart: coming back to one pane should find what was
// picked there, not whatever was picked in the other.
let pickedGuest = been.get('guest', null)
let pickedSup = been.get('supervisor', null)

// WHAT DIFFERS BETWEEN THE TWO, gathered in one place so the painter below reads
// as one panel rather than as a fork per line.
const IDENTITY_PANES = {
  guests: {
    pane: 'guests',
    role: 'guest',
    what: 'guest',
    lendable: true,
    ids: { note: 'guests-note', count: 'guests-context', list: 'guests-list', detail: 'guest-detail', picked: 'guest-context', sessions: 'guest-sessions', sessionsCount: 'guest-sessions-context' },
    get: () => pickedGuest,
    set: v => { pickedGuest = v; been.set('guest', v) },
    empty: 'No Claude guests yet. Add one with the + above — a name, and the token it signs in with.'
  },
  supervisors: {
    pane: 'supervisors',
    role: 'supervisor',
    what: 'supervisor',
    // A SUPERVISOR IS NOT LENT OUT, and the button is absent rather than present
    // and refused. core/guests.js refuses it as well; a button that exists to be
    // refused is a button that teaches people to ignore buttons.
    lendable: false,
    ids: { note: 'sups-note', count: 'sups-context', list: 'sups-list', detail: 'sup-detail', picked: 'sup-context', sessions: 'sup-sessions', sessionsCount: 'sup-sessions-context' },
    get: () => pickedSup,
    set: v => { pickedSup = v; been.set('supervisor', v) },
    empty: 'No supervisor sign-in yet. This is the identity this host works with itself — the model that decides what to give machines, rather than one doing the work.'
  }
}

// Sixteen hex characters of sha256, shown as itself. It is the thing that says
// "the same token as before" and is useless for anything else — which is why it
// can be on screen at all.
const fingerprintOf = g => g.fingerprint
  ? el('span', { className: 'mono muted', textContent: g.fingerprint, title: 'A fingerprint of the token, not the token' })
  : el('span', { className: 'muted', textContent: 'no fingerprint' })

const identityCard = (g, pane, key = {}) => el('div', {
  className: `card pick${g.name === pane.get() ? ' on' : ''}`,
  onclick: () => { pane.set(g.name); paintIdentities(pane) }
},
  el('div', { className: 'card-title' },
    el('span', { className: 'mono grow', textContent: g.name }),
    // Out on a machine is the state worth seeing from the list: it is what stops
    // that machine being snapshotted, and what stops this guest being lent
    // anywhere else.
    g.holder
      ? el('span', { className: 'badge run', textContent: `on ${g.holder}` })
      : el('span', { className: 'badge ok', textContent: 'here' })),
  el('div', { className: 'badges' },
    // WHICH ONE THE SUPERVISOR IS SET TO USE, in the list, because that is the
    // question somebody has when they look at a list of identities that all
    // look alike. Two spellings on purpose: one that was CHOSEN says so, and a
    // lone sign-in that is being used without anybody having chosen it says
    // that instead -- a badge reading "in use" over a decision nobody made is
    // how a default gets mistaken for a choice.
    g.name === key.chosen
      ? el('span', { className: 'badge ok', textContent: 'in use' })
      : g.name === key.usingNow
        ? el('span', { className: 'badge muted', textContent: 'in use — the only one' })
        : null,
    fingerprintOf(g),
    g.has ? null : el('span', { className: 'badge bad', textContent: 'no token file' }),
    g.note ? el('span', { className: 'muted', textContent: g.note }) : null))

// What is known about the one picked. Everything on this panel is a fact about
// the credential that is not the credential.
function identityPanel (g, machines, pane, key = null) {
  if (!g) {
    return el('p', { className: 'empty', textContent: pane.lendable
      ? 'Pick a guest on the left, or add one. A guest is a Claude sign-in kept here under a name.'
      : 'Pick a supervisor on the left, or add one. A supervisor is a Claude sign-in this host spends itself.' })
  }

  const rows = [
    ['name', g.name],
    ['role', pane.lendable ? 'guest — lent to a machine while it works' : 'supervisor — spent by this host, never lent out'],
    ['fingerprint', g.fingerprint || 'none recorded'],
    ['added', g.added ? new Date(g.added).toLocaleString() : 'unknown'],
    ['token file', g.has ? 'here, sealed to this Windows account' : 'MISSING — it was removed by hand, or sealed by another account'],
    pane.lendable ? ['where it is', g.holder ? `on ${g.holder}` : 'here, lent to nobody'] : null,
    pane.lendable ? ['last lent', g.lastGiven ? `${new Date(g.lastGiven).toLocaleString()}${g.lastGivenTo ? ` to ${g.lastGivenTo}` : ''}` : 'never'] : null,
    g.refreshed ? ['last refreshed', new Date(g.refreshed).toLocaleString()] : null,
    // WHAT THIS ONE IS TO THE SUPERVISOR. Said as a fact in the table rather
    // than only as a badge, because "the supervisor signs in as this" is the
    // single most consequential thing about a supervisor sign-in and the panel
    // listed everything except that.
    !pane.lendable && key
      ? ['used by the supervisor', g.name === key.chosen
          ? 'yes — chosen here'
          : g.name === key.using
            ? 'yes — the only one kept here, so it is used without being chosen'
            : 'no']
      : null
  ].filter(Boolean)

  // Only machines that are dialled in can be lent one — the action refuses the
  // rest, and a button that exists to be refused is a button that teaches people
  // to ignore buttons.
  const up = (machines || []).filter(m => m.connected)

  return el('div', {},
    // `kv` is what every other detail panel in this window uses for a table of
    // facts. The first version invented `.facts`, which CSS has no error for —
    // it simply is not applied, and the panel renders as unstyled rows. The
    // window test is what caught it.
    el('table', { className: 'kv' },
      ...rows.map(([k, v]) => el('tr', {},
        el('th', { textContent: k }),
        el('td', { className: 'mono', textContent: String(v) })))),

    el('div', { className: 'row', style: 'margin-top:10px' },
      // CHOOSING WHICH ONE THE SUPERVISOR USES, which is the only decision a
      // person makes on this pane and had no control at all.
      //
      // Shown as a button only when it is not already the one — a button whose
      // press changes nothing is one somebody presses to find out, and this one
      // moves a credential between machines.
      !pane.lendable && key && g.name !== key.chosen && g.has
        ? el('button', {
            className: 'btn small ok',
            textContent: 'Use this one',
            title: 'The supervisor signs in as this, from now on and until it is switched here',
            onclick: () => ask({
              title: `Use "${g.name}" as the supervisor sign-in?`,
              plain: [
                'The supervisor signs in as this from now on, and keeps doing so until it is switched here.',
                // THREE DIFFERENT THINGS THIS PRESS DOES, and saying the wrong
                // one is how a dialog stops being read. It can swap an identity
                // off a running machine, it can decide what the next one gets,
                // or -- on the one already in use without having been chosen --
                // it can do nothing at all except write the choice down.
                key.using === g.name
                  ? 'This is already what it uses, as the only one kept here. Pressing this changes nothing now; it records the choice, so adding a second sign-in later does not make it ambiguous.'
                  : key.using
                    ? `"${key.using}" is what it uses now. If a supervisor is up holding it, that one is taken back — with whatever it refreshed — and this one is handed over in its place.`
                    : 'Nothing is holding another one, so this takes effect the next time a supervisor comes up.'
              ],
              cost: 'Everything the supervisor decides is billed to this identity from now on.',
              confirm: 'Use this one',
              onYes: async () => {
                const said = await api('supervisorKey', { name: g.name })
                say(said.did)
                draw()
              }
            })
          })
        : !pane.lendable
          ? el('span', { className: 'muted', textContent: g.holder
              ? `${g.holder} is signed in as this, and keeps it: a supervisor is never rolled back, so nothing takes it away.`
              : 'A supervisor sign-in belongs on a supervisor machine, and on no other. It is given one when it comes up.' })
        : g.holder
          ? el('button', {
              className: 'btn small',
              textContent: `Take it back from ${g.holder}`,
              title: 'Reads what the worker refreshed, keeps it here, and clears the credential off the machine',
              onclick: async () => {
                const said = await api('guestBack', { name: g.name, machine: g.holder })
                say(said.note, said.rotated ? 'good' : 'muted')
                draw()
              }
            })
          : up.length
            ? el('button', {
                className: 'btn small ok',
                textContent: 'Lend it to a machine',
                onclick: () => ask({
                  title: `Lend "${g.name}" to a machine`,
                  plain: [
                    'The machine is signed in as this guest until it is taken back.',
                    'A machine holding a credential cannot be snapshotted, and a guest that is out cannot be lent anywhere else — which is the point: two machines sharing one sign-in refresh the same token underneath each other.'
                  ],
                  fields: [{
                    name: 'machine',
                    label: 'Which machine',
                    value: up[0].name,
                    options: up.map(m => ({ value: m.name, label: `${m.name} — ${m.stage}` }))
                  }],
                  confirm: 'Lend it',
                  onYes: async f => {
                    const said = await api('guestLend', { name: g.name, machine: f.machine })
                    say(said.note)
                    draw()
                  }
                })
              })
            : el('span', { className: 'muted', textContent: 'No machine is dialled in, so there is nothing to lend it to.' }),

      el('button', {
        className: 'btn small warn',
        textContent: 'Throw it away',
        disabled: !!g.holder,
        title: g.holder ? `It is on ${g.holder} — take it back first` : 'Removes the token and the record',
        onclick: () => ask({
          title: `Throw "${g.name}" away?`,
          plain: ['The token is deleted from this host. Anything that was using it will have to be given another.'],
          cost: 'The sealed token is removed. This cannot be undone from here — signing in again is how you get another.',
          confirm: 'Throw it away',
          danger: true,
          onYes: async () => {
            await api('guestForget', { name: g.name })
            if (pane.get() === g.name) pane.set(null)
            say(`"${g.name}" is gone`)
            draw()
          }
        })
      })))
}

// Two entry points, because the draw loop calls panels by name and a pane behind
// a tab must ask nothing.
const paintGuests = () => paintIdentities(IDENTITY_PANES.guests)
const paintSupervisors = () => paintIdentities(IDENTITY_PANES.supervisors)

function paintIdentities (pane) {
  if (view !== 'runners' || runnerPane !== pane.pane) return
  paintIdentitiesNow(pane)
}

async function paintIdentitiesNow (pane) {
  await settle()
  if (view !== 'runners' || runnerPane !== pane.pane) return

  Promise.all([
    api('guests', { role: pane.role }).catch(e => ({ guests: [], note: e.message })),
    api('vmList').catch(() => ({ vms: [] })),
    api('sessions').catch(() => ({ sessions: [] })),
    // WHICH ONE THE SUPERVISOR USES, and asked only on the pane where it means
    // something. A guest is chosen per task by the queue; a supervisor sign-in
    // is chosen once by a person, and this is where that is done.
    pane.lendable ? Promise.resolve(null) : api('supervisorKey').catch(() => null)
  ]).then(([held, machines, kept, key]) => {
    if (view !== 'runners' || runnerPane !== pane.pane) return
    const chosen = key ? key.chosen : null
    const usingNow = key ? key.using : null

    setText($(pane.ids.note), held.note || '')
    setText($(pane.ids.count), held.guests.length ? `— ${held.guests.length}` : '')

    // Reconciled against what is there, like every other selection in this
    // window: one thrown away between paints is a selection pointing at nothing.
    if (!held.guests.some(g => g.name === pane.get())) {
      pane.set(held.guests.length ? held.guests[0].name : null)
    }
    const one = held.guests.find(g => g.name === pane.get()) || null

    if (changed(`${pane.pane}-list`, [held.guests, pane.get(), usingNow, chosen])) {
      fill($(pane.ids.list), held.guests.length
        ? held.guests.map(g => identityCard(g, pane, { chosen, usingNow }))
        : el('p', { className: 'empty', textContent: pane.empty }))
    }

    setText($(pane.ids.picked), one ? `— ${one.name}` : '— nothing selected')
    if (changed(`${pane.pane}-detail`, [one, (machines.vms || []).map(m => `${m.name}:${m.connected}`), usingNow, chosen, key && key.why])) {
      fill($(pane.ids.detail), identityPanel(one, machines.vms || [], pane, key))
    }

    // THE THIRD COLUMN IS WHAT THIS SIGN-IN HAS BEEN PART OF, and it is filtered
    // to the one picked on the left.
    //
    // Sessions are kept per TASK — a worker's memory belongs to the task, not to
    // the identity that ran it — and this column showed all of them because
    // nothing recorded which sign-in spent a run. It does now: every archive
    // names the identity that was on the machine, and the set of every one that
    // has carried the conversation. See tasks/sessions.js.
    //
    // Matched on the SET, not on the latest. A task resumed three times may have
    // been signed by three identities, and a credential that paid for two of
    // those runs has been part of that conversation whether or not it was the
    // last one to touch it.
    const mine = one
      ? (kept.sessions || []).filter(s => (s.guests || []).includes(one.name) || s.guest === one.name)
      : []
    // Anything from before this was recorded, said out loud rather than left to
    // look like an identity that has never worked.
    const older = (kept.sessions || []).filter(s => !(s.guests || []).length && !s.guest).length

    setText($(pane.ids.sessionsCount), one ? (mine.length ? `— ${mine.length}` : '— none') : '')
    if (changed(`${pane.pane}-sessions`, [one && one.name, mine, older])) {
      fill($(pane.ids.sessions), mine.length
        ? mine.map(s => el('div', { className: 'card' },
            el('div', { className: 'card-title' },
              el('span', { className: 'grow', textContent: s.title || (s.number ? `#${s.number}` : s.uid.slice(0, 8)) }),
              el('span', { className: 'muted', textContent: `${Math.round((s.bytes || 0) / 1024)} KB` })),
            el('div', { className: 'badges' },
              s.number ? el('span', { className: 'muted', textContent: `#${s.number}` }) : null,
              // Which end of the conversation this credential is on, since the
              // set says it was part of it and not that it was the last.
              s.guest === one.name
                ? el('span', { className: 'badge ok', textContent: 'signed the last run' })
                : el('span', { className: 'badge muted', textContent: 'signed an earlier run' }),
              (s.guests || []).length > 1 ? el('span', { className: 'muted', textContent: `${s.guests.length} sign-ins` }) : null,
              s.machine ? el('span', { className: 'muted', textContent: `on ${s.machine}` }) : null,
              s.orphaned ? el('span', { className: 'badge muted', textContent: 'task is gone' }) : null,
              s.kept ? el('span', { className: 'muted', textContent: ago(s.kept) }) : null)))
        : el('div', {},
            el('p', { className: 'empty', textContent: one
              ? `Nothing yet under "${one.name}". A worker hands its memory back when it finishes, and the sign-in that was on the machine is written down with it.`
              : `Pick a ${pane.what} on the left.` }),
            older
              ? el('p', { className: 'muted', textContent: `${older} session${older === 1 ? ' was' : 's were'} kept before this was written down, so ${older === 1 ? 'it names' : 'they name'} no sign-in at all. They are on the Sessions tab.` })
              : null))
    }
  }).catch(e => { if (changed(`${pane.pane}-bad`, String(e.message))) oops(e) })
}

// ADDING ONE IS A NAME AND A TOKEN, and the token is the only thing this window
// ever accepts that it will not show again. One dialog, told which role it is
// adding, for the same reason the painter above is one painter.
const askForIdentity = pane => ask({
  title: pane.lendable ? 'Keep a Claude sign-in here' : 'Keep a supervisor sign-in here',
  plain: pane.lendable
    ? [
        'A guest is a Claude token kept on this host under a name, lent to a machine while it works and taken back afterwards.',
        'It is sealed to this Windows account. Nothing shows it again — what this window reports from here is a name, a date and a fingerprint.'
      ]
    : [
        'A supervisor is a Claude token this host spends itself: the identity that decides what work to give, rather than one doing the work on a machine.',
        'It is never lent to a machine, and it is sealed to this Windows account. Nothing shows it again — what this window reports from here is a name, a date and a fingerprint.'
      ],
  fields: [
    { name: 'name', label: 'A name for it', placeholder: pane.lendable ? 'kit-1, spare' : 'supervisor', hint: 'Letters, digits, dash, dot and underscore. It is a filename and a label in a list.' },
    { name: 'token', label: 'The Claude token', placeholder: 'the contents of .credentials.json', hint: 'What a signed-in machine keeps in ~/.claude/.credentials.json. Signing one in on a machine and taking it from there is the other way to get one.' },
    { name: 'note', label: 'A note (optional)', placeholder: 'what this one is for' }
  ],
  confirm: 'Keep it',
  onYes: async f => {
    const made = await api('guestAdd', { name: f.name, token: f.token, note: f.note, role: pane.role })
    pane.set(made.name)
    say(made.note)
    draw()
  }
})

// ---- getting one, which is a conversation with a person in the middle -------
//
// EVERY CLAUDE SIGN-IN HAPPENS AT THE DESK. That is a second user on the one
// supervisor machine, and it exists so that asking for a login URL cannot touch
// the credential the supervisor is working with — see actions/credentials.js.
// It costs no runner and interrupts nothing.
//
// TWO DIALOGS, because the address does not exist until the desk has been asked
// for one. A form that wanted the code first would be a form nobody could fill
// in.
//
// PASTING ONE IN IS STILL THERE, as the other way out of the first dialog: a
// token somebody already holds does not need a machine at all.
const signInAtTheDesk = pane => ask({
  title: pane.role === 'supervisor' ? 'Sign a supervisor in' : 'Sign a worker in',
  plain: [
    'The sign-in happens at the desk — a user on the supervisor machine that exists for nothing else. Nothing the supervisor is working with is touched by it.',
    'You will get an address to visit; the desk holds the sign-in open until you bring the code back.',
    pane.role === 'supervisor'
      ? 'What comes back is kept here and put straight onto the supervisor machine, because that is the only place a supervisor sign-in may go.'
      : 'What comes back is kept here, sealed, and handed to a machine when one is given work.'
  ],
  fields: [
    { name: 'as', label: 'A name for it', placeholder: pane.role === 'supervisor' ? 'supervisor' : 'kit-1, spare', hint: 'Letters, digits, dash, dot and underscore. It is a filename and a label in a list.' },
    { name: 'note', label: 'A note (optional)', placeholder: 'what this one is for' }
  ],
  confirm: 'Start the sign-in',
  extra: { label: 'I already have a token', onClick: () => askForIdentity(pane) },
  onYes: async f => {
    if (!f.as || !f.as.trim()) throw new Error('Give it a name — a credential is kept under one.')
    const started = await api('claudeSignIn', {})
    askTheDeskForCode(started.name, started.url, pane, f)
  }
})

function askTheDeskForCode (machine, url, pane, f) {
  ask({
    title: `Sign "${f.as}" in`,
    plain: [
      'Open the sign-in page, approve it, and paste back what it gives you.',
      `The desk on ${machine} is holding the sign-in open until you do — it is waiting on that page, not on this window.`
    ],
    link: url,
    fields: [{ name: 'code', label: 'The code from that page', placeholder: 'paste it here' }],
    confirm: 'Finish signing in',
    // GIVING UP CANCELS THE CONVERSATION AND NOTHING ELSE. No machine was
    // borrowed to hold it, so there is nothing to give back — which is the whole
    // difference between this and the sign-in it replaced.
    extra: {
      label: 'Give up',
      onClick: () => api('claudeSignInCancel', { name: machine })
        .then(said => say(said.note))
        .catch(() => { /* it may never have started */ })
    },
    onYes: async got => {
      if (!got.code) throw new Error('Paste the code from the sign-in page.')
      const done = await api('claudeSignedIn', { name: machine, code: got.code, as: f.as.trim(), role: pane.role, note: f.note })
      pane.set(done.guest)
      say(done.note, 'good')
      draw()
    }
  })
}

$('add-guest-open').onclick = () => signInAtTheDesk(IDENTITY_PANES.guests)
$('add-sup-open').onclick = () => signInAtTheDesk(IDENTITY_PANES.supervisors)
