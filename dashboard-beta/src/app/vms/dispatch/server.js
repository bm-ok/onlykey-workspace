var makePayloads = require('./payloads');
var makeWatcher = require('./watcher');
var makeScript = require('./script');
var makeSupervisor = require('./supervisor');
var makeSession = require('./session');
var runsOf = require('./runs');
var quoting = require('../shell/quoting');

//---------------------------------------------------------------------------
//GIVING A MACHINE A TASK, AND LETTING GO OF IT.
//
//EVERYTHING HERE BUILDS SHELL AND NOTHING HERE SENDS IT. That split is the point
//of the group: shell assembled inside an action is shell nothing can look at
//without waking a machine to watch what happens — which is how a `continue`
//outside a loop and a self-matching `pkill` both reached a guest in this
//project. Built as values, every one of these can be printed, checked with
//`bash -n`, and read by somebody who is not currently debugging it.
//
//---- what is here ---------------------------------------------------------
//
//./quoting.js    one shell word, and one whole file, whatever is in them. The
//                two primitives everything else is built on.
//./runs.js       a run's record on the machine, and the three questions asked
//                about it: stop, output, list.
//./payloads.js   the files that run ON a machine rather than here.
//./watcher.js    a way to stand behind a model and watch it work.
//./script.js     the dispatch itself — three kinds of run, one piece of
//                machinery.
//./supervisor.js one turn of the supervisor, as the machine will receive it.
//
//---- and what is not here yet ---------------------------------------------
//
//NO ACTIONS. Nothing here has anywhere to send what it builds: the half that
//holds a connection to a machine is ../channel, and the half that decides WHICH
//machine gets work is the queue — neither of which has moved. Registering
//`vmDispatch` now would be an action that builds a perfect script and has
//nothing to hand it to.
//
//The service is registered so those halves have something to consume when they
//arrive, and so the pieces are reachable from a test and from the command line.
//---------------------------------------------------------------------------

plugin.consumes = ['app'];
plugin.provides = ['dispatch'];
async function plugin(imports, register) {
    //READ ONCE, AT LOAD, AND LOUDLY IF THEY ARE NOT THERE — see ./payloads.js.
    //A guest waiting at the end of a dispatch is the wrong moment to discover a
    //file was never copied into dist.
    var payloads = makePayloads();
    var watcher = makeWatcher({ payloads: payloads });

    await register(null, {
        dispatch: {
            //---- the dispatch ------------------------------------------
            script: makeScript({ payloads: payloads, watcher: watcher }).script,

            //---- a run's record ----------------------------------------
            newId: runsOf.newId,
            checkId: runsOf.checkId,
            stop: runsOf.stop,
            output: runsOf.output,
            //THE SAME LOG, RENDERED BY THE MACHINE'S OWN watch.js — see
            //./runs.js. One renderer, on the machine, so a pane and a terminal
            //show the same thing.
            watching: runsOf.watching,
            list: runsOf.list,
            runs: runsOf.runs,

            //---- the supervisor's own turn -----------------------------
            supervisorTurn: makeSupervisor({ watcher: watcher }).turn,

            //---- and reading what a worker is doing ---------------------
            //
            //STRICTLY READ-ONLY, and DELTAS rather than dumps — see
            //./session.js. `answer` takes a redactor rather than reaching for
            //one, because what it is cleaning is about to be KEPT and the
            //plugin that owns redaction is core/secret.
            sessionCommand: makeSession({ payloads: payloads }).command,
            sessionAnswer: makeSession.answer,

            //---- and the pieces, for whatever needs one on its own ------
            watcherFor: watcher.watcherFor,
            q: quoting.q,
            heredoc: quoting.heredoc,

            RUNS: runsOf.RUNS,
            SUPERVISOR: makeSupervisor.SUPERVISOR
        }
    });
}
module.exports = plugin;
