//what this app is, and what it can do.
//
//THE TWO ACTIONS THAT ANSWER BEFORE ANYTHING ELSE WORKS. `actions` is what the
//command line prints when it is given no arguments — "what can this thing do"
//is the first question anybody asks, and the answer comes from the running app
//rather than from a list in a README that can go stale. `info` is the second:
//whether there is a window, and whether nw is there at all.
//
//IT WAS CALLED `status`, AND THAT WORD BELONGS TO THE OTHER APP. The dashboard
//this relays to has a `status` of its own, and the two share a name and not one
//single field: that one carries the workspace, whether VirtualBox answers,
//whether the drills are on and whether one is running — it is the whole poll its
//window draws from. This one is `app, version, nw, packaged, window, pid`.
//
//A LOCAL NAME WINS OVER A RELAYED ONE, so ours was answering a question nobody
//had asked and the real `status` was unreachable from this app by any route. It
//cost more than the banner it was noticed through: ../../settings/general.js
//reads `askedToTest` off `status`, a field only the relayed one has, so the
//dialog asking whether the drills may run in this folder never once fired.
//
//`info` rather than `about`, which was the other candidate: `about` is already
//the word for the sentence describing an action, in every row of the table.
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
        //EVERY ACTION THERE IS, WHICH IS NOW THE SAME AS EVERY ACTION THIS APP
        //OWNS. It listed a second app's as well while there was a pipe behind
        //the table, and carried a `where` on each row to tell them apart; there
        //is one table now and nothing for that field to say.
        takes: [],
        run: async function () { return actions.all(); }
    }));

    undo.push(actions.define('info', {
        about: 'What this app is, and whether its window is up',
        takes: [],
        run: async function () {
            //ASKED THROUGH `services` RATHER THAN CONSUMED. `window` is
            //undefined when there is no nw — under the test suite, or a plain
            //node boot — and consuming a service that does not exist there
            //would stop this plugin loading at all, which is the opposite of
            //what an `info` action is for.
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
