//---------------------------------------------------------------------------
//WHAT A RESTART LEFT BEHIND.
//
//This app can stop at any moment — a save, a crash, somebody closing it — and
//the machines carry on. Adoption is the one pass that runs before the queue
//starts giving anything out, and it has to tell FOUR situations apart:
//
//  a task that never started      it sat in `given` with no run, invisible to
//                                 everything. Back in the queue.
//  a judgement that never started the same, through the door that was left open
//                                 when the second kind of work was added.
//  a task that WAS running        waited on, finished, filed, machine put away.
//  a judgement that WAS running   the same — and this one is where a complete
//                                 reading was lost twenty minutes at a time.
//
//A PERSON'S IS LEFT ALONE IN ALL FOUR. Work somebody took by hand sits in
//`given` with no run for as long as they are working in it: there is no run
//because there is no worker process, and the exit code is a human saying
//"finished". Re-queueing one hands their branch to a second machine while they
//are still in the first — two machines on one branch, and the work taken from
//underneath somebody with an editor open. See ./policy.stranded, which is where
//that rule lives.
//
//---- re-queueing is right, and it is not the end of the story --------------
//
//A dashboard that has just started knows nothing about what was in flight, so
//putting an unstarted task back is the honest thing to do with it. The other
//half is that THE MACHINE STILL KNOWS, and says so the moment it dials in — see
//./redial. The alternative was to guess from a registry written by the process
//that stopped, and a guess made here has to be right every time about a machine
//that may have been reverted by hand while nothing was watching. Asking the
//machine cannot be stale, because the machine is the thing being asked about.
//---------------------------------------------------------------------------

var stranded = require('./policy').stranded;

var NEWLINE = String.fromCharCode(10);

//---- what a run said it decided --------------------------------------------
//
//THE `okc-result` LINE. A judging run prints one, and it is the only place the
//recommendation exists for a reading this app was not watching: the verdict and
//any file it handed back came through the API and are already here, but the
//record of what it CONCLUDED went out on stdout.
//
//THE LAST ONE, because a shell prints things nobody asked for and a run can
//print more than one. Parsed as whole JSON, so a line the tail cut in half
//simply does not count rather than being guessed at.
function recommendationIn(text) {
    var last = null;
    String(text == null ? '' : text).split(NEWLINE).forEach(function (line) {
        var trimmed = line.trim();
        if (trimmed.indexOf('okc-result') !== 0) return;
        try {
            var o = JSON.parse(trimmed.slice('okc-result'.length).trim());
            if (o && o.recommendation) last = o.recommendation;
        } catch (e) { /* a line the tail cut in half */ }
    });
    return last;
}

