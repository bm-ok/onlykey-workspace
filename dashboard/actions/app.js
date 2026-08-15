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
  log, events, keys, ssh, data, secret, settings, github, remotes, landings, prtemplate, drafts, judgements,
  vbox, vms, provisioner, scripts, channel, tasks, artifact,
  archive, files, prompts, jobs, jobrun, workspaces, queue, machines, provision, reach, editor, repos,
  busy, session, dispatch, auth, branches, workspace, fs, path, https,
  started, net, inTheWay, refuseIfThatTitleIsTaken, refuseIfItHoldsACredential,
  guestPath, workFolder, credentialLife, rememberCredentialCheck, twoLines
} = s
const win = s.win

// ASKED OF THE WINDOW, or refused in a sentence that says why there is nobody to
// ask. A headless run and the tests load this file with no page at all, and a
// window that has not finished starting has not registered yet — both read as
// "nothing answered", and the answer to both is the same: this needs the window,
// and there is not one.
const drive = want => {
  if (!win.drive) throw new Error('No window is open, so there is nothing to press. This drives the real buttons in the real window; start the dashboard and try again.')
  return win.drive(want)
}

module.exports = {
  status: {
    about: 'Is the server up, and what does it have to work with',
    run: async () => ({
      ok: true,
      started,
      // WHAT HAPPENED TO THE LAST ONE, carried across the restart.
      //
      // From outside, every way a dashboard goes away looks identical: a
      // launcher exits, a socket stops answering, a background command reports
      // that it finished. Whoever reads that fills the gap with whatever they
      // were already expecting — which is how a restart from the keyboard got
      // reported here as a process detaching.
      //
      // So the previous instance leaves a note and this one reads it. `asked`
      // says which door it came through; nothing can say who typed it, and a
      // field claiming to would be the same guess with better handwriting.
      //
      // No note means it was not asked — it died, or it is the first run since
      // the file was cleared. Both are worth knowing and neither is a fault.
      lastClose: (() => {
        try {
          const was = JSON.parse(fs.readFileSync(path.join(data.state(), 'last-close.json'), 'utf8'))
          // Only if it happened BEFORE this one started. A note newer than this
          // process belongs to an instance that is still going somewhere else.
          return was.at && was.at < started ? was : null
        } catch { return null }
      })(),
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
      // WHETHER THE DRILLS ARE ON RIGHT NOW, and for here. On the poll because
      // the banner is drawn from it, and because this is the one setting whose
      // being forgotten is the whole risk: it is deliberate, it is invisible
      // from every tab, and it stays on across restarts by design.
      testingHere: (() => {
        try { return settings.testsAllowed(workspaces.dir() || null).allowed } catch { return false }
      })(),
      // A REQUEST WAITING TO BE ANSWERED, carried on the poll the window already
      // makes rather than behind a call somebody has to remember. It is a
      // question for whoever is at the keyboard, wherever they are standing —
      // the same reason the trouble banner rides here.
      askedToTest: (() => {
        try {
          const a = settings.read().testsAsked
          if (!a) return null
          // Only about the folder open now. A request raised against a workspace
          // that has since been closed is not a question anybody can answer.
          const open = workspaces.dir() || null
          return open && a.forDir === open ? a : null
        } catch { return null }
      })(),
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
    about: 'Ask the window to photograph itself and save its markup, optionally on a given tab or tab/pane, with something picked',
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

          // THE MARKUP BESIDE THE PICTURE, always, because they answer
          // different halves of one question and the cost of the second is a
          // file write.
          //
          // A picture has to be looked at. Markup can be searched, diffed and
          // read — "does this pane say the job's name or its id" is one grep
          // and one squint, and only one of those scales to a window with forty
          // rows on it. Same name, so the pair cannot be separated.
          const { html, ...rest } = shot || {}
          let markup = null
          if (html) {
            markup = file.replace(/\.png$/, '.html')
            try {
              fs.writeFileSync(markup, String(html))
            } catch (e) {
              markup = null
              log.on('window').warn(`the markup could not be saved: ${e.message}`)
            }
          }
          return { file, markup, ...rest, took: 'now' }
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

  // ---- what this app is set to -------------------------------------------
  //
  // App settings, not workspace settings. A branch, a task and a line are
  // statements about a folder of repositories; these are statements about this
  // installation, so they survive switching workspace, closing one, and having
  // none open. See core/settings.js.
  settings: {
    about: "What this app is set to, and why each one is where it is",
    run: () => {
      const now = settings.read()
      const open = workspaces.dir() || null
      return {
        settings: now,
        // The derived answer as well as the two fields it comes from, because
        // "enabled" alone is not the question anything actually asks — enabled
        // for somewhere else is not enabled.
        tests: { ...settings.testsAllowed(open), enabled: now.testsEnabled, forDir: now.testsFor, openDir: open },
        where: settings.FILE()
      }
    }
  },

  settingSet: {
    about: 'Change one setting. Turning the drills on is done in the window, by a person',
    takes: ['name', 'value'],
    run: ({ name, value, _overTheWire, _driven }) => {
      const key = String(name || '').trim()
      if (!(key in settings.DEFAULTS)) {
        throw new Error(`"${key}" is not a setting. It is one of: ${Object.keys(settings.DEFAULTS).join(', ')}.`)
      }

      // TURNING THE DRILLS ON IS NOT SOMETHING THE PIPE MAY DO.
      //
      // The refusal in suiteRun is worth nothing if whatever is refused can
      // switch it off first — a guard a caller can disable is a guard that only
      // stops callers who were not going to do it anyway. This is the same rule
      // as approving a job: a model may ask for the drills and may not decide
      // that somebody's repository is a fine place to run them.
      //
      // `_driven` counts as the pipe. A press made in the window BY the command
      // line is still the command line, which is the whole reason that mark
      // exists — see whoAsked in actions/shared.js.
      if (key === 'testsEnabled' && (_overTheWire || _driven)) {
        throw new Error('The drills are switched on in the window, by somebody who knows what folder is open. They write a task and take a credential off a machine — that is a decision about somebody\'s repository, not a flag to be set down a pipe.')
      }

      const on = value === true || value === 'true' || value === 1 || value === '1'
      const patch = key === 'testsEnabled'
        // Enabled is always enabled FOR the folder open right now, written in
        // the same act. Two calls to set two fields is two chances to end up
        // enabled for nowhere, or for whatever was open last week.
        ? { testsEnabled: on, testsFor: on ? (workspaces.dir() || null) : null }
        : { [key]: value }

      const now = settings.write(patch)
      log.on('app').warn(key === 'testsEnabled'
        ? (on ? `the drills are ON for ${now.testsFor} — they write a task and take a credential off a machine` : 'the drills are off')
        : `${key} is now ${JSON.stringify(now[key])}`)
      return { settings: now, note: key === 'testsEnabled' && on ? `On for ${now.testsFor}. Opening a different workspace switches them off.` : 'Saved.' }
    }
  },

  // ASKING TO BE ALLOWED, which is the one thing the pipe MAY do about this.
  //
  // The refusal in settingSet is right and it left a model with nowhere to go:
  // it can want the drills run and cannot say so, which in practice means
  // somebody types the request into a chat window and it is lost the moment the
  // conversation moves on. This puts the question where the answer is.
  //
  // It changes nothing by itself. What it does is raise a hand — the window
  // notices on its next draw and asks, wherever you happen to be standing.
  testsAsk: {
    about: 'Ask to be allowed to run the drills. A person answers in the window',
    takes: ['why'],
    run: ({ why }) => {
      const open = workspaces.dir() || null
      if (!open) throw new Error('No workspace is open, so there is nothing to ask about.')
      const already = settings.testsAllowed(open)
      if (already.allowed) return { asked: false, note: 'The drills are already allowed here. Nothing to ask.' }

      const reason = String(why || '').trim()
      if (!reason) throw new Error('Say what they are wanted for. A request with no reason is one somebody has to interrupt you to understand, which is the thing this exists to avoid.')

      const now = settings.write({ testsAsked: { at: new Date().toISOString(), why: reason, forDir: open } })
      log.on('app').warn(`asked to run the drills against ${open}: ${reason}`)
      return { asked: true, request: now.testsAsked, note: 'Asked. The window will put the question up; nothing runs until somebody answers it.' }
    }
  },

  // ANSWERED IN THE WINDOW, by somebody who can see which folder is open.
  //
  // Refused down the pipe for the same reason settingSet is: a request that
  // could answer itself is not a request. `_driven` counts as the pipe — a press
  // made in the window BY the command line is still the command line.
  testsAnswer: {
    about: 'Answer a request to run the drills — yes for this workspace, or no',
    takes: ['allow'],
    run: ({ allow, _overTheWire, _driven }) => {
      if (_overTheWire || _driven) {
        throw new Error('A request to run the drills is answered in the window, by somebody who can see which folder is open. Something that could answer its own request has not asked for anything.')
      }
      const yes = allow === true || allow === 'true' || allow === 1 || allow === '1'
      const asked = settings.read().testsAsked
      const open = workspaces.dir() || null

      if (!yes) {
        settings.write({ testsAsked: null })
        log.on('app').info('the request to run the drills was declined')
        return { allowed: false, note: 'Declined. Nothing changed, and the request is cleared.' }
      }

      // The folder is checked rather than taken from the request. A request
      // raised against one workspace and answered after switching to another
      // would otherwise turn the drills on somewhere nobody was asked about.
      if (asked && asked.forDir && open && asked.forDir !== open) {
        settings.write({ testsAsked: null })
        throw new Error(`That was asked about ${asked.forDir}, and the folder open now is ${open}. The request is cleared rather than answered — ask again here if that is what is wanted.`)
      }
      if (!open) throw new Error('No workspace is open, so there is nothing to allow.')

      const now = settings.write({ testsEnabled: true, testsFor: open, testsAsked: null })
      log.on('app').warn(`the drills are ON for ${now.testsFor} — they write a task and take a credential off a machine`)
      return { allowed: true, settings: now, note: `On for ${now.testsFor}. Opening a different workspace switches them off.` }
    }
  },

  // ---- driving the window ------------------------------------------------
  //
  // The window is the one half of this app that could not be exercised from
  // outside. Everything else is an action; the window had a camera, so a panel
  // could be photographed and never operated — and the faults that live in click
  // handlers were all found by somebody clicking them.
  //
  // These press the real buttons and fill the real fields, so what they test is
  // what a person gets. A driven press is MARKED as coming from here and the
  // mark travels with everything it causes: nothing is refused because of it —
  // testing the approve button means being able to press it — but the record
  // says "the command line, driving the window" rather than claiming a person
  // read it. See `whoAsked` in actions/shared.js.
  //
  // This is a developer's door and it is on the local pipe, which is a thing a
  // supervisor running in its own machine cannot reach. See ROADMAP.md.
  windowControls: {
    about: 'What is on screen right now: the buttons that can be pressed and the fields that can be filled',
    run: () => drive({ do: 'controls' })
  },

  windowClick: {
    about: 'Press a button in the window, by the words on it. --dry says which one it would press',
    takes: ['text', 'nth', 'dry'],
    run: ({ text, nth, dry }) => drive({ do: 'click', text, nth: nth == null ? null : Number(nth), dry: dry === true || dry === 'true' })
  },

  windowFill: {
    about: 'Type into a field in the window, by its label',
    takes: ['label', 'value', 'nth'],
    run: ({ label, value, nth }) => drive({ do: 'fill', label, value, nth: nth == null ? null : Number(nth) })
  },

  // Read by the window, and by nothing else. Kept in the table rather than
  // hidden, because the table is what says an action exists.
  windowShotPending: {
    about: 'Whether a picture of the window has been asked for',
    run: () => win.wantedShot || { file: null }
  },

  // WHAT HAPPENED WHILE NOBODY WAS WATCHING.
  //
  // The live log is what is happening now and dies with the process — which is
  // every few minutes while this app is being worked on. So a restart and the
  // task somebody wrote after it left no trace of either, and whoever read the
  // gap afterwards filled it with what they expected.
  //
  // This is the kept half: the app's own acts, across restarts. See
  // core/events.js for what is kept and, more importantly, what is not — no
  // command output and nothing a guest said, because that is where credentials
  // and sign-in URLs live.
  events: {
    about: 'What this app has done, kept across restarts — tasks, branches, the queue, and its own starts and stops',
    takes: ['since', 'limit'],
    run: ({ since, limit } = {}) => {
      const rows = events.all({ since: since || null, limit: Number(limit) || 200 })
      return {
        events: rows,
        // The newest timestamp, to pass back as `since` next time. A bookmark,
        // like vmSessionTail's — reading the whole record every time is how a
        // watcher spends its attention re-reading what it already knows.
        bookmark: rows.length ? rows[rows.length - 1].at : (since || null),
        where: events.FILE(),
        kept: events.KEEP ? [...events.KEEP].join(', ') : '',
        note: rows.length
          ? 'The app\'s own acts. Command output and anything a guest said are deliberately not here — see the live log for those, while it lasts.'
          : 'Nothing kept yet.'
      }
    }
  },

  // CLOSING IT, THE WAY CLOSING IT IS MEANT TO HAPPEN.
  //
  // The window loads server.js at startup, so every code change needs a restart
  // — and the only way to do that from outside was to kill the process, which
  // takes the window down mid-anything rather than letting it close. It also
  // meant reaching for a process list to do something the app knows how to do.
  //
  // `nw.App.quit()` lives in the page and nowhere else, so the window hands it
  // back the same way it hands back its own screenshot. See server.js `onQuit`.
  //
  // ANSWERED BEFORE IT GOES. The reply is written first and the quit is left to
  // the next tick, because a process that exits inside the call is a caller
  // holding a socket that closed with no answer — which reads as a crash rather
  // than as the thing it asked for.
  //
  // Headless has no window and exits itself. A machine that is running stays
  // running: it is a virtual machine, not a child process.
  appQuit: {
    about: 'Close the dashboard. Machines that are running keep running',
    run: ({ _overTheWire } = {}) => {
      const how = win.quit ? 'the window' : 'the process'

      // SAID IN THE LOG, BECAUSE A CLOSE LEAVES NO OTHER TRACE.
      //
      // Everything downstream of a dashboard going away looks the same from
      // outside: a launcher exits, a socket stops answering, a background
      // command reports that it finished. Without a line here, "it was asked to
      // close" and "it died" are indistinguishable afterwards — and the guess
      // that gets made is whichever one the reader was already expecting. That
      // happened: a restart from the keyboard was read as a process detaching.
      //
      // WHICH SURFACE, NOT WHO. `_overTheWire` separates the window from the
      // command line and nothing separates one command line from another, so
      // this says the door it came through and stops. A line claiming to know
      // who typed it would be the same guess with better handwriting.
      const asked = _overTheWire ? 'from the command line' : 'in the window'
      log.on('app').warn(`closing ${how} — asked ${asked}`)

      // AND WRITTEN DOWN, BECAUSE THE LOG DIES WITH THE PROCESS. The live log is
      // memory only, so a line saying "this was asked to close" is gone by the
      // moment anybody could read it — which is after the restart. This survives,
      // and `status` reports it, so the next instance can say what happened to
      // the last one instead of leaving it to be guessed.
      try {
        fs.mkdirSync(data.state(), { recursive: true })
        fs.writeFileSync(path.join(data.state(), 'last-close.json'), JSON.stringify({
          at: new Date().toISOString(), closed: how, asked
        }, null, 2))
      } catch { /* it is a note, not the act */ }
      setTimeout(() => {
        try {
          if (win.quit) win.quit()
          else process.exit(0)
        } catch { process.exit(0) }
      }, 50)
      return {
        closing: how,
        note: how === 'the window'
          ? 'It is closing itself. Anything on a machine keeps running — the dashboard is not what holds it up.'
          : 'No window is attached, so the process exits. Anything on a machine keeps running.'
      }
    }
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
