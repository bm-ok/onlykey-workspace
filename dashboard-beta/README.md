# dashboard-beta

A desktop app that runs Claude on a workspace of git repositories without
giving Claude the computer it runs on.

It builds virtual machines, lends each one a sign-in for as long as a piece
of work takes, gives it a branch and a brief a person approved, and rolls
the machine back to a clean snapshot afterwards. What comes back is a
branch pushed to this host and a report; whether any of it reaches GitHub
is a separate press, made by a person.

**[What this dashboard is](docs/what-is-the-dashboard.md)** is the longer
answer — what it does, why it exists, and where a person stands in it. The
rest of `docs/` is the app's own wiki, shown on its Docs tab.

This file is about the *repository*: how to run it, how it is put together,
and what will bite you.

## Install and run

```
npm install
npm start
```

`nw` is pinned to the `-sdk` build, so devtools work. If npm blocks install
scripts the runtime never downloads — `npm approve-scripts nw`, then
reinstall.

| | |
|---|---|
| `npm start` | the app. Returns straight away; it keeps running |
| `npm run stop` | close it, and wait until it actually closed |
| `npm run restart` | for a change to a `main.js`, which never reloads |
| `npm run check` | does it compile — both halves, in memory, five seconds |
| `npm test` | `node --test`, ~2,700 of them in about two minutes |
| `npm run walk` | open every tab and pane and report what drew |
| `npm run sabotage` | break a guard on purpose and check a test notices |
| `npm run build-prod` | the packaged build, staged into `build/app` |
| `npm run dist` | build, then nw-builder → `build/out` |

`npm start` returns and the app keeps running, logging to `nw.log`
(`npm start -- --attach` keeps it in the foreground). Run it again and it
brings the window back rather than starting a second copy — nw.js is single
instance, and `main.js` writes `.nw-instance.json` so the launcher can tell.

**Most work needs nothing but a save.** The window half hot reloads and the
node half is rebuilt and swapped in place. `npm run restart` is only for
`main.js`, `webpack.config.js`, a new dependency, or a plugin folder being
added, moved or removed — the loaders enumerate folders at build time.

See [the dev loop](docs/development/the-dev-loop.md) and
[proving a change](docs/development/proving-a-change.md). `CLAUDE.md` is
the short form of both and is what the model reads first.

## How it is put together

