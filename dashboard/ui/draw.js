'use strict'

// The loop: what is asked for on every pass, the photograph of the window
// itself, and how often any of it happens.
//
// Part of the window. See ui/load.js for the order these are read in and why
// the order matters.

// ---- draw ------------------------------------------------------------

async function drawOnce () {
  // The queue is asked here as well as in its own panel, because the banner
  // needs it: a machine the queue is driving is not an idle machine, and
  // nagging about one would train the operator to ignore the banner.
  const [list, status, running, held] = await Promise.all([
    // CAUGHT, because a broken VirtualBox is not a broken window.
    //
    // This was the one call in here without a catch, and it took the whole draw
    // down with it: the Promise.all rejected, and Tasks, Branches, Keys and the
    // photograph at the bottom were never painted. VirtualBox wedged -- every
    // VBoxManage call, including a read-only `list vms`, hanging until it timed
    // out -- and the window answered by emptying the two tabs that do not touch
    // a machine at all. A task list is read from a file on this host; there is
    // no reason it should go blank because a hypervisor is unwell.
    //
    // The machines panel says so itself, which is where it belongs.
    api('vmList').catch(e => ({ available: false, vms: [], unreachable: e.message })),
    api('status').catch(() => ({ repos: [], virtualbox: true })),
    api('queueState').catch(() => ({ inFlight: [] })),
    // Whether there is a credential to hand out at all, which is the difference
    // between "sign this machine in" and "there is nothing to sign it in with".
    api('credentialsHeld').catch(() => ({ held: false }))
  ])
  const busyMachines = new Set((running.inFlight || []).map(f => f.machine))
  latest = list
  latest.credentialsHeld = held
  queueSays = new Map((running.machines || []).map(m => [m.name, m]))
  queueBusy = new Map((running.inFlight || []).map(f => [f.machine, f.task]))

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
  // A remembered selection is checked against what exists, exactly like any
  // other: a machine can be deleted between one window and the next, and coming
  // back to a name that is gone is the same stranded state as never having
  // chosen. Remembering does not get to skip the reconciliation.
  if (!latest.vms.some(v => v.name === picked)) {
    picked = latest.vms.length ? latest.vms[0].name : null
    been.set('vm', picked)
  }

  // WHICH REPOSITORIES THIS IS ABOUT, in the chrome, because it is the context
  // for everything else on screen. A branch, a task, a baseline and a verdict
  // are all statements about one folder, and until that folder could be changed
  // it went without saying -- so the title bar carried the path to VBoxManage
  // instead, which never changes and which nobody needs to see twice.
  //
  // Clickable, because the thing you want on reading it is to change it.
  const ws = status.workspace
  if (changed('workspace-chip', [ws, status.workspaceKnown])) {
    const tab = $('workspace-tab')
    // The folder's NAME, not its path. A path in the chrome is a line of text
    // nobody reads twice and which pushes everything else along; the name is
    // what somebody calls it. The full path and the count are one hover away,
    // where they answer "which one is this exactly" rather than sitting there.
    tab.textContent = ws ? ws.name : 'no workspace'
    tab.classList.toggle('none', !ws)
    tab.title = ws
      ? `${ws.dir}\n${ws.repos} repositor${ws.repos === 1 ? 'y' : 'ies'}\n\nOpen the Workspaces tab to switch, add or close.`
      : `Nothing is open${status.workspaceKnown ? `, and ${status.workspaceKnown} folder(s) are known` : ''}. Open the Workspaces tab to choose one.`
  }
  // Everything that is a question about a folder of repositories, switched off
  // while there is none. See gateTabs.
  gateTabs(!!ws)
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
  // Read here rather than asked for, and applied before anything paints below.
  slowMs = Number(status.slowMs) || 0

  const trouble = [
    // SAID WHILE IT IS ON, because a window that has been deliberately slowed
    // and does not admit it is a window somebody debugs for an hour. It is the
    // only entry here describing something this app was ASKED to do.
    slowMs
      ? [`Loading states are being held for ${slowMs}ms. `,
          'Turned on deliberately so a placeholder can be seen and judged. Nothing is being read any differently. Turn it off with: okc.js windowSlow --ms 0']
      : null,
    !status.virtualbox
      ? ['VirtualBox was not found. ', 'Nothing here can make or start a machine until it is installed.']
      : null,
    // Said in the banner and not only in the machines panel, because it is a
    // fact about every tab: a task cannot be given out, a branch cannot be
    // worked on, and the reason has nothing to do with either of them.
    latest.unreachable
      ? ['VirtualBox is installed but not answering. ',
          `Machine actions will hang or fail until it recovers — everything read from this host is unaffected. It said: ${latest.unreachable}`]
      : null,
    ...gone.map(v => [
      `${v.name} is in this list but VirtualBox has no such machine. `,
      'It was deleted elsewhere, or never finished being made. Delete it here to tidy up.'
    ]),
    ...stuck.map(r => [
      `${r.repo} is on "${r.on}" here with uncommitted changes. `,
      `A machine working on "${r.on}" cannot push while that is true, and its own error will not say why. Commit or discard them, or put ${r.repo} back on ${r.home}.`
    ]),

    // A machine left on, doing nothing, holding a credential.
    //
    // Said because nothing else says it. A runner's natural state is off; one
    // that is up and idle looks exactly like one that is working, and that is
    // how a machine stayed on for hours holding a token while every panel
    // reported it as healthy. It was noticed by eye.
    //
    // The credential is the part that makes this worth a banner rather than a
    // note: an idle machine is the one case where a token is exposed for no
    // reason at all — nothing is using it, and it will keep not being used
    // until somebody looks.
    //
    // A SHELL OPEN ON IT COUNTS AS USING IT, which it did not until the Terminal
    // tab existed. Without that, the window argued with itself: the sign-in line
    // offers to hand a machine a credential so `claude` will run, and the banner
    // immediately scolds you for the credential you were just told to place, on a
    // machine you are visibly sitting in. A nag that fires at the thing the same
    // window recommended is a nag people learn to ignore, and this one is worth
    // not teaching that about.
    ...latest.vms
      .filter(v => v.running &&
        !busyMachines.has(v.name) &&        // the queue is using it
        !v.borrowed &&                      // somebody took it, deliberately
        !shells.some(s => s.name === v.name && !s.ended) && // you are in it
        v.forTasks !== false &&             // somebody said keep this one back
        v.stage !== 'installing')           // it is being built
      .map(v => v.holdsCredential
        ? [`${v.name} is on, doing nothing, and holding a worker credential. `,
            'A runner rests off and holding nothing. Take the credential back and shut it down, or give it something to do.']
        : [`${v.name} is on and doing nothing. `,
            'A runner rests off — the queue starts one when there is work. Shut it down, or give it something to do.']),

    // OFF, and still holding one. Which nothing said, because every other rule
    // here is about a machine that is running.
    //
    // A credential is taken back before a machine is shut down, so this state
    // cannot be reached by anything working correctly -- it means a machine was
    // stopped from OUTSIDE that sequence. A host that rebooted for an update is
    // the ordinary way, and it happened: an overnight update powered a runner off
    // mid-credential and the window had nothing to say about it in the morning.
    //
    // It matters more when the machine is off than when it is on, not less. A
    // running machine is at least visible; a powered-off one looks finished, and
    // the credential sits on its disk indefinitely, unmentioned, waiting for
    // somebody to happen to read a field. It also silently blocks the next
    // snapshot, with an error about credentials arriving at whoever tries.
    ...latest.vms
      .filter(v => !v.running && v.live && v.holdsCredential)
      .map(v => [
        `${v.name} is powered off and still holding a worker credential. `,
        'That cannot happen in the ordinary sequence — a credential is taken back before a machine is shut down — so it was stopped from outside it, which a host restart does. Start it, take the credential back, and shut it down again. Until then it cannot be snapshotted.'
      ])
  ].filter(Boolean)

  $('trouble').classList.toggle('hidden', !trouble.length)
  if (changed('trouble', trouble)) {
    fill($('trouble'), trouble.map(([bold, rest]) => el('div', {},
      el('strong', { textContent: bold }),
      el('span', { textContent: rest }))))
  }

  paintWorkspace()
  paintRepos()
  paintTodo()
  paintCuts()
  paintTemplates()
  paintVms()
  paintKeys()
  paintGithub()
  paintAppKeys()
  paintTerminal()
  paintBranches()
  paintTasks(running)

  // Last, so the picture is of a window that has finished drawing.
  shotIfAsked()
}

