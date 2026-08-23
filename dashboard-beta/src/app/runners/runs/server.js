var makeAsking = require('./asking');

//---------------------------------------------------------------------------
//WORK IN FLIGHT ON A MACHINE: GIVING IT OUT, FOLLOWING IT, STOPPING IT.
//
//SEPARATE FROM ../machines, WHICH IS THE LIFECYCLE. That plugin starts a
//machine, stops it, photographs it and rolls it back — things done TO a machine.
//This is about the work a machine is holding, which has its own lifetime: a run
//outlives the command that started it, survives this app being restarted, and
//is read back afterwards rather than waited for.
//
//The app being ported from splits them the same way — actions/machines.js and
//actions/runs.js — and the reason shows up in the refusals. Everything here
//refuses a machine that is not dialled in, because everything here is a question
//put TO the machine; half of ../machines works on one that is off, and must.
//
//---- what is here and what is not -----------------------------------------
//
//THE SHELL IS ../../vms/dispatch's, all of it. What a run is, how one is
//started detached, how the guest records it, what the watcher writes — none of
//that is here, and this file builds no shell of its own. It is the door: who may
//ask, of which machine, and what the answer meant.
//
//`vmSessions` and `vmSessionTail` are the OTHER half of following a run — what
//the agent said, rather than what its process printed. Both are worth having and
//they answer different questions: a crash before the agent ever started thinking
//appears here and nowhere in a transcript. Those two are ../sessions'.
//---------------------------------------------------------------------------

plugin.consumes = ['app', 'log', 'dispatch', 'ours', 'channel', 'secret'];
plugin.provides = [];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    var log = imports.log;

    var dispatch = imports.dispatch;
    var channel = imports.channel;

    var asking = makeAsking({
        ours: imports.ours,
        connected: channel.connected
    });

    var undo = [];

    if (actions) {
        //---- WHAT HAS BEEN GIVEN TO A MACHINE, AND WHAT BECAME OF IT -------
        //
        //A RUN WITH NO STATUS IS REPORTED AS `running` RATHER THAN AS A MISSING
        //FIELD — see ../../vms/dispatch/runs.js, which decides that. A caller
        //that has to interpret an absence will eventually interpret it as
        //finished, and the queue is a caller that would then hand the machine to
        //somebody else while the work was still going.
        undo.push(actions.define('vmRuns', {
            about: 'The tasks given to a machine, and whether they are still going',
            takes: ['name'],
            run: async function (args) {
                var name = (args || {}).name;
                asking.reachable(name, 'its runs cannot be read');

                var r = await channel.run(name, dispatch.list(),
                    { what: 'reading its runs', timeout: 60000 });
                return { runs: dispatch.runs(r.output) };
            }
        }));

        //---- WHAT A RUN'S OWN PROCESS PRINTED ------------------------------
        //
        //DIFFERENT FROM THE TRANSCRIPT, AND WORTH BOTH. The transcript says what
        //the agent did; this says what happened to the program running it —
        //which is where a crash before it ever started thinking appears, and
        //where an agent that never authenticated says so.
        //
        //REDACTED, BECAUSE THIS IS KEPT. The queue reads two thousand lines of
        //it into an attempt's record when a task ends badly, so it goes to disk.
        //Command output carries tokens; ../../core/secret is the one place that
        //knows what one looks like.
        undo.push(actions.define('vmRunOutput', {
            about: "The tail of one task's raw output",
            takes: ['name', 'run', 'lines'],
            run: async function (args) {
                var a = args || {};
                asking.reachable(a.name, 'its output cannot be read');
                var run = asking.whichRun(a.run);
                var lines = a.lines == null ? 40 : Number(a.lines);

                var r = await channel.run(a.name, dispatch.output(run, lines),
                    { what: 'reading ' + run, timeout: 60000 });
                return { run: run, output: imports.secret.redact(r.output) };
            }
        }));

        //---- STOPPING ONE, AND EVERYTHING IT STARTED -----------------------
        //
        //THE OUTCOME IS A SENTENCE, NOT A BOOLEAN — see ./asking.js. A stopped
        //run is not a failed one, and the difference matters when somebody reads
        //the board tomorrow: it has no result because it was stopped, not
        //because it went wrong.
        //
        //TWO OF THE FIVE READINGS THROW. Everything downstream treats a
        //successful stop as "the machine is free now", so a machine still
        //running work nobody is watching must never be reported as free.
        undo.push(actions.define('vmRunStop', {
            about: 'Stop a run on a machine, and everything it started',
            takes: ['name', 'run'],
            run: async function (args) {
                var a = args || {};
                asking.reachable(a.name, 'its runs cannot be stopped');
                var run = asking.whichRun(a.run);

                var r = await channel.run(a.name, dispatch.stop(run),
                    { what: 'stopping ' + run, timeout: 60000 });
                var said = makeAsking.outcomeOf(r.output);

                if (said.bad) {
                    throw new Error(run + ' ' + said.how + '. Look at the machine — something there '
                        + 'is ignoring both TERM and KILL.');
                }

                log.on('vm', a.name).warn(run + ' ' + said.how);
                return {
                    name: a.name,
                    run: run,
                    outcome: said.how,
                    //SAID PLAINLY, because a stopped run is the one that looks
                    //like a failure and is not.
                    note: 'stopped, not failed — it has no result because it was stopped'
                };
            }
        }));
    }

    await register(null, { onDestroy: function () { while (undo.length) undo.pop()(); } });
}
module.exports = plugin;
