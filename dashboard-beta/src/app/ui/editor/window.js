var React = require('react');
var { useRef, useEffect } = React;

//ACE, AND THE THREE MODES THIS APP ACTUALLY READS. Required rather than fetched:
//each of these files calls `ace.define(...)` against the global ace sets up, so
//pulling them into the bundle registers them and nothing is loaded over the wire
//at run time. The old window sets `basePath` and lets ace fetch them, which is
//the same decision made for a page with no build step.
var ace = require('./vendor/ace/ace.js');
require('./vendor/ace/mode-javascript.js');
require('./vendor/ace/mode-markdown.js');
require('./vendor/ace/mode-diff.js');
require('./vendor/ace/theme-tomorrow_night.js');

//ACE-DIFF, BUILT FROM SOURCE AND VENDORED BESIDE ACE. It carries
//@sanity/diff-match-patch inside it and takes ace through an option rather than
//off the window, so nothing here depends on a global. Its build declares both a
//named and a default export, which is what the `.default ||` is for.
var aceDiff = require('./vendor/ace-diff/ace-diff.js');
var AceDiff = aceDiff.default || aceDiff.AceDiff || aceDiff;

//INJECTED, NOT EMITTED -- the plugin stylesheet rule in webpack.config.js. All
//of its colours are custom properties on `.acediff`, which is what makes two
//palettes possible without a second stylesheet.
require('./vendor/ace-diff/ace-diff.css');

//---------------------------------------------------------------------------
//A <pre> IS THE OBVIOUS OTHER WAY, and it costs about 900KB less. What it costs
//instead is in ./README.md's first section, which is an argument about approvals
//rather than about looks.
//
//READ-ONLY IN FOUR WAYS, not one. The content is not editable; the cursor is
//hidden so it does not invite one; the active-line highlight is off for the same
//reason; and the syntax worker is never started. Nothing here is a place to
//write code, and it should not look like one for even a moment.
//
//A PLUGIN OF ITS OWN, WITH ITS OWN VENDOR FOLDER. Ace is 900KB and belongs to
//exactly one concern. Putting it in the shared vendors folder would make it look
//like something the app needs, when what the app needs is "show me this text so
//it can be read" — and that is what this provides. Swap this plugin and the
//panes do not change.
//
//IT KNOWS NOTHING ABOUT THE THEME, deliberately. The theme consumes this, not
//the other way round: every pane consumes the theme, so a theme that this
//consumed back would be a cycle. Same shape as the guard hook.
//---------------------------------------------------------------------------

