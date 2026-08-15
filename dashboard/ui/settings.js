'use strict'

// What this app is set to.
//
// Part of the window. See ui/load.js for the order these are read in and why
// the order matters.
//
// NOT WORKSPACE SETTINGS. A branch, a task and a line are statements about a
// folder of repositories; these are statements about this installation, and they
// survive switching workspace, closing one, and having none open. Kept beside the
// events record rather than in a workspace's state — see core/settings.js.
//
// A CARD PER DECISION, with the reason beside the control. A switch with no
// sentence under it is a switch nobody can weigh, and the ones that end up here
// are exactly the ones where the cost of being wrong is not obvious.

function paintSettings () {
  if (view !== 'settings') return
  waiting('settings', { cards: 2 })
  paintSettingsNow()
}

async function paintSettingsNow () {
  await settle()
  if (view !== 'settings') return

  api('settings').then(v => {
    if (view !== 'settings') return
    setText($('settings-context'), '— this app, not this workspace')
    setText($('settings-note'), `Kept in ${v.where}. These survive switching workspace, closing one, and having none open — anything that belongs to a folder of repositories is kept with the folder instead.`)
    if (!changed('settings', v)) return

    fill($('settings'), testCard(v.tests, v.settings.testsAsked))
  }).catch(e => { if (changed('settings-bad', String(e.message))) oops(e) })
}

// THE DRILLS, AND THE ONE THING THAT MAKES THEM DANGEROUS.
//
// They drive this app for real: one writes a task and removes it again, one
// takes a credential off a machine and puts it back. Against three scaffolding
// repositories that is what they are for; against somebody's actual work it is a
// stranger typing into their repository, and nothing here can tell the two apart.
//
// So the card leads with the folder. "On" is not a state this setting has — it
// is on FOR somewhere, and the sentence has to say which, because that is the
// whole of what somebody is agreeing to.
function testCard (t, asked) {
  const on = !!t.enabled
  const here = t.allowed
  // A request standing against THIS folder. One raised against another workspace
  // is not a question anybody here can answer, and showing it would invite an
  // answer about the wrong place.
  const waiting = asked && !here && asked.forDir === t.openDir ? asked : null

  return el('div', { className: `card${on && !here ? ' warn' : ''}` },
    el('div', { className: 'card-title' },
      el('span', { className: 'grow', textContent: 'Run the drills against this workspace' }),
      el('span', here
        ? { className: 'badge ok', textContent: 'on, here' }
        : on
          ? { className: 'badge warn', textContent: 'on, elsewhere' }
          : { className: 'badge muted', textContent: 'off' })),

    // ASKED, AND STILL WAITING. On the card as well as in the dialog, because a
    // dialog can be dismissed and a question that then exists nowhere is a
    // question nobody answers.
    waiting
      ? el('p', { className: 'note warn' },
          el('strong', { textContent: `Asked ${ago(waiting.at)}: ` }),
          el('span', { textContent: waiting.why }))
      : null,

    el('p', { className: 'note' },
      el('span', { textContent: 'The drills in the Test tab drive this app for real — one writes a task and removes it again, one takes a credential off a machine and puts it back. Against scaffolding repositories that is exactly what they are for. Against work you care about it is a stranger typing into your repository, and this app cannot tell the two apart, so it does not guess.' })),

    el('table', { className: 'kv' },
      el('tr', {}, el('th', { textContent: 'turned on for' }),
        el('td', { className: 'mono', style: 'user-select:text', textContent: t.forDir || '—' })),
      el('tr', {}, el('th', { textContent: 'open now' }),
        el('td', { className: 'mono', style: 'user-select:text', textContent: t.openDir || 'nothing is open' }))),

    // WHY IT IS OFF, in the words the action would use — the same sentence a
    // drill run from the command line gets, rather than a second wording of it.
    !here
      ? el('p', { className: 'note warn', textContent: t.why })
      : el('p', { className: 'note', textContent: 'On for the folder open now. Opening a different workspace switches this off — it is on for a place, not on in general.' }),

    el('div', { className: 'row', style: 'margin-top:8px' },
      on
        ? el('button', {
            className: 'btn',
            textContent: 'Switch them off',
            onclick: () => setTests(false)
          })
        : el('button', {
            className: 'btn danger',
            textContent: t.openDir ? 'Turn them on for this workspace' : 'No workspace is open',
            disabled: !t.openDir,
            // A dialog rather than a toggle, because this is the decision and
            // the toggle is only how it is expressed. It names the folder: the
            // whole failure this guards against is somebody switching it on
            // while looking at the wrong one.
            onclick: () => ask({
              title: 'Let the drills run here?',
              plain: [
                `They will run against ${t.openDir}.`,
                'One writes a task on a branch cut and removes it again. One takes the worker credential off a machine, proves that a signed-out machine is refused work, and puts it back.',
                'They never touch a machine the queue is driving, and the two long round-trip drills are not among them — those stay as prose in TEST-PLAN.md.'
              ],
              cost: 'If a guard has already stopped working, the thing it was guarding against happens here, in this folder. That is what a drill is: an attempt to do the wrong thing.',
              confirm: 'Turn them on here',
              danger: true,
              onYes: () => setTests(true)
            })
          })))
}

function setTests (on) {
  return api('settingSet', { name: 'testsEnabled', value: on })
    .then(r => {
      say(r.note, on ? 'warn' : 'ok')
      forget('settings'); forget('tests-note'); forget('test-suites'); forget('test-list'); forget('test-detail')
      return draw()
    })
    .catch(oops)
}

// ---- being asked -------------------------------------------------------
//
// The pipe may ASK to run the drills and may not decide. This is where the
// asking lands: a dialog, wherever you happen to be standing, because it is a
// question for whoever is at the keyboard rather than for whoever thinks to open
// the Settings tab.
//
// ONCE PER REQUEST. Keyed on when it was made, so a question that reappeared on
// every draw — every three seconds — cannot happen. A dialog somebody dismisses
// without reading is the opposite of having asked them.
let askedShown = null

function askToTest (req) {
  if (askedShown === req.at) return
  // Not over the top of something else. A dialog that opens while somebody is
  // mid-decision in another one steals the keyboard and answers the wrong
  // question — this can wait three seconds for the screen to be free.
  if (document.querySelector('.dlg-overlay')) return
  askedShown = req.at

  ask({
    title: 'Run the drills against this workspace?',
    plain: [
      `Asked ${ago(req.at)} — for ${req.forDir}.`,
      `The reason given: ${req.why}`,
      'The drills drive this app for real. One writes a task on a branch cut and removes it again. One takes the worker credential off a machine, proves a signed-out machine is refused work, and puts it back. They never touch a machine the queue is driving.',
      'Saying yes keeps them on for this folder only, across restarts, until the workspace changes.'
    ],
    cost: 'If a guard has already stopped working, the thing it was meant to stop happens here, in this folder. That is what a drill is: an attempt to do the wrong thing.',
    confirm: 'Allow, for this workspace',
    danger: true,
    // Declining is the other button rather than "never mind", because closing
    // the dialog and answering "no" are different acts: one leaves the request
    // standing for later, the other says no.
    extra: {
      label: 'No',
      onClick: () => api('testsAnswer', { allow: false })
        .then(r => { say(r.note); forget('settings'); return draw() })
        .catch(oops)
    },
    onYes: () => api('testsAnswer', { allow: true })
      .then(r => {
        say(r.note, 'warn')
        forget('settings'); forget('tests-note')
        forget('test-suites'); forget('test-list'); forget('test-detail')
        return draw()
      })
      .catch(oops)
  })
}
