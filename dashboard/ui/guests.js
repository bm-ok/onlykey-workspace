'use strict'

// The Claude identities this host holds.
//
// Part of the window. See ui/load.js for the order these are read in.
//
// THE SAME TEMPLATE AS THE MACHINES BESIDE IT: a list you pick from, what is
// known about the one picked, and what it has been part of. A guest is not a
// machine, but the question somebody arrives with is the same shape — which ones
// are there, what is this one, and what has it done.
//
// NOTHING HERE EVER SHOWS A TOKEN. The actions do not hand one back; this draws
// a name, a date, a fingerprint and a holder. That is the rule the Keys tab is
// built to, and it is what makes this pane safe to photograph.

let pickedGuest = been.get('guest', null)

// Sixteen hex characters of sha256, shown as itself. It is the thing that says
// "the same token as before" and is useless for anything else — which is why it
// can be on screen at all.
const fingerprintOf = g => g.fingerprint
  ? el('span', { className: 'mono muted', textContent: g.fingerprint, title: 'A fingerprint of the token, not the token' })
  : el('span', { className: 'muted', textContent: 'no fingerprint' })

const guestCard = g => el('div', {
  className: `card pick${g.name === pickedGuest ? ' on' : ''}`,
  onclick: () => { pickedGuest = g.name; been.set('guest', pickedGuest); paintGuests() }
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
function guestPanel (g, machines) {
  if (!g) return el('p', { className: 'empty', textContent: 'Pick a guest on the left, or add one. A guest is a Claude sign-in kept here under a name.' })

  const rows = [
    ['name', g.name],
    ['fingerprint', g.fingerprint || 'none recorded'],
    ['added', g.added ? new Date(g.added).toLocaleString() : 'unknown'],
    ['token file', g.has ? 'here, sealed to this Windows account' : 'MISSING — it was removed by hand, or sealed by another account'],
    ['where it is', g.holder ? `on ${g.holder}` : 'here, lent to nobody'],
    ['last lent', g.lastGiven ? `${new Date(g.lastGiven).toLocaleString()}${g.lastGivenTo ? ` to ${g.lastGivenTo}` : ''}` : 'never'],
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
      g.holder
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
            if (pickedGuest === g.name) pickedGuest = null
            say(`"${g.name}" is gone`)
            draw()
          }
        })
      })))
}

function paintGuests () {
  if (view !== 'runners' || runnerPane !== 'guests') return
  paintGuestsNow()
}

async function paintGuestsNow () {
  await settle()
  if (view !== 'runners' || runnerPane !== 'guests') return

  Promise.all([
    api('guests').catch(e => ({ guests: [], note: e.message })),
    api('vmList').catch(() => ({ vms: [] })),
    api('sessions').catch(() => ({ sessions: [] }))
  ]).then(([held, machines, kept]) => {
    if (view !== 'runners' || runnerPane !== 'guests') return

    setText($('guests-note'), held.note || '')
    setText($('guests-context'), held.guests.length ? `— ${held.guests.length}` : '')

    // Reconciled against what is there, like every other selection in this
    // window: a guest thrown away between paints is a selection pointing at
    // nothing.
    if (!held.guests.some(g => g.name === pickedGuest)) {
      pickedGuest = held.guests.length ? held.guests[0].name : null
      been.set('guest', pickedGuest)
    }
    const one = held.guests.find(g => g.name === pickedGuest) || null

    if (changed('guests-list', [held.guests, pickedGuest])) {
      fill($('guests-list'), held.guests.length
        ? held.guests.map(guestCard)
        : el('p', { className: 'empty', textContent: 'No Claude guests yet. Add one with the + above — a name, and the token it signs in with.' }))
    }

    setText($('guest-context'), one ? `— ${one.name}` : '— nothing selected')
    if (changed('guest-detail', [one, (machines.vms || []).map(m => `${m.name}:${m.connected}`)])) {
      fill($('guest-detail'), guestPanel(one, machines.vms || []))
    }

    // THE THIRD COLUMN IS WHAT A GUEST HAS BEEN PART OF. Sessions are kept per
    // TASK rather than per guest — a worker's memory belongs to the task, not to
    // the identity that ran it — so this is the whole list for now, and the
    // heading says so rather than implying a filter that is not there.
    setText($('guest-sessions-context'), (kept.sessions || []).length ? `— ${kept.sessions.length}` : '— none')
    if (changed('guest-sessions', kept.sessions || [])) {
      fill($('guest-sessions'), (kept.sessions || []).length
        ? (kept.sessions || []).map(s => el('div', { className: 'card' },
            el('div', { className: 'card-title' },
              el('span', { className: 'grow', textContent: s.title || (s.number ? `#${s.number}` : s.uid.slice(0, 8)) }),
              el('span', { className: 'muted', textContent: `${Math.round((s.bytes || 0) / 1024)} KB` })),
            el('div', { className: 'badges' },
              s.number ? el('span', { className: 'muted', textContent: `#${s.number}` }) : null,
              s.orphaned ? el('span', { className: 'badge muted', textContent: 'task is gone' }) : null,
              s.at ? el('span', { className: 'muted', textContent: ago(s.at) }) : null)))
        : el('p', { className: 'empty', textContent: 'Nothing remembered yet. A worker hands its memory back when it finishes, and gets it again next time that task runs.' }))
    }
  }).catch(e => { if (changed('guests-bad', String(e.message))) oops(e) })
}

// ADDING ONE IS A NAME AND A TOKEN, and the token is the only thing this window
// ever accepts that it will not show again.
$('add-guest-open').onclick = () => ask({
  title: 'Keep a Claude sign-in here',
  plain: [
    'A guest is a Claude token kept on this host under a name, lent to a machine while it works and taken back afterwards.',
    'It is sealed to this Windows account. Nothing shows it again — what this window reports from here is a name, a date and a fingerprint.'
  ],
  fields: [
    { name: 'name', label: 'A name for it', placeholder: 'kit-1, supervisor, spare', hint: 'Letters, digits, dash, dot and underscore. It is a filename and a label in a list.' },
    { name: 'token', label: 'The Claude token', placeholder: 'the contents of .credentials.json', hint: 'What a signed-in machine keeps in ~/.claude/.credentials.json. Signing one in on a machine and taking it from there is the other way to get one.' },
    { name: 'note', label: 'A note (optional)', placeholder: 'what this one is for' }
  ],
  confirm: 'Keep it',
  onYes: async f => {
    const made = await api('guestAdd', { name: f.name, token: f.token, note: f.note })
    pickedGuest = made.name
    been.set('guest', pickedGuest)
    say(made.note)
    draw()
  }
})
