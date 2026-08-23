var fs = require('fs');
var path = require('path');

var makeAsking = require('./asking');
var makeBriefing = require('./briefing');

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

plugin.consumes = ['app', 'log', 'dispatch', 'ours', 'channel', 'secret',
    //FOR `vmDispatch` ONLY, and each for one question:
    //  whatIsOn        whether this is a continuation, and of what
    //  sessions        where that conversation is filed, and what it must be told
    //  vbox, guestApi  where a guest hands an artifact back to
    //  repoWorkspaces  whether `--folder` is a path on the machine or on this host
    'whatIsOn', 'sessions', 'vbox', 'guestApi', 'repoWorkspaces'];
plugin.provides = [];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    var log = imports.log;

    var dispatch = imports.dispatch;
    var channel = imports.channel;
    var sessions = imports.sessions;

    var asking = makeAsking({
        ours: imports.ours,
        connected: channel.connected
    });

    var briefing = makeBriefing({
        readFile: function (at) { return fs.readFileSync(at, 'utf8'); },
        exists: function (at) { return fs.existsSync(at); },
        resolve: function (p) { return path.resolve(String(p)); },
        basename: function (p) { return path.basename(p); }
    });

    var undo = [];

    if (actions) {
        //---- GIVING A MACHINE A TASK, AND LETTING GO OF IT ------------------
        //
        //RETURNS AS SOON AS THE WORK HAS STARTED, NOT WHEN IT ENDS. A task runs
        //for minutes or an hour; waiting would make one command look like a
        //hang, hold the machine against anything else, and give no progress in
        //the meantime. Progress is read afterwards with `vmSessionTail`, which
        //is a delta with a bookmark rather than a stream nobody is watching.
        //
        //NOTHING HERE CARRIES A CREDENTIAL, and that is a correction rather than
        //an omission. The first version of this passed one as an environment
        //assignment on the command that starts the run — which the agent
        //inherits, and can print. Transcripts are captured to this host and
        //KEPT, so a credential reaching agent-visible output is copied out and
        //filed by design. A worker is signed in separately, through its own
        //credential file, which is Claude Code's and not something the agent is
        //handed a copy of.
        undo.push(actions.define('vmDispatch', {
            about: 'Give a machine a task to work on, and return without waiting for it',
            takes: ['name', 'task', 'folder', 'contract', 'rules', 'contractName', 'resume', 'shell'],
            run: async function (args) {
                var a = args || {};
                asking.reachable(a.name, 'it cannot be given work');
                if (!a.task || !String(a.task).trim()) throw new Error('Say what the task is.');

                var vm = imports.ours.get(a.name);
                var to = log.on('vm', a.name);

                //---- WHICH RULES, DECIDED BEFORE ANYTHING IS STARTED --------
                var under = briefing.rulesFor(a);

                //---- A CONTINUATION SAYS SO ---------------------------------
                //
                //Wrapped, because a brief that could not be annotated is still
                //the brief — and refusing to dispatch because the memory folder
                //could not be read would stop work over a note about it.
                //
                //See ../sessions/keying.js for what it says and why it lives
                //there rather than here: this is one of TWO paths to a worker,
                //and writing the words at this end is how the first version of
                //it never once fired.
                var task = String(a.task);
                try {
                    var doing = imports.whatIsOn(a.name);
                    var kept = doing ? await sessions.get(sessions.keyFor(doing)) : null;
                    task = makeBriefing.briefWith(sessions.announcement(doing, kept), task);
                } catch (e) { /* a brief that could not be annotated is still the brief */ }

                //---- AND WHETHER ITS WORKER CAN AUTHENTICATE AT ALL ---------
                //
                //ASKED BEFORE ANYTHING IS SET UP, because a worker that cannot
                //authenticate does not fail as "signed out" — it fails as an api
                //error in a json blob, minutes later, after a workspace has been
                //laid out and a run recorded. The first task ever given out
                //failed exactly that way and nothing between the button and the
                //log said the obvious thing.
                //
                //ASKED OF THE MACHINE rather than read from the registry. A
                //machine can be signed in three ways — handed a credential,
                //signed in on itself, or carrying a key in its environment — and
                //the registry only knows about the first. Refusing a machine
                //that could in fact work is a worse fault than the one being
                //fixed.
                //
                //A SHELL RUN HAS NO WORKER IN IT, so being signed out is beside
                //the point: refusing one would mean refusing a soak because a
                //credential it will never touch is missing.
                if (!a.shell) {
                    var able = await channel.run(a.name,
                        'if [ -s "$HOME/.claude/.credentials.json" ] || [ -n "${ANTHROPIC_API_KEY:-}" ]; '
                        + 'then echo okc-can-authenticate; fi',
                        { what: 'checking its worker can authenticate', timeout: 30000 });

                    if (!/okc-can-authenticate/.test(able.output || '')) {
                        throw new Error('"' + a.name + '"\'s worker is signed out, so the work would fail '
                            + 'the moment it started. Hand it the credential first: vmCredentialsPut '
                            + '--name ' + a.name);
                    }
                }

                var id = dispatch.newId();
                var where = imports.repoWorkspaces.guestPath(a.folder, '--folder')
                    || (vm.spec && vm.spec.folder)
                    || imports.repoWorkspaces.folderFor(vm.spec);

                //---- WHERE THIS HOST CAN BE REACHED --------------------------
                //
                //Worked out here rather than left for the guest to assemble. The
                //machine already knows the address; what it does not know is
                //which port artifacts go to, and telling it is cheaper than
                //putting another value in its environment and re-provisioning to
                //get it there.
                //
                //NO ADDRESS MEANS NO HELPER, AND THE RUN STILL RUNS. What is
                //lost is the ability to hand something back, which is worth less
                //than the work.
                var base = null;
                try {
                    var at = await imports.vbox.hostAddress();
                    if (at) base = 'https://' + at + ':' + imports.guestApi.PORT;
                } catch (e) { /* no address means no helper */ }

                var r = await channel.run(a.name, dispatch.script({
                    id: id,
                    task: task,
                    folder: where,
                    contract: under.rules,
                    resume: a.resume,
                    shell: !!a.shell,
                    base: base
                }), { what: 'dispatching ' + id, timeout: 60000 });

                //---- STARTED IS NOT DISPATCHED ------------------------------
                //
                //The guest prints a marker once the work is detached and
                //running. Without this, a script that failed on its first line
                //returns exactly like one that started an hour of work.
                if (!/okc-dispatched/.test(r.output || '')) {
                    throw new Error('"' + a.name + '" did not start the work: '
                        + (String(r.output || '').trim().split('\n').pop() || 'it said nothing'));
                }

                to.good(a.name + ' is working on ' + id
                    + (under.rules ? ', under ' + under.named : ''));

                return {
                    run: id,
                    machine: a.name,
                    folder: where,
                    //SAID PLAINLY, because "no rules" is the dangerous one and
                    //it is also the silent one — a run without a contract looks
                    //exactly like a run with one from everywhere except here.
                    contract: under.rules ? (under.at || under.named) : null,
                    watch: 'okc.js vmSessionTail --name ' + a.name,
                    note: 'started, not finished — read its session for progress and vmRuns for the outcome'
                };
            }
        }));

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
