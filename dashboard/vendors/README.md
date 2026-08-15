vendors
=======

Third-party code, checked in rather than installed.

This app has no build step and, apart from NW.js itself, nothing it fetches at
run time. A dependency resolved by a package manager is a file that exists on
whoever ran `npm install` last, at whatever version the registry served that
day — and the same window on another machine, or a year from now, is then not
the same window. What is here is what runs.

It also means the one rule this project has held to throughout still holds: what
it needs is here, or it comes from node and git. Nothing is fetched while the
tool is being used.


ace/ — Ace editor 1.44.0
------------------------

Used to show code that is being READ rather than written: the source of a
pre-defined task in the approval dialog, and a branch's diff. Both are things a
person has to read carefully enough to make a decision about, and a plain `<pre>`
of a hundred lines of JavaScript is not that.

BSD licensed; `ace/LICENSE` is the copy that came with it.

Taken from `https://unpkg.com/ace-builds@1.44.0/src-noconflict/`, which is why
those file names look the way they do. `src-noconflict` is the build whose
internal names are prefixed, so nothing it defines collides with a global in a
page that also has node.

Only the parts that are used:

    ace.js                   the editor
    theme-tomorrow_night.js  a dark theme, to match this window
    mode-javascript.js       for a task definition
    mode-diff.js             for what came back on a branch
    mode-markdown.js         for a brief or a contract
    ext-searchbox.js         ctrl-F inside a long definition

Not taken: every other mode and theme, and the syntax-check workers. The workers
are deliberate rather than an oversight — they are only useful for code being
written, everything here is read-only, and a worker in an app page is a second
path for a file to be loaded from.

To move to a newer version, replace these files with the same names from the
same path at the new version, change the number above, and check the two places
that call `codeBlock()` still render.


nanotar/ — nanotar 0.3.0
-------------------------

Reads a tar. Used on one thing: the `~/.claude` archive a worker hands back when
a run ends, so the dashboard can say what that worker actually did — how many
turns, which tools, which files it touched — instead of only how big the file is.

MIT licensed; `nanotar/LICENSE` is the copy that came with it.

    nanotar.js   the CommonJS build, from https://unpkg.com/nanotar@0.3.0/dist/index.cjs

**Only tar, because gzip was already free.** Node ships `zlib`, so
`zlib.gunzipSync` needs nothing vendored; tar is the half node has no opinion
about. That is also why the archive stays compressed: 16 KB on disk against 92 KB
unpacked, for one call.

Chosen for what it does NOT bring. `tar-stream` is the obvious package and pulls
in `b4a`, `bare-fs`, `streamx` and `fast-fifo`; `it-tar` pulls in seven. This has
none, and is 9.5 KB.

It is only ever pointed at an archive this app made from a machine it built. It
is still treated as untrusted input — see `look()` in `tasks/sessions.js`, which
reads every field defensively and answers with "could not be read" rather than
throwing, because losing a transcript because its SUMMARY failed would be the
tail wagging the dog.


marked/ — marked 18.0.9
------------------------

Markdown to HTML, for the things here that are written to be READ rather than
inspected: a report a run handed back, the rules a task carries, a pull request
body before it goes out. As source those are a wall of pipes and hashes, and the
one thing the formatting was for is the thing that does not happen.

MIT licensed; `marked/LICENSE` is the copy that came with it.

    marked.js   the UMD build, from https://unpkg.com/marked@18.0.9/lib/marked.umd.js

The UMD one specifically. marked's `main` is now ESM, and this window loads its
vendors as classic `<script>` tags — the same reason ace is the `src-noconflict`
build.

**It does not sanitise, and is not asked to.** marked passes raw HTML through by
design and removed its `sanitize` option years ago for saying otherwise. That is
fine here because nothing rendered by it is trusted OR trusted-adjacent: it goes
into an iframe with `sandbox=""` and a `default-src 'none'` policy, so a
`<script>` in a machine's report is inert and a remote `<img>` cannot report that
the file was opened. See `markdownFrame` in `ui/base.js` — the frame is the
defence, not the parser, and swapping the parser would not change that.

To move to a newer version, replace `marked.js` with the UMD build at the new
version, change the number above, and open any handed-back `.md` file.


xterm/ — xterm.js 6.0.0, and its fit addon 0.11.0
-------------------------------------------------

The terminal in the Terminal tab. MIT licensed; `xterm/LICENSE` is the copy that
came with it.

    xterm.js        the terminal
    xterm.css       its stylesheet, which it needs to lay out at all
    addon-fit.js    sizes it to whatever box it is in
    LICENSE

From `https://unpkg.com/@xterm/xterm@6.0.0/` and
`https://unpkg.com/@xterm/addon-fit@0.11.0/`.

**No native module, and that is the point.** A terminal usually implies a pty,
which on Windows means `node-pty` — a compiled dependency that has to match the
Node ABI NW.js was built against, and that is exactly the kind of thing this
project does not have. It is not needed here: `ssh -tt` allocates the pty on the
machine at the far end, which is where the shell actually is. This side only
moves bytes.
