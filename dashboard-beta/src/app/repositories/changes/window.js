var React = require('react');
var makeChanges = require('./changes');
var { useState, useEffect, useRef } = React;

//---------------------------------------------------------------------------
//Changes: what one line carries that another does not, file by file.
//
//IT IS A DIFF VIEWER, and that is worth saying because the code it was ported
//from reads like more than that. The old pane offered only PROPOSED lines on the
//left — proposing says a person thinks a line is done — which made it a landing
//queue. But landing was taken out of this app (below), so what is left of the
//queue is the reading, and the reading is the point.
//
//SO ANY LINE MAY BE COMPARED, and being proposed is SHOWN rather than required.
//The first port of this restricted the list to proposals, which leaves exactly
//one comparable line here today and a viewer that cannot view. The proposal is
//still on the screen — which line, when, by whom, and why — because it is the
//signal that somebody is waiting on a read, and "Take it back" is live only for
//a line that is actually proposed.
//
//NOTHING HERE LANDS A CHANGE, and that is the most important thing on the pane.
//"Land it" used to be here: it merged one line into another ON THIS HOST, which
//made this app the single thing allowed to write to a protected branch, outside
//every rule it enforces on a machine. That is the same category error as a
//machine pushing to master, arriving through the door marked "but I am the
//tool". Landing is a pull request now — the review stays here where it is local
//and fast and reads the repositories directly, and the landing goes where
//landings belong, with their own approvals and their own record.
//
//IT IS EXPENSIVE IN A WAY NOTHING ELSE HERE IS. `changeRead` runs three or four
//git processes per repository; on a three-repository workspace that is a dozen.
//A trace of the old window found 78% of its non-idle samples inside `spawn` with
//this pane open and nobody touching it. So the answer is kept until its question
//changes, and there is no timer on this pane at all.
//---------------------------------------------------------------------------

plugin.consumes = ['shell', 'theme', 'okc', 'remember'];
plugin.provides = [];
async function plugin(imports, register) {
    require('./changes.scss');
    var { shell, theme, okc, remember } = imports;


    shell.pane({ tab: 'Repositories', name: 'Changes', order: 80, Component: makeChanges(theme, okc, remember) });

    await register(null, {});
}
module.exports = plugin;