A [rectify](https://github.com/bmatusiak/rectify) plugin app, bundled by
webpack, rendered with React, running inside an nw.js window. In
development there is no build step: nw.js runs the code in `src/`.

**A plugin is a folder under `src/app/`**, one level down or two, and the
files inside say where it runs — `main.js`, `server.js`, `window.js`,
`cli.js`. There is no list to update: the folder is the registry, and each
boot gathers its own half with `require.context`. The second level mirrors
the app's tab row, so a tab tells you where its code is.

```
src/app/
  core/         the plumbing: http, io, state, actions, log, events, ssh …
  ui/           theme, shell, kit, and the vendored editors
  repositories/ repos sync branches lines cuts pull requests issues graph
  vms/          building machines, provisioning, the channel, the editor door
  runners/      machines, sign-ins, sessions
  queue/ judge/ worker/ supervisor/    the loop and the three agents
  diy/          a lane of your own, with no queue in it
  library/ keys/ github/ guards/ settings/ docs/ live/ terminal/ api/
  git/ inbox/ meter/ cron/ bootstrap/ artifact/ workspace/ tests/ …
```

[Plugins](docs/development/plugins.md) is the full account: the four
halves, what may consume what, and why a service goes where it is owned
while an action goes where its pane is.

## The packaged build

```
npm run build-prod     bundles, compiles, stages build/app
npm run dist           and then nw-builder -> build/out
```

`npm start` also takes `--build` and `--package` to run what those
produced. Each runs strictly later output than the one above it, so
something that works in the first and not the third narrows to the step
between them.

`build-prod` produces four files and no javascript:

```
build/app/
  package.json   main: app.html, window hidden
  app.html       one line: evalNWBin(null, 'main.bin')
  main.bin       native code, compiled by nwjc
  icon.png
```

`main.bin` carries `src/main.prod.js`, every `main.js` and `server.js`
half, express and socket.io — and the window half as a string, served out
of memory and never written to disk.

**Why it boots differently.** `evalNWBin` is a `Window` method and nw's
node context has no window, so the packaged `main` is a hidden local page
whose only job is to load the binary. Local means it has node; being a
window means `evalNWBin` exists at all. That is the whole reason there are
two boots: `src/main.js` reads plugins off disk, `src/main.prod.js` gets
the same list from the bundle, and both hand off to `src/boot.js`.

**It is not encryption.** The window half runs in a browser context, so it
is readable by anyone who opens devtools, as any client code is. And
`nwjc` output is tied to one platform and one nw.js version, which is why
CI builds each target on its own runner.

**Nothing is signed.** Windows SmartScreen warns; macOS is ad-hoc signed
(Apple Silicon refuses an unsigned binary outright) and still quarantined,
so `xattr -dr com.apple.quarantine`; Linux may need `chmod +x`.

## What nw.js's node context will not run

This is the reason for several pinned versions. nw.js integrates node's
loop into a chromium render process, and that context is not plain node.
Everything here was found the hard way:

- **ESM-only packages do not load.** `import()` of a bare specifier fails
  with `Failed to resolve module specifier`. Plain node happily `require()`s
  ESM, so these break *only* under nw.js:
  - `@babel/core` 8 is ESM-only — `transformSync` never returns, it blocks
    the thread forever. Babel is pinned to 7.x.
  - `sass-loader` 17 is ESM-only; webpack loads loaders with `import()`.
    Pinned to 16.
  - `webpack-dev-server` 6 resolves express with `await import("express")`,
    so `server.start()` never finishes. The bundle is served by
    `webpack-dev-middleware` on our own express app instead.
- **`URL` is not node's `URL`.** `new URL(x) instanceof require('url').URL`
  is `false`. sass-loader's importer trips on it, so `webpackImporter` is
  off and sass resolves through `loadPaths`.
- **`--mixed-context` swaps in the browser's timers**, so `setInterval()`
  returns a number with no `.unref()` and crashes
  `webpack-hot-middleware` on startup. The flag is gone.
- **`window` and `document` exist there.** Which is why a plugin's runtime
  is *the file it is in* rather than a test it runs: every global you would
  sniff reports the wrong thing on one side or the other.
- `Worker` and `WebSocket` are not available there either.

Everything is in `devDependencies`: the app compiles itself at startup, so
there is no smaller runtime-only install to separate out.

## What a reload costs you

The node half is torn down and rebuilt in place on every save, so a
`server.js` has to undo what it did:

```js
async function plugin(imports, register) {
    imports.app.host.router.get('/api/thing', ...);   //router is swapped for you

    await register(null, {
        'my-thing': ...,
        onDestroy: function () { /* anything else, undo it here */ }
    });
}
```

Without it a reload stacks a second copy of every listener. There is a test
for exactly that.

**Closing the window does not quit.** The node half keeps running behind
the tray icon. Two mechanisms hold that up, because one is not reliable:
`close` is intercepted and the window hidden — but a page reload silently
drops that listener, and the window full-reloads on any change it cannot
hot swap. So a hidden, never-closed keep-alive window is opened as well: nw
quits when the *last* window closes, and that one never does.

## Where everything else is written down

| | |
|---|---|
| `docs/` | the app's own wiki, shown on its Docs tab |
| `docs/what-is-the-dashboard.md` | what it does and why |
| `docs/development/` | the loop, proving a change, the tests, plugins |
| `CLAUDE.md` | the short form, and what a model reads first |
| `THEME.md` | what belongs in the kit versus in a plugin's own stylesheet |

If a page and the app disagree, the app is right and the page is wrong.
