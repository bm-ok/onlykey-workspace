var React = require('react');
var makeTests = require('./tests');
var { useState, useEffect } = React;

//the Tests tab: this app run against itself, and what the green is worth.
//
//THE QUESTION IT ANSWERS IS NOT "IS IT GREEN". It is "what has actually been
//established about this host right now, and what does the green mean" — and
//neither half has a yes/no answer, which is why this is three columns of
//evidence rather than a runner readout.
//
//WHAT IS PROVEN, WHAT WAS MERELY NOT TRIED, AND WHAT NOBODY HAS WRITTEN YET are
//three different things and the pane keeps them apart. Live right now: 298
//checks across 12 suites and 64 tests — 201 passed, 74 that could not be tried,
//18 drafts, 5 changed, zero failed. Flattening "not tried" into failure would
//report 74 red on a system where nothing is wrong: these drills want a machine
//on, a credential lent, a branch claimed, and this app's whole design puts
//machines at rest. Resting is the normal state, so red here would train
//somebody to ignore the red.
//
//AND THE WIDEST COLUMN IS CODE, NOT OUTPUT. Each check's source rides on the
//wire — 6,025 lines of it in the current payload — because reading the check IS
//the value of the tick. Same rule as a job showing its script before it is
//approved.
//
//WHAT THE OLD PANE GOT WRONG AND THIS DOES NOT:
//
//  its worstOf() was dead code. The server always sets suite.state, and the
//  server's own worst() only knows failed/unrunnable/passed/not run — so
//  'changed', 'draft', 'needs you', 'carried', 'running' and 'interrupted'
//  could never reach a suite or test badge and collapsed to "not run". Live,
//  "what this host has" reads NOT RUN while its checks read passed, passed,
//  passed, changed. Here the badge is the WORSE of what the server says and
//  what the checks say, so the server's own stronger verdicts (a suite
//  contradicted by somebody else's check) still win and the states it cannot
//  express stop disappearing.
//
//  its suite count badges were computed from TEST states, so drafts and
//  needs-you were invisible one level up: "a worker credential" holds 18 drafts
//  and its card showed none. Counted from checks here.
//
//  suite.ranWhole was on the wire and drawn nowhere, so now that results outlive
//  the window a suite that passed four days ago and one that passed four minutes
//  ago looked identical.
//
//  check.note was on the wire and drawn nowhere. For a draft the note IS the
//  check — 800 to 1,600 characters of "WHAT IT WOULD BUY / THE STICKING POINT /
//  THE CHECK", kept up to date as reality moves ahead of the draft — and it was
//  reachable only by unfolding something labelled "the code it runs".

plugin.consumes = ['shell', 'theme', 'okc', 'remember'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc, remember } = imports;

    //RUNNING THE DRILLS IS A PERSON'S PRESS, and every button here starts one.
    //
    //A drill is an ATTEMPT TO DO THE WRONG THING — it writes a task on a branch
    //cut, takes the worker credential off a machine, proves a signed-out machine
    //is refused work, and puts it back. It drives real machines with real
    //credentials, and if a guard has already stopped working then the thing that
    //guard was stopping happens for real, in this workspace.
    //
    //So these are proposed as guarded: visible from the command line, refused
    //from it. The person who wants to spend that time is the person who presses
    //it. Turn any of them off in Settings -> Guards.

    //WHERE A PERSON WAS LOOKING lives in ../remember now, and this pane is why
    //that plugin has a test guarding it. This file had grown its own copy of the
    //old window's `been` -- same idea, same `okc.` prefix, written in good faith
    //for something small -- which is a second place for the rule about what may
    //be kept in browser storage to be broken. The rule is only worth having if
    //there is one.


    //held rather than passed inline so the badge above has something to write
    //on. The shell reads it when it next paints the bar.
    var tab = { name: 'Test', order: 110, Component: makeTests(theme, okc, remember, shell) };
    shell.tab(tab);

    await register(null, {});
}
module.exports = plugin;
