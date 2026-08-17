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

  // A machine that is running has a console tab, opened once and never taken
  // away. Here rather than in the machines panel, because a console is worth
  // having whatever tab somebody is on — and this is the one place that already
  // knows what every machine is doing. See mindConsoles in ui/terminal.js.
  mindConsoles(list)
  latest.credentialsHeld = held
  queueSays = new Map((running.machines || []).map(m => [m.name, m]))
  queueBusy = new Map((running.inFlight || []).map(f => [f.machine, f.task]))

  // THE BADGE IS SET HERE, not in the panel, because the panel is view-guarded
  // and a badge whose whole job is to be read from another tab cannot depend on
  // that tab being open. The answer is already in hand.
  const inLine = (running.waiting || []).length + (running.inFlight || []).length
  setText($('queue-badge'), inLine ? String(inLine) : '')
  $('queue-badge').classList.toggle('hidden', !inLine)

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

  // SOMEBODY ASKED TO BE ALLOWED TO RUN THE DRILLS, and it is a question for
  // whoever is at the keyboard rather than for whoever opens the Settings tab.
  // Raised wherever you are standing, on the poll that is already happening.
  //
  // Once per request, keyed on when it was made. A dialog that reappeared every
  // three seconds would be a dialog somebody dismisses without reading, which is
  // the opposite of asking.
  if (status.askedToTest) askToTest(status.askedToTest)
  // The count of machines used to be written here. It is the Settings button
  // now — a number the Runners tab states better was holding the one corner of
  // the chrome with no way in to anything.

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

  // THE DRILLS ARE ON. Its own banner, above the shared one and never part of
  // it — this is deliberate, it survives restarts by design, it is invisible
  // from every tab, and it means this app may write a task and take a credential
  // off a machine in THIS folder. Nothing else may push it out of the way.
  $('testing-banner').classList.toggle('hidden', !status.testingHere)
  if (status.testingHere && changed('testing-banner', ws && ws.name)) {
    // ONE SLIM LINE. It is permanent while testing is on, and a permanent thing
    // that costs two lines and fifty pixels is a thing that gets resented and
    // then ignored. What it has to do is be UNMISSABLE and say which folder —
    // the paragraph about what the drills actually do belongs on the Settings
    // card, where somebody is deciding, rather than repeated over every tab for
    // as long as it is switched on.
    fill($('testing-banner'),
      el('strong', { textContent: 'Testing mode' }),
      el('span', { textContent: ` — ${ws ? ws.name : 'this workspace'}. The drills may write a task and take a credential off a machine here.` }),
      el('button', {
        className: 'linky',
        textContent: 'Switch it off',
        onclick: () => showTab('settings')
      }))
  }

  $('trouble').classList.toggle('hidden', !trouble.length)
  if (changed('trouble', trouble)) {
    // A THIRD ELEMENT, OPTIONAL: where to go about it. Every line here describes
    // something somebody has to do something about, and until now every one of
    // them left them to work out where — which for a deliberate setting means
    // reading the sentence, agreeing, and then hunting for the switch.
    fill($('trouble'), trouble.map(([bold, rest, go]) => el('div', {},
      el('strong', { textContent: bold }),
      el('span', { textContent: rest }),
      go
        ? el('button', {
            className: 'linky',
            style: 'margin-left:8px',
            textContent: go.label,
            onclick: go.onClick
          })
        : null)))
  }

  paintWorkspace()
  paintRepos()
  paintTodo()
  paintConflicts()
  paintCuts()
  paintTemplates()
  paintVms()
  paintKeys()
  paintGithub()
  paintAppKeys()
  paintTerminal()
  paintBranches()
  paintTasks(running)
  // Handed the same answer the loop already fetched, rather than asking again —
  // `queueState` walks every machine. Its own view guard keeps it from drawing
  // behind a tab nobody is on.
  paintQueue(running)
  paintSessions()
  paintChat()
  // On the loop, not only when the sub-tab is clicked. It was wired to the
  // switcher alone, so a window opened with this pane already remembered drew
  // nothing at all — an empty column that looks exactly like having no guests.
  // Its own view guard is what keeps it from asking anything behind a tab.
  paintGuests()
  paintSupervisors()
  paintTests()
  paintSettings()
  paintAddTask()
  paintJobs()
  paintPrompts()
  paintContracts()

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

    // IN THE VIEW BEING ASKED FOR, not in the Branches tab.
    //
    // This was `#view-branches` hardcoded, written when Branches was the only
    // tab with sub-tabs. Three of them have panes now, and `tasks/contracts`
    // matched nothing here and photographed whichever pane had been left open —
    // a picture that looks like evidence and is of somewhere else, which is the
    // one failure a screenshot mechanism must not have.
    //
    // Read off `.active` rather than compared against that tab's own variable,
    // so a fourth tab with panes needs nothing added here.
    if (wantPane) {
      const inside = wantView || view
      const t = document.querySelector(`#view-${inside} .subtab[data-pane="${wantPane}"]`)
      if (t && !t.classList.contains('active')) {
        t.click()
        shotSettle = 2
        // Deliberately not returning: the view itself may still need switching,
        // and clicking a sub-tab inside a hidden view changes nothing on screen.
      }
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
    // WHICH SUB-TAB, first. The Tasks tab grew three of them and was the only
    // tab whose panes could not be reached from outside — so a photograph of
    // Jobs, Prompts or Contracts was a photograph of whichever one had been left
    // open, which is exactly the "measure before claiming" fault: a picture that
    // looks like evidence and is of somewhere else.
    // ASKED OF THE MARKUP, not from a list written here. This named the five
    // panes Tasks had, and three of them have since moved to their own tab —
    // so the list was wrong the moment they did, in a way nothing would report.
    // Whether a name is a pane is a question the document can answer.
    if (want.pick) {
      const t = document.querySelector(`#view-${view} .subtab[data-pane="${want.pick}"]`)
      if (t && !t.classList.contains('active')) {
        shotSettle = 2
        t.click()
        return
      }
    }

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

    // A PR-cuts-specific pane switch stood here. The generic one further up
    // does it for every view, so this was a second answer to a question already
    // answered — and it named a tab that no longer exists.

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
        forget('repos')
        forget('repo-detail')
        shotSettle = 2
        paintRepos()
        return
      }
    }

    // The Merge pane has a selection of its own: which of its two readings is
    // open, and which file. `commits` / `files`, or `repo:path` to open a file.
    if (want.pick && view === 'repos' && repoPane === 'changes') {
      if (want.pick === 'commits' || want.pick === 'files') {
        if (changeLook !== want.pick) {
          changeLook = want.pick
          been.set('change-look', changeLook)
          forget('change')
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
          forget('change')
          forget('change-file')
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
    if (want.pick && view === 'repos' && repoPane === 'branchcuts' && pickedBranch !== want.pick) {
      pickedBranch = want.pick
      been.set('branch', pickedBranch)
      // The finder is cleared, or a branch that does not match whatever was last
      // typed is selected and not on screen -- a photograph of a detail panel
      // beside a list that does not contain it.
      $('branch-find').value = ''
      forget('branches')
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
// HOW THE APP CLOSES ITSELF, handed over the same way the screenshot is and for
// the same reason: `nw.App.quit()` exists in the page and nowhere else. Without
// it the only way to restart after a code change is killing the process, which
// takes the window down mid-write instead of letting it close.
//
// Registered only where there is an app to register with — a browser has none,
// and `host.quit` says so by answering false rather than closing the tab.
if (app) app.onQuit(() => host.quit())

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
  //
  // 800 rather than 400, because a pane now yields a frame before it reads
  // anything -- `settle` is 250ms on its own -- and 400 photographed a panel
  // mid-load twice, which is the ambiguous picture this whole mechanism exists
  // to avoid: an empty panel is indistinguishable from a broken one.
  await new Promise(r => setTimeout(r, 800))
  await takeShot(want.file)
  // AND THE MARKUP, beside the picture and of the same moment.
  //
  // A photograph has to be looked at; markup can be searched, diffed and read.
  // Anything reading this window from outside — the command line, a session
  // following along — wants the second at least as often as the first, and used
  // to have only the first. Taken after the shot rather than before, so a
  // difference between them can only ever be the window having moved on, never
  // the order they were taken in.
  return { bytes: null, html: markupNow() }
})

// ---- driving the window from outside -----------------------------------
//
// The window was the one half of this app with no way in. Everything else is an
// action, reachable by the command line and by a drill; the window had a camera
// and nothing else — so a panel could be photographed and never operated, and
// every fault in a click handler was found by a person clicking it. Two of them
// shipped that way: a button wired to a function that did not exist, and a pane
// that painted and then swallowed what had been typed into it.
//
// A driven press is a REAL press. `.click()` runs exactly the handler a person's
// click runs, and a fill raises the same `input` and `change` events the fields
// listen for. A test that took a private path would be testing the path, not the
// button — which is the same reason the queue drives the actions rather than
// having its own way to the machines.
//
// VISIBLE ONLY, which is what makes "what is on screen" answerable at all. Every
// pane in this window is in the document the whole time and hidden with CSS, so
// the buttons of four other tabs are sitting there matching by name. `offsetParent`
// is null for anything `display:none`, and that is the whole filter.
//
// A DIALOG TAKES THE WHOLE SCREEN when one is open, because it is modal: nothing
// behind it can be pressed by a person either, and offering it would be offering
// something that does not work.
const seen = n => !!n.offsetParent
const words = n => (n.textContent || '').replace(/\s+/g, ' ').trim()

// The same, minus anything that is itself pressable. A card's title carries a
// settings cog and a badge or two; a name with a cog stuck to the end of it
// matches nothing anybody would type, and reads in the answer like a mistake.
const cardWords = n => [...n.childNodes]
  .filter(c => !(c.nodeType === 1 && (c.tagName === 'BUTTON' || c.classList.contains('badge'))))
  .map(c => (c.textContent || '').replace(/\s+/g, ' '))
  .join(' ')
  .replace(/\s+/g, ' ')
  .trim()

function drivingRegion () {
  const dlg = document.querySelector('.dlg-overlay .dlg')
  if (dlg) return { where: 'the open dialog', node: dlg, dialog: true }
  // Which pane, read off the markup for whichever view is open, rather than from
  // one view's variable. `windowControls` reported "tasks/board" and plain
  // "repos" for every other tab that has panes, which made the one answer this
  // returns depend on which tab somebody happened to be on.
  const open = document.querySelector(`#view-${view} .subtab[data-pane].active`)
  return { where: `${view}${open ? `/${open.dataset.pane}` : ''}`, node: document.body, dialog: false }
}

// The label a field goes by, in the words on the screen. `buildFields` puts a
// <label> immediately before its input, and a dialog's own fields do the same,
// so the previous sibling is the answer wherever there is one. The placeholder
// is the fallback, because a field with no label still has to be nameable.
function labelOf (n) {
  const prev = n.previousElementSibling
  if (prev && prev.tagName === 'LABEL') return words(prev)
  return n.placeholder || ''
}

// ONE MATCH OR A REFUSAL, never the first of several.
//
// Picking the first would work most of the time and be wrong silently the rest,
// which is the worst available behaviour for something whose whole job is to
// find out whether the window does what it says. "Clear" appears on two panes
// and "Throw it away" on four; being told so, with the list, is the useful
// answer. `nth` is how you then say which.
function theOne (all, text, nth, kind) {
  const want = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase()
  if (!want) throw new Error(`Say which ${kind}, by the words on it. Ask for windowControls to see what is there.`)
  const exact = all.filter(x => x.label.toLowerCase() === want)
  const some = exact.length ? exact : all.filter(x => x.label.toLowerCase().includes(want))
  if (!some.length) {
    throw new Error(`There is no ${kind} reading "${text}" on screen. What is there: ${all.map(x => `"${x.label}"`).join(', ') || 'nothing'}.`)
  }
  if (some.length > 1 && nth == null) {
    throw new Error(`"${text}" matches ${some.length} of them: ${some.map((x, i) => `${i + 1}. "${x.label}"`).join(', ')}. Say which with --nth.`)
  }
  const at = nth == null ? 0 : Number(nth) - 1
  if (!some[at]) throw new Error(`There is no ${at + 1} — "${text}" matches ${some.length}.`)
  return some[at]
}

if (app) app.onDrive(async want => {
  // MARKED BEFORE ANYTHING IS TOUCHED, and left marked. Everything this press
  // sets off is the command line's doing, however long it takes to finish. See
  // drivenFromTheWire in ui/base.js for why a person's touch is what clears it.
  drivingNow(true)

  const region = drivingRegion()
  // BUTTONS, AND THE CARDS THAT ARE ALSO BUTTONS.
  //
  // Half of this window is chosen rather than pressed: a machine, a task, a
  // suite, a cut. Those are cards with a click handler and the class `pick`, and
  // to the driver they did not exist — so a machine could be started, stopped
  // and deleted from the command line, and could not be SELECTED. Every test
  // that needed a particular one had to arrange for it to be the first in the
  // list, which is arranging the world to suit the instrument.
  //
  // A card's label is its title, which is the same thing a person reads. It is
  // marked as a pick rather than a button so the answer still says which is
  // which: pressing "Delete it" and choosing "runner4" are different acts and
  // should not read the same in a log.
  const buttons = [
    ...[...region.node.querySelectorAll('button')]
      .filter(seen)
      .map(n => ({ node: n, label: words(n), disabled: !!n.disabled, why: n.title || '' })),
    ...[...region.node.querySelectorAll('.pick')]
      .filter(seen)
      .filter(n => typeof n.onclick === 'function')
      .map(n => ({
        node: n,
        // The title's own words, WITHOUT the buttons sitting inside it. A card
        // title holds a settings cog and sometimes a badge, and reading the lot
        // gave "runner4⚙" — which matches nothing anybody would type and reads
        // like a typo in the answer.
        label: cardWords(n.querySelector('.card-title') || n),
        picks: true,
        disabled: false,
        why: n.classList.contains('on') ? 'already chosen' : 'choose it'
      }))
      .filter(x => x.label)
  ]
  const fields = [...region.node.querySelectorAll('input, select, textarea')]
    .filter(seen)
    .map(n => ({
      node: n,
      label: labelOf(n),
      kind: n.tagName.toLowerCase(),
      value: n.value,
      options: n.tagName === 'SELECT' ? [...n.options].map(o => o.textContent.trim()) : null
    }))

  const strip = x => ({ ...x, node: undefined })

  if (want.do === 'controls') {
    return {
      on: region.where,
      dialog: region.dialog,
      // The title too, because a dialog is a question and the question is the
      // point. Reading back "there is a dialog with a Throw it away button" and
      // not what it is about is how the wrong thing gets confirmed.
      asking: region.dialog ? words(document.querySelector('.dlg-title')) : null,
      buttons: buttons.map(strip),
      fields: fields.map(strip)
    }
  }

  if (want.do === 'fill') {
    const one = theOne(fields, want.label, want.nth, 'field')
    const before = one.node.value
    one.node.value = want.value == null ? '' : String(want.value)
    // A SELECT ONLY TAKES WHAT IT HAS. Assigning a value it has no option for
    // leaves it empty, which reads as a real choice — "none" is a real answer in
    // half the dropdowns here — so it is checked rather than reported as done.
    if (one.kind === 'select' && one.node.value !== String(want.value == null ? '' : want.value)) {
      one.node.value = before
      throw new Error(`"${one.label}" has no option "${want.value}". It offers: ${one.options.map(o => `"${o}"`).join(', ')}.`)
    }
    // THE EVENTS A PERSON'S TYPING RAISES, because that is what the fields are
    // listening for: the add-task pane keeps what is typed by recording on
    // `input`, and the prompt picker fills three other fields on `change`.
    // Setting `.value` alone raises neither, so a filled form would look right
    // on screen and be empty everywhere it mattered.
    one.node.dispatchEvent(new Event('input', { bubbles: true }))
    one.node.dispatchEvent(new Event('change', { bubbles: true }))
    return { on: region.where, filled: one.label, was: before, now: one.node.value }
  }

  if (want.do === 'click') {
    const one = theOne(buttons, want.text, want.nth, 'button')
    // SAYING WHICH ONE, WITHOUT PRESSING IT.
    //
    // Matching is by the words on the button, so the thing you have to be sure
    // of is that your words picked the button you meant — and the only way to
    // find out was to press it. That cost somebody's half-written task: a click
    // meant to test the "matches several" refusal named a button that turned out
    // to match exactly one, which was "Clear", which cleared the form.
    //
    // Ambiguity already refuses. This is the other half: an UNambiguous match
    // that is unambiguously the wrong button.
    if (want.dry) {
      return {
        on: region.where,
        would: one.label,
        picks: !!one.picks,
        disabled: one.disabled,
        why: one.why || null,
        note: 'Nothing was pressed. Run it again without --dry to press it.'
      }
    }
    // REFUSED RATHER THAN PRESSED AND IGNORED. A disabled button does nothing
    // when clicked, so driving one would report success and change nothing —
    // and half the buttons here are deliberately disabled with the reason in
    // their title, which is exactly what somebody testing wants to read.
    if (one.disabled) {
      throw new Error(`"${one.label}" is disabled${one.why ? `: ${one.why}` : ' and says no reason'}.`)
    }
    one.node.click()
    // Long enough for what the press caused to have happened — a dialog to open,
    // a pane to switch, a request to come back. Said as a duration for the same
    // reason the screenshot's wait is: the work is asynchronous and there is no
    // count of frames that means "done".
    await new Promise(r => setTimeout(r, 600))
    const after = drivingRegion()
    return {
      [one.picks ? 'chose' : 'clicked']: one.label,
      on: region.where,
      // WHERE IT LANDED, because that is the assertion. A click that was meant
      // to switch panes and did not is the failure being looked for, and it is
      // invisible in "clicked: ok".
      now: after.where,
      asking: after.dialog ? words(document.querySelector('.dlg-title')) : null
    }
  }

  throw new Error(`"${want.do}" is not something that can be done to the window.`)
})

// Which row, once the right tab is open. Every tab that has a list has its own
// idea of what picking one means, and each of them already had one -- this is
// only the place they are reached from.
async function pickFor (v, pick) {
  // A SUB-TAB FIRST, IN WHICHEVER VIEW, asked of the markup rather than from a
  // list kept here. A pane nobody can reach from outside is a pane nobody has
  // seen, which is the whole reason this exists — and a hardcoded list of pane
  // names goes stale the first time one moves, silently.
  const pane = document.querySelector(`#view-${v} .subtab[data-pane="${pick}"]`)
  if (pane) { pane.click(); return }

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
      forget('repos'); forget('repo-detail')
      paintRepos()
    }
    return
  }
  if (v === 'repos') {
    if (pickedBranch !== pick) {
      pickedBranch = pick
      been.set('branch', pickedBranch)
      $('branch-find').value = ''
      forget('branches')
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
// Ctrl+Shift+D saves what is on screen -- the rendered DOM, not the source -- to
// state/capture.html, and a picture beside it. The clipboard is offered rather
// than taken: the notice carries a button that copies the two paths.

// THE RENDERED DOM, with the stylesheets inlined so it opens on its own.
//
// Pulled out of `capture` because `windowShot` wants exactly the same thing:
// markup is searchable and a picture is not, and the two answer different halves
// of "what does the window look like" — a class matching no rule is invisible in
// the markup and obvious in the picture, and a value drawn from the wrong field
// is the other way round. Written twice, they would have drifted, and the one
// that drifted would be the one nobody was reading.
function markupNow () {
  const css = [...document.styleSheets].map(sheet => {
    try { return [...sheet.cssRules].map(r => r.cssText).join('\n') } catch { return '' }
  }).join('\n')
  return `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>captured</title>\n<style>\n${css}\n</style>\n</head>\n${document.body.outerHTML}\n</html>\n`
}

async function capture () {
  const html = markupNow()

  // THE CLIPBOARD IS NOT TAKEN. It was, and it took it silently: a quarter of a
  // megabyte of markup replaced whatever was being carried between two windows,
  // for a capture that had already been written to disk and did not need it.
  // Anything that overwrites something a person is holding has to be asked for,
  // and the thing actually worth copying is the two paths, which is a button in
  // the notice below.

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
    const paths = [file, image].filter(Boolean)
    say(
      image
        ? `Captured ${view} — ${bytes} bytes of markup, and a picture beside it.`
        : `Captured ${view} — ${bytes} bytes of markup.`,
      'ok',
      {
        // Long enough to read two paths and decide, rather than long enough to
        // notice something happened. The button is the point of the notice now,
        // and six seconds is not enough time to reach one.
        lasts: 25000,
        does: [{
          label: paths.length > 1 ? 'Copy both paths' : 'Copy the path',
          title: paths.join('\n'),
          onClick: async bar => {
            try {
              await navigator.clipboard.writeText(paths.join('\n'))
              // Said in the bar that was pressed, not in a new one. A confirmation
              // that replaces the thing it is confirming leaves nothing on screen
              // to have been confirmed.
              const was = bar.querySelector('span')
              if (was) was.textContent = `Copied ${paths.length === 1 ? 'the path' : 'both paths'} to the clipboard.`
            } catch (e) {
              oops(new Error(`the clipboard would not take it: ${e.message}`))
            }
          }
        }]
      })
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
