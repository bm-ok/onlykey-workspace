'use strict'

// NW.js node-main.
//
// The window is loaded from disk by NW.js and calls the actions table directly, in
// this same process -- so it does not need the server, and does not wait for it.
// The server is started here for one client only: a machine being provisioned,
// which fetches its scripts over HTTP and reports back the same way.
//
// So a failure to listen is worth saying loudly and is not fatal to the app. The
// window opens either way; only provisioning a machine needs the port.

const { start } = require('./server')

start()
  .then(s => {
    // The handle for poking at things from a devtools console while it runs.
    global.dashboard = s
    console.log(`dashboard listening at ${s.url}`)
    // ui/boot.html is already on screen waiting for this, and navigates itself
    // once we answer. Nothing here touches a window: from this context that binds
    // a window belonging to another one and throws.
  })
  .catch(err => {
    // boot.html gives up after 30 seconds and says to run it headlessly. This is
    // the line that makes that recoverable.
    console.error('dashboard failed to start:', (err && (err.stack || err.message)) || err)
  })
