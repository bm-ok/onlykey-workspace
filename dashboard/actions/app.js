'use strict'

// The window itself, the log, and what this process is.
// 
// Holds the mutable bits nothing else may touch: the pending photograph,
// how long a loading state is held, and the window's own capture
// function. They live together because they are read and written by
// each other and by nothing else.
//
// Part of the one table every caller reaches: see actions/table.js for why
// these are in separate files and still one surface.

// The table itself, so an action can call another by name. Required rather
// than passed, and read inside a `run` rather than at load time, which is what
// lets these files be split at all -- at load time half of them do not exist
// yet, and by the time anything runs they all do.
const actions = require('./table')

// Everything the table is built out of, in one place rather than a require
// block repeated nine times. See actions/shared.js.
const s = require('./shared')
const {
  log, keys, ssh, data, secret, github, remotes, landings, prtemplate, drafts,
  vbox, vms, provisioner, scripts, channel, tasks, artifact, harness, approval,
  archive, files, workspaces, queue, machines, provision, reach, editor, repos,
  busy, session, dispatch, auth, branches, workspace, fs, path, https,
  started, net, inTheWay, refuseIfThatTitleIsTaken, refuseIfItHoldsACredential,
  guestPath, workFolder, credentialLife, rememberCredentialCheck, twoLines
} = s
const win = s.win

