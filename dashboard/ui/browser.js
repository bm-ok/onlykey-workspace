'use strict'

// The same host, in a page that is only a page.
//
// This file exists to be the honest half of the pair. Every panel in ui/ is
// ordinary DOM code, so most of this window would render in a browser tab
// tomorrow -- and the parts that would not are exactly the ones named here.
//
// NOTHING HERE PRETENDS. A browser cannot hand a page an absolute path to a
// folder, cannot photograph its own window, and cannot write to disk, and each
// of those refuses in a sentence saying what it would take. The alternative --
// a directory input that returns half a path, a canvas render that is not what
// the screen shows -- is worse than a refusal, because it works well enough to
// be trusted and is wrong somewhere nobody looks.
//
// The list of what is missing IS the point. It is short, it is executable, and
// it is in one place instead of spread through six files as `nw.` calls.
const host = {
  name: 'browser',

  // THE ONE THAT IS NOT A SHIM. The window calls the actions in its own process
  // because it has node; a page would need them over http, and this app's HTTP
  // side deliberately serves machines and nothing else -- the actions are not on
  // that port at all. Putting them there is a real decision about what is
  // exposed and to whom, not a missing function, so this says so rather than
  // quietly inventing an endpoint.
  app: null,
  call () {
    return Promise.reject(new Error(
      'This page has no dashboard to call. The actions run in the app process; over http this server serves machines only.'
    ))
  },

  // The one thing that works as well here as it does there.
  openExternal (url) {
    return !!window.open(url, '_blank', 'noopener')
  },

  // A page can draw itself into a canvas; it cannot see itself. Scrollbars,
  // native controls, the window frame and anything outside the viewport are all
  // absent, and a picture that is nearly the screen is the kind of evidence that
  // is worse than none -- the whole reason the photograph exists here is to
  // catch what the markup cannot say.
  capturePage () {
    return Promise.resolve(null)
  },

  writeFile () {
    throw new Error('A browser cannot write to this computer. Download it instead, or run the desktop window.')
  },

  // A browser will happily show a folder chooser and then hand back the names of
  // the files inside it, relative, with the real location removed on purpose.
  // That is not a path and cannot be turned into one, so a workspace cannot be
  // added this way at all -- which is worth saying out loud rather than
  // discovering after picking a folder and watching nothing happen.
  pickFolder () {
    return Promise.reject(new Error(
      'A browser is not allowed to know where a folder is on disk. Type the path, or add it from the desktop window.'
    ))
  },

  devTools () {
    return false
  }
}
