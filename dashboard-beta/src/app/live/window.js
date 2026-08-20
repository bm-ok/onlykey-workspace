var React = require('react');
var makeLive = require('./live');
var { useState, useRef, useEffect } = React;

//the Live tab: one tagged stream of everything this host and every machine it
//supervises are saying, right now.
//
//WHAT A PERSON OPENS IT FOR. "Something long is running — what is happening,
//and if it went wrong, what said so." An install is twenty-five minutes of
//near-silence and then everything at once, and this is the only place a guest's
//output surfaces at all.
//
//THE OLD PANE COULD NOT BE PORTED AS WRITTEN. Over there the window shares the
//server's node context and does `require('./core/log')` — `liveLog.all()` once
//and `liveLog.subscribe()` for push — so it throws on load in any host that is
//not the desktop window. Here there is a socket and a table of named actions,
//so the log is read over the wire like everything else.
//
//AND IT IS READ FROM ZERO EVERY TIME, not from the last id seen. That looks
//wasteful and is the cheap way out of a real trap: ids start at 1 and RESET
//when the dashboard restarts, which it does a dozen times in an afternoon while
//its own code is being worked on. A watcher holding an id from a previous life
//is connected, healthy and permanently silent — which looks exactly like a
//quiet system. Holding no id at all cannot get that wrong. The server's ring is
//2000 entries, so the answer is bounded no matter how long this sits open.

plugin.consumes = ['shell', 'theme', 'okc'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc } = imports;


    //THREE THINGS THE OLD PANE DID THAT DELIBERATELY DO NOT COME ACROSS.
    //
    //  the tab badge. Over there arrivals were counted while the pane was
    //  hidden, and a `bad` line turned the count red until somebody visited.
    //  Here the shell mounts one tab at a time, so a hidden Live has no effects
    //  running and nothing to count with — the badge would have to live in the
    //  shell, watching the log on every tab's behalf, which is a change to a
    //  shared plugin rather than to this one. Left undone and said out loud
    //  rather than half-built.
    //
    //  the "am I actually receiving" dot. The topbar already has one, driven by
    //  `okc.onUp`, and it goes dull on disconnect and green again on reconnect
    //  on its own. A second one painted here once at startup would lie for the
    //  rest of the session.
    //
    //  the redraw kick. An arriving `vm` or `guest` line used to schedule a full
    //  window repaint, debounced 400ms, because the rest of the window learned
    //  from this stream that a machine had changed. Every tab asks its own
    //  question on its own cadence now, so Machines finds out by asking rather
    //  than by being told — and the debounce existed only to stop dozens of
    //  lines a second each re-asking VirtualBox for the whole machine list.
    shell.tab({ name: 'Live', order: 80, Component: makeLive(theme, okc) });

    await register(null, {});
}
module.exports = plugin;
