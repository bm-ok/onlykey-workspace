//---------------------------------------------------------------------------
//THE HAND-OVER. The real locks are in ./main.js, because what they hold has to
//outlive a save — see the header there.
//
//WITHOUT A MAIN HALF THERE IS A STAND-IN THAT REFUSES NOTHING, and that choice
//needs stating rather than assuming.
//
//The test suite builds server halves against a bare host, and so does anything
//running this outside NW.js. In that process there is no window pressing
//buttons and no queue dispatching work, so there is nothing for a lock to
//serialise — and a stand-in that REFUSED would turn "no main half" into "every
//machine is permanently busy", which fails in a way that points nowhere near
//the cause.
//
//`during` AND `comingUp` STILL RUN THE WORK. A stand-in that skipped it would
//make the absence of a main half silently change what the app does, which is
//worse than either refusing or allowing.
//---------------------------------------------------------------------------

plugin.consumes = ['app'];
plugin.provides = ['busy'];
async function plugin(imports, register) {
    var host = imports.app.host;
    var busy = host && host.busy;

    if (!busy) {
        var nothing = function () {};
        busy = {
            what: function () { return null; },
            claim: nothing,
            release: function () { return false; },
            during: function (name, job, fn) { return Promise.resolve().then(fn); },
            all: function () { return []; },

            comingUp: function (name, fn) { return Promise.resolve().then(fn); },
            booting: function () { return null; },
            queued: function () { return []; }
        };
    }

    await register(null, { busy: busy });
}
module.exports = plugin;
