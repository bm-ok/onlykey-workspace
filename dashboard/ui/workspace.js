'use strict'

// Which folder of repositories all of this is about.
//
// Part of the window. See ui/load.js for the order these are read in and why
// the order matters.

// ---- which repositories this is about ----------------------------------
//
// A workspace is a folder of repositories, and it is the SUBJECT of every other
// tab: a branch, a task, a baseline and a pull request are each a statement
// about one of them. It was a link in the title bar opening a dialog, which is
// the right shape for one decision and the wrong shape for a list you add to,
// remove from, switch between and put down.
//
// AND IT CAN BE PUT DOWN. "No workspace" is a state, not a failure — the honest
// answer at the end of a day, or while working on this app rather than through
// it. What makes it safe is that the refusal is one rule in one place: an action
// says whether it is a question about a workspace, and `call` in server.js turns
// it down by name. Everything here does is show that rule before somebody walks
// into it: the tabs that stop working are disabled, and they say why.
function paintWorkspace () {
  if (view !== 'workspace') return
  waiting('ws-list', { cards: 2 })
  paintWorkspaceNow()
}

async function paintWorkspaceNow () {
  await settle()
  if (view !== 'workspace') return
  api('workspaces').then(w => {
    const open = !!w.open
    const now = w.current

    if (changed('ws-head', [open, now, w.known, w.inTheWay])) {
      setText($('ws-context'), open ? `— serving ${now.name}` : '— none open')
      setText($('ws-note'), w.note)

      const stuck = w.inTheWay || []
      const close = $('ws-close')
      close.classList.toggle('hidden', !open)
      close.disabled = !!stuck.length
      close.textContent = stuck.length ? 'Cannot close it yet' : 'Close this workspace'
      // THE SAME LIST THE ACTION REFUSES WITH. A button that offers something
      // and then explains afterwards why it will not do it is a button that
      // teaches people to distrust every other one on the screen.
      close.title = stuck.length
        ? `Not while ${stuck.map(s => s.why).join('; ')}.`
        : 'Stops serving this folder. Its tasks, branch reasons and baselines are kept and come back with it.'
      close.onclick = () => askToCloseWorkspace(now)
    }

    // THE WELCOME LANDING. Shown only with none open, and it is the one panel in
    // this app that exists to be read rather than acted on — because somebody
    // arriving at it has no context at all, which is exactly the state it
    // describes.
    if (changed('ws-welcome', [open, w.known.length])) {
      $('ws-welcome').classList.toggle('hidden', open)
      if (!open) {
        fill($('ws-welcome'),
          el('h3', { style: 'margin:0 0 6px', textContent: 'Nothing is open.' }),
          el('p', { className: 'note', textContent: w.known.length
            ? 'Pick one below, or add a folder. Everything about branches, tasks and pull requests is a statement about a folder of repositories, so those tabs stay switched off until there is one.'
            : 'This app works on a folder whose subdirectories are git repositories. Add one on the right, and every other tab starts meaning something.' }),
          el('p', { className: 'note', textContent: 'The machines this app made are still here, and so are the keys, the approvals and the live log — those belong to this computer, not to any workspace. That is why putting a machine away works while nothing is open.' }))
      }
    }

    if (changed('ws-list', [w.known, open])) {
      fill($('ws-list'), w.known.length
        ? w.known.map(k => workspaceCard(k, w))
        : el('p', { className: 'empty', textContent: 'None known yet.' }))
    }

    if (changed('ws-scope', w.gated)) {
      // WHAT STOPS WORKING, counted rather than listed. Fifty-three names is a
      // wall nobody reads; the number plus the shape of the rule is what
      // somebody actually needs to predict whether the thing they want to do
      // will work.
      fill($('ws-scope'),
        el('div', { className: 'carries-head' }, el('span', { textContent: 'What belongs to a workspace' })),
        el('p', { className: 'note', textContent: `${(w.gated || []).length} of this app's actions are questions about a folder of repositories, and are refused by name while none is open — everything under Repositories, Branches, PR cuts and Tasks.` }),
        el('p', { className: 'note', textContent: 'The rest are about this computer: Virtual machines, Terminal, Keys and the live log. They keep working, because putting a machine away is how you get to close a workspace.' }),
        el('p', { className: 'note mono', textContent: w.where || 'no state directory while none is open' }))
    }
  }).catch(oops)
}

