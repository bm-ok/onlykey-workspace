# Plugins

A plugin is a folder under `src/app/` — one level down, or two — and the
files inside say where it runs. There is no list to update: **the folder
is the registry.**

## The four halves

| file | runs in | reloads |
|---|---|---|
| `main.js` | nw's node context | never |
| `server.js` | the app's node half | on every save |
| `window.js` | the browser | on every save |
| `cli.js` | the command line, not a plugin | when `okc.js` runs |

`main.js` versus `server.js` is about lifetime, not subject: anything that
must survive a save goes in main and is handed over. `cli.js` exports
`{ print: { <action>: said => string } }` — how an answer prints goes with
the plugin that knows what it means.

## Declaring what it needs

    // src/app/artifact/server.js
    plugin.consumes = ['app', 'log', 'git', 'workspace', 'lines', 'archive'];
    plugin.provides = ['artifact'];
    async function plugin(imports, register) { ...; await register(null, { artifact: ... }); }

Most plugins provide nothing — `plugin.provides = []` — and exist to define
actions and draw a pane. `src/app/docs/server.js` is one.

Rectify resolves the order from `consumes` and `provides`. A plugin is
handed exactly what it declared and nothing else — that boundary is what
makes a tab a tab.

## Where things go

- **An action goes where the pane is.** `logSince` is the Live pane's, so
  it is `live/server.js`.
- **A service goes where it is owned.** `log` is written by everyone, so it
  is `core/log`. Nothing under `core/` may name an app service; a test
  holds it.
- **A shared system is its own plugin.** If more than one plugin needs it,
  ask who owns it, not where to put it.
- **Vendored, inside the plugin that uses it** — `ui/editor/vendor/ace`,
  `ui/markdown/vendor/marked`. No shared vendors folder.

## The window's rules

A pane never names a CSS class; everything it draws with comes from
`theme`, and `Settings → Kit` is the catalogue. Purple is a hazard mark
and is spent on nothing else; nothing enumerates it any more. Nothing
irreversible without
`ask()`. `remember` keeps only where somebody was looking. A secret is
never an attribute and never on screen unmasked.

## Adding a tab

    shell.tab({ name: 'Docs', order: 115, Component: ... });

in `window.js`, and a restart — a new folder is found at build time.
`test/rules/plugins.test.js` refuses a folder that is both a plugin and a
group, and `test/rules/` holds the rest of the shape.
