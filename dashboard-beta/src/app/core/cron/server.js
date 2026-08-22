//the same clock, seen from the app's node half.
//
//THE JOBS ARE OWNED BY ./main.js because they outlive this bundle — a save
//rebuilds everything here, and a timer rebuilt every few minutes is one that
//never reaches an interval measured in hours. What arrives here is that same
//object, handed over on the host.
//
//WHATEVER ELSE HAPPENS, THE SHAPE ANSWERS. The test suite builds server halves
//against a bare host with no main behind it, and a plugin that registers a job
//at startup must not have to check first. So a clock with nowhere to run keeps
//the shape and does nothing — the same choice ../log makes, for the same reason.

plugin.consumes = ['app', 'log'];
plugin.provides = ['cron'];
async function plugin(imports, register) {
    var host = imports.app.host;

    //THE ACTION TABLE ARRIVES ON THE HOST, NOT AS A SERVICE, and asking for it
    //the other way is not a small mistake: an unresolved name takes down the
    //WHOLE graph, so every plugin's server half stops and the window loses the
    //lot. `plugin.consumes = ['actions']` did exactly that here.
    var actions = host && host.actions;

    var cron = host && host.cron;

    if (!cron) {
        var nothing = function () {};
        cron = {
            BEAT: 0,
            add: function (spec) { return { name: (spec || {}).name }; },
            //`does` STILL HANDS BACK AN UNSUBSCRIBE, because every caller keeps
            //one and calls it on destroy. Handing back undefined here would turn
            //each of those into a null check, and the first one somebody forgot
            //would be a crash on shutdown.
            does: function () { return nothing; },
            forget: nothing,
            start: function () { return false; },
            stop: function () { return false; },
            list: function () { return []; },
            get: function () { return null; },
            fire: function () { return null; }
        };
    }

    var undo = [];

    //A BARE HOST HAS NO TABLE. The test suite builds this half against one, and
    //an action defined into nothing would throw at registration — which is the
    //same total failure as above, from the other direction.
    if (!actions) {
        await register(null, { cron: cron });
        return;
    }

    //---- the gate ----------------------------------------------------------
    //
    //A JOB THAT MAY ONLY BE WORKED BY A PERSON SAYS SO ITSELF, and this is the
    //one place that asks.
    //
    //WITHOUT IT THIS PLUGIN IS A WAY ROUND A REFUSAL THAT ALREADY EXISTS.
    //`queueStart` refuses over the wire, in those words, because starting the
    //queue gives real machines real work — rolled back, handed a credential, and
    //run unattended. A generic `cronStart --name queue` that did not ask would
    //be the same act under a name nobody had thought to guard.
    function onlyAPerson(name, args) {
        var job = cron.get(name);
        if (!job) throw new Error('There is no scheduled job called "' + name + '".');
        if (job.humanOnly && (args || {})._overTheWire) throw new Error(job.humanOnly);
        return job;
    }

    undo.push(actions.define('crons', {
        about: 'Everything this app does on a timer: what is running, when it last ran, and what it said',
        run: function () { return { beat: cron.BEAT, jobs: cron.list() }; }
    }));

    undo.push(actions.define('cronStart', {
        about: 'Start a scheduled job',
        takes: ['name', 'why'],
        run: function (args) {
            var a = args || {};
            onlyAPerson(a.name, a);
            var was = cron.get(a.name).running;
            cron.start(a.name, actions.whoAsked(a));
            //WHAT IT WAS BEFORE, because "start" on something already running is
            //not a failure and not a change, and a caller that cannot tell the
            //two apart will press it again.
            return { name: a.name, running: true, wasAlready: was };
        }
    }));

    undo.push(actions.define('cronStop', {
        about: 'Stop a scheduled job. A run already in flight is not interrupted',
        takes: ['name', 'why'],
        run: function (args) {
            var a = args || {};
            onlyAPerson(a.name, a);
            var was = cron.get(a.name).running;
            cron.stop(a.name, a.why || ('stopped by ' + actions.whoAsked(a)));
            return { name: a.name, running: false, wasAlready: !was };
        }
    }));

    undo.push(actions.define('cronRun', {
        about: 'Run a scheduled job once, now, whether or not it is due',
        takes: ['name'],
        run: async function (args) {
            var a = args || {};
            //THE SAME GATE AS STARTING IT. Running the queue's job once IS
            //giving a machine work; that it happens once rather than every
            //fifteen seconds does not make it a different act.
            onlyAPerson(a.name, a);

            var ok = await cron.fire(a.name);
            //`null` MEANS IT DID NOT RUN — it was already in flight, or nothing
            //is registered to do it. Kept apart from "ran and failed", because
            //the two want opposite things done about them.
            return { name: a.name, ran: ok !== null, ok: ok, job: cron.get(a.name) ? cron.list().filter(function (j) { return j.name === a.name; })[0] : null };
        }
    }));

    await register(null, {
        cron: cron,
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
