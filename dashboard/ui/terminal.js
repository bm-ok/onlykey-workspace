'use strict'

// Shells on machines, landed in from a task.
//
// Part of the window. See ui/load.js for the order these are read in and why
// the order matters.

// ---- shells on machines ------------------------------------------------
//
// THE PTY IS AT THE FAR END. `ssh -tt` allocates one on the machine, which is
// where the shell actually is; this side only moves bytes between a child
// process and a terminal widget. That matters because a pty on THIS side would
// mean a compiled native module matching NW.js's Node ABI, and this app has no
// native modules on purpose.
//
// Spawned from the window rather than through an action, and that is not a
// hole in "one surface": the command line's half of this is `vmShell`, which
// does the same thing with the same key. What cannot be shared is the terminal —
// the dashboard has none to hand over, and an interactive session needs the one
// the person is sitting at.
//
// SEVERAL AT ONCE, each its own tab. A terminal is mostly somewhere you wait —
// for a build, for a sign-in, for an agent to say something — and needing a
// second one while the first is busy is the ordinary case, not the exotic one.
//
// EACH TAB OWNS ITS OWN Terminal, WHICH IS ALSO THE FIX FOR A REAL BUG. The
// first version made one widget and reused it. `onData` registers a handler and
// hands back a disposable; reusing the widget meant registering again on every
// open without ever disposing, so after closing one shell and opening another
// each keystroke was written to stdin TWICE — once per session ever opened.
// It looked like a stuck key rather than a leak, which is why it took a person
// noticing rather than anything here reporting it. Nothing is shared between
// shells now, so there is nothing left to leak.
let shells = []
let active = null
let shellSeq = 0

const shellFor = id => shells.find(s => s.id === id) || null

