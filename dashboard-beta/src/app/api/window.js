var React = require('react');
var makeApi = require('./api');
var { useState } = React;

//---------------------------------------------------------------------------
//API: every capability this server has.
//
//GENERATED FROM THE ACTION TABLE, WHICH IS WHY IT CANNOT GO STALE. This is not
//documentation somebody keeps in step — it is the table itself, listed. An
//action that exists appears here the moment it exists, and one that is deleted
//stops appearing. A hand-written page would drift within a week and be believed
//for a year.
//
//WHICH ALSO MAKES IT THE ANSWER TO "WHAT CAN THIS THING DO". The window, the
//command line and the drills all reach the same table by name — there is one
//surface, and this is it written out. If something cannot be done from here, it
//cannot be done.
//
//IT IS NOT AN HTTP API, AND THE SENTENCE MATTERS. The old window's version of
//this pane says "generated from /api/actions". Here the list arrives over the
//socket, like every other answer, because that was a deliberate choice rather
//than an accident of porting: the command line goes through a local socket, and
//the browser half speaks socket.io over http. There is no url that returns
//this, and saying there is would send somebody looking for one.
//
//READ-ONLY, AND NOTHING HERE PRESSES ANYTHING. A list of everything the app can
//do, with a button beside each, would be the single widest hole this app could
//have — every refusal on every other pane bypassed by the reference page.
//---------------------------------------------------------------------------

plugin.consumes = ['shell', 'theme', 'okc'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc } = imports;


    //A TAB OF ITS OWN AND LAST BUT ONE, exactly where the old window puts it:
    //Live, Terminal, Keys, Test, API. It is a reference rather than a place work
    //happens, which is why it sits at the cold end of the row.
    shell.tab({ name: 'API', order: 120, Component: makeApi(theme, okc) });

    await register(null, {});
}
module.exports = plugin;
