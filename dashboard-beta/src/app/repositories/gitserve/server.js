var serving = require('./serve');
var makeGitApi = require('./gitapi');

//---------------------------------------------------------------------------
//SERVING THE WORKSPACE'S REPOSITORIES TO THE MACHINES.
//
//./serve.js is the protocol — git's own `upload-pack` and `receive-pack`, piped
//over http. ./gitapi.js is the door, and every rule about who may read and who
//may write. ./hooks/pre-receive is the one that actually refuses a push, and it
//runs on this host in a folder no guest can reach.
//
//---- why this is not part of ../repos ------------------------------------
//
//IT WAS, FOR AN AFTERNOON, and the graph would not have built.
//
//A push has to know whether the machine pushing is running a JUDGEMENT, because
//a judge is set up on the branch it reads and so every other check says yes.
//That is `whatIsOn`, and:
//
//    repos -> whatIsOn -> onmachine -> queue -> repositories -> repos
//
//`queue` consumes `repositories`, which `repos` provides. A cycle, and an
//unresolved or circular name takes down the WHOLE plugin graph rather than the
//plugin that caused it — so this would not have failed as "the git door is
//broken", it would have failed as "the app does not start".
//
//AND IT IS THE RIGHT SHAPE ANYWAY. The repositories are ../repos's. A SERVER for
//them is a different thing with a different audience: everything here answers a
//machine, nothing here answers a pane, and the two have no code in common. What
//it needs from ../repos it asks for — `repoWorkspaces` carries the permission
//and the way-clearing — rather than sharing a file with it.
//
//NOTHING CONSUMES THIS. It provides no service; it registers a door and hands
//back the way to take it down. So none of the names above can close a loop
//through here.
//---------------------------------------------------------------------------

//`whatIsOn`      what this machine is running, so a judgement cannot push.
//`lines`         which repositories a branch is about, and what is protected.
//`repoWorkspaces` the one permission — see its `mayRevise` — and the clearing of
//                this host's own checkout off the branch a push is about to land
//                on.
//`workspace`     where the repositories are, asked per request so a workspace
//                that changes needs nothing restarted.
//`guestApi`      the door itself. ../../vms/https owns the port, the certificate
//                and the token check.
plugin.consumes = ['app', 'log', 'workspace', 'lines', 'repoWorkspaces', 'whatIsOn', 'guestApi'];
plugin.provides = [];
async function plugin(imports, register) {
    var say = imports.log.on;

    var serve = serving({ workspace: imports.workspace, say: say });

    var stopServing = imports.guestApi.api(makeGitApi({
        serve: serve,
        say: say,

        //EVERY RULE ASKED WHERE IT IS WRITTEN, and not one of them re-derived
        //here. This file is wiring: if a rule needs to change, it changes in the
        //plugin that owns it and this keeps asking the same question.
        scopeOf: function (branch) { return imports.lines.scopeOf(branch); },
        whyProtected: function (branch) { return imports.lines.whyProtected(branch); },
        mayRevise: function (branch) { return imports.repoWorkspaces.mayRevise(branch); },
        freeEverywhere: function (branch) { return imports.repoWorkspaces.freeEverywhere(branch); },
        whatIsOn: function (machine) { return imports.whatIsOn(machine); }
    }));

    await register(null, {
        onDestroy: function () { stopServing(); }
    });
}
module.exports = plugin;
