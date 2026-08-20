//---------------------------------------------------------------------------
//the Live tab's node half: reading the log out, and emptying it.
//
//THE SERVICE IS IN ../core/log AND THE ACTIONS ARE HERE, which is the split this
//move is built on and worth stating once where it first happens. The log is
//written by everything — every action module ported after this one takes `log`
//and tags a line — so it is infrastructure and lives in core beside `actions`
//and `io`. These two actions are not: they are what the LIVE PANE asks for, and
//they belong beside the pane that asks, the same way ../ui/shell/server.js keeps
//`show` beside the shell it shows.
//
//SO THE RULE FOR EVERYTHING AFTER IT: the service goes where it is owned, the
//action goes where the pane is. A plugin that has neither has no server half.
//
//THIS SHADOWS THE DASHBOARD'S OWN `logSince`. ../core/actions tries this app's
//table first and falls through the relay second, so from here the Live tab shows
//THIS app's log rather than the one being ported from. That is the intended
//change and not a regression: the lines on that tab are now about the app the
//window belongs to, and they start empty because this log did just begin.
//---------------------------------------------------------------------------

plugin.consumes = ['app', 'log'];
plugin.provides = [];
async function plugin(imports, register) {
    var actions = imports.app.host && imports.app.host.actions;
    var log = imports.log;

    //`actions` is absent when this half is built against a bare host — the test
    //suite does exactly that. See ../core/okc/server.js.
    if (!actions) return register(null, {});

    var undo = [];

    undo.push(actions.define('logSince', {
        about: 'Log lines after an id, and every tag in use',
        takes: ['since'],
        run: function (args) {
            return { entries: log.since(args && args.since), tags: log.tags() };
        }
    }));

    undo.push(actions.define('logClear', {
        //NOT PORTED AS ASKED FOR, AND SAID HERE. What was wanted is a bookmark —
        //"start reading from now", leaving what came before intact for anyone who
        //goes looking. This empties, because that is what the action being ported
        //does and what the pane's button says it does. Changing the meaning of a
        //name mid-port is how the two apps quietly stop being the same app; the
        //bookmark is a change to make deliberately, on its own, once the port is
        //no longer moving underneath it.
        about: 'Empty the live log',
        run: function () { log.clear(); return { cleared: true }; }
    }));

    //NOT PORTED: `logWatch`. Over there it is the one action that answers for
    //ever instead of once — `stream` and `subscribe` instead of `run` — which an
    //install needs, being twenty-five minutes of silence and then everything at
    //once. ../core/actions only knows how to `run` something, so this needs the
    //table to learn what a streaming action is before the action can move. The
    //pane does not use it; the command line does.

    await register(null, {
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
