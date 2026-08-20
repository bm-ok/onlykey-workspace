# vendor

Third-party code, checked in rather than installed.

A dependency resolved by a package manager is a file that exists on whoever ran
`npm install` last, at whatever version the registry served that day — and the
same window on another machine, or a year from now, is then not the same window.
What is here is what runs.

It sits **inside the plugin that uses it** rather than in one folder at the root.
xterm belongs to exactly one concern; putting it somewhere shared would make it
look like something the app needs, when what the app needs is "show me what this
machine said". Delete this plugin and its 488KB goes with it.

## xterm/ — xterm.js 6.0.0, and its fit addon 0.11.0

    xterm.js        the terminal
    xterm.css       its stylesheet, which it needs to lay out at all
    addon-fit.js    sizes it to whatever box it is in
    LICENSE         MIT, the copy that came with it

From `https://unpkg.com/@xterm/xterm@6.0.0/` and
`https://unpkg.com/@xterm/addon-fit@0.11.0/`.

**The stylesheet is not decoration.** xterm measures a character cell out of the
DOM and positions every row against it; without `xterm.css` the rows stack at the
browser's default line height and the cursor lands nowhere near the text. It is
the only plain `.css` file in this app, which is why `webpack.config.js` has a
rule that exists for it alone.

**No native module, and that is the point.** A terminal usually implies a pty,
which on Windows means `node-pty` — a compiled dependency that has to match the
Node ABI NW.js was built against, and that is exactly the kind of thing this
project does not have. It is not needed here: `ssh -tt` allocates the pty on the
machine at the far end, which is where the shell actually is. This side only
moves bytes.

**Both files are UMD**, so `require()` gives back what they publish — `Terminal`
from one, `FitAddon` from the other. Nothing is fetched at run time.