module.exports = {
  status: {
    about: 'Is the server up, and what does it have to work with',
    run: async () => ({
      ok: true,
      started,
      port: net.port,
      virtualbox: vbox.available() ? vbox.exe() : null,
      // WHICH REPOSITORIES THIS IS ABOUT, carried on the poll the window already
      // makes. It is the one piece of context that changes what nearly every
      // panel means -- a branch, a task and a baseline are all statements about
      // one folder -- so it belongs where the window can always see it rather
      // than behind a call somebody has to remember to make.
      //
      // NULL MEANS NONE IS OPEN, which is a state and not a failure. The window
      // reads it as "show the welcome landing and disable everything that is a
      // question about repositories", so it has to be told apart from the poll
      // having gone wrong -- hence `workspaceKnown`, which says how many folders
      // it could open, beside it.
      workspace: (() => {
        try {
          const now = workspaces.current()
          if (!now) return null
          return { name: now.name, dir: now.dir, repos: repos.list().length }
        } catch { return null }
      })(),
      workspaceKnown: (() => { try { return workspaces.known().length } catch { return 0 } })(),
      // Carried here rather than asked for separately, because it is read on
      // every paint and an extra call per panel to find out how long to pause
      // would be its own small joke.
      slowMs: win.slowMs,
      mine: vms.read().length,
      // Repositories left somewhere other than their default branch. Carried on
      // the poll because a dirty one will refuse a push whose owner cannot
      // possibly explain it, and the operator should meet that here rather than
      // as a machine's confusing failure an hour later.
      repos: (() => { try { return branches.blocking() } catch { return [] } })(),
      // Both ways the certificate stops working, checked against the address
      // machines are actually told to use rather than against any address.
      tls: await (async () => {
        try { return keys.state(await vbox.hostAddress()) } catch { return keys.state(null) }
      })()
    })
  },

  actions: {
    about: 'Every action this server has, with what each is for',
    run: async () => ({
      actions: Object.entries(actions).map(([name, a]) => ({ name, about: a.about, takes: a.takes || [] }))
    })
  },

  // The one way out of a certificate that no longer works -- expired, or no
  // longer naming this host because its address moved.
  //
  // Never automatic. Regenerating drops the trust of every machine that was
  // given the old authority, so it is a decision with a cost, and doing it
  // quietly on a mismatch would break machines to fix a warning.
  tlsRegenerate: {
    about: 'Make a new certificate for this host — every machine must then be set up again',
    run: async () => {
      const made = keys.ensure({ force: true })
      log.on('server').warn('A new certificate was made. Every machine has to be set up again before it can fetch or push.')
      return { covers: made.covers, fingerprint: made.fingerprint, dir: made.dir, restart: 'restart the dashboard for it to be served' }
    }
  },

  // ---- holding a moment still long enough to look at it ------------------
  //
  // A loading state lasts a fifth of a second. That is the right length to live
  // with and the wrong length to JUDGE: asking for a photograph from outside
  // takes longer than the state exists, so the picture always shows the finished
  // panel and the placeholder can never be checked. It was invisible for weeks
  // for exactly this reason -- every skeleton in the window was being created
  // and thrown away unseen, and nothing could have caught it from out here.
  //
  // So the app holds it, rather than something outside trying to be quick. Every
  // panel waits one frame before reading anything, which is where the skeleton
  // gets drawn; this makes that wait as long as you like.
  //
  // A SWITCH, NOT A SETTING. It is off unless somebody turns it on, it says so
  // in the window while it is on -- otherwise the next person to open the
  // dashboard finds it mysteriously slow and goes looking for a fault that is
  // not there -- and it changes nothing about what is read or when, only how
  // long the gap before it lasts.
  windowSlow: {
    about: 'Hold every loading state for this many milliseconds, so it can be seen and photographed. 0 turns it off',
    takes: ['ms'],
    run: ({ ms }) => {
      if (ms === undefined) return { ms: win.slowMs, on: win.slowMs > 0 }
      win.slowMs = Math.max(0, Math.min(10000, Number(ms) || 0))
      log.on('window')[win.slowMs ? 'warn' : 'info'](win.slowMs
        ? `loading states are being held for ${win.slowMs}ms — the window is deliberately slow until this is turned off`
        : 'loading states are back to their real length')
      return { ms: win.slowMs, on: win.slowMs > 0, note: win.slowMs ? 'Turn it off with --ms 0.' : 'Off.' }
    }
  },

  // ---- a picture of the window itself ------------------------------------
  //
  // `vmScreenshot` answers "what is that machine doing"; this answers "what does
  // this app actually look like", which had no answer at all. Everything in the
  // Tasks tab was built and driven from a terminal, and the only visual fault
  // found so far was found by a person's eye — a misspelt CSS class produces no
  // error, so a panel can be wrong in a way nothing reports.
  //
  // ASKED HERE, TAKEN THERE. `capturePage` exists only in the window: the node
  // side has no page to photograph. So this leaves a request, and the window
  // notices it on its next draw and answers. That is why it returns a path
  // rather than an image — the file appears a second or two later.
  windowShot: {
    about: 'Ask the window to photograph itself, optionally on a given tab or tab/pane, with something picked',
    takes: ['note', 'view', 'pick', 'when'],
    run: async ({ note, view, pick, when }) => {
      const file = path.join(data.sub('window'), `window-${data.stamp()}.png`)

      // TAKEN NOW, WHEN THE WINDOW IS HERE TO TAKE IT.
      //
      // This used to leave the request in the table for the window to notice on
      // its next draw, which is up to twelve seconds away, and then let two or
      // three more draws pass so the panel had filled -- half a minute for one
      // picture, and a second request in that window silently replaced the first.
      //
      // The polling was never necessary. The window loads this file IN ITS OWN
      // PROCESS, so it can hand back a function that photographs on demand, and
      // this waits for the file rather than for a clock. It registers that on
      // startup; see `onCapture`.
      //
      // The poll is kept as the fallback for the case it was actually written
      // for: nothing has registered because no window is open, which is how a
      // headless run and the tests load this file.
      if (win.capture) {
        try {
          const shot = await win.capture({ file, view: view || null, pick: pick == null ? null : String(pick), when: when === 'loading' ? 'loading' : null })
          if (note) log.on('window').info(note)
          return { file, ...shot, took: 'now' }
        } catch (e) {
          throw new Error(`The window could not photograph itself: ${e.message}`)
        }
      }

      // WHICH TAB, because otherwise only the one that happens to be open can
      // ever be checked. The window is the single part of this that fails
      // silently -- a class that matches no rule, a panel that stopped updating,
      // both of which have happened here -- and photographing it was the answer.
      // But a panel behind a tab nobody clicked is exactly as unverifiable as it
      // was before, and every new tab arrived that way: built, reasoned about,
      // and photographed only once somebody thought to switch to it.
      //
      // AND WHICH ONE IS PICKED, for the same reason one step further in. Half
      // this window is detail panels that show nothing until something in a list
      // is selected, and from outside there was no way to say which -- so the
      // photograph came back showing whichever row was last clicked by hand, and
      // a panel that only appears for one kind of row could not be reached at
      // all. `pick` is a task id or number; the window selects it before drawing.
      // WHEN, because some of what this window does lasts a fifth of a second.
      //
      // The ordinary shot is taken on a draw, after a couple have been let pass
      // so the panel has filled -- which is right for photographing a panel and
      // exactly wrong for photographing one that has NOT filled yet. A loading
      // state cannot be caught from out here at all: asking for it takes longer
      // than it exists, and the answer always shows the finished panel.
      //
      // So the window takes this one itself, at the moment it puts a placeholder
      // up and before it reads anything. Pair it with `windowSlow` to make that
      // moment long enough to be worth a picture.
      win.wantedShot = { file, note: note || null, view: view || null, pick: pick == null ? null : String(pick), when: when === 'loading' ? 'loading' : null, asked: Date.now() }
      return {
        file,
        view: view || null,
        pick: pick == null ? null : String(pick),
        note: 'The window takes it on its next draw — up to twelve seconds if nobody is looking at it. Read the file once it appears.'
      }
    }
  },

  // Read by the window, and by nothing else. Kept in the table rather than
  // hidden, because the table is what says an action exists.
  windowShotPending: {
    about: 'Whether a picture of the window has been asked for',
    run: () => win.wantedShot || { file: null }
  },

  windowShotDone: {
    about: 'The window reporting that it took the picture',
    takes: ['file', 'bytes', 'error'],
    run: ({ file, bytes, error }) => {
      win.wantedShot = null
      if (error) log.on('window').bad(`could not photograph itself: ${error}`)
      else log.on('window').good(`window saved to ${file} (${bytes} bytes)`)
      return { ok: !error }
    }
  },

  // ---- pre-defined work, declared the way tests are declared -------------
  //
  // The drills used to be prose in TEST-PLAN.md, which a person read and typed
  // out. Prose cannot report a status, cannot be listed in a window, and rots
  // against the code it describes. Declared with describe/it they can be
  // enumerated, chosen, run one at a time, and watched.
  //
  // Listing must be free of side effects: opening the dialog is not consent to
  // run anything.

  capture: {
    about: 'Save what the window currently looks like: the markup, and a picture of it',
    takes: ['html', 'png'],
    run: async ({ html, png }) => {
      const dir = data.state()
      const file = path.join(dir, 'capture.html')
      fs.writeFileSync(file, String(html || ''))

      // Beside the markup and named the same, because they are one capture of
      // one moment and separating them is how a picture ends up being compared
      // against markup from ten minutes later. The markup says what the window
      // is made of; only the picture says what it looks like, and the faults
      // that matter here — a class matching no rule, a panel off the bottom of
      // the screen — are invisible in the first and obvious in the second.
      let image = null
      if (png) {
        try {
          image = path.join(dir, 'capture.png')
          fs.writeFileSync(image, Buffer.from(String(png), 'base64'))
        } catch (e) {
          image = null
          log.on('capture').warn(`the picture could not be saved: ${e.message}`)
        }
      }

      log.on('capture').good(`Saved what the window looks like to ${file}${image ? `, and a picture to ${image}` : ''}`)
      return { file, bytes: String(html || '').length, image }
    }
  },

  logSince: { about: 'Log lines after an id, and every tag in use', takes: ['since'], run: ({ since }) => ({ entries: log.since(since), tags: log.tags() }) },

  // The only action that answers forever instead of once.
  //
  // An install is twenty-five minutes of silence and then everything at once, so
  // asking repeatedly either misses it or spends the whole time asking. `stream`
  // rather than `run` is what tells the socket to stay open; it is in this table
  // like everything else, because this table is what says an action exists and
  // one kept somewhere else would be missing from `okc` with no arguments.
  logWatch: {
    about: 'Follow the live log as it happens, until you stop it',
    takes: ['since'],
    stream: from => log.since(from || 0),
    subscribe: log.subscribe
  },

  logClear: { about: 'Empty the live log', run: () => { log.clear(); return { cleared: true } } }
}
