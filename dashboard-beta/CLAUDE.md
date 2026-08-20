# dashboard-beta

The `dashboard/` app, ported to rectify plugins + React + webpack, running under
NW.js and in a browser tab.

## The dev loop

**It is webpack, with the dev server built in.** `webpack-hot-middleware`
(`reload=true`) serves the window bundle and `webpack().watch()` rebuilds the
server half. Both are already running.

**A UI change needs nothing.** Edit `src/app/**/window.js`, any other file in the
window bundle, or a `.scss`, and the page rebuilds and reloads itself in about
five seconds. Do not build. Do not restart.

    edit → poll `node tools/okc.js windowControls --json` until it reflects the
           change → verify

**`npm run restart` is only for what does not reload:**

* `src/app/**/main.js` — the process that never reloads
* `webpack.config.js`
* a new npm dependency or anything vendored

It builds on the way, so `npm run build` before it is redundant. Run it
**backgrounded** — in the foreground it hangs on the child's stdout and killing
the call takes the app with it.

**`npm run build` on its own** is for a compile check that HMR would swallow,
and before `npm test` or a commit. That is all.

Roughly: 5 seconds versus 90. Reaching for build+restart on a UI change is an
hour a day of nothing.

## Proving a change

Never conclude from reading the source. Run it.

    node tools/okc.js show --tab X --pane Y     put a pane on screen
    node tools/okc.js windowControls --json     what is on screen right now
    node tools/okc.js windowShot --name n       photograph it (--whole, --width)
    npm run walk                                open every tab and pane
    npm test

`windowControls` reports `loading` (a skeleton is visible) and `content` (how
many characters are on the pane) separately from the button and field counts —
so "nothing to press" and "nothing there" stay different answers.

`show --tab X --pane Y` lands first time. It did not used to: the shell filed
the pane under the tab it was *leaving*, so the first call switched tab and kept
X's old pane, and a second call fixed it. That was worked around here for a whole
session and written into this file as if it were a property of the window — a
workaround that works is how a defect gets promoted to documented behaviour.

Still check `on` came back as what you asked for before photographing. A shot of
the wrong pane looks exactly like a shot of the right one.

## Porting a pane

**Photograph the original first, and look at the picture.**

    cd ../dashboard && node tools/okc.js windowShot --view <view>/<pane>

It writes a PNG *and* an HTML file, and is not gated by testing mode. The JSON
from an action gives the data; only the picture gives the shape — which column
is narrow, what sits beside the heading, which sentence the pane leads with,
what is a whole state rather than a disabled button. Grep the markup for
structure as well, never instead.

The tab and pane names come from `../dashboard/ui/index.html` and are not up for
invention.

## Where server logic goes

The dashboard's own node logic is being moved out of `../dashboard/` and into the
plugin whose pane uses it. It goes in one of two places and the split is not
about subject:

* **A service goes where it is owned.** `log` is written by every action module
  there will ever be, so it is `core/log` beside `actions` and `io` — not in
  `live/`, even though Live is where you read it.
* **An action goes where the pane is.** `logSince` and `logClear` are what the
  Live pane asks for, so they are `live/server.js`. Same shape as `show` living
  in `ui/shell/server.js`.
* **How an answer prints goes with the plugin too**, in `cli.js` — the fourth
  half. `okc.js todos` printing a wall of braces is a JSON dump with a prompt in
  front of it, and whoever knows how a todo should read wrote the todo pane.
  It exports `{ print: { <action>: said => string } }`, nothing more; an action
  with no printer still prints as JSON, and `--json` always does.
* A plugin with none of them has no server half. Most do not.

`cli.js` is a plain module, not a rectify plugin: the command line is a separate
program with no plugin graph in it, which is what lets it answer while the window
is closed. It is loaded by a walk in `tools/okc.js` — the **fifth** place the
"one or two levels, no `_`, no `vendor`" rule is written down, and
`test/plugins.test.js` holds it to the same answer as the other four.

**`main.js` versus `server.js` is about lifetime, not subject.** The node bundle
is rebuilt on every save; main is not. Anything that must survive a save goes in
main and is handed over on the host — the window, the tray, the action table, and
now the log. `core/log/server.js` is that hand-over, and it answers with a log
that drops every line when there is no main behind it, because the test suite
builds server halves against a bare host and every ported module logs.

**Moving an action shadows the relayed one, and that is the migration path.**
`actions.call` tries this app's table first and the pipe to `dashboard/` second,
so a moved action takes over the moment it is defined and everything not yet
moved keeps working. It also means the pane starts reading THIS app's answer —
state lives in `%LOCALAPPDATA%\dashboard-beta`, not the dashboard's, so a moved
subsystem starts empty. That is deliberate: nothing here can corrupt the real
machines, tasks or sign-ins. Say so in the pane if empty would read as broken.

## Rules the code is built to

* **A pane never names a CSS class.** Everything it draws with comes from
  `theme`. CSS has no undefined-name error, so a misspelt class is the quietest
  failure available here. If the kit lacks something, add it to the kit —
  `Settings → Kit` is the catalogue and the review surface, and `THEME.md` says
  what belongs there versus in a plugin's own stylesheet.
* **Purple means a person.** A purple button is a press the command line is
  refused; a purple field outline is a value that is neither read nor written
  from outside. The colour is only honest because of the refusal.
* **Nothing irreversible without the gate.** `ask()` from the theme.
* **`remember` keeps only where somebody was looking**, never what they were
  looking at. Credentials live in the app data folder, which is derived from
  `name` in `package.json` — a rename moves it, and it is not the old app's.
* **Vendored, not installed**, for anything that renders somebody else's bytes.
  See `vendors/README.md`.
