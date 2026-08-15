'use strict'

// Everything that is NW.js rather than a web page.
//
// This window is an app page: it has node, it has the `nw.*` APIs, and it can
// read and write this computer's disk. Every panel in the rest of ui/ is
// ordinary DOM code that would run anywhere -- and the handful of places it is
// NOT were scattered through six files, so "what does this actually need from
// its host" had no answer short of grepping for `nw.`.
//
// So the host is one object with one shape, and there are two files that provide
// it: this one and browser.js. Exactly one of them loads -- see load.js -- and
// everything above them calls `host.something` without knowing which.
//
// THAT IS NOT PORTABILITY FOR ITS OWN SAKE. It is a list, kept honest by being
// executable, of what this app needs a desktop for. Today the answer is: open a
// link in the real browser, photograph itself, write a file, choose a folder,
// and call the actions in this same process. browser.js says which of those a
// page cannot have, in the place somebody would look.
//
// A page loaded over http is a "remote" page and gets none of the nw.* APIs
// whatever it is whitelisted for, which is why this is not a runtime check
// somewhere -- it is a decision made once, at load.
const host = {
  name: 'nw.js',

  // The actions, in this process. No fetch, no origin, no port, nothing to
  // reconnect: the window requires the app the same way the command line does.
  app: require('./server'),
  call: (action, args = {}) => require('./server').call(action, args),

  // Opened in the browser you actually use, not in this window.
  //
  // An ordinary <a href> navigates the DASHBOARD to the address, which replaces
  // the window with a sign-in page and loses everything on screen -- including
  // the dialog waiting for the code that the link was for.
  //
  // The current API first; `nw.gui` is the old name and is only reached if the
  // global is missing, which would mean this is not the app page it thinks it
  // is. Either way a failure has to say so, because a button that quietly does
  // not work is the failure this whole window is written against.
  openExternal (url) {
    try {
      nw.Shell.openExternal(url)
      return true
    } catch {
      try {
        require('nw.gui').Shell.openExternal(url)
        return true
      } catch { return false }
    }
  },

  // What the window looks like, as raw base64 rather than a data URI: it is
  // written to a file, and the `data:image/png;base64,` prefix would only have
  // to be sliced off again.
  capturePage () {
    return new Promise(resolve => {
      try {
        nw.Window.get().capturePage(b64 => resolve(b64), { format: 'png', datatype: 'raw' })
      } catch { resolve(null) }
    })
  },

  writeFile (file, bytes) {
    require('node:fs').writeFileSync(file, bytes)
  },

  // A FILE, WHERE IT ACTUALLY IS. For anything handed back that this window
  // should not try to render: a binary, an archive, something the operator wants
  // to do the next thing with in a program that is not this one.
  //
  // Two doors, because they are different intentions. `showInFolder` opens the
  // file manager with it selected, which is what somebody wants when the next
  // step is copying or dragging it. `openItem` hands it to whatever the desktop
  // says opens that kind of file.
  //
  // Reported rather than swallowed: a button that quietly does nothing is the
  // failure this window is written against, and on a desktop with no file
  // manager registered these do quietly do nothing.
  // CLOSING THE APP, which only the page can do. `nw.App.quit()` ends every
  // window and the node context with them, which is what "quit" means here --
  // `nw.Window.get().close()` closes one window and leaves the app running with
  // nothing on screen, which is worse than not closing at all.
  quit () {
    try { nw.App.quit() } catch { process.exit(0) }
  },

  showInFolder (file) {
    try { nw.Shell.showItemInFolder(file); return true } catch { return false }
  },

  openItem (file) {
    try { nw.Shell.openItem(file); return true } catch { return false }
  },

  // A FOLDER, CHOSEN THE WAY EVERY OTHER PROGRAM ON THIS COMPUTER CHOOSES ONE.
  //
  // Adding a workspace meant typing an absolute path into a text box, which is
  // the one input in this window that cannot be checked as it is typed and is
  // most easily got wrong -- a trailing slash, a backslash eaten by something,
  // the wrong drive. The answer already exists on the desktop and this is how
  // NW.js reaches it: a file input with `nwdirectory`, whose value is a real
  // path rather than the sandboxed half-name a browser would give.
  //
  // CANCELLING IS AN ANSWER. `change` does not fire when somebody backs out, so
  // waiting only for that leaves a promise nobody ever settles, and whatever was
  // awaiting it is stuck for the life of the window. `cancel` covers the modern
  // path; the focus check behind it covers a build where it does not fire.
  pickFolder ({ startAt = null } = {}) {
    return new Promise(resolve => {
      const input = document.createElement('input')
      input.type = 'file'
      input.setAttribute('nwdirectory', '')
      if (startAt) input.setAttribute('nwworkingdir', startAt)
      input.style.display = 'none'

      let done = false
      const finish = value => {
        if (done) return
        done = true
        window.removeEventListener('focus', onFocus)
        input.remove()
        resolve(value || null)
      }
      // A beat after the window comes back, because the change event arrives
      // after the focus one and answering first would call every choice a
      // cancellation.
      const onFocus = () => setTimeout(() => finish(input.value), 300)

      input.addEventListener('change', () => finish(input.value))
      input.addEventListener('cancel', () => finish(null))
      window.addEventListener('focus', onFocus)

      document.body.appendChild(input)
      input.click()
    })
  },

  // NW.js ships no context menu at all, so right-click does nothing until one is
  // built. This is the one thing here that is only reachable because the page is
  // opened from disk.
  devTools () {
    try { nw.Window.get().showDevTools(); return true } catch { return false }
  }
}