// A photograph of this window, when something has asked for one.
//
// `capturePage` exists only here — the node side has no page to photograph — so
// the request is left in the actions table and answered on the next draw. That
// is the whole reason this is a poll rather than a call: the asking and the
// taking happen in different processes.
//
// It exists because the window is the one part of this tool nobody could check
// from a terminal. A misspelt CSS class produces no error, a panel can silently
// stop updating, and both have happened — so "it renders correctly" was, until
// now, always somebody's opinion.
function shotIfAsked () {
  api('windowShotPending').then(want => {
    if (!want || !want.file || shotInFlight) return

    // Switched to the asked-for tab first, and then A WHOLE DRAW IS LET PASS.
    //
    // One draw is not enough, which cost a picture to learn. Every panel here
    // fills from an action, so painting it is asynchronous, while this runs
    // synchronously at the END of the same draw that started those requests. A
    // tab that has never been painted is therefore still empty at exactly the
    // moment the photograph is taken -- and an empty panel in a screenshot is
    // worse than no screenshot, because it looks like a rendering fault rather
    // than a timing one. It did: the Branches tab photographed blank, correctly.
    // A view, and optionally a pane inside it: `branches/baselines`. Sub-tabs
    // are exactly as unverifiable as tabs were before this existed -- a panel
    // nobody clicked is a panel nobody has seen -- and from outside the window
    // there is no other way to reach one.
    // ARMED, NOT TAKEN. The tab still has to be switched to below -- that is
    // what CAUSES the placeholder this is waiting for -- and the next `settle`
    // fires it. Nothing here lets a draw pass first, because the moment being
    // photographed is over before the next draw begins.
    if (want.when === 'loading') catchLoading = want

    const [wantView, wantPane] = String(want.view || '').split('/')

    if (wantPane && document.querySelector(`#view-branches .subtab[data-pane="${wantPane}"]`) && branchPane !== wantPane) {
      document.querySelector(`#view-branches .subtab[data-pane="${wantPane}"]`).click()
      shotSettle = 2
      // Deliberately not returning: the view itself may still need switching,
      // and clicking a sub-tab inside a hidden view changes nothing on screen.
    }

    if (wantView && wantView !== view) {
      const tab = document.querySelector(`.tab[data-view="${wantView}"]`)
      // TWO draws, not one. One was enough for a tab whose panels come from data
      // already in hand, and not for one that reads git the moment it opens --
      // the Branches tab photographed showing its own "reading…" placeholder,
      // which is honest and still not what the picture was for.
      if (tab) { tab.click(); shotSettle = 2; return }
      // Named a tab that does not exist. Said rather than silently photographing
      // whatever was already open and letting it read as that tab.
      api('windowShotDone', { file: want.file, error: `there is no tab called "${wantView}"` })
      return
    }
    // WHICH ROW, once the right tab is open. A detail panel that only exists for
    // one kind of task -- a person's, with its own two buttons -- was reachable
    // only by clicking that row by hand, which is the thing this whole mechanism
    // exists to avoid. Taken by number or by id, because a number is what the
    // board shows and an id is what every action takes.
    if (want.pick && view === 'tasks') {
      const t = (taskList || []).find(x => x.id === want.pick || String(x.number) === want.pick)
      // THROUGH THE SAME DOOR A PERSON USES. This set the selection and repainted
      // by hand, which meant the one path a click actually takes -- clear the
      // panels, put placeholders up, let a frame through, then read -- was the
      // one path no photograph could ever be of.
      if (t && pickedTask !== t.id) {
        shotSettle = 2
        pickTask(t.id, null)
        return
      }
    }

    // The PR cuts tab: which of its two readings is open.
    if (want.pick && view === 'prcuts' && ['cuts', 'templates'].includes(want.pick) && cutPane !== want.pick) {
      const t = document.querySelector(`#view-prcuts .subtab[data-pane="${want.pick}"]`)
      if (t) { t.click(); shotSettle = 3; return }
    }

    // The Repositories tab has two selections: which sub-tab, and which
    // repository. `todo` / `repos` / `issues` / `pulls` picks the reading;
    // anything else is taken as a repository name.
    if (want.pick && view === 'repos') {
      if (['todo', 'repos', 'issues', 'pulls'].includes(want.pick)) {
        if (repoPane !== want.pick) {
          const t = document.querySelector(`#view-repos .subtab[data-pane="${want.pick}"]`)
          if (t) { t.click(); shotSettle = 2; return }
        }
      } else if (pickedRepo !== want.pick) {
        pickedRepo = want.pick
        been.set('repo', pickedRepo)
        changed('repos', null)
        changed('repo-detail', null)
        shotSettle = 2
        paintRepos()
        return
      }
    }

    // The Merge pane has a selection of its own: which of its two readings is
    // open, and which file. `commits` / `files`, or `repo:path` to open a file.
    if (want.pick && view === 'branches' && branchPane === 'changes') {
      if (want.pick === 'commits' || want.pick === 'files') {
        if (changeLook !== want.pick) {
          changeLook = want.pick
          been.set('change-look', changeLook)
          changed('change', null)
          shotSettle = 2
          paintBranches()
          return
        }
      } else if (want.pick.includes(':')) {
        const cut = want.pick.indexOf(':')
        const wanted = { repo: want.pick.slice(0, cut), file: want.pick.slice(cut + 1) }
        if (!changePicked || changePicked.repo !== wanted.repo || changePicked.file !== wanted.file) {
          changePicked = wanted
          changeLook = 'files'
          been.set('change-look', changeLook)
          changed('change', null)
          changed('change-file', null)
          shotSettle = 3
          paintBranches()
          return
        }
      }
    }

    // The same for a branch, by name. Two tabs are built around a list and a
    // detail panel, and only one of them could be reached from outside.
    // NOT WHILE THE MERGE PANE IS OPEN, which has its own meaning for `pick`.
    // Without this the Merge pane's "repo:file" was also read as a branch name,
    // set as the selection, reset by the next paint because no such branch
    // exists, and set again — a photograph that never arrived and a window that
    // never settled, which looked like the pane being broken.
    if (want.pick && view === 'branches' && branchPane !== 'change' && pickedBranch !== want.pick) {
      pickedBranch = want.pick
      been.set('branch', pickedBranch)
      // The finder is cleared, or a branch that does not match whatever was last
      // typed is selected and not on screen -- a photograph of a detail panel
      // beside a list that does not contain it.
      $('branch-find').value = ''
      $('branch-mine').checked = false
      changed('branches', null)
      shotSettle = 2
      paintBranches()
      return
    }

    if (shotSettle > 0) { shotSettle--; return }
    // Left for `settle` to take. Otherwise a draw would beat it to the file and
    // the picture would be of the finished panel, which is the one thing it was
    // asked not to be.
    if (want.when === 'loading') return

    takeShot(want.file)
  }).catch(() => { shotInFlight = false })
}

