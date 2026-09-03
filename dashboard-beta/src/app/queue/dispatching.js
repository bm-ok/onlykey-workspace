//---------------------------------------------------------------------------
//WHERE THE PIECES ARE JOINED UP.
//
//Everything the queue does to a machine is in a file of its own — ./starting
//brings one up, ./running waits for the work, ./metering reads what it cost,
//./putting hands it back, ./onetask and ./onejudgement drive one piece of work
//end to end, ./tick decides who gets what, ./adopting picks up what a restart
//left. Each takes what it needs as arguments and knows nothing about the plugin
//graph.
//
//THIS IS THE ONE PLACE THAT KNOWS BOTH. It takes the services and hands each
//piece exactly what it asked for, and it is deliberately nothing but wiring:
//there is no rule here, and anything that looks like one has been put in the
//wrong file.
//
//---- why it is not in server.js -------------------------------------------
//
//BECAUSE IT IS THE PART MOST LIKELY TO BE WRONG, and a plugin file that also
//holds three hundred lines of assembly is a file where the wiring is read as
//scenery. Here it is the subject, and it can be built against stand-ins and
//asked what it handed to what.
//---------------------------------------------------------------------------

var makeWaiting = require('./waiting');
var makeStarting = require('./starting');
var makeRunning = require('./running');
var makePutting = require('./putting');
var makeMetering = require('./metering');
var makeHeads = require('./heads');
var makePapers = require('./papers');
var makeOneTask = require('./onetask');
var makeOneJudgement = require('./onejudgement');
var makeTick = require('./tick');
var makeAdopting = require('./adopting');
var makeRedial = require('./redial');