// A shell on a machine, in this window.
//
// `what` names the shell in the tab strip and `cwd` is the folder it lands in --
// the two things that made this a machine-picker rather than a place work
// arrives at. It returns the shell so a caller can hold on to one.
//
// IT LANDS YOU IN BASH AND STOPS. It does not run `claude` for you, and that is
// deliberate: the point of a terminal is that a person is at it. Typing the
// command is how they decide what session this is, and a window that types it
// for them has taken the one decision the terminal was opened to make.
//
// `then` IS THE ONE EXCEPTION, AND IT IS NOT THAT DECISION. It types a command
// after the shell lands -- for watching a run that is already going, where the
// terminal was opened FOR that command and typing it by hand means retyping a
// run id nobody has memorised. It is sent visibly rather than through
// `quietly`, so the line is on screen: Ctrl-C leaves an ordinary shell on the
// machine, and up-arrow brings it back.
function openShell (name, { what = null, cwd = null, task = null, then = null } = {}) {
  return api('vmShell', { name }).then(where => {
    const { spawn } = require('node:child_process')

    // Its own element, its own widget, its own child process. The element is
    // what the tab switches between, so a hidden shell keeps its scrollback and
    // its running command rather than being torn down and rebuilt.
    const holder = el('div', { className: 'term-pane' })
    $('term').append(holder)

    const term = new Terminal({
      fontFamily: 'Consolas, "Cascadia Mono", monospace',
      fontSize: 13,
      // Matches the window rather than xterm's default black, so a terminal
      // sitting in this page does not look like a hole cut in it.
      theme: { background: '#0a0d12', foreground: '#c9d1d9', cursor: '#58a6ff' },
      cursorBlink: true,
      // Kept, because the whole point of a terminal is reading what went past.
      scrollback: 5000
    })
    const fit = new FitAddon.FitAddon()
    term.loadAddon(fit)
    term.open(holder)

    // -tt FORCES a pty even though our stdin is a pipe rather than a terminal.
    // Without it ssh notices there is no terminal here and runs the command
    // without one, which gives a shell with no prompt, no line editing and no
    // job control -- something that looks like a broken terminal rather than a
    // deliberate one.
    const args = [
      '-tt',
      ...(where.identity ? ['-o', `IdentityFile=${String(where.identity).split('\\').join('/')}`, '-o', 'IdentitiesOnly=yes'] : []),
      '-o', 'StrictHostKeyChecking=accept-new',
      where.target
    ]

    const shell = {
      id: ++shellSeq,
      name,
      // What this shell IS, rather than only which machine it is on. A strip of
      // tabs all reading "runner1" is what a machine-picker produces; a strip
      // reading "#25 claude" is what work arriving produces.
      what,
      task,
      target: where.target,
      live: where.live,
      term,
      fit,
      holder,
      child: spawn('ssh', args, { windowsHide: true }),
      // Every handler this shell registered, so closing it takes them with it.
      off: [],
      ended: false
    }
    shells.push(shell)

    const write = t => { try { shell.child && shell.child.stdin.write(t) } catch { /* it has gone */ } }
    // Kept on the shell as well, so something outside this closure can say
    // things into it. It was the missing half of driving one from anywhere else.
    shell.write = write

    // WHAT WE TYPED IS TAKEN BACK OUT OF WHAT COMES BACK.
    //
    // The remote pty's size can only be changed by running `stty` in it, and
    // running something in a shell means typing it — which the shell then echoes,
    // so every resize printed `stty rows 44 cols 168` into the terminal a person
    // is trying to read. That was reported as the terminal being buggy, and it
    // was: the tool's own housekeeping was being shown as though the user had
    // typed it.
    //
    // So a command sent by this code is registered before it goes, and struck
    // from the first output that contains it. Exact match, first occurrence,
    // once — if it does not match, nothing is removed and the worst case is what
    // happened before.
    shell.hush = []
    const scrub = text => {
      for (let i = 0; i < shell.hush.length; i++) {
        const at = text.indexOf(shell.hush[i])
        if (at === -1) continue
        // The echo carries the newline that ended it, in either spelling.
        const end = at + shell.hush[i].length
        const skip = text.startsWith('\r\n', end) ? 2 : (text[end] === '\r' || text[end] === '\n') ? 1 : 0
        text = text.slice(0, at) + text.slice(end + skip)
        shell.hush.splice(i, 1)
        i--
      }
      return text
    }

    shell.child.stdout.on('data', d => term.write(scrub(d.toString('utf8'))))
    shell.child.stderr.on('data', d => term.write(scrub(d.toString('utf8'))))
    shell.off.push(term.onData(write))

    // The remote pty is created at ssh's idea of our size, which is 80x24
    // because we have no terminal here. Telling the far end the real size is the
    // only way anything full-screen -- an editor, `less`, `top` -- lays out
    // correctly, and it has to be said again whenever the window changes.
    // Said once the dragging stops, not on every frame of it. A resize produces
    // a burst of these — one per column crossed — and each one was a command run
    // in the shell, so the cost of widening a window was thirty prompts.
    const quietly = cmd => { shell.hush.push(cmd); write(`${cmd}\n`) }
    let resizing = null
    shell.off.push(term.onResize(() => {
      clearTimeout(resizing)
      resizing = setTimeout(() => quietly(`stty rows ${term.rows} cols ${term.cols} 2>/dev/null`), 400)
    }))
    // Closing takes the pending resize with it, or a shell disposed mid-drag
    // writes to a child that has gone.
    shell.off.push({ dispose: () => clearTimeout(resizing) })
    // The size, and the folder the work is in, once the login has finished.
    //
    // NOTHING IS CLEARED. This used to end in `; clear`, which wiped the login
    // banner — the distribution, the update count, the last-login line — and left
    // a bare prompt. That was reported as the banner not showing, and "cleared by
    // something" was exactly right: the thing a person reads first to know which
    // machine they are on was being erased a moment after it arrived, by us.
    //
    // Sent through `quietly`, so the housekeeping does not appear as though it
    // had been typed. What remains visible is one fresh prompt, which is honest:
    // something ran.
    //
    // Quoted, because the folder came from a dialog somebody can type in and
    // this is a line being handed to a shell.
    setTimeout(() => {
      quietly(
        `stty rows ${term.rows} cols ${term.cols} 2>/dev/null` +
        (cwd ? `; cd '${String(cwd).split("'").join("'\\''")}' 2>/dev/null || echo "could not enter ${String(cwd).split('"').join('')}"` : '')
      )
      // After the housekeeping, and visibly. A moment later than the rest so it
      // lands after the prompt rather than interleaved with the login banner.
      if (then) setTimeout(() => write(`${then}\r`), 250)
    }, 700)

    shell.child.on('close', code => {
      term.write(`\r\n\x1b[38;5;244m[the session ended${code ? ` — ssh exited ${code}` : ''}]\x1b[0m\r\n`)
      shell.child = null
      shell.ended = true
      // Left open on purpose. Whatever it said before it died is the reason it
      // died, and closing the tab automatically would take that away at exactly
      // the moment it is worth reading.
      paintShellTabs()
    })
    shell.child.on('error', e => term.write(`\r\n\x1b[31m[could not start ssh: ${e.message}]\x1b[0m\r\n`))

    showShell(shell)
    // Handed back so a caller can hold on to it. The catch belongs to whoever
    // asked -- a task opening one wants the failure said next to the task.
    return shell
  })
}

