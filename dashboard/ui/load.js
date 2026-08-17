'use strict'

// The window, in the order it has to be read.
//
// It was one file of six thousand lines. Nothing was wrong with it except that
// nobody could hold it, and every panel added made the next one harder to find.
//
// THE ORDER IS NOT A PREFERENCE. These are classic scripts sharing one global
// scope -- which is the point, because that is what the one file had and it
// means no export or import churn -- and in that scope `const` and `let` are
// hoisted into a temporal dead zone rather than being available early. So a file
// that runs code at load time can only use what an earlier file has already
// declared. Several of them do run code at load time: the tabs wire their
// handlers, the sub-tabs restore what was open, the finder boxes take their
// listeners. This list is the same order those things were in when they were one
// file, and it must stay that way.
//
// `async = false` on an injected script is what keeps them in order. Without it
// the browser is free to run whichever arrives first, which on a fast disk is
// usually the smallest -- an intermittent failure, on a machine that is not
// yours, dressed as something else entirely.
//
// WHY NOT eval. Reading each file and eval'ing it looks equivalent and is not:
// top-level `const` and `let` inside eval belong to that eval, not to the global
// lexical scope, so every declaration would vanish between files and only `var`
// and functions would survive. A script element is the thing that has the
// semantics this needs.
;(() => {
  // WHICH HOST THIS IS, decided once, here, rather than checked at each call.
  //
  // Exactly one of these loads and both declare `host`. A page opened from disk
  // by NW.js has node and the nw.* APIs; a page served over http is a "remote"
  // page and gets none of them whatever it is whitelisted for -- so this is not
  // a thing that can change while running, and treating it as one would only
  // spread `typeof nw` through every file that opens a link.
  const HOST = typeof nw !== 'undefined' && nw.Window ? 'nwjs' : 'browser'

  const FILES = [
    HOST,        // what this window can ask of the computer it is on

    // The toolkit first: everything below is built out of these.
    'base',      // the call into the app, elements, the repaint guard, the editor
    'changes',   // what a line carries, and the files it touches
    'shell',     // the notice bar, what is remembered, the tabs, the dialog

    // Then a file per tab, in the order the work goes.
    'keys',      // the credential this host holds so machines do not have to
    'tasks',     // what has been asked for, who is doing it, what came back
    'queue',     // what is waiting for a machine, of whichever kind
    'judge',     // reading a change and saying whether it holds. After tasks:
                 // it uses the sub-tab switcher declared there
    'branches',  // where the work lives, and the lines cut across repositories
    'terminal',  // shells on machines, landed in from a task
    'github',    // the token, and what it may reach
    'workspace', // which folder of repositories all of this is about
    'repos',     // the repositories, and everything open across them
    'prcuts',    // a change once it has left
    'sessions',  // what workers remember, kept across the machines they pass through
    'guests',    // the Claude identities kept here, lent to a machine while it works
    'machines',  // the virtual machines this app made
    'chat',      // talking to the supervisor, and it talking back
    'live',      // the log, and every action there is
    'tests',     // this app run against itself, for developing it
    'settings',  // what this app is set to, as opposed to what a workspace holds

    // Last, because it calls into all of them.
    'draw'       // the loop, the photograph of the window, and how often
  ]

  for (const name of FILES) {
    const s = document.createElement('script')
    s.src = `${name}.js`
    // In order, not as-soon-as-possible. See above.
    s.async = false
    // SAID OUT LOUD. A missing or unparseable file otherwise shows up as a
    // ReferenceError somewhere else entirely, in whichever panel first needed
    // something the file was going to declare.
    s.onerror = () => console.error(`ui/${name}.js did not load — the window will be missing whatever it declares`)
    document.body.appendChild(s)
  }
})()
