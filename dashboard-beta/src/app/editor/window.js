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

//---------------------------------------------------------------------------
//the editor: code that is READ.
//
//A <pre> IS NOT GOOD ENOUGH, AND THAT IS AN ARGUMENT ABOUT APPROVALS RATHER THAN
//ABOUT LOOKS. Two things in this app are read carefully enough that a decision
//hangs on them: the source of a job somebody has to approve, and a branch's diff
//somebody has to judge. A hundred lines of undifferentiated JavaScript is not
//something a person reads — it is something a person scrolls past and then
//approves anyway, which defeats the whole point of putting it on the screen.
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

    function Editor({ text, mode, min, max }) {
        var host = useRef(null);
        var edRef = useRef(null);
        var body = String(text == null ? '' : text);
        var lo = min || 3;
        var hi = max == null ? HUGE : max;

        useEffect(function () {
            if (!host.current) return;
            var ed = ace.edit(host.current);
            edRef.current = ed;

            ed.setTheme('ace/theme/tomorrow_night');
            //PLAIN TEXT UNLESS ASKED OTHERWISE, and the default matters more
            //than it looks. Most of what this app puts up to be read is PROSE —
            //a contract, a prompt, a brief — and highlighting prose as
            //JavaScript colours `delete`, `do`, `in` and `that` at random. On a
            //contract about what a judge may NOT do, that is false emphasis on
            //the one document somebody has to read every line of.
            //
            //`ace/mode/text` needs no mode file; it is in the core.
            ed.session.setMode('ace/mode/' + (mode || 'text'));
            //NO WORKER. It is a syntax checker for something being written, and
            //nothing here is being written — so it is a thread and a round of
            //parsing spent to put squiggles under somebody else's code.
            ed.session.setUseWorker(false);
            ed.setValue(body, -1);
            ed.setReadOnly(true);
            ed.setOptions({
                highlightActiveLine: false,
                highlightGutterLine: false,
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
            //refuses the typing; this stops it being offered.
            try { ed.renderer.$cursorLayer.element.style.display = 'none'; } catch (e) { /* older ace */ }

            //The height guessed before ace saw the box was for one frame only.
            //Ace owns it now, and leaving the guess behind would fight it.
            host.current.style.height = '';

            return function () {
                edRef.current = null;
                //DESTROYED, NOT LEFT. Ace attaches window resize listeners and a
                //text layer; a pane that mounts one of these on every selection
                //would otherwise leak an editor per click.
                try { ed.destroy(); } catch (e) { /* already gone */ }
            };
        }, [mode, lo, hi]);

        //TEXT CHANGES WITHOUT REBUILDING THE EDITOR, so picking the next file in
        //a list does not tear down and re-lay-out a thousand rows. `-1` puts the
        //cursor at the start rather than selecting everything.
        useEffect(function () {
            var ed = edRef.current;
            if (ed && ed.getValue() !== body) ed.setValue(body, -1);
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
    function Code({ text, mode, tall }) {
        return <Editor text={text} mode={mode} max={tall ? LID : undefined} />;
    }

    await register(null, {
        editor: {
            Editor: Editor,
            Code: Code,
            //THE LID, HANDED OUT RATHER THAN GUESSED AT BY EACH CALLER. A diff
            //asks for it by name; everything read whole does not ask at all.
            LID: LID
        }
    });
}
module.exports = plugin;
