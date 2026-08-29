var React = require('react');
var { useState, useCallback } = React;

//---------------------------------------------------------------------------
//where you were: the tab, the pane, the row you had picked.
//
//WHY IT IS WORTH ANYTHING. This window is restarted constantly — every change to
//the server half needs one — and it comes back on the first tab with nothing
//selected. The cost of a restart is not the four seconds; it is finding your
//place again, and that is paid by whoever is working ON this tool rather than by
//the tool.
//
//---------------------------------------------------------------------------
//WHAT MAY BE KEPT HERE, AND THIS IS THE WHOLE RULE:
//
//    ONLY WHERE SOMEBODY WAS LOOKING. Never what they were looking at.
//
//A tab name, a pane name, the NAME of the row that was selected, a filter that
//was ticked. That is a property of this window and of nothing else — which is
//also why the command line has no view to restore and should never acquire one.
//
//NEVER: a token, a key, a password, anything typed into a guarded field, or the
//contents of anything read from the dashboard. Not because this store is
//especially leaky, but because browser storage is the wrong SHAPE for a secret —
//it is readable by anything running in the page, it survives in a profile
//directory nobody thinks of as sensitive, and it is copied around by browser
//sync without anybody deciding that. Those live in the data directory, on the
//main side, reached only by the process that owns them. See ../guards/main.js,
//which keeps its file there for exactly that reason.
//
//A NAME IS NOT ALWAYS HARMLESS and it is worth saying where the line actually
//is. "the machine called runner4 was selected" is a bookmark. "the branch called
//fix/the-customer-name-leak was selected" is a bookmark that quotes something.
//It is still only what is already on the screen and already in the repository,
//so it stays — but if a pane ever wants to remember a VALUE rather than a
//choice, that is the moment to stop and put it somewhere else.
//---------------------------------------------------------------------------
//
//localStorage rather than sessionStorage, through the `config` half of
//../storage. A session store dies with the tab, which is precisely the case this
//exists to survive: the restart.
//
//EVERY READ AND WRITE IS GUARDED. A window that will not open because it could
//not remember which tab was showing would be a poor trade for the convenience —
//and storage genuinely does throw, in private mode and on a full disk.

plugin.consumes = ['config'];
plugin.provides = ['remember'];
async function plugin(imports, register) {
    var config = imports.config;

    //ASKED FOR ONE KEY AT A TIME, WHICH IS NOT FUSS.
    //
    //../storage builds its object by defining a property PER KEY IT WAS GIVEN A
    //DEFAULT FOR. So a store asked for with `{}` has no properties at all, and
    //every read off it comes back undefined however much is sitting in storage
    //underneath. The first version of this file did exactly that: it wrote
    //faithfully, `okc.shell` appeared in the profile, and every restart still
    //opened on the first tab — a store that saves and cannot load, which reads
    //from the outside as "nothing was ever saved".
    //
    //Naming the key as a default fixes it and is also the documented shape:
    //the getter reads storage, so a value already there wins, and the default is
    //written only when there is nothing.
    function slot(area, key, fallback) {
        var s = config('okc.' + area, pair(key, fallback));
        return s;
    }

    function read(area, key, fallback) {
        try {
            var v = slot(area, key, fallback)[key];
            return v === undefined ? fallback : v;
        } catch (e) { return fallback; }
    }

    function write(area, key, value) {
        try { slot(area, key, value)[key] = value; }
        catch (e) { /* private mode, or a full disk */ }
    }

    function pair(k, v) { var o = {}; o[k] = v; return o; }

    //A useState that survives a restart. Same shape as useState on purpose:
    //a pane swapping one for the other should not have to change anything else.
    function use(area, key, fallback) {
        var [v, setV] = useState(function () { return read(area, key, fallback); });
        var set = useCallback(function (next) {
            setV(function (was) {
                var value = typeof next == 'function' ? next(was) : next;
                write(area, key, value);
                return value;
            });
        }, [area, key]);
        return [v, set];
    }

    //---- AND WHEN WHAT WAS BEING LOOKED AT STOPS EXISTING --------------------
    //
    //EVERY SLOT IN HERE NAMES SOMETHING IN A WORKSPACE — the repository that was
    //picked, the cut, the task, the branch. Switch folder and every one of them
    //names something that is not there, and a pane holding a selection that
    //resolves to nothing draws the same as a pane that is broken.
    //
    //THE WHOLE NAMESPACE, NOT A LIST OF KEYS. This has no register of what has
    //been written — the point of `slot` is that a pane asks for what it wants
    //and nothing has to be declared — so the only honest way to drop the lot is
    //by prefix. `localStorage` directly rather than through `config`, which
    //hands back one named object at a time and cannot enumerate.
    function forget() {
        var mine = [];
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && k.indexOf('okc.') === 0) mine.push(k);
            }
            mine.forEach(function (k) { localStorage.removeItem(k); });
        } catch (e) { /* private mode, or a full disk */ }
        return mine.length;
    }

    await register(null, {
        remember: { use: use, read: read, write: write, forget: forget }
    });
}
module.exports = plugin;
