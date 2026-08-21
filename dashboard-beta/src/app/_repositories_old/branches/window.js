var React = require('react');
var makeBranches = require('./branches');
var { useState } = React;

//---------------------------------------------------------------------------
//Branch cuts: what work is done on, and what each one carries.
//
//A CUT IS A BRANCH THIS APP MADE, with a reason and a starting point, for work
//to be done on. A LINE is the same thing protected — what work is measured
//against, and what a PR cut is proposed into, which is why nothing may be built
//directly on one. The two used to live under one heading here, which is where
//the word stopped meaning anything; lines are next door under Lines.
//
//CUTTING ONE IS A DELIBERATE ACT WITH A REASON. It used to happen as a side
//effect of setting a machine up, from whatever string a task carried — so a typo
//made a branch rather than an error, and the branch list filled with names
//nobody recognised and nobody dared delete.
//
//WHAT IT CARRIES IS THE THIRD COLUMN AND THE REASON THE PANE IS THIS SHAPE. A
//branch used to mean commits and nothing else. A run can now hand over a file a
//branch cannot hold, and the session that produced the work is the third thing
//worth keeping with it — so "what is on this branch" is three questions, and
//answering only the first is how work gets thrown away as empty.
//---------------------------------------------------------------------------

plugin.consumes = ['shell', 'theme', 'okc', 'remember'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc, remember } = imports;

    //---- the left column ---------------------------------------------------


    shell.pane({ tab: 'Repositories', name: 'Branches Cut', order: 60, Component: makeBranches(theme, okc, remember) });

    await register(null, {});
}
module.exports = plugin;