// WATCHING A RUN GO PAST, which is the question a status field cannot answer.
//
// "Working" is true for twenty minutes whether the worker is reading files or
// stuck on a sign-in prompt, and the run log is the only place the difference
// shows. Dispatch writes `okc-watch` into every run's own directory for exactly
// this: it follows that run's log and prints what was said, what was reached
// for, and what came back.
//
// A REAL SHELL, NOT A VIEWER. Ctrl-C stops the watching and leaves a person on
// the machine, in the run's directory, which is where they wanted to be anyway
// if what they saw was worth stopping for. Nothing here can touch the run.
//
// Shared by tasks and judgements because a run is a run -- neither tab should
// know how a log is followed, and the only difference between them is what the
// tab is called.
// THE SUPERVISOR'S OWN TURNS, followed the same way and from a fixed place.
//
// A worker's log is named after its run, because a run is a thing that happens
// once. A supervisor wakes over and over on one machine, so the file it writes
// is relinked to each new turn and this follows the LINK -- `tail -F`, by name.
// A terminal opened between wakes is already in place when the next one starts,
// which is how somebody watches a supervisor rather than racing a button.
//
// The path is the supervisor's box on the machine and is written by the same
// helper that writes a run's -- see watcherFor in machines/dispatch.js.
function watchSupervisor (machine) {
  showTab('terminal')
  return openShell(machine, { what: 'supervisor', then: '$HOME/.okc-supervisor/okc-watch' })
    .then(() => say(`Following ${machine}'s turns. Ctrl-C stops watching, not the thinking.`))
    .catch(e => say(`${machine} would not open a shell: ${e.message}`, 'bad'))
}

function watchRun (machine, run, what) {
  showTab('terminal')
  const dir = `$HOME/.okc-runs/${String(run).split("'").join('')}`
  return openShell(machine, { what, cwd: undefined, then: `${dir}/okc-watch` })
    .then(() => say(`Following ${run} on ${machine}. Ctrl-C stops watching, not the run.`))
    .catch(e => say(`${machine} would not open a shell: ${e.message}`, 'bad'))
}

// The box gets whatever is left of the window, measured rather than assumed.
//
// What sits above it is a header, a banner that is sometimes several lines and
// sometimes absent, a note, a sign-in line and a strip of tabs. A stylesheet
// cannot subtract that -- the first version tried, with `100vh - 200px`, and the
// page grew a scrollbar with the terminal running off the bottom the moment two
// of those rows were added. Asking the element where it ended up is exact and
// stays exact.
function sizeTerminal () {
  const box = $('term')
  if (view !== 'terminal') return
  const top = box.getBoundingClientRect().top
  // The 16 is main's own bottom padding, which is a real constant rather than a
  // guess at a layout.
  box.style.height = `${Math.max(240, Math.round(window.innerHeight - top - 16))}px`
}

// ---- watching an install ------------------------------------------------
//
// A tab that is not a shell: it reads the machine's console, which VirtualBox is
// writing to a file on this host, and shows it as it arrives.
//
// THE CONSOLE RATHER THAN SSH, and that is the whole point. ssh into the
// installer works and is nicer to look at — it attaches to subiquity's own
// session — but it only exists in the window where the network is already up,
// sshd is already running and the machine has an address. The console starts at
// the kernel's first line, needs no address and no credentials, survives the
// installer rebooting into the installed system, and keeps working when the
// machine is wedged with no network at all. Those are exactly the installs
// somebody needs to watch.
//
// NOTHING IS TYPED INTO IT. There is no far end to type at: this is a file. The
// tab says so rather than swallowing keystrokes silently.
//
// One per machine. Asking to watch a machine already being watched brings that
// tab forward instead of opening a second reader on the same file.
const watchers = new Map()   // machine name -> shell-shaped object