// PHOTOGRAPHED ON DEMAND, rather than asked for and waited on.
//
// The window loads server.js in its own process, so it can simply hand back a
// function that takes the picture -- and `windowShot` calls it and returns when
// the file is on disk. What that replaced was a request left in a table for the
// next draw to notice, plus two or three more draws so the panel had filled:
// half a minute a picture, and a second request inside that window silently
// replaced the first.
//
// Whatever is being asked for is set up FIRST and then a frame is let through,
// because that is what the draws were buying -- a panel that has been switched
// to has not drawn yet, and an empty panel in a photograph reads as a rendering
// fault rather than as a timing one. It did, once, which is why the waiting was
// there at all.
app.onCapture(async want => {
  const [wantView, wantPane] = String(want.view || '').split('/')

  if (wantView && wantView !== view) {
    const tab = document.querySelector(`.tab[data-view="${wantView}"]`)
    if (!tab) throw new Error(`there is no tab called "${wantView}"`)
    tab.click()
  }

  // A pane inside the tab, and then whatever is picked within it -- each one a
  // narrower question about the same screen, in the order they nest.
  if (wantPane) {
    const t = document.querySelector(`#view-${view} .subtab[data-pane="${wantPane}"]`)
    if (t) t.click()
  }
  if (want.pick) await pickFor(view, want.pick)

  // Asked for BEFORE the wait, so it fires on the placeholder the setup above
  // just put up rather than on the next unrelated one.
  if (want.when === 'loading') {
    return new Promise(resolve => { catchLoading = { file: want.file, resolve } })
  }

  // Long enough for what was just switched to to have been read and drawn. The
  // panels answer asynchronously, so this is the same wait the draws were
  // standing in for, said as a duration instead of as a count of ticks.
  await new Promise(r => setTimeout(r, 400))
  await takeShot(want.file)
  return { bytes: null }
})

