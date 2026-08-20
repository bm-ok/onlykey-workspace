var makeWriter = require('./writer');
var React = require('react');
var makeCuts = require('./cuts');
var { useState, useEffect, useCallback } = React;

//---------------------------------------------------------------------------
//PR cuts: a change once it has left.
//
//ONE ACT, ONE PULL REQUEST PER REPOSITORY, held together and edited as one
//thing. GITHUB CANNOT DO THIS PART — it has no idea the three are one change.
//Each repository sees its own, each is approved on its own, and "is it in"
//cannot be answered by looking at any single one of them. Nor can three
//descriptions of one change stay in step by hand: the second repository ends up
//with last week's title, and a reviewer reads a different story depending on
//which one they happened to open.
//
//READ FROM GITHUB ON PURPOSE, NEVER ON A TIMER. Every state on this pane is
//somebody else's fact and a network call to learn. So it is read once when the
//pane is opened — a pane that says "not read yet" and does nothing is a pane
//that looks broken — and after that it is a button. Same rule the old window
//arrived at, and the reason this is the one pane in the app with no cadence.
//
//THE TWO PURPLE BUTTONS LIVE HERE, and this is what they were built for.
//
//  Send it   pushes branches to GitHub and opens pull requests. Visible to
//            anyone who can see those repositories, the moment it happens.
//  Merge it  a commit on a real default branch. The one thing on this screen
//            that cannot be undone from this window.
//
//A supervisor may prepare either one and may say it is ready. The press is a
//person's. That is not a policy written down somewhere — the command line is
//refused, by name, with the reason. See ../guards/ and ../drive/.
//---------------------------------------------------------------------------

plugin.consumes = ['shell', 'theme', 'okc', 'remember'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc, remember } = imports;


    shell.pane({ tab: 'Repositories', name: 'PR cuts', order: 100, Component: makeCuts(theme, okc, remember) });
    //THE ONE THAT WRITES, BESIDE THE ONE THAT SENDS. Two panes rather than one
    //screen that does both, because the difference between thinking and doing
    //should not be a button the mouse is already over.
    shell.pane({ tab: 'Repositories', name: 'New PR Cut', order: 110, Component: makeWriter(theme, okc, remember) });

    await register(null, {});
}
module.exports = plugin;
