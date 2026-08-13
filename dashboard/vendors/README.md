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