function watchInstall (name, { onEnd = null, show = true, auto = false } = {}) {
  const already = watchers.get(name)
  if (already) {
    if (show && already !== 'opening') showShell(already)
    return Promise.resolve(already === 'opening' ? null : already)
  }
  // Claimed before the asking, because the answer takes a moment and the draw
  // loop comes round every few seconds — without this an install opens four
  // readers on the same file before the first one exists.
  watchers.set(name, 'opening')

  return api('vmLog', { name, which: 'serial', lines: 400 })
    .catch(() => null)
    .then(seen => {
      const fs = require('node:fs')
      const holder = el('div', { className: 'term-pane' })
      $('term').append(holder)

      const term = new Terminal({
        fontFamily: 'Consolas, "Cascadia Mono", monospace',
        fontSize: 13,
        theme: { background: '#0a0d12', foreground: '#c9d1d9', cursor: '#58a6ff' },
        // No cursor: nothing here is waiting for anybody to type.
        cursorBlink: false,
        // Longer than a shell's. An install is thousands of lines and the
        // interesting one is rarely the last.
        scrollback: 20000
      })
      const fit = new FitAddon.FitAddon()
      term.loadAddon(fit)
      term.open(holder)

      const file = seen && seen.file
      const shell = {
        id: ++shellSeq,
        name,
        what: 'console',
        target: file || `${name} console`,
        live: true,
        watching: true,
        // WHO OPENED IT, which decides who may close it. A tab opened because an
        // install started is closed again when that install ends; a tab somebody
        // opened to read a console stays until they close it. Without this, the
        // first thing that happened after pressing "Read its console" was the
        // draw loop noticing the machine was not installing and taking the tab
        // away again — with a notice explaining that it had.
        auto,
        term,
        fit,
        holder,
        child: null,
        off: [],
        ended: false
      }

      // What is already there, before following what comes next — an install
      // watched from the middle should not start at the middle.
      if (seen && seen.lines && seen.lines.length) {
        term.write(seen.lines.join('\r\n') + '\r\n')
      }

      // FOLLOWED BY READING WHAT IS NEW, from where we had got to. `fs.watch` is
      // the notification and the read is ours: a watcher says "it changed", not
      // what changed, and re-reading the whole file every time an installer
      // writes a line is a megabyte a second by the end of it.
      let at = 0
      try { at = file ? fs.statSync(file).size : 0 } catch { at = 0 }

      const pull = () => {
        if (!file || shell.ended) return
        let now = 0
        try { now = fs.statSync(file).size } catch { return }
        // A file that shrank was replaced — a new install into the same file.
        // Start again rather than reading from a position that no longer means
        // anything.
        if (now < at) { at = 0; term.write('\r\n[33m— the console started again —[0m\r\n') }
        if (now === at) return
        try {
          const fd = fs.openSync(file, 'r')
          const buf = Buffer.alloc(now - at)
          fs.readSync(fd, buf, 0, buf.length, at)
          fs.closeSync(fd)
          at = now
          term.write(buf.toString('utf8').split('\n').join('\r\n'))
        } catch { /* it will be read on the next change */ }
      }

      let watcher = null
      try {
        watcher = fs.watch(file, { persistent: false }, () => pull())
      } catch { /* said below */ }
      // AND A SLOW HEARTBEAT BEHIND IT. fs.watch on Windows misses appends to a
      // file held open by another process often enough to matter, and the thing
      // being missed here is the last few lines before a machine goes quiet —
      // which is the part somebody is watching for.
      const beat = setInterval(pull, 2000)

      shell.stop = () => {
        clearInterval(beat)
        try { watcher && watcher.close() } catch { /* already closed */ }
      }
      shell.onEnd = onEnd

      shells.push(shell)
      watchers.set(name, shell)
      // BROUGHT FORWARD ONLY IF SOMEBODY IS ALREADY LOOKING AT THE TERMINAL.
      //
      // showShell focuses the widget, and focusing a terminal in a view nobody
      // is on steals the keyboard from whatever they are actually typing into.
      // An install opening a tab must not take the cursor out of somebody's
      // task brief.
      if (show && view === 'terminal') showShell(shell)
      else paintShellTabs()
      if (!file) {
        // A TAB WITH NOTHING IN IT IS STILL THE RIGHT TAB. It says why rather than
        // looking broken, and the reason is always the same one: the port is
        // attached when a machine is BUILT, and VirtualBox will not add one to a
        // machine that is running. Every machine made from now on has it.
        term.write('[33mThis machine is running with no console being captured.[0m\r\n' +
          'The serial port is attached when a machine is built, and VirtualBox will not add one to a\r\n' +
          'running machine, so this boot cannot be watched. It is captured from the next install.\r\n')
      }
      return shell
    })
}

