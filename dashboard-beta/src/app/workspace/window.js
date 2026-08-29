var React = require('react');
var makeWorkspace = require('./workspace');
var { useState, useEffect } = React;

//---------------------------------------------------------------------------
//the workspace: which folder of repositories all of this is about.
//
//IT SITS BESIDE THE TITLE RATHER THAN IN THE ROW OF TABS, and that is the
//argument. It is not one more thing to look at — it is the SUBJECT of all of
//them. A branch, a task, a line and a verdict are each a statement about one
//folder, and until that folder could be changed it went without saying, so the
//title bar carried something that never changes instead.
//
//THE FOLDER'S NAME, NOT ITS PATH. A path in the chrome is a line of text nobody
//reads twice and which pushes everything else along; the name is what somebody
//calls it. The full path and the repository count are one hover away, where they
//answer "which one is this exactly" rather than sitting there.
//
//AND WHICH TABS STOP WORKING IS THE CLEAREST STATEMENT OF WHAT A WORKSPACE IS.
//Repositories and Tasks are questions about a folder of repositories, so with
//none open they are dimmed and unclickable with the reason on them — rather than
//removed, because a row that silently loses half its buttons reads as a broken
//window instead of as a state.
//---------------------------------------------------------------------------

plugin.consumes = ['shell', 'theme', 'okc', 'remember'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc, remember } = imports;

    //THE TABS THAT MEAN NOTHING WITHOUT A WORKSPACE, and it lives here because
    //stopping a tab is this plugin's chrome business rather than the pane's.


    //A SECOND CHROME TAB, BESIDE THE FIRST. `home` marks it as where the shell
    //sends somebody standing on a tab that just switched off — which is here,
    //because the reason it switched off is that there is no folder.
    shell.tab({
        name: 'Workspace', order: 1, chrome: true, home: true, none: true,
        label: 'no workspace', Component: makeWorkspace(theme, okc)
    });

    //---- the chrome, told from OUTSIDE the pane -----------------------------
    //
    //THE PANE CANNOT BE THE ONE THAT SAYS THIS, and the browser proved it: a
    //fresh tab opens on Repositories, the Workspaces pane never mounts, and the
    //button beside the title read "no workspace" over a workspace that was
    //perfectly open. In the desktop window it looked right only because I had
    //navigated to that pane and left it there.
    //
    //THE GATE HAD IT WORSE. Repositories and Tasks would not have been disabled
    //until somebody visited the thing that gates them — a rule that applies
    //only after you have looked at the rule.
    //
    //Same shape as the Inbox badge, and the same answer: chrome is told by
    //something that runs for as long as the app does. Two of these now, and if
    //there is a third it wants a service rather than a third copy of this.
    //---- AND WHEN THE FOLDER ACTUALLY CHANGES --------------------------------
    //
    //THE WINDOW IS FULL OF THE FOLDER BEFORE LAST. Every pane holds what it was
    //last told, and ../core/remember holds which repository, which cut and which
    //task were picked — all of them named in a workspace that is no longer the
    //one open. A selection that resolves to nothing draws exactly like a pane
    //that is broken, which is the state this whole tab exists to keep out of.
    //
    //SO: DROP THE SELECTIONS AND READ EVERYTHING AGAIN. A reload is not heavy
    //here — it is what every code change already does, several times an hour —
    //and it is the only thing that makes "everything on the other tabs becomes a
    //statement about this folder instead" true of what is on screen rather than
    //only of what would be fetched next.
    //
    //NOT ON THE FIRST ANSWER, which is not a change but the first time anybody
    //asked. `seen` undefined is that, and it is why this cannot be a comparison
    //against null: opening the first workspace of the run IS a change worth
    //reloading for, and it comes from null.
    var seen;
    var stop = null;
    function chrome() {
        okc.call('workspaces', {}).then(function (d) {
            var open = !!(d && d.open);
            var name = d && d.current ? d.current.name : null;
            var dir = d && d.current ? d.current.dir : null;

            if (seen !== undefined && seen !== dir) {
                remember.forget();
                try { window.location.reload(); } catch (e) { /* nothing else to try */ }
                return;
            }
            seen = dir;
            shell.label('Workspace', name || 'no workspace');
            var why = open ? null : 'Needs a workspace. Open a folder of repositories from the button beside the title.';
            //FIVE, AND IT WAS TWO. Every one of these reads the open workspace's
            //own drawer — the tasks, the judgements, the lines, the cuts, what
            //the supervisor is carrying — so with no folder open they are each
            //a pane asking a question with no subject. Two of them were gated
            //and three were not, which is the worst of the three states: the
            //ones left alone drew empty and looked broken rather than closed.
            ['Repositories', 'Worker', 'Queue', 'Judge', 'Supervisor']
                .forEach(function (t) { shell.stop(t, why); });
        }, function () { /* the pipe may be down; the chrome stays as it was */ });
    }
    chrome();
    stop = setInterval(chrome, 20000);

    await register(null, {
        onDestroy: function () { if (stop) clearInterval(stop); }
    });
}
module.exports = plugin;