module.exports = function dispatching(deps) {
    var d = deps || {};

    var call = d.call;          //the action table, which every step goes through
    var say = d.say;            //(who, machine) -> a logger
    var busy = d.busy;          //claim, release, all
    var ours = d.ours;          //the machine register
    var guests = d.guests;      //the sign-ins
    var judge = d.judge;        //the judgements
    //WHERE A RUN'S LOG SURVIVES THE MACHINE — the queue's own drawer, the same
    //one taskProgress fills, because a judgement's log is a run's log.
    var logs = d.logs;
    //AND WHAT A JUDGEMENT HANDED BACK, which is ../core/archive's `artifacts`
    //drawer — the one ../judge already opens. Both answer OFF DISK, so both are
    //async, which is why ./papers and ./concluding await their readers.
    var findings = d.findings;
    var refs = d.refs;          //where a branch stands
    var channel = d.channel;    //talking to a machine
    var workspace = d.workspace;
    var settings = d.settings;
    //THE SPENDING RECORD, CONSUMED RATHER THAN BUILT. It was ./meter.js here
    //until the Runners tab became a second reader — see ../meter/ledger.js for
    //the note that asked for exactly that move.
    var meter = d.meter;
    var tipsFor = d.tipsFor || function () { return null; };

    //---- EVERY STEP GOES THROUGH THE ACTIONS -------------------------------
    //
    //So a job dispatched by the queue meets exactly the refusals a job
    //dispatched by hand meets — the script must be approved, the machine must be
    //dialled in, and the workspace gate still applies. A second path for the
    //scheduler is always the one that turns out to be wrong.

    var waiting = makeWaiting({});
    var heads = makeHeads({ all: function () { return refs.heads(); } });

    var starting = makeStarting({ call: call, busy: busy, settle: waiting.settle });

    var putting = makePutting({
        call: call,
        settle: waiting.settle,
        say: say,
        //A MACHINE KEPT FOR LOOKING AT IS CLAIMED IN THE REGISTER, so nothing
        //picks it up while somebody is reading it. The same field a person's
        //borrow uses, because to everything else it is the same fact.
        keep: function (machine, why) { ours.update(machine, { borrowed: why }); }
    });

    var running = makeRunning({ call: call, ticking: waiting.ticking, secs: waiting.secs });

    var metering = makeMetering({
        call: call,
        holderOf: guests.holderOf,
        //PAUSED RATHER THAN REVOKED. A sign-in that cannot authenticate stops
        //being lent out, and nothing spends a machine on it again until somebody
        //replaces it — which is a different act from deciding it is gone.
        pause: function (who, how) { return guests.pause(who, how); },
        record: meter.record
    });

    var papers = makePapers({
        judging: { get: judge.get },
        handedBack: function (uid) { return findings.list(uid); },
        readHanded: function (uid, file) { return findings.read(uid, file); },
        run: function (machine, command, opts) { return channel.run(machine, command, opts); }
    });

    //WHETHER THE SUPERVISOR IS MEANT TO BE WOKEN, read at the moment it would
    //be rather than remembered — a setting somebody changed while a run was
    //going should take effect on that run.
    //ASYNC SINCE THE SWITCH FOLLOWED THE FOLDER. Whether the supervisor may wake
    //itself is now a decision about the workspace it would be waking about, so
    //answering it means knowing which one is open. Awaited at both call sites; a
    //promise read as a boolean is truthy, which would wake it always.
    async function wakes() {
        try { return (await settings.read()).supervisorWakes === true; }
        catch (e) { return false; }
    }

    var onetask = makeOneTask({
        call: call, say: say,
        starting: starting, running: running, metering: metering, putting: putting,
        hold: function (machine, borrowed) { ours.update(machine, { borrowed: borrowed }); },
        release: busy.given.take,
        headsOn: heads.on,
        papersFor: function (id, machine, to) { return papers.deliver(id, machine, to); },
        wakes: wakes,
        noteFor: d.noteFor
    });

    var onejudgement = makeOneJudgement({
        call: call, say: say,
        starting: starting, running: running, metering: metering, putting: putting,
        judging: { get: judge.get, update: judge.update },
        release: busy.given.take,
        refOf: judge.refOf,
        repoFor: d.repoFor,
        handedBack: function (uid) { return findings.list(uid); },
        readHanded: function (uid, file) { return findings.read(uid, file); },
        kept: function (uid, run) { return logs.has(uid, run); },
        keep: function (uid, run, what) { return logs.keep(uid, run, what); },
        tipsFor: tipsFor,
        wakes: wakes
    });

    //---- and what holds a machine, which is ../vms/busy's -------------------
    //
    //ONE ANSWER TO "IS THAT MACHINE FREE". The queue asks rather than remembers,
    //because the node bundle is rebuilt on every save and a queue that forgot
    //would hand a machine a SECOND task on top of a worker still writing.
    function inFlight() {
        return busy.given.all().reduce(function (n, r) { n[r.name] = r.job; return n; }, {});
    }

    //---- and whether there is anywhere to deliver ---------------------------
    //
    //`workspace.dir()` THROWS WHEN NOTHING IS OPEN, which is the right shape for
    //a caller that needs the folder and the wrong one for a caller asking
    //whether there is one. Turned into an answer here rather than at the two
    //call sites, so both read the same fact the same way.
    async function isOpen() {
        try { return !!(await workspace.dir()); } catch (e) { return false; }
    }

    async function machinesNow() {
        var said = await call('vmList', {});
        return (said && said.vms) || [];
    }

    async function tasksNow() {
        var said = await call('tasks', {});
        return (said && said.tasks) || [];
    }

    var tick = makeTick({
        call: call, say: say,
        workspaceOpen: isOpen,
        machinesNow: machinesNow,
        tasksNow: tasksNow,
        judgementsNow: async function () { return judge.all() || []; },
        inFlight: inFlight,
        signIns: guests.forQueue,
        claim: busy.given.give,
        runTask: function (entry, machine) { return onetask.run(entry, machine); },
        runJudgement: function (entry, machine) { return onejudgement.run(entry, machine); },
        judging: { update: judge.update },
        refOf: judge.refOf,
        //ANYTHING THAT ARRIVED FROM OUTSIDE. Not ported yet — see ./tick, which
        //takes it as an argument for exactly this reason.
        watch: d.watch
    });

    var adopting = makeAdopting({
        call: call, say: say,
        workspaceOpen: isOpen,
        machinesNow: machinesNow,
        tasksNow: tasksNow,
        judgementsNow: async function () { return judge.all() || []; },
        judging: { get: judge.get, update: judge.update },
        refOf: judge.refOf,
        held: function (machine) { return !!busy.given.whose(machine); },
        claim: busy.given.give,
        release: busy.given.take,
        running: running,
        putting: putting,
        kept: function (uid, run) { return logs.has(uid, run); },
        keep: function (uid, run, what) { return logs.keep(uid, run, what); }
    });

    var redial = makeRedial({
        call: call, say: say,
        ask: function (machine, command, opts) { return channel.run(machine, command, opts); },
        taskByUid: d.taskByUid,
        machineNamed: function (machine) { return ours.get(machine); },
        busyWith: function () {
            var all = busy.given.all();
            return {
                machines: all.map(function (r) { return r.name; }),
                work: all.map(function (r) { return r.job; })
            };
        }
    });

    return {
        tick: tick,
        adopt: adopting.adopt,
        dialledIn: redial.dialledIn,
        meter: meter,
        inFlight: inFlight,

        //THE TWO A PERSON DRIVES DIRECTLY, handed out rather than rebuilt.
        //
        //`vmBorrow` and `vmReturn` are the same two acts the tick performs —
        //bring a machine up clean, and put it away — done by somebody at the
        //window instead of by the loop. Building a second `starting` and a second
        //`putting` for them would be two implementations of "put a machine away",
        //and the one that turns out to be wrong is discovered by a machine.
        starting: starting,
        putting: putting
    };
};
