# The dev loop

`npm start` runs webpack with the dev server built in. Both halves are
already running; most work needs nothing else.

## What reloads by itself

- **A window change** — `window.js`, any file in the window bundle, a
  `.scss` — rebuilds and reloads the page in about five seconds.
- **A server change** — `server.js` and what it requires — rebuilds the
  server half in place: the old plugins are torn down (`onDestroy`), the new
  bundle loaded, the guest-facing ports rebound.

## What needs `npm run restart`

- `main.js` halves — loaded once, never reloaded
- `webpack.config.js`
- a new dependency or anything vendored
- **adding, moving or removing a plugin folder** — the boots find plugins
  with `require.context`, which enumerates at build time

Run it **in the background**; in the foreground it hangs on the child's
stdout and killing the call takes the app with it. Never while a machine
is installing, and never while the supervisor is mid-turn — a reload drops
the channel a turn is holding (`this host is shutting down`).

## The two quiet failures

A server-half reload can **fail** — a free identifier compiles and dies at
load — and the window keeps drawing off the last good bundle with a red
overlay only the picture shows. `windowControls` says `failed` when it is
so. And the watcher can **stop rebuilding** while everything else goes on
working; `grep -a "server half reloaded" nw.log | tail -1` is the receipt
that your code last became real.

## Editing while machines work

A save reloads the server half, and the reload drops what a machine is
holding. Check `supervisorState` (`thinking`) and `queueState` (`running`)
before saving anything on the server side; hold the save until they are
idle.
