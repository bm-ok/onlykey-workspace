'use strict'

// Close the dashboard, wait for it to actually be gone, and start it again.
//
// The window loads server.js at startup, so every change to the app is invisible
// until it restarts — which made "stop it and start it" the most repeated pair of
// commands there is, usually as a process kill because that was the only way in.
//
// WAITING IS THE WHOLE POINT, and it is why this is a script rather than
// `quit && start`. `appQuit` answers BEFORE it closes, deliberately: a process
// that exits inside the call leaves the caller holding a socket that shut with
// no reply. So the moment it answers, the old app is still up, still holding the
// port and the pipe — and a new one started right then loses a race it did not
// know it was in. This asks, then watches until nothing answers.
//
// NOT A KILL. If it is already gone, this says so and starts one anyway, which
// is what somebody typing "restart" wants either way.

const path = require('node:path')
const ipc = require('../core/ipc')

const GONE_BY = 20000
const EVERY = 250

const sleep = ms => new Promise(r => setTimeout(r, ms))

const answering = () => ipc.call('status').then(() => true, () => false)

async function main () {
  if (await answering()) {
    try {
      const said = await ipc.call('appQuit')
      console.log(`closing ${said.closing || 'it'}...`)
    } catch (e) {
      // THE ONE CASE THAT IS NOT A FAULT: a dashboard older than this action.
      // The window loads server.js at startup, so a running app is whatever the
      // code was when it started -- and the first restart after adding `appQuit`
      // is asking an app that has never heard of it. Said plainly, because
      // "No action called appQuit" reads as a broken script rather than as the
      // one build that cannot do this.
      if (/No action called/.test(e.message)) {
        console.error('this dashboard was started before it learned how to close itself.')
        console.error('close the window by hand, or kill it once, then start it again — after that,')
        console.error('"npm run restart" works.')
        process.exit(1)
      }
      // It answered `status` a moment ago and will not answer this, which is
      // odd enough to say rather than to plough through.
      console.error(`could not ask it to close: ${e.message}`)
      process.exit(1)
    }

    const until = Date.now() + GONE_BY
    while (await answering()) {
      if (Date.now() > until) {
        console.error(`\nit is still answering ${GONE_BY / 1000}s after being asked to close.`)
        console.error('something is holding it open — close the window by hand, then run this again.')
        process.exit(1)
      }
      await sleep(EVERY)
    }
    console.log('closed.')
  } else {
    // NOT AN ERROR, AND NOT A NO-OP. "Restart" when nothing is running means
    // start it: that is what somebody typing it wants either way, and refusing
    // would make this the one command you have to know the state before using.
    console.log('nothing was running — starting it.')
  }

  // Started the same way `npm start` starts it, rather than a second opinion
  // about where NW.js lives.
  require(path.join(__dirname, 'nw.js'))
}

main().catch(e => { console.error(e.message); process.exit(1) })