// Which row, once the right tab is open. Every tab that has a list has its own
// idea of what picking one means, and each of them already had one -- this is
// only the place they are reached from.
async function pickFor (v, pick) {
  if (v === 'tasks') {
    const t = (taskList || []).find(x => x.id === pick || String(x.number) === pick)
    if (t && pickedTask !== t.id) return pickTask(t.id, null)
    return
  }
  if (v === 'repos') {
    if (['todo', 'repos', 'issues', 'pulls'].includes(pick)) {
      const t = document.querySelector(`#view-repos .subtab[data-pane="${pick}"]`)
      if (t) t.click()
    } else if (pickedRepo !== pick) {
      pickedRepo = pick
      been.set('repo', pickedRepo)
      changed('repos', null); changed('repo-detail', null)
      paintRepos()
    }
    return
  }
  if (v === 'prcuts' && ['cuts', 'templates'].includes(pick)) {
    const t = document.querySelector(`#view-prcuts .subtab[data-pane="${pick}"]`)
    if (t) t.click()
    return
  }
  if (v === 'branches') {
    const t = document.querySelector(`#view-branches .subtab[data-pane="${pick}"]`)
    if (t) return t.click()
    if (pickedBranch !== pick) {
      pickedBranch = pick
      been.set('branch', pickedBranch)
      $('branch-find').value = ''
      $('branch-mine').checked = false
      changed('branches', null)
      paintBranches()
    }
  }
}

