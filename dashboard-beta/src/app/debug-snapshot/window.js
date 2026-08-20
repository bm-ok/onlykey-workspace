//---------------------------------------------------------------------------
//Ctrl+Shift+D — photograph this window, and write down what it is made of.
//
//THE PAGE'S HALF IS THE MARKUP, because only the page has it. ./server.js asks
//for it and writes it beside the picture; everything else about a capture
//happens over there.
//
//WITH THE STYLESHEETS INLINED, so the file opens on its own. A saved DOM with a
//<link> in it renders unstyled the moment it is moved, which is exactly what
//somebody does with it — send it somewhere, open it tomorrow — and unstyled
//markup answers none of the questions the picture could not.
//
//THE CLIPBOARD IS OFFERED, NEVER TAKEN. It used to be taken, over in the app
//this is ported from, and it took a quarter of a megabyte of markup silently in
//place of whatever was being carried between two windows — for a file that was
//already on disk. What is worth copying is the two paths, which is a button.
//
//SELF-CONTAINED ON PURPOSE. This is a debugging tool: it registers no tab, no
//pane and no service, and nothing in the app consumes it. Delete the folder and
//the key stops working and nothing else changes.
//
//WHICH IS WHY IT ASKS FOR THINGS RATHER THAN REACHING FOR THEM. Two of the
//pieces it needs were lent out by nothing, and the first version helped itself:
//it read `.tab.active` out of the DOM to find out where the window was, and
//opened the gate as a stand-in for a notice. Both worked. Both would also have
//gone on working while quietly making this plugin the only thing in the app that
//knows a class name — and a debugging tool that cannot be deleted cleanly is the
//wrong kind of tool. `shell.where()` and `shell.say()` exist because of this
//one, and both are ordinary things any plugin may want, which is the test of
//whether a seam is a seam or a special case.
//---------------------------------------------------------------------------

plugin.consumes = ['io', 'shell', 'okc'];
plugin.provides = [];
async function plugin(imports, register) {
    var io = imports.io;
    var shell = imports.shell;
    var okc = imports.okc;

    //THE RENDERED DOM, NOT THE SOURCE. The source is in the repository and can
    //be read there; what cannot be read anywhere else is what the app actually
    //built out of it — which class landed on which element, what a component
    //decided at run time, and which of them matches no rule at all.
    function markupNow() {
        var css = [].slice.call(document.styleSheets).map(function (sheet) {
            //A STYLESHEET FROM ANOTHER ORIGIN THROWS ON `cssRules` rather than
            //returning nothing, and one throw would lose every sheet after it.
            try {
                return [].slice.call(sheet.cssRules).map(function (r) { return r.cssText; }).join('\n');
            } catch (e) { return ''; }
        }).join('\n');

        return '<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>captured</title>\n<style>\n'
            + css + '\n</style>\n</head>\n' + document.body.outerHTML + '\n</html>\n';
    }

    //WHICH PANE IT IS OF, ASKED OF THE SHELL rather than worked out from the
    //DOM. It answers in the same words `show` takes, so a capture is named after
    //the pane it is of and the two agree by being one string.
    function whereWeAre() {
        var at = shell.where();
        return [at.tab, at.pane].filter(Boolean).join('/') || null;
    }

    io.on('snapshot:markup?', function (_args, reply) {
        if (typeof reply != 'function') return;
        try { reply({ html: markupNow(), on: whereWeAre() }); }
        catch (e) { reply({ error: 'the page could not read its own markup: ' + e.message }); }
    });

    //---- the key -----------------------------------------------------------

    var busy = false;

    async function capture() {
        //ONE AT A TIME. Holding the keys down repeats the keydown event, and a
        //capture is two file writes and a screenshot — a dozen of them queued up
        //behind one press is a window that stops answering for a while.
        if (busy) return;
        busy = true;
        try {
            var said = await okc.call('capture', {});
            var paths = [said.file, said.image].filter(Boolean);

            //SAID IN THE WINDOW'S OWN NOTICE, which the shell lends out. The
            //first version of this opened the gate instead — a modal, for a
            //screenshot — because there was no shared slot for a sentence, and
            //growing the shell for a debugging tool looked like the wrong trade.
            //It was the wrong trade the other way round: every pane here already
            //keeps its own `said` state, so the slot was missing rather than
            //deliberately absent, and a key press is not a pane.
            shell.say(said.bytes + ' bytes of markup, and a picture, of '
                + (said.on || 'the window') + '.  ' + paths.join('   '), {
                //LONG ENOUGH TO READ TWO PATHS AND DECIDE, rather than long
                //enough to notice something happened. The button is the point.
                lasts: 25000,
                does: [{
                    label: paths.length > 1 ? 'Copy both paths' : 'Copy the path',
                    onClick: function () {
                        navigator.clipboard.writeText(paths.join(String.fromCharCode(10))).then(
                            function () { shell.say('Copied.', { lasts: 4000 }); },
                            function (e) { shell.say('the clipboard would not take it: ' + e.message, { kind: 'bad' }); });
                    }
                }]
            });
        } catch (e) {
            shell.say('the capture did not happen: ' + e.message, { kind: 'bad', lasts: 12000 });
        } finally {
            busy = false;
        }
    }

    function onKey(e) {
        if (!e.ctrlKey || !e.shiftKey) return;
        if (e.key !== 'D' && e.key !== 'd') return;
        e.preventDefault();
        capture();
    }

    document.addEventListener('keydown', onKey);

    await register(null, {
        //TAKEN OFF AGAIN ON RELOAD. The window half is rebuilt on every save; a
        //listener left on the document would mean two captures per press after
        //one edit, and eight after three — which still "works", which is how it
        //would go unnoticed.
        onDestroy: function () { document.removeEventListener('keydown', onKey); }
    });
}
module.exports = plugin;
