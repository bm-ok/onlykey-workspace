//---------------------------------------------------------------------------
//WHAT AN APP PLUGIN HANDS TO ITS OWN OTHER HALF, ACROSS A RELOAD.
//
//The node bundle is rebuilt every time a file is saved. Anything a plugin must
//not forget when that happens lives in its `main.js`, and reaches its
//`server.js` through the host — see ../build/main.js, which is what carries the
//host over.
//
//---- why this exists at all -----------------------------------------------
//
//../build USED TO NAME THEM. Its `consumes` listed the app services whose main
//halves it was carrying, so `core/build` knew that a thing called `busy` existed
//— and a plugin lifted out of this app for another project would arrive with a
//strand still attached to it from core.
//
//THAT IS THE ONE COUPLING THIS SCAFFOLD CANNOT AFFORD. The plugin graph is a web
//that links only what each part needs, which is what makes any one plugin
//liftable; core naming an app service is the strand nothing needed and nobody
//could see.
//
//SO CORE PROVIDES THE CONTAINER AND NEVER LEARNS WHAT IS IN IT. The same shape
//as the action table, which ../build also carries and also never reads: plugins
//register INTO it, and core moves it.
//
//---- the rule, which is now statable --------------------------------------
//
//  ../build names CORE services directly — they are core-to-core, and hiding
//  them behind a lookup would make the host harder to read for no gain.
//
//  APP services arrive through here. `main.js` puts one in; `server.js` asks for
//  it by the same name off `host.of`.
//
//Nothing enforces which side a name is on, and nothing should: what it does
//enforce is that core's `consumes` lists have no app names in them, which is
//the thing a test can check and a person can see.
//---------------------------------------------------------------------------

plugin.consumes = [];
plugin.provides = ['handover'];
async function plugin(imports, register) {
    var kept = {};

    //A PLAIN OBJECT WITH THE PROTOTYPE CUT OFF. A service called `constructor`
    //or `toString` would otherwise come back as a function from Object's
    //prototype — the same trap ../../vms/busy/doing.js carries a note about, and
    //a lookup that answers with something plausible is worse than one that
    //answers nothing.
    kept = Object.create(null);

    await register(null, {
        handover: {
            //PUT ONCE. A second plugin claiming a name it does not own is not a
            //merge and not a preference — it is two things believing they are
            //the same one, which is exactly what a shared record must not allow.
            put: function (name, value) {
                var key = String(name || '').trim();
                if (!key) throw new Error('A handed-over service needs a name.');
                if (key in kept) {
                    throw new Error('"' + key + '" is already handed over by another plugin. '
                        + 'Two things under one name is two answers to the same question.');
                }
                kept[key] = value;
                return value;
            },

            //UNDEFINED FOR A NAME NOBODY PUT, deliberately rather than a throw.
            //A server half asks for its own main half and must be able to carry
            //on WITHOUT one: the test suite builds server halves against a bare
            //host, and every one of them has a stand-in for exactly that case.
            get: function (name) { return kept[String(name || '')]; },

            //WHAT IS BEING CARRIED, for a person looking at the host rather than
            //for anything that runs.
            names: function () { return Object.keys(kept).sort(); }
        }
    });
}
module.exports = plugin;
