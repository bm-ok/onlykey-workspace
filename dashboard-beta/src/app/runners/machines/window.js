var makeMeter = require('./meter');
var React = require('react');
var makeMachines = require('./machines');
var { useState } = React;

//---------------------------------------------------------------------------
//the Machines tab — and the first pane built in the shape the app actually has.
//
//THREE COLUMNS, WHICH IS NOT A STYLE CHOICE. The list, then what can be done to
//whatever is picked in it, then what that thing is. One set of buttons serves
//every machine — put the dozen acts inside each card instead and a list of ten
//machines is a hundred and twenty buttons.
//
//The old window had this shape and it was invisible to the port, because it
//lived in index.html and the JavaScript only filled containers that were
//already there. See ../../THEME.md.
//
//EVERY ACT THAT CANNOT BE TAKEN BACK GOES THROUGH `ask`. Starting a machine is
//reversible and is a button. Stopping one with force, letting it off its branch,
//and changing whether the queue may use it are not, and each states its cost
//before it is agreed to. The person makes the press; nothing here presses on
//their behalf.
//
//WHAT IT SHOWS IS WHAT DECIDES SOMETHING. A machine list that prints every field
//is a list nobody reads: this answers the questions somebody actually has — is
//it up, can it be reached, what may it be given, is it holding a credential, is
//it claiming a branch, and is anything allowed to give it work.
//---------------------------------------------------------------------------

plugin.consumes = ['shell', 'theme', 'okc', 'remember'];
plugin.provides = [];
async function plugin(imports, register) {
    //THIS PANE'S OWN LOOK, which the theme does not promise. See ./machines.scss.
    require('./machines.scss');
    var { shell, theme, okc, remember } = imports;


    //---- where this lives, and it is not a choice -------------------------
    //
    //THE TAB NAMES ARE THE STRUCTURE. This port had been inventing its own —
    //top-level tabs for Machines, Sessions, Sign-ins and Graph, none of which
    //exist in the app being ported from, and renamed panes elsewhere. An
    //information architecture that drifts is one that has to be re-learned by
    //anybody who knows the old window, which is everybody who would use this.
    //
    //The real map is in ui/index.html over there: twelve panes under
    //Repositories, six under Runners, and the tab names as written.
    shell.tab({ name: 'Runners', order: 60 });
    shell.pane({ tab: 'Runners', name: 'Virtual machines', order: 10, Component: makeMachines(theme, okc, remember) });
    //LAST UNDER Runners, because it is about what they have COST rather than
    //what any of them is doing. Nothing on it can be acted on.
    shell.pane({ tab: 'Runners', name: 'Meter', order: 60, Component: makeMeter(theme, okc) });

    await register(null, {});
}
module.exports = plugin;
