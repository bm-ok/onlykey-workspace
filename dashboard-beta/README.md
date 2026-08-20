# rectify-webpack-react-nw-app

Minimal scaffold: a [rectify](https://github.com/bmatusiak/rectify) plugin app,
bundled by webpack, rendered with React, running live inside an nw.js window.

`webpack-rectify-react` (plugin architecture + theme kit) merged with
`react-nw-app` (nw.js shell). There is no build/packaging step — nw.js runs
everything, and the code it runs is the code in `src/`.

## three boots, one folder of plugins

A plugin is a folder in `src/app/` — one level down, or two — and the files
inside say where it runs. The second level is the grouping, and it mirrors the
app's own tab row, so looking at a tab tells you where its code is.

```
src/
  main.js       boot: nw's node context. loaded off disk, never bundled
  server.js     boot: the app's node half. bundled, reloaded on every save
  window.js     boot: the browser. bundled, hot reloaded
  config.js     settings, sliced per plugin
  index.html
  overlay.js
  rectify.d.ts
  app/
    core/           the plumbing, and nothing with a tab
      lifecycle/    shutdown, crashes, instance file
      http/         express, the swappable router
      io/           socket.io, all three sides
      window/       the nw window, and its handle
      tray/         the tray, and its menu api
      build/        webpack and the reload
      react/  storage/  remember/  datadir/  devtools/
      okc/          the socket to the running dashboard
      actions/      the action table          about/  drive/  ipc/  shot/
    ui/             how it looks, and what renders inside it
      theme/        the kit every pane draws from
      shell/        tabs, panes, the chrome
      kit/          the catalogue pane, under Settings
      editor/       ace, in its own vendor/
      markdown/     marked, in its own vendor/
    repositories/   repos conflicts branches lines changes prcuts graph
    runners/        machines guests sessions
    library/  keys/  github/  settings/  guards/     a tab that is one plugin
    judge/  tasks/  supervisor/  queue/  live/       stays flat, named for
    terminal/  api/  tests/                          the tab it serves
    inbox/  workspace/                               chrome, not in the row
```

A folder directly under `src/app/` is either a **plugin** (it has a `window.js`,
`server.js` or `main.js`) or a **group** (it has none, and holds plugins). Never
both — `test/plugins.test.js` refuses the shape, because a folder that was both
would be matched at either depth and register twice.

Each boot gathers its own half and nothing else:

```js
//src/window.js
var found = require.context('./app', true, /^\.\/[^_./][^/]*(?:\/(?!vendor\/)[^_./][^/]*)?\/window\.(js|jsx)$/);
var plugins = found.keys().map(found);
```

So **the folder is the registry**. Adding a plugin is creating a folder; there
is no list to update, and no way to add one in a place that forgets it. Rename
a folder with a leading `_` and it stops loading.

**The filename is the branch.** There is no `isServer` or `isBrowser` test
anywhere in a plugin, because a file that only exists in one bundle cannot run
in the other — and the window bundle never even parses the server half. That
also means editing a `server.js` no longer reloads the page: it is not in that
bundle.

### how the halves join

They are three separate rectify apps with three service graphs, so a plugin
that spans runtimes joins itself:

- `window/main.js` owns the real nw window and provides `window` on the main
  graph. `window/server.js` provides `window` on the app graph, wrapping a
  controller handed over from main. Same name, same meaning, different process.
- `tray/` does the same for the tray.
- `io/main.js` creates the socket.io server, `io/server.js` registers the
  handlers, `io/window.js` connects — and both of the latter share `serve.js`,
  which is the one function `?mock` runs in the page.

Main hands the app side a **host** object — `express`, `router`, `httpServer`,
`io`, `appPackage`, and controllers for `window` and `tray` — and it arrives as
`app.host`. Under one key on purpose: rectify's own `services.app` already
carries `window` (the dom window, or `global` in node), `services`, `on`,
`emit` and the `is*` flags, so anything spread in there is one name away from a
collision that looks like it works.

The startup order lives in `src/main.js` rather than inside whichever plugin
happens to depend on all the others:

```js
await services.build.ready();          //first bundle built and loaded
var url = await services.http.listen();
services.lifecycle.publish(url);       //tools/nw.js reads this
services.tray.start();
services.window.open();
```

Teardown is rectify's: `lifecycle.shutdown()` calls `app.destroy()` and every
plugin's `onDestroy` runs in reverse.

### why main.js sits at the root

`main.js` in the root is three lines that require `src/main.js`. nw.js loads
the manifest's `main` into a generated background page at the app root and
resolves that script's requires from the root rather than from the file's own
directory, so a boot living in `src/` cannot require its neighbours without it.

## building a package

```
npm run build   production bundles, compiled, staged into build/app
npm run dist    build, then nw-builder -> build/out
```

`npm start` runs whichever of the three you ask for:

```
npm start              the source tree. webpack in memory, both halves reload
npm start -- --build   build/app: the compiled main.bin, run by the sdk runtime
npm start -- --package build/out: the executable, exactly what a user runs
```

Each runs strictly later output than the one above it, so something that works
in the first and not the third narrows to the step between them. `--build` still
has the sdk runtime under it, so its console is audible and devtools work;
`--package` is the normal flavour and has neither.

`npm run build` produces four files and no javascript:

```
build/app/
  package.json   main: app.html, window hidden
  app.html       one line: evalNWBin(null, 'main.bin')
  main.bin       native code, compiled by nwjc
  icon.png
```

What goes into `main.bin`: `src/main.prod.js`, every `main.js` plugin half,
`src/server.js` and every `server.js` half, express, socket.io — and the window
half as a string, so it is served out of memory and never written to disk
either. Nothing is external, because there is no `node_modules` beside it.

### why it boots differently

`evalNWBin` is a `Window` method, and nw's node context has no window —
`nw.Window.get()` throws `No current window` there. So the packaged app's
`main` is a hidden local page whose only job is to load the binary. Local means
it has node; being a window means `evalNWBin` exists at all. The visible window
is still remote and still has no node.

That is the whole reason for the second boot: `src/main.js` reads plugins off
disk for development, `src/main.prod.js` gets the same list from the bundle
through `require.context`, and both hand off to `src/boot.js`.

`src/app/core/build` is where the two modes actually diverge — webpack, watching and
reloading on one side; assets served from memory and the node half simply
required on the other. `BUILD_PROD` gates the requires directly rather than
sitting inside a function, because webpack collects a dependency wherever it
can reach it, and a `require('webpack')` in an unreachable function would still
be bundled.

### paths inside a package

Nothing about the app's own location survives the move intact, so the two
places that need it are worth knowing:

- **`app.root` is `process.cwd()`** in the packaged boot. nw sets the working
  directory to the app's own directory, whichever directory it was launched
  from — measured both ways. The obvious alternatives all fail: `location.href`
  is a `chrome-extension://` url rather than `file://`, so `fileURLToPath`
  throws; `__dirname` does not exist in that context; `process.execPath` is the
  runtime; and `nw.App.startPath` is wherever the launch happened.
- **The tray icon goes in relative**, and nw resolves it against the app. The
  same value then works from the source tree and from inside a package.

Watch for that second one. An icon path that does not resolve is not an error —
`new nw.Tray()` succeeds, the menu works, and you get an invisible entry in the
notification area. It cost a while to notice, and longer to believe.

### builds from CI

`.github/workflows/prerelease.yml` builds all three platforms and attaches the
zips to a release, so a prerelease does not have to be built by hand. It runs
on `release: published` — which covers prereleases — and on
`workflow_dispatch`, where the zips land on the run itself instead.

The matrix is not a convenience. `nwjc` compiles for one platform and one nw.js
version, so each target has to be built on its own runner. Note `npm ci` must
run install scripts there: nw's postinstall is what fetches the sdk, and the
build needs `nwjc` out of it.

**Nothing is signed**, and no certificate is involved anywhere. What that costs
whoever downloads it:

- **Windows** — SmartScreen warns. More info, then Run anyway.
- **macOS** — the workflow ad-hoc signs (`codesign --sign -`, no identity
  needed) because Apple Silicon refuses to run an unsigned binary at all. It is
  still quarantined on download, so:
  `xattr -dr com.apple.quarantine "Rectify NW App.app"`, or right-click and Open.
- **Linux** — `chmod +x` the binary if the zip did not preserve it.

macOS also has no `.icns` here, so it packages without an icon rather than with
a fabricated one. Drop a real `.icns` in and pass it as `app.icon` in
`tools/pack.js` when there is one.

### what this does and does not protect

It means the app runs what it shipped with: there is no `.js` on disk to edit,
and no `node_modules` to shim. Swapping `main.bin` for another one is possible
but it is not a text edit.

It is not encryption. The window half is delivered to a browser context to run,
so it is readable there by anyone who opens devtools — as any client code is.
And `nwjc` output is tied to **one platform and one nw.js version**, so the
build has to run on each target with the runtime it will ship against. That is
why `tools/pack.js` takes its version from the same `nw` pin that compiled the
binary.

## install

```
npm install
```

`nw` is pinned to the `-sdk` build, so devtools work and the flavour is decided
by the version rather than by an `.npmrc` npm now warns about on every command.
If npm blocks install scripts the runtime never downloads — `npm approve-scripts
nw`, then reinstall.

## run

```
npm start        # nw.js: node context + window, then gives the terminal back
npm run stop     # close it, and wait until it is actually closed
npm run restart  # stop, wait, start — for changes to the half that does not reload
npm run build    # production bundles, compiled and staged into build/app
npm run dist     # build, then nw-builder -> build/out
npm test         # node --test
```

`npm start` is the only way in. The window and the server half rebuild on save,
so most work needs nothing else; `npm run restart` is for a change to a
`main.js`, which is loaded once and never reloads.

`npm start` also takes `--build` and `--package` to run what those two produced
— see [building a package](#building-a-package).

`npm start` returns straight away and the app keeps running. Run it again and
it says so, and brings the window back:

```
$ npm start
launching node_modules\nw\nwjs-sdk-v0.114.2-win-x64\nw.exe
logging to nw.log  (--attach to watch it live)

$ npm start
already running (pid 35788) at http://localhost:57539/
bringing its window to the front
```

nw.js is single instance, so the second launch is handed to the running app,
which shows its window. That handoff happens inside the nw binary though, so
the launcher cannot see it — `main.js` writes `.nw-instance.json` with its pid
and url, and `tools/nw.js` reads that. A stale file left by a hard kill is
caught by signalling the pid.

Detached means the output goes to `nw.log` instead of your terminal.
`npm start -- --attach` keeps it in the foreground when you want to watch a run
happen, and combines with `--build` and `--package`. Other flags pass through
either way:

```
npm start -- --remote-debugging-port=9222
```

The port is whatever is free, so two of these can run side by side. `PORT=8080`
pins it.

`tools/nw.js` passes `--enable-logging=stderr`, which is what makes the
window's console audible at all — without it a page that threw on load looks
exactly like a page with nothing to draw.

### inspecting either half

Devtools does not open by itself. The tray menu has both:

- **Inspect window** — the page. `win.showDevTools()`, the ordinary thing.
- **Inspect main.js** — the node context. Not the ordinary thing: `main.js`
  runs in `_generated_background_page.html`, which nw does not treat as a
  window, so `nw.Window.get()` throws `No current window` there with or without
  a window object passed to it. The way in is chromium's own debugger. The
  launcher starts nw with `--remote-debugging-port=0`, chromium picks a free
  port and writes it to `DevToolsActivePort` in the user data dir, and the
  `background_page` entry in `/json` carries a frontend url to open.

  (`nw.App.dataPath` is `<user data>/Default`; the port file is one level up.)

The port is loopback-only and never pinned. Pass your own
`--remote-debugging-port` to override it.

### reloading

Both halves hot reload. The window half goes through webpack-hot-middleware;
the node half is watched too, and on each rebuild `build/main.js` tears the old
one down and loads the new bundle in place — same process, no restart.

That teardown is why a `server.js` has to clean up after itself. Return an
`onDestroy` alongside what you provide — the same shape as an effect returning
its cleanup:

```js
//src/app/my-thing/server.js
async function plugin(imports, register) {
    imports.app.host.router.get('/api/thing', ...);   //router is swapped for you

    await register(null, {
        'my-thing': ...,
        onDestroy: function () {                      //anything else, undo it here
            imports.app.host.io.removeAllListeners('connection');
        }
    });
}
```

Without it a reload stacks a second copy of every listener. There is a test for
exactly that.

`onDestroy` is rectify's own slot: `register()` collects it and `app.destroy()`
runs them, in reverse dependency order, catching so one bad cleanup cannot
strand the rest. It works for any plugin, including one that provides nothing.

### the window is a view, the tray is the app

Closing the window does not quit. The node half keeps running behind the tray
icon; reopen from the tray, by left-clicking it, or by running `npm start`
again, and quit from the tray's Quit.

Two mechanisms hold that up, because one of them is not reliable:

- `close` is intercepted and the window hidden instead, so reopening is instant
  with the page state intact. Nice when it works — but **a page reload silently
  drops that listener** while leaving `loaded` firing, and the window half
  full-reloads on any change it cannot hot swap. So the first edit you make
  turns close back into a real close. Re-attaching on `loaded` does not fix it;
  the handle is stale.
- So `window` also opens a hidden, never-closed keep-alive window. nw quits when
  the *last* window closes, and that one never does. If the interception held,
  the window hides; if it did not, the window is destroyed and the app survives
  anyway — "Open window" then makes a fresh one.

Measured both ways: fresh start, close hides it. After an edit, close destroys
it and the app is still serving.

Quitting has to be thorough. `nw.App.quit()` alone does not always manage it —
the http server, socket.io and webpack's watchers are open handles, and the
node context can outlive the window holding them, which leaves a copy running
with nothing on screen and the port taken. So `shutdown()` closes the server,
removes the tray, closes the windows, quits, and then hard exits.

Closing the devtools window does nothing to the app.

### the tray belongs to the app too

`src/app/core/tray/server.js` provides a `tray` service, so a plugin can put its own
items on the menu:

```js
//src/app/my-thing/server.js
plugin.consumes = ['tray'];

async function plugin(imports, register) {
    var item = imports.tray && imports.tray.add({
        label: 'Say hello in the log',
        click: function () { console.log('hello'); }
    });

    //nw.MenuItem options all work: type, checked, enabled, submenu, icon, key

    await register(null, { onDestroy: function () { if (item) item.remove(); } });
}
```

Give the item back on teardown and a reload cannot leave a second copy behind —
the menu is rebuilt from scratch each time rather than patched by index. The
`window` service alongside it carries `url`, `isOpen`, `open()`, `show()`,
`hide()`, `openInBrowser()` and `quit()`.

The icon and the window themselves live in `tray/main.js` and `window/main.js`,
not in the halves that reload: they have to outlive the bundle that is being
thrown away. The `server.js` halves wrap a controller and own only what they
added.

Booted under plain node there is no nw.js at all, so both services are
`undefined` — check for them before using them. The test suite runs the server
half exactly that way.

Two things you will see if a copy is somehow still up:

```
Opening in existing browser session.        # nw.js is single instance. the
                                            # second start woke the first one
                                            # and exited. the window comes back.

port 8080 is already taken. another copy    # only if you pinned PORT.
is probably still running.                  # this one shuts down instead of
                                            # sitting there dead.
```

## adding a plugin

Make a folder under `src/app/` and put in the halves you need. Nothing to
register:

```
src/app/my-thing/
  server.js     runs in the node half
  window.js     runs in the window
```

If it belongs to a tab that already has a group, it goes inside that one
instead — `src/app/repositories/my-thing/`. Two levels is as deep as the
loaders look, which is what keeps a plugin's own `vendor/` from ever being
mistaken for a plugin.

```js
//src/app/my-thing/server.js
plugin.consumes = ['app', 'appPackage'];
plugin.provides = ['my-thing'];
async function plugin(imports, register) {
    imports.app.host.router.get('/api/my-thing', ...);

    await register(null, {
        'my-thing': {},
        onDestroy: function () { /* undo it, this half reloads */ }
    });
}
module.exports = plugin;
```

Service names are the contract between halves and between plugins; rectify
resolves the order from `consumes` and `provides`, so the order of the folders
never matters.

### the theme kit

`theme` is a slot, and bringing your own style is the expected thing to do.
Bootstrap, jquery and bootstrap-icons are in `src/app/ui/theme/` because something
had to be — tailwind, plain css, a component library or nothing at all all fit
the same slot.

The service name is the only thing anything outside that directory knows:
`src/app/_example/window.js` asks for `theme` and reads `theme.navbar`. So a swap is the
whole directory replaced. What this kit happens to carry is `navbar`, `dialog`,
`themeSwitcher`, `bs` (its own library) and `$` (its dom helper, deliberately
not a top level service since another kit may not want one) — none of which are
required of a replacement, only of the example plugin that uses them.

### config

`src/config.js` is the app's settings. Rectify slices it by service name and
hands each plugin its own piece as the third argument to setup, so the theme
plugin reads `config.theme.mode`:

```js
async function plugin(imports, register, config) {
    var mode = config.theme.mode || ...;
}
```

### when a plugin fails to start

All three boots listen for rectify's `error`. Without that the emit throws with
no indication of which plugin died. `src/main.js` and `src/server.js` log it —
and the server boot rethrows, so a broken node half fails the reload loudly
instead of half-starting. `src/window.js` also prints it at the top of the page
rather than leaving you a blank one.

## the services

There is no typescript here. It was removed once this stopped being a scaffold:
`tsconfig.json` covered `.ts` files only, and by then the one `.ts` file left
was the scaffold's own demonstration — so `npm run typecheck` opened two files
out of thirty and reported success, which reads as "the app is type-clean" and
means "the two files I looked at were". A check whose scope is smaller than its
name is worse than no check, because it is quoted as evidence.

So the service graph is documented here instead of declared in a `.d.ts`. Every
service, across all three boots:

| service | where | what it is |
|---|---|---|
| `app` | all three | rectify's own: `on`, `emit`, `services` |
| `http` | main | express, the swappable router, `listen()` |
| `lifecycle` | main | `shutdown(reason)`, `publish(url)`, `isShuttingDown` |
| `build` | main | `ready()` — resolves once both bundles are up |
| `io` | main, server, window | socket.io: the server on one side, the client on the other |
| `appPackage` | server, window | title, name, version, description |
| `window` | main, server | the nw window, and a handle onto it |
| `tray` | main, server | `add(item)`, `labels()` |
| `react` | window | `root`, the createRoot handle |
| `session`, `config` | window | the two stores, on sessionStorage and localStorage |
| `theme` | window | the dashboard's kit: `Topbar`, `Pane`, `Panel`, `Card`, `Badge`, `Button`, `Empty`, `Note`, `Mono` |
| `shell` | window | `tab({ name, order, Component })` — the topbar and which tab shows |
| `okc` | window | `call(action, args)`, `connected`, `onUp(fn)` — the running dashboard |

A plugin declares what it needs in `plugin.consumes` and is handed exactly
those. Anything it did not declare is not reachable, which is the boundary that
makes a tab a tab rather than a file that happens to live in its own folder.

## when things break

Failures here are easy to make invisible — a window with nothing in it, or a
node context that has quietly stopped serving. So:

- a plugin that throws during startup is caught by rectify's `error`, logged,
  and printed over the page
- if the server half fails to rebuild, its old handlers are already gone, so
  the node side pushes `server:error` down the socket and the window says so
- an uncaught exception in the node context logs and shuts the app down rather
  than leaving a headless process behind
- reloads are queued, so two rebuilds in quick succession cannot interleave and
  double-register

## what nw.js's node context will not run

This is the reason for several of the pinned versions. nw.js integrates node's
loop into a chromium render process, and that context is not plain node:

- **ESM-only packages do not load.** `import()` of a bare specifier fails with
  `Failed to resolve module specifier`. Plain node happily `require()`s ESM, so
  these only break under nw.js:
  - `@babel/core` 8 is ESM-only — `transformSync` never returns, it blocks the
    thread forever. Hence babel is pinned to the 7.x line.
  - `sass-loader` 17 is ESM-only — webpack loads loaders with `import()`.
    Pinned to 16.
  - `webpack-dev-server` 6 resolves express with `await import("express")`, so
    `server.start()` never finishes. That is why the bundle is served by
    `webpack-dev-middleware` on our own express app instead.
- **`URL` is not the same class as node's.** `new URL(x) instanceof
  require('url').URL` is `false`. sass-loader's webpack importer trips on this
  ("The canonicalize() method must return a URL"), so `webpackImporter` is off
  and sass resolves `@use "bootstrap/scss/bootstrap"` through `loadPaths`.
- **`--mixed-context` swaps in the browser's timers.** `setInterval()` then
  returns a number with no `.unref()`, which crashes `webpack-hot-middleware`
  on startup. Nothing here does cross-context `instanceof`, so the flag is gone.
- **`window` and `document` exist there.** Which is why a plugin's runtime is
  the file it is in, rather than a test it runs: every global you would sniff
  reports the wrong thing on one side or the other. Rectify's own
  `services.app.window` is that same trap — it is the dom window, or `global`
  in node, and never the app's window.
- `Worker` and `WebSocket` are not available there either.

Everything is in `devDependencies`: the app compiles itself at startup, so
there is no smaller runtime-only install to separate out.
