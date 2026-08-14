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
function openShell (name, { what = null, cwd = null, task = null } = {}) {
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
    setTimeout(() => quietly(
      `stty rows ${term.rows} cols ${term.cols} 2>/dev/null` +
      (cwd ? `; cd '${String(cwd).split("'").join("'\\''")}' 2>/dev/null || echo "could not enter ${String(cwd).split('"').join('')}"` : '')
    ), 700)

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
  if (!changed('term-auth', [name, vm.holdsCredential, !!held.held])) return

  const has = vm.holdsCredential
  fill(box, el('div', { className: `authline ${has ? 'ok' : ''}` },
    el('strong', { textContent: has ? `claude is signed in on ${name}. ` : `claude is signed out on ${name}. ` }),
    el('span', {
      textContent: has
        ? 'It is holding this host\'s worker credential, which also means it cannot be snapshotted until that is taken back.'
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
  // Said here as well as in paintShellTabs, which only runs once a shell has
  // existed — so on a window where none ever has, the button sat there looking
  // like something you could press.
  $('term-close').disabled = !active
  if (idle && changed('term-empty', true)) {
    fill($('term-empty'), el('div', { className: 'panel' },
      el('p', { className: 'empty', textContent: 'No terminals are open.' }),
      el('p', { className: 'empty', textContent: 'They start from a task, the same way VS Code does — take a task and choose "in a terminal", and the shell lands here with the branch checked out and the machine signed in. Then type claude, or anything else.' }),
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
