var React = require('react');
var { useRef, useEffect, useImperativeHandle, forwardRef } = React;

//THE TERMINAL AND THE ONE ADDON THIS APP USES, required rather than fetched —
//the same decision ../editor makes about ace, for the same reason. Both files
//are UMD, so a require gives back the module they publish.
var xterm = require('./vendor/xterm/xterm.js');
var fitAddon = require('./vendor/xterm/addon-fit.js');
//IT CANNOT LAY OUT WITHOUT THIS. xterm measures a character cell out of the DOM
//and positions every row against it; with no stylesheet the rows stack at the
//browser's default line height and the cursor lands nowhere near the text. It is
//the one plain .css file in the app, and webpack.config.js says why it has a
//rule of its own.
require('./vendor/xterm/xterm.css');

//---------------------------------------------------------------------------
//a terminal: bytes that arrived from somewhere else.
//
//A <pre> IS NOT GOOD ENOUGH, AND THIS TIME IT IS NOT ABOUT LOOKS AT ALL. What
//comes back from a machine is not text — it is drawing instructions. A pty
//answers with escape sequences that move the cursor, repaint a line, clear the
//screen and colour a word, and a `<pre>` renders those as garbage in the middle
//of the output somebody is trying to read. This app already learned that once
//from the other end: a URL scraped out of `script -qec` arrived wrapped and
//doubled because nothing had stripped the escapes.
//
//SO IT IS THE SAME ARGUMENT ../editor MAKES. That one exists because a hundred
//lines of undifferentiated JavaScript is something a person scrolls past and
//approves anyway. This one exists because a terminal's output is unreadable
//without something that understands it, and a person who cannot read what a
//machine said cannot judge what it did.
//
//A PLUGIN OF ITS OWN, WITH ITS OWN VENDOR FOLDER. xterm is 488KB and belongs to
//exactly one concern. Swap this plugin and the panes do not change.
//
//NO NATIVE MODULE, AND THAT IS THE POINT. A terminal usually implies a pty,
//which on Windows means node-pty — a compiled dependency that has to match the
//Node ABI NW.js was built against, and that is exactly the kind of thing this
//project does not have. It is not needed: `ssh -tt` allocates the pty on the
//machine at the far end, which is where the shell actually is. This side only
//moves bytes.
//
//AND IT MOVES NO BYTES ITSELF. Nothing here opens a connection, spawns anything
//or knows what a machine is. It is a surface: write to it, read what was typed
//into it, and size it to its box. Whatever carries the bytes is somebody else's
//plugin, and the relay that would carry them is not built yet.
//
//IT KNOWS NOTHING ABOUT THE THEME, deliberately. The theme consumes this, not
//the other way round: every pane consumes the theme, so a theme that this
//consumed back would be a cycle. Same shape as ../editor and the guard hook.
//---------------------------------------------------------------------------