// A CONSOLE FOR EVERY MACHINE THAT IS RUNNING, AND NOTHING TAKES IT AWAY.
//
// The first version of this opened a tab when an install started and closed it
// when the install ended, and closing was where all the bugs were. Two of them,
// both mine:
//
//   - the draw catches a failed vmList as an empty list, and during an install
//     VBoxManage calls queue behind the install itself. An empty list reads as
//     "nothing is installing", so a slow answer closed the tab somebody was
//     reading. That is the "it randomly closed" that was reported.
//
//   - "installing" clears when the guest reports online, which comes from the
//     INSTALLER's post-install stage — before the machine has ever booted. So
//     the tab went away with several minutes of the interesting part left.
//
// Neither is worth fixing, because the question they were answering is the wrong
// one. A console is not an install: the same port carries the installer, the
// first boot, every boot after it, and the shutdown. So the rule is simply that
// a machine which is RUNNING has a console tab, and it is opened once.
//
// NOTHING IS AUTO-SHOWN AND NOTHING IS AUTO-CLOSED. Opening a tab is not
// switching to it, and a tab that closes itself is a tab that closes while
// somebody is reading it. Closing one is a person's decision, and the × is
// right there.
function mindConsoles (list) {
  // A LIST THAT COULD NOT BE READ IS NOT A LIST OF NOTHING. This is the same
  // trap in the other direction: acting on an empty list would open nothing,
  // which is harmless, but the guard is written down because the closing half
  // acted on it and was not harmless at all.
  if (!list || list.available === false || !Array.isArray(list.vms)) return

  for (const v of list.vms) {
    // RUNNING IS THE WHOLE CONDITION. It also asked for a console to be captured,
    // which sounds sensible and is the same mistake as closing the tab: a machine
    // running with no console is precisely the one somebody cannot see, and it
    // got no tab at all — so the Terminal tab showed "no terminals are open"
    // while an install ran. The tab is opened either way and says what it has;
    // see the note written into it below when there is no file.
    if (!v.running) continue
    if (watchers.has(v.name)) continue
    watchInstall(v.name, { show: false, auto: true }).then(s => {
      if (s) say(`${v.name} is running — its console is in the Terminal tab.`, undefined, { lasts: 8000 })
    })
  }
}

function showShell (shell) {
  active = shell || null
  for (const s of shells) s.holder.classList.toggle('on', s === active)
  paintShellTabs()
  if (!active) return
  // Sized and THEN fitted, in that order: fit measures the container, so fitting
  // before the container has its height measures the old one.
  sizeTerminal()
  // Fitted only once visible: a terminal laid out inside a hidden element
  // measures zero and comes back at the wrong size.
  try { active.fit.fit() } catch { /* not laid out yet */ }
  active.term.focus()
}

function closeShell (shell) {
  if (!shell) return
  if (shell.child) { try { shell.child.kill() } catch { /* already gone */ } }
  // A watcher has no child to kill; it has a file watcher and a timer, and both
  // outlive the widget unless they are told not to.
  if (shell.stop) { try { shell.stop() } catch { /* already stopped */ } }
  if (shell.watching) watchers.delete(shell.name)
  // Disposed EXPLICITLY, both the handlers and the widget. This is the half
  // that was missing before: a killed child stops producing output, but a
  // handler on a widget that outlives it goes on delivering keystrokes.
  for (const d of shell.off) { try { d.dispose() } catch { /* already gone */ } }
  try { shell.term.dispose() } catch { /* already gone */ }
  shell.holder.remove()
  shells = shells.filter(s => s !== shell)
  if (active === shell) showShell(shells[shells.length - 1] || null)
  else paintShellTabs()
}

