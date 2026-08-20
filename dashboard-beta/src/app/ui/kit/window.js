var React = require('react');
var makeKit = require('./kit');

//---------------------------------------------------------------------------
//the Kit pane — every piece of the theme, on one screen.
//
//WHY THIS EXISTS. `theme` is meant to be a slot: swap the folder and the app
//looks different and nothing else moves. That is only true if somebody can see
//what the slot is required to provide, and until this pane the answer was
//spread across fourteen panes — so the real contract was "whatever the panes
//happen to use", which is not a contract.
//
//It is also the review surface. Consolidating a look means comparing things
//side by side: two badges that should differ and do not, a warn and a bad that
//read the same at a glance, a skeleton that does not match the card it stands
//in for. None of that is visible one pane at a time.
//
//AND IT IS WHAT A NEW PANE IS WRITTEN FROM. The rule is that a pane never names
//a class — if what it needs is not here, either it belongs here so the next pane
//gets it too, or it is that pane's own furniture and belongs in that plugin's
//own stylesheet. ../../THEME.md says which is which.
//
//THE DIALOG CANNOT BE PHOTOGRAPHED FROM OUTSIDE, and that is on purpose. `show`
//moves the window and does nothing else — it cannot press a button — so the
//gate has to be opened by a person. That is the same reason it is the gate.
//---------------------------------------------------------------------------

plugin.consumes = ['shell', 'theme'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme } = imports;


    shell.pane({ tab: 'Settings', name: 'Kit', order: 90, Component: makeKit(theme) });

    await register(null, {});
}
module.exports = plugin;
