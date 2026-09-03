var fs = require('fs');
var path = require('path');

var makeGuestApi = require('./guestapi');
var doc = require('./doc');

//---------------------------------------------------------------------------
//WHAT A MACHINE IS TOLD ABOUT THE WORKSPACE ITSELF.
//
//A guest opens `~/workspace`, finds the repositories, and is told nothing about
//them. How to get them into a state where they will run, how to run the tests,
//how to run the thing, what is peculiar about this project — none of it is
//written anywhere a machine can read, so every worker and every judge works it
//out again from the source. One judge spent its first turns building a
//virtualenv before it could answer the question it was sent to answer.
//
//SO THE WORKSPACE CARRIES ITS OWN NOTES, at `.okc/workspace_claude.md`, and
//every machine gets them as `~/workspace/CLAUDE.md` at boot.
//
//---- IT IS THE WORKSPACE'S, NOT THIS APP'S -------------------------------
//
//Which is why it lives in the workspace drawer rather than in `provision/`
//beside the skills. A skill says what a WORKER is; this says what THIS PROJECT
//is, it is different for every workspace, and it is meant to be edited by the
//people and machines that work in it. The starter beside this file is only what
//a workspace gets when it has none of its own.
//
//---- WHY IT IS NOT SERVED BY ../vms/provision -----------------------------
//
//That would have been free: `fetch_okc` and the `/provision/*` route already
//exist, and a file dropped in `.okc/provision/` is served with no new code at
//all. It is not done that way because ../vms/provision/scripts.js searches
//`[keptDir, .okc/provision, appDir]` and serves ANY file in them matching
//`SERVABLE` — so putting this at the `.okc` ROOT and adding that folder to the
//search path would serve `machines.json`, `github-drafts.json`, `meter.json`
//and every contract to any guest that asked for them by name.
//
//ONE FILE, ONE ROUTE, AND NOTHING ELSE REACHABLE. See ./guestapi.js.
//---------------------------------------------------------------------------

plugin.consumes = ['app', 'log', 'state', 'guestApi'];

//HANDED OUT SO ../bootstrap CAN SHIP IT. A bundle is what a fresh workspace
//starts from, and the starter belongs in one -- but the starter lives beside
//THIS plugin and the workspace's own copy is read by rules this plugin owns, so
//bootstrap asking is better than bootstrap knowing where either of them is.
plugin.provides = ['workstrap'];

async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    var undo = [];

    //THE STARTER, READ FROM BESIDE THIS FILE. Packaged with the app, so a
    //workspace that has never had one still answers with something useful
    //rather than with an error a machine cannot act on.
    //
    //`__dirname` SURVIVES THE BUNDLE because webpack is configured for a node
    //target here; the same read is how ../vms/provision finds its scripts.
    function starter() {
        return fs.readFileSync(path.join(__dirname, 'starter', 'workspace_claude.md'), 'utf8');
    }

    var notes = doc({
        //WHERE THE WORKSPACE'S DRAWER IS, ASKED EVERY TIME. Which workspace is
        //open is not a constant, and a path read once at startup is a path that
        //goes on naming the folder from before the last switch.
        dirNow: function () { return imports.state.here.where(); },
        starter: starter
    });

    //---- READING IT -------------------------------------------------------
    //
    //GUARDED, BECAUSE THE SUITE BUILDS THIS AGAINST A BARE HOST. There is no
    //action table in `test/rules/server-graph.test.js` — the point of that test
    //is that every plugin's dependencies resolve, not that its verbs work — so
    //a plugin which assumes one fails the check that exists to prove the graph
    //is sound. Every other plugin here guards the same way.
    if (actions) {
    undo.push(actions.define('workstrapRead', {
        about: "The workspace's own notes: how to finalise it, build it, test it and run it — what every machine is given as CLAUDE.md",
        run: async function () {
            var got = await notes.read();
            return {
                text: got.text,
                //WHOSE COPY THIS IS, because "the starter" and "what somebody
                //wrote" read identically once they are both just text, and the
                //difference decides whether a machine should trust it.
                its: got.mine ? 'this workspace' : 'the starter',
                mine: got.mine,
                at: got.at,
                bytes: got.text.length,
                note: got.mine
                    ? 'This workspace has its own notes. Every machine gets them as ~/workspace/CLAUDE.md at boot.'
                    : 'This workspace has no notes of its own yet, so machines are given the starter — which '
                        + 'tells them what the file is for and asks them to fill it in. Saving over it makes it '
                        + "this workspace's."
            };
        }
    }));

    //---- AND WRITING IT ---------------------------------------------------
    //
    //A PERSON'S, FOR NOW. A machine editing what every future machine is told
    //is exactly the thing that wants an approval in front of it, and that is
    //the next piece of work rather than this one — so until it exists, this
    //door is closed to everything but the window. Refusing now costs nothing;
    //opening it now would have to be taken back.
    undo.push(actions.define('workstrapSave', {
        about: "Write the workspace's notes. A person at the window only",
        takes: ['text'],
        run: async function (a) {
            var args = a || {};
            if (args._overTheWire || args._driven || args._fromMachine) {
                throw new Error('Writing the workspace notes is done in the window. Every machine that '
                    + 'opens this workspace is given this file, so changing it changes what everything '
                    + 'is told — a machine proposing that change, and the reading of it, is the next '
                    + 'thing to build here.');
            }

            var text = String(args.text == null ? '' : args.text);
            if (!text.trim()) {
                throw new Error('The notes are empty. An empty CLAUDE.md is worse than the starter: it '
                    + 'reads as a project that has nothing worth saying about it rather than one nobody '
                    + 'has written up yet.');
            }

            var at = await notes.write(text);
            imports.log.on('workstrap').good('the workspace notes were saved — ' + text.length + ' characters');
            return { saved: true, at: at, bytes: text.length };
        }
    }));
    }

    //---- THE DOOR A MACHINE FETCHES IT THROUGH ----------------------------
    //
    //REGISTERED WITH ../vms/https, which owns the certificate and the port and
    //has already turned `vm:token` into a machine record before anything in
    //./guestapi.js runs. What is this plugin's is the one verb.
    undo.push(imports.guestApi.api(makeGuestApi({
        read: notes.read,
        say: imports.log.on
    })));

    await register(null, {
        workstrap: {
            //WHAT A WORKSPACE'S NOTES SAY, AND WHOSE COPY IT IS. The second
            //half is the one a caller has to have: ../bootstrap ships whatever
            //this answers, and shipping the starter as though it were a
            //workspace's own writing is how a bundle would carry one project's
            //notes into every workspace made from it.
            read: notes.read,
            starter: starter,
            NAME: doc.NAME
        },
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}

module.exports = plugin;
