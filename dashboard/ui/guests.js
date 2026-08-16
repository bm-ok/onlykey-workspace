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

const identityCard = (g, pane) => el('div', {
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
    fingerprintOf(g),
    g.has ? null : el('span', { className: 'badge bad', textContent: 'no token file' }),
    g.note ? el('span', { className: 'muted', textContent: g.note }) : null))

// What is known about the one picked. Everything on this panel is a fact about
// the credential that is not the credential.
function identityPanel (g, machines, pane) {
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
    g.refreshed ? ['last refreshed', new Date(g.refreshed).toLocaleString()] : null
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
      !pane.lendable
        ? el('span', { className: 'muted', textContent: 'A supervisor is never handed to a machine. Lending it would let a worker spend the identity that decides what workers do.' })
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
    api('sessions').catch(() => ({ sessions: [] }))
  ]).then(([held, machines, kept]) => {
    if (view !== 'runners' || runnerPane !== pane.pane) return

    setText($(pane.ids.note), held.note || '')
    setText($(pane.ids.count), held.guests.length ? `— ${held.guests.length}` : '')

    // Reconciled against what is there, like every other selection in this
    // window: one thrown away between paints is a selection pointing at nothing.
    if (!held.guests.some(g => g.name === pane.get())) {
      pane.set(held.guests.length ? held.guests[0].name : null)
    }
    const one = held.guests.find(g => g.name === pane.get()) || null

    if (changed(`${pane.pane}-list`, [held.guests, pane.get()])) {
      fill($(pane.ids.list), held.guests.length
        ? held.guests.map(g => identityCard(g, pane))
        : el('p', { className: 'empty', textContent: pane.empty }))
    }

    setText($(pane.ids.picked), one ? `— ${one.name}` : '— nothing selected')
    if (changed(`${pane.pane}-detail`, [one, (machines.vms || []).map(m => `${m.name}:${m.connected}`)])) {
      fill($(pane.ids.detail), identityPanel(one, machines.vms || [], pane))
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

$('add-guest-open').onclick = () => askForIdentity(IDENTITY_PANES.guests)
$('add-sup-open').onclick = () => askForIdentity(IDENTITY_PANES.supervisors)
