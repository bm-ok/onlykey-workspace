'use strict'

// The worker credential this host holds so machines do not have to.
//
// Part of the window. See ui/load.js for the order these are read in and why
// the order matters.

// ---- keys ------------------------------------------------------------
//
// The sign-in is a conversation with a program running on a machine: it prints
// an address, a person visits it, and a code comes back. So it is two dialogs
// rather than one, and the machine holds its half open in between -- which is
// the whole reason this is not a single button that either works or does not.

function paintKeys () {
  api('credentialsHeld').then(held => {
    setText($('keys-context'), held.held ? `— taken from ${held.from}` : '— none yet')
    if (!changed('keys', held)) return

    // WHAT THE STATE ACTUALLY IS, from the two things that know: the credential's
    // own refresh-token clock, and the last time a machine really tried it.
    //
    // They are shown as two rows and not merged into one verdict, because they
    // disagree in a way that matters and the disagreement IS the information.
    // This host's credential says "four weeks left" and a worker says "OAuth
    // session expired" — the clock is not lying, it is answering a different
    // question, since a refresh rotates the token and one grabbed from a machine
    // that refreshed since is already superseded.
    const life = held.life || {}
    const tried = held.checked || null
    const dead = life.usable === false || (tried && tried.ready === false)
    const proven = tried && tried.ready === true

    fill($('keys'), held.held
      ? el('div', { className: `card${dead ? ' warn' : ''}` },
          el('div', { className: 'card-title' },
            el('span', { textContent: 'Claude Code' }),
            el('span', {
              className: `badge ${dead ? 'bad' : proven ? 'ok' : 'warn'}`,
              textContent: dead ? 'will not work' : proven ? 'working' : 'not tried yet'
            })),
          el('table', { className: 'kv', style: 'margin-top:8px' },
            // The headline: how long is left, and on which clock.
            el('tr', {}, el('th', { textContent: 'time left' }),
              el('td', {}, life.refresh
                ? el('span', {
                    className: life.refresh.expired ? 'bad' : '',
                    textContent: life.refresh.expired
                      ? `expired ${lasts(life.refresh.left)} ago`
                      : `${lasts(life.refresh.left)} — until ${new Date(life.refresh.at).toLocaleString()}`
                  })
                : el('span', { className: 'muted', textContent: life.readable ? 'it does not say' : (life.why || 'unreadable') }))),
            // The short clock, which is expired almost always and means nothing
            // on its own. Said anyway, because otherwise somebody reads it
            // elsewhere and draws the wrong conclusion from it.
            life.access
              ? el('tr', {}, el('th', { textContent: 'session token' }),
                  el('td', { className: 'muted' },
                    life.access.expired
                      ? `expired ${lasts(life.access.left)} ago — normal, it is refreshed when needed`
                      : `${lasts(life.access.left)} left`))
              : null,
            // The only proof there is.
            el('tr', {}, el('th', { textContent: 'last tried' }),
              el('td', {}, tried
                ? el('span', {
                    className: tried.ready ? 'ok' : 'bad',
                    textContent: `${tried.ready ? 'worked' : 'refused'} on ${tried.on}, ${ago(tried.at)}`
                  })
                : el('span', { className: 'muted', textContent: 'never — no machine has used it since it was taken' }))),
            life.plan ? el('tr', {}, el('th', { textContent: 'plan' }), el('td', { className: 'mono', textContent: life.plan })) : null,
            el('tr', {}, el('th', { textContent: 'taken from' }), el('td', { className: 'mono', textContent: held.from })),
            el('tr', {}, el('th', { textContent: 'when' }), el('td', { className: 'mono', textContent: `${new Date(held.taken).toLocaleString()} — ${ago(held.taken)}` })),
            // The path, not the contents. A page that shows a secret is a page
            // that ends up in a screenshot.
            el('tr', {}, el('th', { textContent: 'kept in' }), el('td', { className: 'mono', style: 'user-select:text', textContent: held.dir })),
            // Which protection is actually holding, not which one was intended.
            // "Encrypted for this account" and "the folder happens to be yours"
            // are different answers to "is this safe here", and only one of them
            // survives the file being copied somewhere else.
            el('tr', {}, el('th', { textContent: 'at rest' }),
              el('td', {}, el('span', { className: `badge ${held.sealed ? 'ok' : 'warn'}`, textContent: held.sealed ? 'sealed' : 'plain' }))),
            el('tr', {}, el('th', { textContent: '' }), el('td', { className: 'muted', textContent: held.protection || '' }))),

          // WHAT TO DO ABOUT IT, beside the thing that is wrong. A panel that
          // reports a dead credential and leaves the cure on another row of the
          // page is a panel somebody reads twice and acts on neither time.
          el('p', { className: 'note', style: 'margin-top:10px', textContent: dead
            ? (life.usable === false ? life.why : 'A machine tried it and the worker reported itself signed out. Only a person at a sign-in page can replace it.')
            : proven
              ? 'Handed to a machine per task and taken back afterwards, so no machine keeps it and none can be snapshotted while holding one.'
              : 'It has not been tried since it was taken. Testing it takes a machine for a minute or two and settles it now, rather than a task finding out.' }),

          // BOTH, ALWAYS. Replacing was offered only while the credential was
          // known bad — so a freshly signed-in one had no way to be replaced,
          // and the moment somebody most wants to redo a sign-in is right after
          // one that went wrong in a way nothing detected.
          el('div', { className: 'row' },
            el('button', {
              className: `btn ${dead ? '' : 'ok'}`,
              textContent: proven ? 'Test it again' : 'Test it on a machine',
              title: 'Borrows a free machine, hands it the credential, asks the worker, then takes it back and puts the machine away',
              onclick: () => testCredentials()
            }),
            el('button', {
              className: `btn ${dead ? 'ok' : ''}`,
              textContent: 'Sign in again and replace it',
              onclick: () => getCredentials()
            })))
      : el('div', {},
          el('p', { className: 'empty', textContent: 'No worker credential yet, so nothing on a machine can run claude.' }),
          el('button', { className: 'btn ok', textContent: 'Sign in and get one', onclick: () => getCredentials() })))
  }).catch(() => { /* the tab is not worth an error bar of its own */ })
}
