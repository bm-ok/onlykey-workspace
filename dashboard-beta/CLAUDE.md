# dashboard-beta

Only use claude credentials for testing worker, judge, and supervisor workflow., 
Test everything else without credentials as possible.

while developing Target tests to the features in progress, then run the whole test suite as the final gate.

if provide a scrren shot and markup, read both beucase markkup will show rendered dropdown options the user cant photo

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

**That promise was false for most of a day and nothing said so.** A hot update
that nobody accepts is a SUCCESS as far as `reload=true` is concerned — the
console says `[HMR] Nothing hot updated.` and the page keeps running the old
code. The window's plugin graph is built once at startup, so no module ever
accepts one, so every window-side edit landed in the bundle and stopped there.

The server half reloaded correctly throughout, which is what made it so hard to
see: half the app updated and half did not, and the half that did not was the
half you look at.

`src/window.js` now reloads the page on any hot update, because for a graph
built at startup there is no hot swap that could be correct. If a window edit
ever again fails to appear, check `nw.log` for `Nothing hot updated` before
touching the code.

**`npm run restart` is only for what does not reload:**

* `src/app/**/main.js` — the process that never reloads
* `webpack.config.js`
* a new npm dependency or anything vendored
* **moving, adding or removing a plugin FOLDER.** The three boot files find
  plugins with `require.context`, which enumerates at BUILD time — so a folder
  that moves leaves the watcher holding a path that no longer exists.

It builds on the way, so building before it is redundant. Run it
**backgrounded** — in the foreground it hangs on the child's stdout and killing
the call takes the app with it.

**The folder one fails in a shape worth knowing**, because nothing points at the
folder. The window keeps working, since it is serving the last good bundle;
`npm test` and `npm run check` are both green, since they build from scratch; and
`okc.js show` puts the pane up quite happily. The only sign is a red overlay on
the window reading `Module build failed … ENOENT`, naming the old path — which
`okc.js capture` shows and every other check misses. It is the strongest case in
this file for looking at the picture rather than at a green tick.

**`npm run check` is the compile check**, and it is the only one. webpack over
both halves, in memory: it writes nothing, packages nothing, and takes a few
seconds. Run it after an edit HMR would swallow, and before `npm test` or a
commit.

It answers exactly one question — *does it compile* — and says so on the way
out, because that is the question it kept getting mistaken for the other one. A
pane that compiles perfectly and draws nothing is a pane that compiles. Whether
it WORKS comes from the window: `okc.js show`, `okc.js capture`, `npm run walk`.

**`npm run build-prod` is the PACKAGED build.** It is not a compile check — it
is slower, it clears and fills `dist/`, and it goes on to nwjc and stages
`build/app`. Reaching for it to find out whether the source parses is the drift
this file already warns about, one rung down: 90 seconds and a rebuilt package
to answer what `npm run check` answers in five.

`npm run build` no longer builds anything. It echoes that sentence back at you
and exits, because it was reached for so often as a compile check.

Roughly: 5 seconds versus 90. Reaching for build+restart on a UI change is an
hour a day of nothing.

**Check that nothing is mid-turn before saving a server-side file.** A save
reloads the server half, and the reload drops the channel a machine is
holding: the supervisor's turn ends with `this host is shutting down`, a
sweep dies between writing its note and recording what arrived. Before any
`server.js` edit: `okc.js supervisorState --json` says `thinking: false` and
`okc.js queueState --json` shows nothing `running`. Hold the save otherwise.

**`okc-bootstrap.tar` is what a fresh workspace starts from, and it goes stale
by hand.** After a skill, job, prompt or contract is approved here, run
`node tools/okc.js bootstrapShip` — it rewrites the repo's tar from the live set
and prints which entries moved, with both sizes, which is the line the commit
message needs. It went fourteen thousand characters behind once because the
only other way was a window press and a save-as over the checked-in file.

## The backslash trap

