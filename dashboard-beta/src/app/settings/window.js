var React = require('react');
var makeGeneral = require('./general');
var makeTrust = require('./trust');
var { useState, useEffect } = React;

//the Settings tab: one question, asked about one place.
//
//"MAY THE DRILLS RUN AGAINST THE FOLDER I HAVE OPEN RIGHT NOW?" Three kinds of
//person open this tab: one the Test tab has just refused and who wants the
//sentence saying why; one about to hand this app a workspace they care about,
//checking nothing is armed against it; and one who dismissed the dialog that
//asked them and has come looking for the question again. All three want the
//same card, so there is one.
//
//ON IS NOT A STATE THIS SETTING HAS. It is on FOR somewhere. `enabled` alone
//answers nothing — the predicate is enabled AND the folder it was turned on for
//being the folder open now, compared as raw strings. "On for a folder that is
//not the one open" is the exact state this card exists to make visible, and
//collapsing it to on or to off deletes the pane's reason to exist.
//
//THE TWO BUTTONS HERE USED TO BE REFUSED, AND NOW GO THROUGH. That is not a
//guard having been dropped — it is the reason the guard exists arriving.
//
//`settingSet testsEnabled` and `testsAnswer` refuse the pipe: a model may ASK
//for the drills and may not decide that somebody's repository is a fine place to
//run them. While these relayed, the press left this window, crossed a socket
//into the app being ported from, and was correctly counted as the pipe — so the
//pane's own buttons answered with a refusal, and the sentence was shown where
//the press was made rather than swallowed.
//
//./server.js owns both actions now. `_overTheWire` is stamped by ../core/ipc and
//by nothing else, so a press made HERE is a person at the window and is not
//marked — which is what the guard always meant. The pipe is still refused, and
//the confirm dialog in ./general.js is `protect`ed so ../core/drive will not
//press it either. Both halves are real; see ./server.js for why one mark now
//does the work three used to.

plugin.consumes = ['shell', 'theme', 'okc'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc } = imports;


    //A PANE RATHER THAN THE TAB ITSELF, so the tab can hold more than one thing.
    //The shell shows a tab's panes when it has any and its own Component when it
    //has none — so a tab that is both is a tab whose body silently disappears the
    //day somebody adds a second pane to it. Registered this way it cannot.
    //LAST, AND OUTSIDE THE ROW OF WORK. Over there it is a ☰ at the far
    //end rather than a word in the line — settings is not somewhere you go
    //to work, it is somewhere you go to change one thing and come back from.
    shell.tab({ name: 'Settings', order: 200 });
    shell.pane({ tab: 'Settings', name: 'General', order: 10, Component: makeGeneral(theme, okc, shell) });

    //A SECOND PANE, AND THE TAB'S ONE QUESTION IS NOW TWO OF THE SAME KIND.
    //Both are "what may happen here without somebody saying so each time" —
    //General answers it about the drills, this one about text arriving from
    //somebody else's service. Neither is a preference; both ship off.
    shell.pane({ tab: 'Settings', name: 'Trust', order: 20, Component: makeTrust(theme, okc) });

    await register(null, {});
}
module.exports = plugin;
