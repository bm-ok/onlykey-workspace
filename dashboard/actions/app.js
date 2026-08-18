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
// The conversation, for counting what the supervisor has said since the
// person's own bookmark — see  below.
const chat = require('../core/chat')
// Whether the drills are running, for the banner that says so. See status.
const testruns = require('../core/testruns')

const {
  log, events, keys, ssh, data, secret, settings, github, remotes, allowed, landings, prtemplate, drafts, judgements,
  vbox, vms, provisioner, scripts, channel, tasks, artifact,
  archive, files, prompts, jobs, contracts, judging, jobrun, workspaces, queue, machines, provision, reach, editor, repos,
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

// WHETHER THE WINDOW MAY BE DRIVEN AT ALL, asked in one place.
//
// The same switch as the drills, on purpose. A driven click is indistinguishable
// from a person's click once it reaches the handler — that is what makes it
// worth having and what makes it the way around every refusal written about the
// wire. Tying it to testing mode means the door is open exactly while somebody
// has said, at the window, which folder they do not mind being driven.
const mayDrive = what => {
  const may = settings.testsAllowed(workspaces.dir() || null)
  if (!may.allowed) {
    throw new Error(`The window is only driven while testing mode is on for this workspace. ${may.why} Until then this cannot ${what} — a driven press reaches the same handlers a person's does, so it would be a way around every refusal this app makes about the command line. Ask with testsAsk, and answer it at the window.`)
  }
}

module.exports = {
  // ---- WHAT IS WAITING ON A PERSON -----------------------------------------
  //
  // The tab strip has badges and three of them were never set: `judge-badge`
  // and `chat-badge` are in the markup and nothing ever wrote to them, and the
  // two tabs where somebody is most often BLOCKING — Repositories and Actions —
  // had no badge at all. So a job sat unapproved and a pull request sat drafted
  // and unsent, and the only way to find either was to be told.
  //
  // ONE ACTION RATHER THAN A COUNT PER PANEL, because the panels are
  // view-guarded: a tab that is not open asks nothing, which is exactly right
  // for a panel and exactly wrong for a badge whose whole job is to be read
  // from somewhere else. Counted here, in one pass, and the window sets every
  // badge from the one answer.
  //
  // ONLY WHAT A PERSON MUST DO. Not "what is happening" — the queue badge says
  // that, and a badge that counts things in flight is a badge that is always
  // lit. Every line below is something that STOPS until somebody acts:
  //
  //   an approval        a model may write a job, a prompt or a contract and
  //                      may not ratify one. Nothing runs until somebody reads
  //                      it, and nothing said so.
  //   a verdict          a judgement a PERSON is reading has no other end. And
  //                      a worker's judgement that finished without sending one
  //                      is a fault, not a wait — counted, and said differently.
  //   a change to send   work that is drafted, or a line proposed, and not out.
  //                      The supervisor is allowed to cut a PR and parks anyway;
  //                      nothing on screen showed that it had.
  //   the supervisor     what it said since you last moved your bookmark.
  //
  // NOTHING HERE TOUCHES GIT, VIRTUALBOX OR GITHUB. It is read off this host's
  // own files, because it is called on the draw loop — see the rule about paint
  // functions in CLAUDE.md, which this would otherwise break for every tab at
  // once.
  waiting: {
    about: 'What is waiting on a person: approvals, verdicts, changes to send, and what the supervisor said',
    run: () => {
      const why = []
      const count = (n, one, many) => { if (n) why.push(`${n} ${n === 1 ? one : many}`) }

      // ---- approvals ------------------------------------------------------
      // AND WHERE EACH ONE IS, because there are two libraries and they live on
      // two different tabs.
      //
      // A job, a prompt or a contract carries `kind`: "task" ones are under
      // Actions, "judge" ones under Judge → Judges. The first version of this
      // counted them together and put the number on Actions — so three judging
      // artifacts waiting to be read lit a badge on a tab they are not on, and
      // the banner's "Read them" opened a pane where they are not. Reported as
      // a button that fails to switch, which is exactly what it looked like.
      const forWhom = it => (String(it.kind || 'task') === 'judge' ? 'judge' : 'task')
      const unapproved = [
        ...jobs.all().filter(j => !j.approved).map(j => ({ kind: 'job', of: forWhom(j), id: j.id, name: j.name })),
        ...prompts.all().filter(p => !p.approved).map(p => ({ kind: 'prompt', of: forWhom(p), id: p.id, name: p.name })),
        ...contracts.all().filter(c => !c.approved).map(c => ({ kind: 'contract', of: forWhom(c), id: c.id, name: c.name }))
      ]
      count(unapproved.length, 'thing to approve', 'things to approve')

      // ---- verdicts, and judgements that ended without one -----------------
      const all = judging.read()
      const mine = all.filter(j => j.by === 'person' && j.state === 'done' && !j.verdict)
      const mute = all.filter(j => j.by !== 'person' && j.state === 'done' && !j.verdict)
      count(mine.length, 'judgement to decide', 'judgements to decide')
      count(mute.length, 'judgement that ended without a verdict', 'judgements that ended without a verdict')

      // ---- work that is ready and has not gone out -------------------------
      //
      // A draft is a title and a body somebody wrote for a pair of lines and
      // did not cut. It is the state the supervisor parks in, deliberately, and
      // it was invisible.
      // ---- WORK THAT IS OUT AND NOT IN ------------------------------------
      //
      // A DRAFT IS NOT THIS. The first version counted PR drafts -- a title
      // and a body somebody wrote and did not cut -- and a draft is a note
      // you left yourself, not a thing that has stopped. It also outlives
      // its subject: one sat here for four days after its work had landed,
      // pointing at a pane where pressing anything would be refused with
      // "carries nothing that default does not already have". A badge that
      // sends somebody to a refusal spends attention and returns nothing.
      //
      // What is genuinely outstanding is a CUT that went out and has not
      // landed: pull requests open on somebody else's repository, waiting
      // on a merge. That is work in the world with this host's name on it.
      //
      // AS LAST READ FROM GITHUB, and the hover says so. This is local --
      // the draw loop must not reach the network -- so a cut merged since
      // the last "Read them again" still counts. Saying "as last read" is
      // the difference between a stale number and a lying one.
      // FROM THE LAST READING, NOT FROM THE RECORD. What was written down
      // when a cut was made says the pull requests were open, because they
      // were -- and it never learns that they merged, deliberately: see the
      // note at the top of repos/landings.js. So this counts what the last
      // "Read them again" actually found, and a pair nobody has read is not
      // counted at all, because unknown is not the same as none.
      const out = landings.readings().filter(r => !r.landed && (r.pulls || []).some(p => p.number))
      count(out.length, 'change out and not merged', 'changes out and not merged')

      // ---- AND WORK THAT ARRIVED AND IS WAITING ON A PERSON -----------------
      //
      // A pull request from somebody else cannot be judged until somebody says
      // so, at the commit it is on. That decision is the one thing in this app
      // a model may not make for itself -- so it has to be visible, or it is a
      // request sitting in a list nobody opened.
      //
      // Counted from the last gathering rather than from GitHub, like everything
      // else here: this runs on the draw loop.
      // NOTES ONLY, AND READ ONCE. `read()` starts a git process per
      // repository for a default branch, a head and a branch count, and
      // not one of them is used below -- this wants pull requests and a
      // parent, which only GitHub knows and which are already written
      // down. It was nine git processes every three seconds for three
      // fields nothing here looks at, and the inner call made it eighteen.
      const rows = remotes.notesOnly()
      const ourRemotes = new Set(rows.filter(x => x.remote).map(x => `${x.remote.owner}/${x.remote.repo}`))
      const arrived = []
      for (const r of rows) {
        const where = r.parent || r.repo
        for (const p of r.pulls || []) {
          if (p.state !== 'open' || p.merged) continue
          const from = String(p.headRepo || '').trim()
          if (ourRemotes.has(from)) continue
          const may = allowed.check(where, p.number, p.headSha)
          if (may.allowed) continue
          arrived.push({ repo: r.repo, on: where, number: p.number, title: p.title, by: p.by || null, stale: !!may.stale })
        }
      }
      count(arrived.length, 'arrived pull request to allow', 'arrived pull requests to allow')

      // ---- and what the supervisor said ------------------------------------
      //
      // Since the bookmark rather than since for ever: "start reading from here"
      // is how the conversation is cleared, and a badge that ignored it would
      // count messages somebody has already decided they are done with.
      const from = chat.fromMark()
      const said = chat.all().filter(m => m.who === 'supervisor' && Number(m.n) > Number(from || 0)).length
      count(said, 'message from the supervisor', 'messages from the supervisor')

      // AND HOW MUCH OF THE CONVERSATION THE SUPERVISOR CAN NO LONGER REACH.
      //
      // It reads with a bookmark and gets the most recent 200; anything older
      // than that is not "unread", it is unreadable — there is no call that
      // hands it back. So a standing instruction given far enough up the thread
      // stops applying without anything having happened, and the first sign is
      // a supervisor asking something it was told months ago.
      //
      // COUNTED IN THE SAME BADGE, because both are "the Chat tab wants you",
      // and told apart in the hover — a second badge on one tab is two numbers
      // to interpret where there was one.
      const readMark = chat.readMark ? chat.readMark() : null
      const beyond = chat.since(Number(readMark && readMark.n) || 0).missed || 0
      count(beyond, 'message the supervisor can no longer see', 'messages the supervisor can no longer see')

      // SPLIT BY WHICH LIBRARY THEY ARE IN, so each badge counts what is on its
      // own tab. `actions` is the working library; a judging one belongs to the
      // Judge tab, beside the verdicts that are also owed there.
      const forTasks = unapproved.filter(a => a.of === 'task')
      const forJudges = unapproved.filter(a => a.of === 'judge')

      return {
        actions: forTasks.length,
        // READINGS WITHOUT A VERDICT ARE NOT COUNTED HERE ANY MORE.
        //
        // This was mine + mute + forJudges, and the first two are judgements
        // that finished and were never decided about. They are history rather
        // than errands -- nothing is blocked by one -- and there were eight of
        // them, so this badge read 8 all day while the two things that did need
        // somebody were a smaller number on another tab. A count that is never
        // zero is a count nobody reads.
        //
        // What is left is what is genuinely owed on that tab: a judging job,
        // prompt or contract that nothing may run until a person reads it.
        judge: forJudges.length,
        repos: out.length + arrived.length,
        supervisor: said + beyond,
        // Apart as well as together, so the hover can say which is which and the
        // window does not have to re-derive it.
        supervisorSaid: said,
        beyondReach: beyond,
        total: unapproved.length + mine.length + mute.length + out.length + arrived.length + said,
        // What each of them IS, so a badge can carry it on its hover rather than
        // being a number somebody has to go and interpret.
        approvals: unapproved,
        // The same list, already divided, so the window does not have to know
        // the rule about which library lives on which tab.
        approvalsForTasks: forTasks,
        approvalsForJudges: forJudges,
        verdicts: mine.map(j => ({ ref: judging.refOf(j.number), reads: j.subject && j.subject.name })),
        silent: mute.map(j => ({ ref: judging.refOf(j.number), reads: j.subject && j.subject.name })),
        // Each one as a row, so the hover can name it rather than being a
        // number to go and interpret.
        // Each arrived pull request as a row, so a badge can name what it is
        // asking for rather than being a number to go and interpret.
        arrived,
        out: out.map(c => ({
          source: c.source,
          target: c.target,
          pulls: (c.pulls || []).map(p => ({ repo: p.repo, number: p.number, state: p.merged ? 'merged' : p.state }))
        })),
        note: why.length ? why.join(', ') : 'nothing is waiting on you'
      }
    }
  },

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
      // AND WHETHER A RUN IS GOING RIGHT NOW, which is a different question
      // from the one above and gets a different banner.
      //
      // Carried on the poll rather than behind `suites`, which builds the
      // whole board out of every remembered result: the banner is drawn on
      // every draw, and a paint function that calls something expensive is
      // how this window has twice ended up spending its time on work nobody
      // asked for. This is one small file read.
      //
      // FROM THE FILE, NOT FROM A VARIABLE, because that is the copy that
      // survives a restart -- and survives it HONESTLY: a run in flight when
      // this app stops is marked not-running and interrupted on the way back
      // up, so the banner goes out rather than sitting on over nothing.
      drillsRunning: (() => {
        try {
          const r = testruns.lastRun()
          if (!r || !r.running) return null
          // WHAT IT IS DOING AND HOW FAR IN, so the banner says something
          // rather than only shining. A run is fifteen minutes of nothing
          // visible happening, and "it is running" answered once stops being
          // an answer about ten minutes in.
          const on = testruns.progress() || {}
          return {
            since: r.at || null,
            asked: r.asked || null,
            doing: on.doing || null,
            passed: on.passed || 0,
            failed: on.failed || 0,
            done: on.done || 0
          }
        } catch { return null }
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
    // WHAT IS THERE RIGHT NOW, which is not always the same list.
    //
    // The test surface exists only while the drills are switched on for the open
    // folder: it writes tasks, cuts branches, borrows machines and opens pull
    // requests, and that is a decision about somebody's repository rather than
    // something to be discovered in a list and tried. With testing mode off it
    // is not listed here, and `call` in server.js turns it down — hidden from
    // the list, honest when asked.
    //
    // The command line builds its whole help from this, so switching testing
    // mode on is what makes those commands appear.
    run: async () => {
      let testing = false
      try { testing = settings.testsAllowed(workspaces.dir() || null).allowed } catch { testing = false }
      return {
        actions: Object.entries(actions)
          // `needs` may be one thing or several — see `wants` in server.js, and
          // the duplicate-key bug that made reading it as a single value hide a
          // gate rather than apply it.
          .filter(([, a]) => testing || !(Array.isArray(a.needs) ? a.needs : [a.needs]).includes('testing'))
          .map(([name, a]) => ({ name, about: a.about, takes: a.takes || [] }))
      }
    }
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
    run: ({ name, value, _overTheWire, _driven, _fromTest }) => {
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
      // AND A DRILL IS NOT A PERSON AT THE WINDOW EITHER, which is the hole this
      // closes. The harness calls the action table in process, exactly as the
      // window does, so a drill asking to switch the drills on looked like
      // somebody clicking — and the one thing this guard exists to stop is
      // something deciding for itself that a folder is a fine place to run them.
      //
      // Found by reading test/claims.md: this refusal was one of 242 the code
      // makes that no drill watches. Writing the check is what showed that the
      // check could not have been written honestly without this.
      if (key === 'testsEnabled' && (_overTheWire || _driven || _fromTest)) {
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
    run: ({ allow, _overTheWire, _driven, _fromTest }) => {
      // A drill counts as the pipe here for the same reason: something that can
      // answer its own request has not asked for anything, and a drill asking is
      // still not a person who can see which folder is open.
      if (_overTheWire || _driven || _fromTest) {
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
  //
  // AND IT IS SHUT UNLESS TESTING MODE IS ON.
  //
  // A driven press reaches exactly the handlers a person's press reaches, which
  // is the whole point of it and also the whole problem: every refusal this app
  // makes about the command line — approving a job, landing a cut — is a refusal
  // about the WIRE, and a click is not on the wire. Without this, "a model may
  // not approve its own job" is one `windowClick --text Approve` away from being
  // untrue, and nothing would have been refused or recorded as strange.
  //
  // So the same switch that says the drills may run says the window may be
  // driven: on for one named folder, turned on at the window and nowhere else,
  // off again when the workspace changes, and visible in a banner the whole time
  // it is on. Reading what is on screen stays open — a photograph and a list of
  // buttons change nothing.
  windowControls: {
    about: 'What is on screen right now: the buttons that can be pressed and the fields that can be filled',
    run: () => drive({ do: 'controls' })
  },

  windowClick: {
    about: 'Press a button in the window, by the words on it. Only while testing mode is on. --dry says which one it would press',
    takes: ['text', 'nth', 'dry'],
    run: ({ text, nth, dry }) => {
      const asking = dry === true || dry === 'true'
      // --dry is allowed either way: it says WHICH button would be pressed and
      // presses nothing, which is reading rather than driving — and it is what
      // somebody uses to find out that the door is shut without opening it.
      if (!asking) mayDrive('press a button in the window')
      return drive({ do: 'click', text, nth: nth == null ? null : Number(nth), dry: asking })
    }
  },

  windowFill: {
    about: 'Type into a field in the window, by its label. Only while testing mode is on',
    takes: ['label', 'value', 'nth'],
    run: ({ label, value, nth }) => {
      mayDrive('type into the window')
      return drive({ do: 'fill', label, value, nth: nth == null ? null : Number(nth) })
    }
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
  // The drills used to be prose a person read and typed
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
