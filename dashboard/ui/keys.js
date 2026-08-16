'use strict'

// Where the worker sign-ins went.
//
// Part of the window. See ui/load.js for the order these are read in and why
// the order matters.
//
// THIS TAB HELD THE CREDENTIAL. One Claude sign-in, taken from a machine
// somebody signed in by hand, kept sealed here and handed to whichever machine
// was working. That is the design that broke: the CLI refreshes the token as a
// worker runs, so two machines sharing one sign-in rotate the same credential
// underneath each other, and taking it back deleted what the last one refreshed.
//
// Identities live in a list now — see core/guests.js — with their own pane under
// Virtual machines, built like the machines beside them: the ones there, what
// this one is, and what it has been part of. So what is left here is a signpost.
//
// A SIGNPOST AND NOT A REDIRECT. Somebody arriving at this tab is looking for
// something that used to be here; sending them somewhere without saying so makes
// a moved thing look like a broken tab. It also asks nothing on the draw loop,
// which the old panel did every few seconds for a credential it no longer owns.

function paintKeys () {
  if (view !== 'keys') return
  if (!changed('keys', 'moved')) return

  setText($('keys-context'), '— now under Virtual machines')

  fill($('keys'), el('div', { className: 'card' },
    el('div', { className: 'card-title' },
      el('span', { textContent: 'Claude sign-ins' }),
      el('span', { className: 'badge ok', textContent: 'moved' })),
    el('p', { className: 'note' },
      'They are kept as named guests, one per machine that is working, on the ',
      el('b', {}, 'Claude guest'),
      ' pane. Add one there, lend it to a machine, and take it back when the work is done — what comes back is what the worker refreshed, which is newer than what went out.'),
    el('div', { className: 'row' },
      el('button', {
        className: 'btn ok small',
        textContent: 'Open Claude guests',
        // Through the tabs themselves rather than by setting the variables they
        // write: one path into a pane, and it is the one a person uses.
        onclick: () => {
          const tab = document.querySelector('.tab[data-view="runners"]')
          if (tab) tab.click()
          const pane = document.querySelector('#view-runners .subtab[data-pane="guests"]')
          if (pane) pane.click()
        }
      }))))
}