**A backslash typed into a shell heredoc arrives halved.** Writing a file through
`bash <<'EOF'` — or through `python - <<'PYEOF'` — is the fastest way to edit
several places at once, and it is the one way to put a character into a file that
is not the character you typed.

| you meant | what landed | what it did |
|---|---|---|
| `join('\n')` — an escape | a real newline, mid-string | unterminated string, build fails |
| a Windows pipe path | one backslash where two were meant | dialled nothing, `ENOENT` |
| `person\'s` | `person's` | unterminated string, build fails |

Type **four** backslashes to get two. It cost time on four separate edits in one
afternoon and the failures do not look alike: two were build errors, one was a
client dialling a pipe that does not exist, and one was silent.

**This very section was written through a heredoc and arrived mangled** — the
table above came out with real newlines in it and the pipe path halved. That is
the whole argument in one paragraph: the thing you are least likely to notice is
the edit that describes the problem.

**The reliable ways out, in order:**

* Use `Write` or `Edit` for anything containing a backslash. They take the string
  as given.
* Build the character in JavaScript instead — `String.fromCharCode(27)` for an
  escape, `String.fromCharCode(13, 10)` for CRLF. `ui/kit/kit.js` does exactly
  this for the terminal exhibit, and says why: what that exhibit is FOR is
  control sequences, so the sequences have to survive the next person editing
  them.
* Reword to avoid it. An apostrophe inside a single-quoted JS string can usually
  become a different sentence.

`test/bytes.test.js` catches the invisible half of this — a stray control
character that builds, runs, and makes later string edits silently miss.

## Proving a change

Never conclude from reading the source. Run it.

    node tools/okc.js show --tab X --pane Y     put a pane on screen
    node tools/okc.js windowControls --json     what is on screen right now
    node tools/okc.js capture --name n          the picture AND the markup
    npm run walk                                open every tab and pane
    npm test

**First ask whether the app is UP**, which is not what any other check answers.

    node tools/okc.js windowControls --json     # `failed` is null when healthy

A bare identifier is valid syntax. `node --check` parses one, `npm run check`
bundles one, and `okc.js show` puts a pane up off the last good bundle — so all
three read green while the server half is dead, and the pane under the red
overlay goes on rendering its data, which is what makes it convincing. That is
how `ReferenceError: makeFreeing is not defined` survived a session: two green
checks, then a screenshot from somebody who had simply looked at the screen.

**AND WHETHER THE SERVER HALF ACTUALLY REBUILT, which is a third question and
the quietest of the three.** The watcher can stop rebuilding while everything
else goes on working perfectly.

Nothing points at it. `okc.js` still answers, because the pipe is served by a
half that did not need to reload. The action list is right. `npm run check` is
green and `npm test` is green, because both build from scratch. `windowControls`
says `failed: null`. Every check available says the app is healthy, and it is —
it is just not running the code you last wrote.

    grep -a "is listening on 7383" nw.log | tail -1

That line is the receipt: the guest-facing server rebinds on every server-half
reload, so its timestamp is when your code last became real. If it is older than
your edit, nothing you have measured since means anything.

It cost an hour on the git door. The route was registered, `guestApis` listed it
with the right paths, and a machine got a 401 anyway — so the search went into
the route matcher, the register, `may`, the token, and the record shape, all of
which were correct. The answer was that the app had last rebuilt ten minutes
before the edit that added the door. **Two "verified" results in that window were
verifications of stale code**, which is worse than no result: a wrong answer
arrived at carefully is one you defend.

`npm run restart` is the fix and it is also the way to rule this out — reach for
it before doubting your code when a server-half change does not appear.

`failed` and `broke` are different questions and both are on that answer.
**`broke` is one pane throwing inside a working window; `failed` is the window
not working.** `npm run walk` stops on `failed` rather than walking forty-two
panes against a dead app, and `grep -a "server half failed to reload" nw.log`
is the same answer from the other side.

The overlay also `console.error`s itself, so it is in the dev console and in
`nw.log` without anybody asking. It comes down again on the next reload that
works — a check that says "down" while the app is up is not believed twice.