function workspaceCard (k, w) {
  const stuck = (w.inTheWay || []).length
  return el('div', { className: `card${k.current ? ' on' : ''}${k.there ? '' : ' warn'}` },
    el('div', { className: 'card-title' },
      el('span', { textContent: k.name }),
      k.current ? el('span', { className: 'badge ok', textContent: 'in use' }) : null,
      // Where it was when it was closed, so coming back is one click on a list
      // that would otherwise look like it had forgotten.
      k.last ? el('span', { className: 'badge muted', textContent: 'last open' }) : null,
      k.there ? null : el('span', { className: 'badge bad', textContent: 'no such folder' }),
      el('span', { className: 'grow' }),
      el('span', { className: 'muted', textContent: k.there ? `${k.repos} repositor${k.repos === 1 ? 'y' : 'ies'}` : '' })),

    el('div', { className: 'card-sub mono muted', textContent: k.dir }),

    el('div', { className: 'row', style: 'margin-top:8px' },
      k.current
        ? el('button', { className: 'btn small', textContent: 'In use', disabled: true })
        : el('button', {
            className: 'btn small ok',
            textContent: 'Open it',
            // A folder that has gone is offered and refused rather than hidden:
            // a removed drive is a thing to notice, and the button is where
            // somebody looks to find out what happened to it.
            disabled: !k.there || !!stuck,
            title: !k.there
              ? 'There is no folder at that path any more.'
              : stuck
                ? `Not while ${(w.inTheWay || []).map(s => s.why).join('; ')}.`
                : 'Serve this folder. Its tasks, branch reasons and baselines come with it.',
            onclick: () => useWorkspace(k.dir)
          }),
      el('button', {
        className: 'btn small bad',
        textContent: 'Forget it',
        disabled: !!k.current,
        title: k.current
          ? 'That is the one in use. Close it, or open another, before forgetting it.'
          : 'Stops offering this folder. What is known about it is kept, and comes back if it is added again.',
        onclick: () => ask({
          title: `Forget ${k.name}?`,
          plain: [
            `${k.dir} is dropped from this list.`,
            // The one thing worth stating, because it is the opposite of what
            // "forget" sounds like and it is what makes this a small decision.
            'Nothing in the folder is touched, and what this app knows about it — its tasks, its branch reasons, its baselines — is kept. Add it again and they are all still there.'
          ],
          confirm: 'Forget it',
          danger: true,
          onYes: async () => {
            await api('workspaceForget', { dir: k.dir })
            say(`${k.name} is no longer offered. What it knows was kept.`)
            changed('ws-list', null)
            return draw()
          }
        })
      })))
}

// SWITCHING AND CLOSING BOTH TEAR DOWN EVERYTHING ON SCREEN, because everything
// on screen was about somewhere else. The signatures are cleared by hand rather
// than trusted to differ: an empty list of branches and a different workspace's
// empty list of branches are the same signature, so the guard that stops a
// needless repaint would stop the one repaint that matters.
const AFTER_WORKSPACE = [
  'branches', 'baselines', 'branch-actions', 'branch-carries', 'branch-detail',
  'tasks', 'task-detail', 'repos', 'repo-detail', 'todo-list', 'todo-chrome',
  'prcuts', 'prcut-detail', 'prwrite-fields', 'change', 'ws-head', 'ws-list',
  'ws-welcome', 'workspace-chip', 'ws-scope'
]

async function useWorkspace (dir) {
  try {
    const now = await api('workspaceUse', { dir })
    for (const key of AFTER_WORKSPACE) changed(key, null)
    say(now.changed ? `Now serving ${now.dir} — ${(now.repos || []).length} repositories.` : now.note)
    return draw()
  } catch (e) { oops(e) }
}

function askToCloseWorkspace (now) {
  ask({
    title: `Close ${now.name}?`,
    plain: [
      `${now.dir} stops being served.`,
      'Its tasks, branch reasons, baselines and pull request drafts are kept exactly where they are and come back with it. Nothing in the folder is touched.',
      'Repositories, Branches, PR cuts and Tasks switch off until a workspace is open — those tabs are questions about a folder of repositories, and there would be no folder to ask about.',
      'The machines, the keys, the approvals and the live log belong to this computer and keep working.'
    ],
    confirm: 'Close it',
    onYes: async () => {
      const r = await api('workspaceClose')
      for (const key of AFTER_WORKSPACE) changed(key, null)
      say(r.changed ? `Closed ${r.wasName}. Nothing about repositories is being served.` : r.note, 'warn')
      showTab('workspace')
      return draw()
    }
  })
}

function addWorkspace (andUse) {
  const where = $('ws-add').value.trim()
  if (!where) return say('Say which folder.', 'bad')
  api('workspaceAdd', { dir: where })
    .then(async added => {
      $('ws-add').value = ''
      changed('ws-list', null)
      if (andUse) return useWorkspace(added.dir)
      say(added.already ? `${added.name} was already known.` : `${added.name} added — ${added.repos} repositor${added.repos === 1 ? 'y' : 'ies'}. It is not in use until you open it.`)
      return draw()
    })
    .catch(oops)
}

$('ws-add-go').onclick = () => addWorkspace(false)
$('ws-add-use').onclick = () => addWorkspace(true)
// Enter is what somebody presses after typing a path, and the safer of the two
// acts is the one it does: remembering a folder changes nothing, opening one
// changes what every other tab means.
$('ws-add').onkeydown = e => { if (e.key === 'Enter') addWorkspace(false) }

// WHICH TABS ARE QUESTIONS ABOUT A WORKSPACE. The same split the actions draw,
// said in the chrome — disabled rather than hidden, because a row of tabs that
// silently loses half its buttons reads as a broken window rather than a state,
// and which ones go is the clearest available description of what a workspace
// actually is.
const NEEDS_WORKSPACE = ['repos', 'branches', 'prcuts', 'tasks']

function gateTabs (open) {
  if (!changed('tab-gate', open)) return
  for (const name of NEEDS_WORKSPACE) {
    const tab = document.querySelector(`.tab[data-view="${name}"]`)
    if (!tab) continue
    tab.disabled = !open
    tab.title = open ? '' : 'Needs a workspace. Open a folder of repositories from the tab beside the title.'
  }
  // Standing on a tab that just switched off. Moved rather than left showing the
  // last workspace's branches under a heading that no longer means anything.
  if (!open && NEEDS_WORKSPACE.includes(view)) showTab('workspace')
}