module.exports = function adopting(deps) {
    var d = deps || {};
    var call = d.call;
    var say = d.say;

    //ASYNC, for the reason ./tick gives.
    var workspaceOpen = d.workspaceOpen || async function () { return true; };
    var machinesNow = d.machinesNow;
    var tasksNow = d.tasksNow;
    var judgementsNow = d.judgementsNow;

    var judging = d.judging || { get: function () { return null; }, update: function () {} };
    var refOf = d.refOf || function (n) { return 'J' + n; };

    var held = d.held || function () { return false; };
    var claim = d.claim;
    var release = d.release;

    var running = d.running;      //waitForRun
    var putting = d.putting;      //putAway

    var kept = d.kept || function () { return false; };
    var keep = d.keep || function () {};

    var stamp = d.stamp || function () { return new Date().toISOString(); };

    async function adopt() {
        //NOTHING WAS IN FLIGHT IN A WORKSPACE NOBODY IS SERVING — and asking
        //would read an empty board and "recover" it, which is adoption doing the
        //one thing it exists to prevent.
        if (!(await workspaceOpen())) return { skipped: 'no workspace' };

        var tasks = (await tasksNow()) || [];
        var judgements = (await judgementsNow()) || [];

        var requeued = await putBack(tasks, judgements);
        var picked = pickUp(tasks, judgements);

        return { requeued: requeued, picked: picked };
    }

    //---- work that was being SET UP when this stopped ----------------------
    //
    //It sat in `given` with no run id, which made it invisible to everything:
    //the queue only looks at `queued`, adoption only looks for a run to wait on,
    //and the board showed it working with no worker anywhere. Two accumulated in
    //one afternoon, both from restarting while a machine was booting.
    //
    //PUT BACK RATHER THAN MARKED DONE, and the difference is real: nothing was
    //dispatched, so no work happened and there is nothing to judge. Re-queueing
    //loses nothing and re-running it is exactly what was wanted.
    async function putBack(tasks, judgements) {
        var back = [];

        var lostTasks = stranded(tasks, function (t) { return t.worker; });
        for (var i = 0; i < lostTasks.length; i++) {
            var t = lostTasks[i];
            say('queue').warn('#' + t.number + ' was being set up when this stopped, and never started — '
                + 'back in the queue'
                + (t.machine ? '. If ' + t.machine + ' still has it, it will say so when it dials in' : ''));
            try {
                await call('taskUpdate', { id: t.id, task: { state: 'queued', machine: null } });
            } catch (e) { /* said by the warning above */ }
            back.push('#' + t.number);
        }

        //AND THE SAME FOR A JUDGEMENT, WHICH THIS DID NOT DO.
        //
        //Everything above was written about tasks because tasks were the only
        //kind of work then. Judging arrived later, shares this queue, is
        //dispatched by the same tick and is set up on a machine exactly the same
        //way — and adoption never learned about it. So a restart during the
        //twenty seconds between "the workspace is set up" and "the run has
        //started" left a judgement in `given` with no run: invisible to the
        //queue, which only looks at `queued`, and invisible to the pass below,
        //which only looks for a run to wait on.
        //
        //FOUND BY DOING IT: the app was restarted while a machine was being set
        //up for J41, and J41 sat `given` with no run and no attempts while its
        //machine was rolled back underneath it.
        var lostReadings = stranded(judgements, function (j) { return j.by; });
        for (var k = 0; k < lostReadings.length; k++) {
            var j = lostReadings[k];
            var ref = j.ref || refOf(j.number);
            say('queue').warn(ref + ' was being set up when this stopped, and never started — back in the queue'
                + (j.machine ? '. ' + j.machine + ' was rolled back with nothing on it' : ''));
            try {
                judging.update(j.id, { state: 'queued', machine: null });
            } catch (e) { /* said by the warning above */ }
            back.push(ref);
        }

        return back;
    }

    //---- and work that was already RUNNING ---------------------------------
    //
    //NOT AWAITED. Each of these waits on a run that may have hours left, and
    //adoption's job is to get them all under way before the queue starts giving
    //anything else out — not to sit through them one at a time.
    function pickUp(tasks, judgements) {
        var up = [];

        tasks.filter(function (t) {
            return t.state === 'given' && t.machine && t.run;
        }).forEach(function (task) {
            if (held(task.machine)) return;
            claim(task.machine, '#' + task.number);
            up.push('#' + task.number);

            var to = say('queue', task.machine);
            to.warn('#' + task.number + ' was in flight when this restarted; picking it back up');
            finishTask(task, to).catch(function (e) { to.bad(e.message); });
        });

        //---- AND A JUDGEMENT THAT WAS ALREADY RUNNING ---------------------
        //
        //THE OTHER HALF OF THE SAME OMISSION. The pass above reads tasks and
        //only tasks; the pass before it takes judgements that never STARTED. A
        //judgement that HAD started fell between them.
        //
        //WHAT THAT COSTS, AND IT IS NOT THEORETICAL. A reading ran, read the
        //change, recommended accept, handed back a 2,798-byte report and sent
        //its verdict — all of which arrived here — and then sat in `given` for
        //twenty minutes because this app had been restarted while it worked. The
        //reading cost 0.67 USD and was complete; only the record was lost. And
        //the machine stayed up holding a JUDGE's credential, out of the pool,
        //because the finally that puts it away died with the process watching.
        //
        //WORSE, IT COULD NOT BE FIXED BY HAND EITHER: judgementUpdate refuses
        //any change to something in `given`, which is right for what it READS
        //and made recording that it had finished impossible. A state nothing can
        //leave is a state nothing should be able to enter.
        judgements.filter(function (j) {
            return j.state === 'given' && j.machine && j.run && j.by !== 'person';
        }).forEach(function (j) {
            if (held(j.machine)) return;
            var ref = j.ref || refOf(j.number);
            claim(j.machine, ref);
            up.push(ref);

            var to = say('queue', j.machine);
            to.warn(ref + ' was being read when this restarted; picking it back up');
            finishReading(j, ref, to).catch(function (e) { to.bad(ref + ' — ' + e.message); });
        });

        return up;
    }

    async function finishTask(task, to) {
        try {
            var vm = await machineNamed(task.machine);
            if (vm && vm.connected) {
                await running.waitForRun(to, task.machine, task.run);
                try { await call('taskProgress', { id: task.id }); } catch (e) { /* best effort */ }
            }
            var art = await call('taskArtifact', { id: task.id });
            await call('taskUpdate', { id: task.id, task: { state: 'done' } });
            to[art.delivered ? 'good' : 'warn']('#' + task.number + ' done — ' + art.summary);
        } finally {
            await putting.putAway(task.machine);
            release(task.machine);
        }
    }

    async function finishReading(j, ref, to) {
        var concluded = null;
        try {
            var vm = await machineNamed(j.machine);
            var outcome = null;

            if (vm && vm.connected) {
                //WAITS IF IT IS STILL GOING, returns at once if it finished
                //while this app was down — which is the case this exists for.
                outcome = await running.waitForRun(to, j.machine, j.run);

                await keepTheLog(j, outcome, to);
                concluded = await whatItRecommended(j);
            }

            //AND HOW THE RUN ENDED, ON THE ATTEMPT, for the same reason the
            //ordinary path does it: the attempt is where "it crashed" and "it
            //finished and said nothing" are told apart, and an adopted run was
            //leaving both blank.
            var latest = judging.get(j.id) || j;
            var marked = (latest.attempts || []).map(function (a) {
                if (a.run !== j.run) return a;
                return Object.assign({}, a, {
                    exit: outcome && outcome.exit !== undefined ? outcome.exit : (a.exit === undefined ? null : a.exit),
                    outcome: (outcome && outcome.state) || a.outcome || null,
                    adopted: true
                });
            });

            judging.update(j.id, {
                state: 'done',
                attempts: marked,
                concluded: concluded || j.concluded || null,
                read: stamp()
            });
            to.good(ref + ' done — it finished while this app was not watching'
                + (concluded ? ', and it recommends: ' + concluded : ''));
        } finally {
            await putting.putAway(j.machine);
            release(j.machine);
        }
    }

    //THE LOG IS KEPT HERE TOO, WHICH IT WAS NOT.
    //
    //The ordinary path keeps it "so it survives the machine", and this path
    //threw the same answer away — so a judgement adopted after a restart came
    //out with its findings and no account of the run that produced them, and the
    //log reader explained the absence as "judgements read before this app
    //started keeping their logs have none". For one made four minutes earlier.
    //
    //THE EXIT CODE GOES WITH IT, and that is the part that matters. The record
    //already learnt once that a crashed reading and one that read the change and
    //found nothing are the same row without it — and the machine is rolled back
    //in the finally, taking the answer with it. Adoption was quietly undoing
    //that fix for every run a restart happened to interrupt.
    async function keepTheLog(j, outcome, to) {
        try {
            if (kept(j.uid, j.run)) return;
            var out = await call('vmRunOutput', { name: j.machine, run: j.run, lines: 2000 });
            keep(j.uid, j.run, {
                output: out.output || out.text || '',
                machine: j.machine,
                state: (outcome && outcome.state) || null,
                exit: outcome && outcome.exit !== undefined ? outcome.exit : null
            });
            to.info('kept the log of ' + j.run + ', so it survives the machine — picked up after a restart');
        } catch (e) { /* the reading is recorded either way */ }
    }

    //WHAT IT DECIDED, OFF THE MACHINE, because the record here has no way to
    //know: the run prints one `okc-result` line, and the verdict and any file it
    //handed back came through the API and are already here.
    async function whatItRecommended(j) {
        try {
            var said = await call('vmRunOutput', { name: j.machine, run: j.run, lines: 200 });
            return recommendationIn(String((said && (said.output || said.tail)) || ''));
        } catch (e) {
            return null;   //the reading is recorded either way
        }
    }

    async function machineNamed(name) {
        var here = ((await machinesNow()) || []);
        return here.filter(function (v) { return v.name === name; })[0] || null;
    }

    return { adopt: adopt, recommendationIn: recommendationIn };
};

module.exports.recommendationIn = recommendationIn;