plugin.consumes = ['react'];
plugin.provides = ['editor'];
async function plugin(imports, register) {

    //ACE WILL NOT TAKE Infinity; it wants a count. This is "no lid".
    var HUGE = 100000;

    //THE LID A DIFF ASKS FOR. With maxLines set, ace lays out EVERY row rather
    //than only the visible ones — fine for a script somebody wrote, and not fine
    //for a ten-thousand-line machine-generated diff, which would lay out fifty
    //thousand rows and take the window with it. Generous enough that an ordinary
    //change is still read whole.
    var LID = 500;

    //TWO PALETTES, AND THE CALLER PICKS -- the same shape as ../xterm,
    //../markdown and ../litegraph, and for the same reason: this plugin knows
    //nothing about the theme, so whoever knows which mode is showing says so.
    //
    //A PALETTE HERE IS TWO THINGS, because a diff is two things: an ace theme
    //for the text, and the custom properties ace-diff paints its gutter,
    //connectors and highlight bands with. Flip only the first and the diff bands
    //stay a pale blue drawn for a white ground; flip only the second and the
    //code stays dark inside a light frame.
    //
    //THE DARK NUMBERS ARE UPSTREAM'S OWN `styles-twilight.css`, which is the
    //preset it ships for a dark ace theme. They are here rather than in a second
    //vendored stylesheet because two stylesheets both targeting `.acediff` cannot
    //be switched between -- whichever webpack injects last wins for good.
    var DARK = {
        theme: 'ace/theme/tomorrow_night',
        vars: {
            '--acediff-gutter-bg': '#1a1a1a',
            '--acediff-gutter-border': '#333333',
            '--acediff-diff-bg': '#004d7a',
            '--acediff-diff-border': '#003554',
            '--acediff-diff-char-bg': '#006699',
            '--acediff-arrow-color': '#f8f8f8',
            '--acediff-arrow-shadow': 'rgba(0, 0, 0, 0.7)',
            '--acediff-arrow-hover-left': '#61a2e7',
            '--acediff-arrow-hover-right': '#f7b742'
        }
    };

    //`ace/theme/textmate` needs no file: it is ace's default and is in the core
    //build, the same way `ace/mode/text` is. The values are the stylesheet's own
    //defaults, written out rather than left implied -- a palette that is an empty
    //object cannot put back what the other one set.
    var LIGHT = {
        theme: 'ace/theme/textmate',
        vars: {
            '--acediff-gutter-bg': '#efefef',
            '--acediff-gutter-border': '#bcbcbc',
            '--acediff-diff-bg': '#d8f2ff',
            '--acediff-diff-border': '#a2d7f2',
            '--acediff-diff-char-bg': '#b8e2f5',
            '--acediff-arrow-color': '#000000',
            '--acediff-arrow-shadow': 'rgba(255, 255, 255, 0.7)',
            '--acediff-arrow-hover-left': '#004ea0',
            '--acediff-arrow-hover-right': '#c98100'
        }
    };

    var LOOKS = { dark: DARK, light: LIGHT };

    //anything unrecognised is dark, because that is what this was before there
    //was a choice
    function look(mode) { return mode === 'light' ? LIGHT : DARK; }

    //READ-ONLY ALREADY REFUSES THE TYPING; this stops it being offered.
    function hideCursor(ed) {
        try { ed.renderer.$cursorLayer.element.style.display = 'none'; } catch (e) { /* older ace */ }
    }

    //---- ONE EDITOR, AND `editable` IS WHAT IT IS FOR -----------------------
    //
    //THE SAME PROP AS `Diff` TAKES, and the same shape of answer: read-only by
    //default, and with `editable` the content takes typing and `onChange` gets
    //what is in it. A caller that wants a place to WRITE a document -- rather
    //than to resolve a change between two of them -- has one editor to fill, and
    //until now this plugin only offered that as half of a comparison.
    //
    //THE FOUR REFUSALS BELOW ARE UNDONE TOGETHER OR NOT AT ALL. Read-only is
    //four things, not one -- the content, the cursor, the active line and the
    //worker -- and turning one of them round and leaving the others is an editor
    //that takes typing and does not look like one.
    function Editor({ text, mode, min, max, look: wanted, editable, onChange }) {
        var host = useRef(null);
        var edRef = useRef(null);
        var skin = wanted || DARK;
        var body = String(text == null ? '' : text);

        //THE CALLBACK THROUGH A REF, and a flag saying WE are the ones writing.
        var back = useRef(onChange);
        back.current = onChange;
        var writing = useRef(false);
        var lo = min || 3;
        var hi = max == null ? HUGE : max;

        useEffect(function () {
            if (!host.current) return;
            var ed = ace.edit(host.current);
            edRef.current = ed;

            ed.setTheme(skin.theme);
            //PLAIN TEXT UNLESS ASKED OTHERWISE, and the default matters more
            //than it looks. Most of what this app puts up to be read is PROSE —
            //a contract, a prompt, a brief — and highlighting prose as
            //JavaScript colours `delete`, `do`, `in` and `that` at random. On a
            //contract about what a judge may NOT do, that is false emphasis on
            //the one document somebody has to read every line of.
            //
            //`ace/mode/text` needs no mode file; it is in the core.
            ed.session.setMode('ace/mode/' + (mode || 'text'));
            //NO WORKER UNLESS SOMETHING IS BEING WRITTEN. It is a syntax
            //checker, and spending a thread and a round of parsing to put
            //squiggles under somebody else's finished document is the cost with
            //none of the benefit — but under what a person is typing right now,
            //that is exactly the benefit.
            ed.session.setUseWorker(!!editable);
            ed.setValue(body, -1);
            ed.setReadOnly(!editable);
            ed.setOptions({
                highlightActiveLine: !!editable,
                highlightGutterLine: !!editable,
                showPrintMargin: false,
                fontSize: 12,
                //WRAPPED, because the alternative is a horizontal scrollbar on
                //the one thing somebody is meant to read every line of.
                wrap: true,
                showFoldWidgets: false,
                //ACE MEASURES ITS OWN LAID-OUT ROWS, AFTER WRAPPING, and sizes
                //the container to them. Arithmetic here would be wrong twice
                //over: too short, because a long thing hits a clamp and gets a
                //scrollbar inside a page that already scrolls — which is how a
                //hundred lines gets scrolled past and approved anyway — and too
                //tall, because `wrap` turns one long line into three screen rows
                //and counting newlines cannot know that.
                minLines: lo,
                maxLines: hi
            });
            //THE CURSOR IS A PROMISE THAT YOU CAN TYPE. Read-only already
            //refuses the typing; this stops it being offered -- and where typing
            //IS the point, the promise is one this keeps.
            if (!editable) hideCursor(ed);

            //The height guessed before ace saw the box was for one frame only.
            //Ace owns it now, and leaving the guess behind would fight it.
            host.current.style.height = '';

            //---- AND WHAT WAS TYPED, THROUGH A REF ---------------------------
            //
            //The same arrangement as `Diff`'s, for the same reason: a caller
            //passing an inline function would otherwise tear this editor down
            //and rebuild it on every render of the page around it, and with
            //`editable` on, that is somebody's typing.
            //
            //`writing` GUARDS THE PROGRAMMATIC WRITE below, so setting the text
            //from a prop does not come back out as though a person had typed it.
            var typed = function () {
                if (writing.current) return;
                var fn = back.current;
                if (fn) fn(ed.getValue());
            };
            if (editable) ed.session.on('change', typed);

            return function () {
                edRef.current = null;
                if (editable) ed.session.off('change', typed);
                //DESTROYED, NOT LEFT. Ace attaches window resize listeners and a
                //text layer; a pane that mounts one of these on every selection
                //would otherwise leak an editor per click.
                try { ed.destroy(); } catch (e) { /* already gone */ }
            };
        }, [mode, lo, hi, editable]);

        //RECOLOURING NEVER REBUILDS. Putting the palette in the dependency list
        //of the effect above would throw away the scroll position on every mode
        //change -- ../xterm has the same note, and for the same reason.
        useEffect(function () {
            var ed = edRef.current;
            if (ed) ed.setTheme(skin.theme);
        }, [wanted]);

        //TEXT CHANGES WITHOUT REBUILDING THE EDITOR, so picking the next file in
        //a list does not tear down and re-lay-out a thousand rows. `-1` puts the
        //cursor at the start rather than selecting everything.
        useEffect(function () {
            var ed = edRef.current;
            if (!ed || ed.getValue() === body) return;
            //FLAGGED, SO THIS DOES NOT COME BACK OUT AS TYPING. Without it a
            //caller that echoes `onChange` into the `text` prop -- which is the
            //ordinary way to hold a draft in React -- gets its own write handed
            //back to it as a change, and the cursor jumps to the start on every
            //keystroke.
            writing.current = true;
            try { ed.setValue(body, -1); }
            finally { writing.current = false; }
        }, [body]);

        //A HEIGHT BEFORE ACE SEES IT. Ace measures its container to lay out, so
        //a container with no height renders an editor with no rows in it — which
        //looks exactly like an empty file. Replaced above on the first frame.
        var rough = Math.max(lo, Math.min(hi === HUGE ? 40 : hi, body.split('\n').length + 1));

        return <div className="code" ref={host} style={{ height: (rough * 1.5) + 'em' }} />;
    }

    //WHAT NEARLY EVERY CALLER ACTUALLY WANTS: a block of something to be read,
    //sized to fit, with a lid only where one is needed. `tall` is the lid — it
    //is what a diff and a long log ask for, and what a job's script does not.
    //
    //THE NAME IS Code AND NOT Editor BECAUSE THE PANES SAY WHAT THEY MEAN. A
    //pane showing a contract is not embedding an editor; it is showing text that
    //has to be read closely. `Editor` stays exported for the one thing that will
    //need it later — a side-by-side diff has to reach the instance to scroll two
    //of them together.
    function Code({ text, mode, tall, look: wanted }) {
        return <Editor text={text} mode={mode} max={tall ? LID : undefined} look={wanted} />;
    }

    //THE VARIABLES GO ON THE ELEMENT ACE-DIFF MAKES, NOT ON OURS. It wraps our
    //container's contents in its own `<div class="acediff">`, and the stylesheet
    //sets the light defaults ON that class -- so a value inherited from a parent
    //loses to it, and putting the palette on our own element does nothing at
    //all. Inline on that element is what wins.
    function paint(hostEl, skin) {
        var box = hostEl && hostEl.querySelector('.acediff');
        if (!box) return false;
        Object.keys(skin.vars).forEach(function (name) {
            box.style.setProperty(name, skin.vars[name]);
        });
        return true;
    }

    //---------------------------------------------------------------------
    //a diff: the second thing in this app that is read closely enough for a
    //decision to hang on it.
    //
    //ONE COMPONENT, TWO JOBS, AND THE PROP SAYS WHICH. Read-only it is a
    //picture of a change somebody has to judge; with `editable` the right pane
    //takes typing and the gutter grows copy arrows, which is a place to resolve
    //a change rather than only look at it. They are the same component because
    //they are the same geometry -- the difference is whether anything may move.
    //
    //ACE COMES THROUGH AN OPTION rather than off `window.ace`. ace-diff falls
    //back to the global when it is not told, and this app has no global ace:
    //ours is a module in this plugin's vendor folder, which is the whole point
    //of vendoring it here.
    //---------------------------------------------------------------------
    function Diff({ left, right, mode, height, look: wanted, editable, onChange, onDiffReady }) {
        var host = useRef(null);
        var madeRef = useRef(null);
        var skin = wanted || DARK;
        var L = String(left == null ? '' : left);
        var R = String(right == null ? '' : right);

        //CALLBACKS THROUGH A REF. A page passing an inline function would
        //otherwise tear down and rebuild two ace editors on every render of the
        //page around it -- and with `editable` on, that is somebody's typing.
        var back = useRef({});
        back.current.onChange = onChange;
        back.current.onDiffReady = onDiffReady;

        useEffect(function () {
            if (!host.current) return;

            //true while WE are setting the text, so a programmatic update does
            //not come back out of onChange as if somebody had typed it
            var writing = false;

            var made = new AceDiff({
                ace: ace,
                element: host.current,
                mode: 'ace/mode/' + (mode || 'text'),
                theme: skin.theme,
                //THE LEFT SIDE IS NEVER EDITABLE, in either job. What is being
                //judged is the change FROM the left, so a left that can be
                //edited is a diff that can be made to say anything.
                left: { content: L, editable: false, copyLinkEnabled: !!editable },
                right: { content: R, editable: !!editable, copyLinkEnabled: !!editable },
                onDiffReady: function (diffs) {
                    var fn = back.current.onDiffReady;
                    if (fn) fn(diffs);
                }
            });
            madeRef.current = made;

            var eds = made.getEditors();
            [eds.left, eds.right].forEach(function (ed) {
                //NO WORKER, for the reason above: nothing here is being written
                //in the sense a syntax checker means.
                ed.session.setUseWorker(false);
                ed.setOptions({
                    highlightActiveLine: false,
                    highlightGutterLine: false,
                    showPrintMargin: false,
                    fontSize: 12,
                    showFoldWidgets: false,
                    //NOT WRAPPED, AND THAT IS NOT A PREFERENCE. Every position
                    //ace-diff draws -- the bands, the connectors, the arrows --
                    //is a document row times a line height. A wrapped line is
                    //one document row and two screen rows, so with `wrap` on the
                    //connectors slide further out of place the further down the
                    //file somebody reads. A horizontal scrollbar is the price.
                    wrap: false
                });
            });

            //THE CURSOR IS A PROMISE THAT YOU CAN TYPE, so only the side that
            //can shows one.
            hideCursor(eds.left);
            if (!editable) hideCursor(eds.right);

            var session = eds.right.getSession();
            function typed() {
                if (writing) return;
                var fn = back.current.onChange;
                if (fn) fn(eds.right.getValue());
            }
            if (editable) session.on('change', typed);

            paint(host.current, skin);

            //TEXT CHANGES WITHOUT REBUILDING, which the effect below drives
            made.setBoth = function (nextL, nextR) {
                writing = true;
                try {
                    if (eds.left.getValue() !== nextL) eds.left.setValue(nextL, -1);
                    if (eds.right.getValue() !== nextR) eds.right.setValue(nextR, -1);
                } finally { writing = false; }
                made.diff();
            };

            return function () {
                madeRef.current = null;
                if (editable) session.off('change', typed);
                //DESTROYED, NOT LEFT: it holds two ace editors, a scroll lock
                //between them and document-level handlers. Its own destroy()
                //takes all three.
                try { made.destroy(); } catch (e) { /* already gone */ }
            };
        }, [mode, editable]);

        useEffect(function () {
            var made = madeRef.current;
            if (made && made.setBoth) made.setBoth(L, R);
        }, [L, R]);

        //RECOLOURING NEVER REBUILDS, the lesson ../xterm learned the hard way:
        //with the palette in the dependency list of the effect above, flipping
        //the page from dark to light would throw away the scroll position, the
        //selection, and -- in the editable job -- whatever had been typed.
        useEffect(function () {
            var made = madeRef.current;
            if (!made) return;
            var eds = made.getEditors();
            eds.left.setTheme(skin.theme);
            eds.right.setTheme(skin.theme);
            paint(host.current, skin);
        }, [wanted]);

        //A DEFINITE BOX, exactly as in ../xterm and ../litegraph. ace-diff's own
        //wrapper is `position: absolute; top: 0; bottom: 0`, so a container
        //sized by its content gives it nothing and the whole diff collapses to
        //nothing at all.
        return <div className="diff" ref={host}
            style={{ position: 'relative', height: (height || 320) + 'px' }} />;
    }

    await register(null, {
        editor: {
            Editor: Editor,
            Code: Code,
            Diff: Diff,

            //THE PALETTES, HANDED OUT RATHER THAN COPIED, as ../xterm does
            look: look,
            LOOKS: LOOKS,

            //THE LID, HANDED OUT RATHER THAN GUESSED AT BY EACH CALLER. A diff
            //asks for it by name; everything read whole does not ask at all.
            LID: LID
        }
    });
}
module.exports = plugin;