plugin.consumes = ['react'];
plugin.provides = ['xterm'];
async function plugin(imports, register) {

    var Terminal = xterm.Terminal;
    var FitAddon = fitAddon.FitAddon;

    //MATCHES THE WINDOW RATHER THAN XTERM'S DEFAULT BLACK, so a terminal sitting
    //in this page does not look like a hole cut in it. Carried over exactly from
    //the old window, colours included: they are this app's, not a theme somebody
    //picked, and changing them here would make one pane disagree with the rest.
    var LOOK = {
        fontFamily: 'Consolas, "Cascadia Mono", monospace',
        fontSize: 13,
        theme: { background: '#0a0d12', foreground: '#c9d1d9', cursor: '#58a6ff' },
        //KEPT, because the whole point of a terminal is reading what went past.
        scrollback: 5000
    };

    //A REF RATHER THAN A PROP FOR THE BYTES, and that is the whole shape of this
    //component. Output arrives continuously and is APPENDED; a `text` prop would
    //mean re-rendering the terminal on every chunk, and re-rendering a terminal
    //means throwing away the scrollback somebody is reading. So the caller holds
    //a handle and writes into it.
    var Term = forwardRef(function Term({ onData, onResize, look, height }, ref) {
        var host = useRef(null);
        var term = useRef(null);
        var fit = useRef(null);

        useEffect(function () {
            if (!host.current) return;

            var t = new Terminal(Object.assign({}, LOOK, look || {}, {
                //A CURSOR THAT BLINKS ONLY WHERE SOMETHING CAN BE TYPED. A
                //captured console is being READ, and a blinking cursor on it is
                //a promise that a keystroke goes somewhere.
                cursorBlink: !!onData,
                disableStdin: !onData
            }));
            var f = new FitAddon();
            t.loadAddon(f);
            t.open(host.current);
            term.current = t;
            fit.current = f;

            //FITTED AFTER THE BOX EXISTS, not before. xterm measures its
            //container to work out how many columns fit, and a container the
            //browser has not laid out yet measures zero — which gives a terminal
            //one column wide that never recovers on its own.
            try { f.fit(); } catch (e) { /* not laid out yet; the observer below gets it */ }

            var typed = onData ? t.onData(onData) : null;

            //RESIZED WITH ITS BOX, because the far end has to be told. A pty
            //that thinks it is 80 columns while the window is 200 wraps every
            //line in the wrong place, and the person reading it sees a terminal
            //that is subtly broken rather than one that is the wrong size.
            var watching = null;
            if (typeof ResizeObserver == 'function') {
                watching = new ResizeObserver(function () {
                    try { f.fit(); } catch (e) { /* mid-teardown */ }
                    if (onResize && t.cols && t.rows) onResize({ cols: t.cols, rows: t.rows });
                });
                watching.observe(host.current);
            }

            return function () {
                if (watching) watching.disconnect();
                if (typed) { try { typed.dispose(); } catch (e) { /* already gone */ } }
                term.current = null;
                fit.current = null;
                //DISPOSED, NOT LEFT. xterm attaches listeners and a canvas; a
                //pane that mounted one of these per selection would otherwise
                //leak a terminal per click. The same reason ../editor destroys
                //its ace instance.
                try { t.dispose(); } catch (e) { /* already gone */ }
            };
            //ONCE, AND ONLY ONCE. Everything that changes about a terminal
            //changes THROUGH it — bytes are written, the box is watched — so
            //rebuilding on a prop change would be throwing away scrollback to
            //apply something that did not need it.
        }, []);

        useImperativeHandle(ref, function () {
            return {
                write: function (bytes) { if (term.current) term.current.write(bytes); },
                //CLEARED RATHER THAN REBUILT, for the same reason as above.
                clear: function () { if (term.current) term.current.clear(); },
                fit: function () { try { if (fit.current) fit.current.fit(); } catch (e) { /* no box yet */ } },
                focus: function () { if (term.current) term.current.focus(); },
                get size() {
                    return term.current ? { cols: term.current.cols, rows: term.current.rows } : null;
                }
            };
        }, []);

        //THE BOX IS THE CALLER'S, AND IT MUST BE A DEFINITE ONE. xterm fills
        //whatever it is given, and this plugin has no opinion about how big a
        //terminal should be — a pane showing one console and a pane showing four
        //want different answers.
        //
        //WHAT IT MAY NOT BE IS CONTENT-SIZED. The observer above and xterm's own
        //fit feed each other if the height comes from the content: fit picks
        //rows, the rows make the box taller, the observer sees a taller box, fit
        //picks more rows. The theme's `.term` sets a height for exactly that
        //reason, and `height` here overrides it with another definite one —
        //which is why it is a value and not a flag: there is no "size yourself".
        return <div className="term" ref={host} style={height ? { height: height } : undefined} />;
    });

    await register(null, {
        xterm: {
            Term: Term,
            //THE LOOK, HANDED OUT RATHER THAN COPIED. Anything that wants a
            //terminal-ish surface of its own should start from the same colours
            //rather than picking them again.
            LOOK: LOOK
        }
    });
}
module.exports = plugin;