**Reach for `capture`, not `windowShot`.** It writes both files, of the same
moment, named the same thing, and takes everything `windowShot` takes —
`--whole`, `--width`, `--height`. `windowShot` is the picture on its own and is
what `capture` is built from; using it directly gets you half the answer and no
sign that the other half was available.

The two halves are not the same evidence. A class that matches no rule is
invisible in the picture and obvious in the markup; a value drawn from the wrong
field is the other way round. CSS has no undefined-name error here, so a
misspelt class is the quietest failure this app has, and the markup is the only
place it shows.

Ctrl+Shift+D does the same thing from the window and offers the two paths for
copying. It is `src/app/debug-snapshot`, which is deletable in one piece.

**The picture is of the app window; the markup is of a PAGE.** Those are the same
thing only while one page is connected, and a browser tab left open at
`localhost:7317` is a page. It answers the request for markup for as long as it
is open — including a tab from a previous run that has stopped reloading and is
serving a DOM from an hour ago.

`capture` used to take the socket that connected FIRST, which is reliably the
oldest and therefore the most likely to be dead. It now takes the newest and
**says `pages: n` on the answer** whenever more than one was listening. If that
field is there, close the extras before believing anything in the file.

This is worth knowing because of the shape it fails in. The edit lands, `npm run
check` is green, `curl localhost:7317/window.js` contains the change, the log
says `[HMR] Reloading page` — and the capture does not show it. Every one of
those points at the code. None of them points at the camera, and an hour went
into the code before the camera was suspected.

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

## Building a pane

**Photograph it and look at the picture, not only at the markup.** The JSON from
an action gives the data; only the picture gives the shape — which column is
narrow, what sits beside the heading, which sentence the pane leads with, what is
a whole state rather than a disabled button.

There was an app this one was ported from, and for a long time the instruction
here was to photograph ITS version of a pane first and take the tab and pane
names from its `index.html`. That app is gone — no relay, no source in this
repository — so there is nothing to copy from and nothing to check a name
against. What is here is what there is.

## Where server logic goes

Node logic goes in the plugin whose pane uses it. It goes in one of two places
and the split is not about subject:

* **A service goes where it is owned.** `log` is written by every action module
  there will ever be, so it is `core/log` beside `actions` and `io` — not in
  `live/`, even though Live is where you read it.
* **An action goes where the pane is.** `logSince` and `logClear` are what the
  Live pane asks for, so they are `live/server.js`. Same shape as `show` living
  in `ui/shell/server.js`.
* **How an answer prints goes with the plugin too**, in `cli.js` — the fourth
  half. `okc.js memory` printing a wall of braces is a JSON dump with a prompt in
  front of it, and whoever knows how a memory should read wrote the memory pane.
  It exports `{ print: { <action>: said => string } }`, nothing more; an action
  with no printer still prints as JSON, and `--json` always does.

  **It is the half nothing tested, and it rotted first.** `judgementFindings`
  stopped answering with `reads` and `state`; its printer went on reading them
  and printed `J4 undefined undefined` for a commit. Nothing failed — reading a
  missing field off an object is `undefined`, and `'  ' + undefined` is a
  perfectly good string, so `npm run check` and the whole suite stayed green.
  `test/judge/judgement-printing.test.js` is the shape of the fix: the answer's
  shape copied from the action, asserting no printer emits `undefined` or
  `[object Object]`.
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

**There is one action table, and nothing behind it.** `actions.call` answers
from this app or refuses. For most of the port it fell through to a pipe to
`dashboard/`, so a moved action shadowed the relayed one and everything not yet
moved kept working — that pipe is gone, along with `actions.elsewhere`, the
`where` field on the action list, and the purple dot that reported it.

**What that means for anything still missing:** it is missing, visibly, rather
than answered by the app nothing here may write to. Roughly thirty of the old
app's names have no counterpart here — most of them machine introspection and
shell, `vmShell` and `vmSerial` and the rest. Build them here if they are
wanted; do not reach for the old app.

