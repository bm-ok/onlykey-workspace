var React = require('react');
var makeGeneral = require('./general');
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
//WHY THE TWO BUTTONS HERE ARE EXPECTED TO BE REFUSED, and that is not a bug in
//this file. `settingSet testsEnabled` and `testsAnswer` are guarded against
//`_overTheWire`, `_driven` and `_fromTest` — a model may ASK for the drills and
//may not decide that somebody's repository is a fine place to run them. This
//window is a second process talking to the running dashboard down its socket,
//so the guard counts it as the pipe and says so. The buttons stay, because they
//are what the pane is for and because the refusal is the honest answer to press
//them from here today; the sentence it returns is shown where the press was
//made rather than swallowed. When this window IS the window, the same press
//goes through unchanged.

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

    await register(null, {});
}
module.exports = plugin;