// Lifted out so a draw and a loading moment share one copy of it.
function takeShot (file) {
  shotInFlight = true
  return new Promise(done => {
    try {
      // Raw base64 rather than a data URI: it is written to a file, and the
      // `data:image/png;base64,` prefix would have to be sliced off again.
      host.capturePage().then(b64 => {
        try {
          const bytes = Buffer.from(b64, 'base64')
          host.writeFile(file, bytes)
          api('windowShotDone', { file, bytes: bytes.length })
        } catch (e) {
          api('windowShotDone', { file, error: e.message })
        } finally { shotInFlight = false; done() }
      })
    } catch (e) {
      shotInFlight = false
      api('windowShotDone', { file, error: e.message })
      done()
    }
  })
}
let shotInFlight = false
// Draws still to let pass before photographing, so a panel that was switched to
// has actually finished filling. See shotIfAsked.
let shotSettle = 0

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

  // A picture as well as the markup, because they answer different questions.
  //
  // The HTML says what the window is made of and can be searched, diffed and
  // read at leisure. It does not say what the window LOOKS like: a class that
  // matches no rule, a panel drawn off the bottom, text the same colour as its
  // background are all invisible in the markup and obvious in a photograph. The
  // one visual fault found so far was found by eye for exactly that reason.
  //
  // Taken first and awaited, so both files describe the same moment rather than
  // one being a second later than the other.
  const png = await host.capturePage()

  try {
    const { file, bytes, image } = await api('capture', { html, png })
    say(image
      ? `Copied to the clipboard. ${bytes} bytes to ${file}, and a picture beside it.`
      : `Copied to the clipboard, and saved ${bytes} bytes to ${file}`)
  } catch (err) {
    oops(err)
  }
}

document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
    e.preventDefault()
    // Announced BEFORE it is taken, and saying which tab, so anything watching
    // the stream knows a capture is coming and what it will be of. The action
    // logs the file afterwards; this logs the intent, and the two together are
    // what let a session following along say "they just photographed the
    // Branches tab" rather than noticing a file appear.
    liveLog.on('window').info(`asked for a capture of ${view} — Ctrl+Shift+D`)
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

// `keys-get` was wired here. Getting a credential is now a button on the card
// that describes the one it replaces, beside the button that tests it.
paintActions().catch(oops)
draw().then(sync).catch(e => say(e.message, 'bad'))