State lives in `%LOCALAPPDATA%\dashboard-beta`, not the dashboard's, so a
subsystem that moved starts empty. That is deliberate: nothing here can corrupt
the real machines, tasks or sign-ins. Say so in the pane if empty would read as
broken.

## Rules the code is built to

* **A pane never names a CSS class.** Everything it draws with comes from
  `theme`. CSS has no undefined-name error, so a misspelt class is the quietest
  failure available here. If the kit lacks something, add it to the kit —
  `Settings → Kit` is the catalogue and the review surface, and `THEME.md` says
  what belongs there versus in a plugin's own stylesheet.
* **Purple is a hazard mark: this is the person's, and a model may not use it.**
  It has to scream the moment anything reaches for what it is on. A purple button
  is a press the command line is refused; a purple field outline is a value that
  is neither read nor written from outside. **The dot in the corner is the one
  exception and the only place purple is a status**: it means the person has
  something waiting, lit by the Inbox count. That is the same sentence from the
  other side — on a control purple says *this is the person's*, in the corner it
  says *the person has something to do* — and neither answers *how is it going*.
  (It used to mean this app was still attached to `dashboard/`; that relay is
  gone.) The colour is only honest because of the refusal, and it is only
  legible while it is spent on nothing else — every other colour in the theme
  answers *how is it doing*, and purple answers *is this mine*. **The test for a new purple thing is never "is this
  important"** — everything on a dashboard is important to somebody. It is
  whether reaching for it is out of bounds. **There is no complete list any
  more.** `Settings → Kit` had a Guarded shelf that claimed to be one; the shelf
  is gone and the purple exhibits live on Buttons. Counted today it is thirteen
  — twelve buttons and the GitHub token field — across eight files, and nothing
  enumerates them — so adding one no longer
  makes a sentence somewhere false, which means nothing will catch a careless
  one for you.
* **Grep the stylesheet before inventing a class name**, including a class
  assembled from a variable. `class="dot notice"` drew a wide purple oval because
  `.notice` is the banner — padding, flex, a gap — and every check was green.
  `test/rules/classes.test.js` covers the literal `className="a b"` form and, for
  components whose class is `'<base> ' + <prop>`, follows the prop. It cannot
  follow an arbitrary one: if you add a component of that shape, add it to
  `TONED` in that file.
* **Nothing irreversible without the gate.** `ask()` from the theme.
* **`remember` keeps only where somebody was looking**, never what they were
  looking at. Credentials live in the app data folder, which is derived from
  `name` in `package.json` — a rename moves it, and it is not the old app's.
* **Vendored, not installed**, for anything that renders somebody else's bytes,
  and it lives **inside the plugin that uses it** — `ui/editor/vendor/ace`,
  `ui/markdown/vendor/marked`, `ui/xterm/vendor/xterm`. There is no shared
  `vendors/` folder here: a library that belongs to one concern should go when
  that concern does. `ui/xterm/vendor/README.md` is the shape a note takes —
  version, where it came from, and what would break without each file.
* **A secret is never an attribute, and never on screen unmasked.** `capture`
  writes the whole rendered DOM and a picture of the window to `/shots`, with no
  redaction anywhere — unlike the live log, which stays in memory precisely
  because command output carries tokens, and unlike `core/events`, which
  allowlists and scrubs before writing. Two things keep captures safe today and
  **neither is a rule this app enforces**: React sets `value` as a property so a
  typed value is not serialised into `outerHTML` (measured with a canary), and
  the token field is `type="password"` so it photographs as dots. An
  uncontrolled input, a `defaultValue`, a hand-written `value={...}`, or an
  unmasked field breaks one of those and every capture afterwards carries the
  secret, silently. `/shots` is gitignored and nothing in it is tracked, but
  those files are cleartext in the working tree — unpublished, not protected,
  and worth deleting after reading.