function paintShellTabs () {
  const bar = $('term-tabs')
  bar.classList.toggle('hidden', !shells.length)
  fill(bar, shells.map(s => el('span', {
    className: `term-tab${s === active ? ' on' : ''}${s.ended ? ' ended' : ''}`,
    onclick: () => showShell(s),
    title: `${s.target}${s.ended ? ' — this session has ended' : ''}`
  },
  // What the shell is for, and the machine second. Two shells opened for two
  // tasks on the same machine were "runner1" and "runner1 #2" -- true, and no
  // help at all in picking the one you meant.
  el('span', { textContent: s.what ? `${s.what} · ${s.name}` : `${s.name}${shells.filter(o => o.name === s.name).length > 1 ? ` #${s.id}` : ''}` }),
  el('button', {
    className: 'term-x',
    textContent: '×',
    title: 'close this shell',
    onclick: e => { e.stopPropagation(); closeShell(s) }
  }))))

  setText($('term-context'), active
    ? `— ${active.target}${active.live ? '' : ' (last known address)'}${active.ended ? ', ended' : ''}`
    : '')
  $('term-close').disabled = !active
  // The sign-in line describes the front tab, so it moves when the front tab
  // does rather than waiting for the next draw.
  paintTermAuth()
}

// Whether the worker in the shell you are looking at can authenticate.
//
// HERE BECAUSE THIS IS WHERE IT BITES. Typing `claude` in a shell on a machine
// that is signed out gets a sign-in menu, because a runner's credential is
// handed to it per task and taken back afterwards — so a machine sitting idle is
// signed OUT by design, and the way to fix that was a command line only.
//
// IT FOLLOWS THE ACTIVE TAB now, not a picker, because the picker is gone. That
// is also the more useful question: it used to describe a machine somebody was
// considering, and now it describes the shell they are actually sitting in.
//
// Not probed. The dashboard already records who is holding one, because a
// machine holding a credential is the thing that cannot be snapshotted.
function paintTermAuth () {
  const name = active && active.name
  const vm = latest.vms.find(v => v.name === name)
  const box = $('term-auth')
  if (!vm) { box.classList.add('hidden'); return }
  box.classList.remove('hidden')

  const held = latest.credentialsHeld || {}
  // A SUPERVISOR IS NOT A RUNNER AND THE SENTENCE BELOW WAS WRITTEN FOR A RUNNER.
  //
  // "An idle one is signed out by design" is true of a machine that is handed a
  // credential per task and has it taken back afterwards. A supervisor is handed
  // one when it comes up and keeps it, so signed-out is not its resting state —
  // it is a supervisor that cannot think, sitting behind a line saying that is
  // how it is meant to be. It was up like that and the window agreed with it.
  //
  // The two identities are separate and refuse each other, so the button matters
  // as much as the words: `Sign it in` here places a WORKER credential, which a
  // supervisor refuses. `supervisorUp` is the one that finds a supervisor
  // sign-in, and says so plainly when there is none.
  //
  // `held.guests` IS THE WRONG PLACE TO ASK, and asking it there is how this
  // was wrong once already: that list answers "is there anything to hand a
  // runner" and omits supervisors deliberately, so a host holding one read as
  // holding none. `held.supervisor` is the field that answers about them.
  const isSup = (vm.tags || []).includes('supervisor')
  const sup = held.supervisor || { kept: 0, free: false, out: null }
  if (!changed('term-auth', [name, vm.holdsCredential, !!held.held, isSup, sup.free, sup.out])) return

  const has = vm.holdsCredential
  fill(box, el('div', { className: `authline ${has ? 'ok' : isSup ? 'bad' : ''}` },
    el('strong', { textContent: has ? `claude is signed in on ${name}. ` : `claude is signed out on ${name}. ` }),
    el('span', {
      textContent: has
        ? isSup
          ? 'It is holding this host\'s supervisor sign-in, which is where it stays while it is up.'
          : 'It is holding this host\'s worker credential, which also means it cannot be snapshotted until that is taken back.'
        : isSup
          ? sup.free
            ? `A supervisor keeps its sign-in while it is up, so this is not a rest — and one is signed in automatically when it dials in. "${sup.using}" is free here, so this is a machine that missed that.`
            // The reason is written where the decision is made — see
            // supervisorKey in core/guests.js — rather than spelled out again
            // here, which is how two explanations of one state drift apart.
            : `A supervisor keeps its sign-in while it is up, so this is not a rest: ${sup.why || 'it has none'}.`
          : held.held
            ? 'A runner is handed a credential per task and it is taken back afterwards, so an idle one is signed out by design.'
            : 'This host holds no worker credential either. Sign one machine in on the Keys tab first.'
    }),
    has
      ? el('button', {
          className: 'btn danger small',
          textContent: 'Take it back',
          onclick: () => api('vmCredentialsForget', { name })
            .then(() => say(`${name} no longer holds a credential.`)).catch(oops)
        })
      : isSup
        ? sup.free
          ? el('button', {
              className: 'btn ok small',
              textContent: 'Sign it in',
              onclick: () => api('supervisorSignIn', { name })
                .then(r => say(r.did || r.why)).catch(oops)
            })
          : null
        : held.held
          ? el('button', {
              className: 'btn ok small',
              textContent: 'Sign it in',
              onclick: () => api('vmCredentialsPut', { name })
                .then(() => say(`${name} is ready — credential placed and the first-run wizard marked done. A claude already running will not notice; start it again.`))
                .catch(oops)
            })
          : null))
}

function paintTerminal () {
  // AN AREA WORK ARRIVES AT. The machine picker and its "Open a shell" button
  // stood here, and they were the last way in this window to end up on a machine
  // with nothing saying what the work is. What replaces them is a sentence
  // saying where terminals come from -- shown only when there are none, because
  // once one has landed the tab strip says it better.
  const idle = !shells.length
  $('term').classList.toggle('hidden', idle)
  $('term-empty').classList.toggle('hidden', !idle)

  // SOMETHING IS SHOWING WHENEVER THERE IS SOMETHING TO SHOW.
  //
  // A console opens itself and deliberately does NOT bring itself forward —
  // opening a tab is not switching to it, and stealing the view from somebody is
  // the whole thing that was asked not to happen. But that left the other half
  // undone: arriving at this tab with sessions open and none of them chosen
  // showed a strip of tabs above an empty black square, which reads as a broken
  // terminal rather than an unchosen one.
  //
  // Choosing one only happens once somebody is HERE, which is not auto-showing:
  // nothing moved, they came.
  if (!idle && !active) showShell(shells[shells.length - 1])
  // Said here as well as in paintShellTabs, which only runs once a shell has
  // existed — so on a window where none ever has, the button sat there looking
  // like something you could press.
  $('term-close').disabled = !active
  // A MACHINE THAT IS RUNNING AND CANNOT BE WATCHED SAYS SO HERE.
  //
  // A console opens itself for any machine that is running AND has its serial
  // port captured — see mindConsoles. A machine with the port off is running
  // invisibly, and this tab showed the ordinary "no terminals are open" for it,
  // which reads as nothing happening rather than as something happening
  // unwatched. It was found exactly that way: an install running, and nothing
  // here for it.
  //
  // Only while one is actually running, so this is silent on a quiet host.
  const dark = ((latest && latest.vms) || []).filter(v => v.running && !v.serial)

  if (idle && changed('term-empty', [true, dark.map(v => v.name)])) {
    fill($('term-empty'), el('div', { className: 'panel' },
      el('p', { className: 'empty', textContent: 'No terminals are open.' }),
      el('p', { className: 'empty', textContent: 'They start from a task, the same way VS Code does — take a task and choose "in a terminal", and the shell lands here with the branch checked out and the machine signed in. Then type claude, or anything else.' }),
      dark.length
        ? el('p', { className: 'note' },
            `${dark.map(v => v.name).join(', ')} ${dark.length === 1 ? 'is' : 'are'} running with no console being captured, so there is nothing to show for `,
            dark.length === 1 ? 'it' : 'them',
            '. The serial port is what makes a boot watchable, and VirtualBox will only add one to a machine that is switched off — so this cannot be turned on mid-install. An install turns it on by itself from now on.')
        : null,
      el('button', {
        className: 'btn',
        textContent: 'Go to the tasks',
        onclick: () => showTab('tasks')
      })))
  }
  if (!idle) changed('term-empty', false)

  paintTermAuth()
  // Resized and refitted every draw, because what sits above the box changes on
  // its own: the banner appears and disappears with the state of the machines.
  sizeTerminal()
  if (view === 'terminal' && active) { try { active.fit.fit() } catch { /* not open yet */ } }
}
