'use strict'

// NW.js node-main. This is where the app lives.
//
// NW.js is the host process: it runs the API server in this Node context and
// shows the window. One process, both halves -- and because the server is a real
// HTTP server rather than an in-window function call, a machine can dial into the
// same API the window is using. That is the reason it is a server at all.
//
// Nothing under core/ or machines/ knows NW.js exists. The window is a client of
// the same API the cli drives, so there is one server and one API however you
// come at it.

const { start } = require('./server')

start()
  .then(s => {
    // The handle for poking at things from the devtools console while it runs.
    global.dashboard = s
    console.log(`dashboard listening at ${s.url}`)
    // ui/boot.html is already on screen polling for this, and navigates itself
    // once we answer. Nothing here touches nw.Window: from the node-main context
    // that binds a window belonging to another context and throws.
  })
  .catch(err => {
    // The boot page gives up after 30 seconds and says to look here. This is the
    // line that makes that recoverable.
    console.error('dashboard failed to start:', (err && (err.stack || err.message)) || err)
  })
