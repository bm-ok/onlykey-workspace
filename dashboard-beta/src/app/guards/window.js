var React = require('react');
var makeGuards = require('./guards');
var { useState, useEffect } = React;

//---------------------------------------------------------------------------
//the guards, in the window: what is guarded, and the one place it is changed.
//
//See ./main.js for the rule. This half holds the list the theme paints from and
//the driver enforces from, so there is one answer to "is this guarded" rather
//than one per consumer.
//
//THE CODE PROPOSES AND THE PERSON DECIDES. A pane writing `protect` on a button
//is the app's opinion that this press should be somebody's; it stands unless the
//person turns it off, and the person may guard anything else on the screen by
//the words on it. Storing only the exceptions is what lets a guard added to the
//code later actually take effect — a stored full list would leave it open and
//look correct.
//---------------------------------------------------------------------------

plugin.consumes = ['okc', 'shell', 'theme'];
plugin.provides = ['guards'];
async function plugin(imports, register) {
    var { okc, shell, theme } = imports;


    var key = function (label) { return String(label || '').trim().toLowerCase(); };

    //What the person has changed. Held here rather than asked for on every
    //render — the theme consults this for every button it draws.
    var off = new Set();
    var on = new Set();
    var listeners = new Set();

    function announce() { listeners.forEach(function (f) { f(); }); }

    async function reload() {
        var g = await okc.call('guards', {});
        off = new Set((g.off || []).map(function (x) { return key(x.label); }));
        on = new Set((g.on || []).map(function (x) { return key(x.label); }));
        announce();
        return g;
    }

    //WHAT EVERY CONSUMER ASKS. `proposed` is what the code wanted; the answer is
    //that unless the person said otherwise, plus anything they added.
    //
    //`where` is a tab or a pane and may be left out, which guards the words
    //wherever they appear. A person guarding "Merge it" almost certainly means
    //all of them, and having to guard it once per pane is how one gets missed.
    function guarded(label, proposed) {
        var k = key(label);
        if (on.has(k)) return true;
        if (off.has(k)) return false;
        return !!proposed;
    }

    function subscribe(f) { listeners.add(f); return function () { listeners.delete(f); }; }

    var guards = { key: key, guarded: guarded, subscribe: subscribe, reload: reload };

    shell.pane({ tab: 'Settings', name: 'Guards', order: 80, Component: makeGuards(theme, okc, guards) });

    //THE THEME ASKED FOR THIS BACKWARDS, and here is the other end: it keeps a
    //hook with a fail-shut default and this fills it in. See ../theme/bits.js.
    theme.setGuardCheck(guarded);
    listeners.add(function () { theme.guardsChanged(); });

    //NOT AWAITED, AND THAT IS THE WHOLE POINT.
    //
    //This is a round trip over the socket, made while the plugin graph is still
    //being built — and the socket is not necessarily up yet at that moment. An
    //`await` here does not fail when it is down; it HANGS, the graph never
    //finishes, `start` never fires and the window renders nothing while the
    //process looks perfectly healthy from outside. That is what it did.
    //
    //A plugin may not block its own registration on something across a wire.
    //The safe default is already in place — every proposed guard stands until
    //this answers — so arriving late costs nothing and arriving never costs
    //nothing either.
    reload().catch(function () { /* the socket may not be up yet; the pane asks again */ });

    await register(null, {
        guards: { guarded: guarded, subscribe: subscribe, reload: reload }
    });
}
module.exports = plugin;
