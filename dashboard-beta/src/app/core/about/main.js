//what this app is, and what it can do.
//
//THE TWO ACTIONS THAT ANSWER BEFORE ANYTHING ELSE WORKS. `actions` is what the
//command line prints when it is given no arguments — "what can this thing do"
//is the first question anybody asks, and the answer comes from the running app
//rather than from a list in a README that can go stale. `status` is the second:
//whether there is a window, and whether nw is there at all.
//
//IN MAIN, WHICH IS DELIBERATE. These are the two things worth being able to ask
//when the half that reloads has failed to load — the moment they are most
//useful is the moment the rest is broken.

plugin.consumes = ['actions', 'app'];
plugin.provides = [];
async function plugin(imports, register) {
    var actions = imports.actions;
    var app = imports.app;

    var undo = [];

    undo.push(actions.define('actions', {
        about: 'Every action there is, and what each one takes',
        //EVERYTHING, NOT JUST WHAT THIS HALF OWNS. While the port is under way
        //most of what the app can do is still answered by the app it relays to,
        //and an answer listing only this half's ten reads as "the other two
        //hundred and fifty were lost" rather than "they have not moved yet".
        //Each row says which side answers it.
        takes: [],
        run: async function () { return actions.all(); }
    }));

    undo.push(actions.define('status', {
        about: 'What this app is, and whether its window is up',
        takes: [],
        run: async function () {
            //ASKED THROUGH `services` RATHER THAN CONSUMED. `window` is
            //undefined when there is no nw — under the test suite, or a plain
            //node boot — and consuming a service that does not exist there
            //would stop this plugin loading at all, which is the opposite of
            //what a status action is for.
            var win = app.services.window;
            return {
                app: app.appPackage ? app.appPackage.name : null,
                version: app.appPackage ? app.appPackage.version : null,
                nw: !!app.isNw,
                packaged: !!app.isPackaged,
                window: !win ? 'none — running without nw' : (win.isOpen ? 'open' : 'closed'),
                pid: process.pid
            };
        }
    }));

    await register(null, {
        onDestroy: function () { undo.forEach(function (off) { off(); }); }
    });
}
module.exports = plugin;
