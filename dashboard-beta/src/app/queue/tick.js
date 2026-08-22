//---------------------------------------------------------------------------
//THE TICK. Waiting work, free machines, and who gets what.
//
//THE DECISION IS NOT HERE. ./policy.plan takes what is waiting and what is free
//and answers which machine each thing goes to, and for everything that goes
//nowhere, the real reason. This file is what surrounds that: the guards that say
//whether a tick should happen at all, the claim that stops two ticks handing one
//machine to two pieces of work, and the place a failure LANDS.
//
//SEPARATED BECAUSE THE ONLY WAY TO ASK "WHAT WOULD HAPPEN" USED TO BE TO LET IT
//HAPPEN. The Queue tab reports what is waiting and why; the tick dispatches.
//Two readings of one paragraph is how a board comes to say a judgement is next
//while a task goes out.
//
//---- and it says things once ----------------------------------------------
//
//This runs four times a minute. Anything it says about work that is WAITING it
//would otherwise say again four times a minute, for as long as the wait lasts —
//a task waiting overnight for a sign-in somebody has to make writes three and a
//half thousand identical lines into the record. The cost is not disk: the record
//is read from a bookmark, so the cost is that the next real event arrives buried
//under them.
//
//KEYED ON THE REASON, NOT ON THE WORK, so a task that starts waiting for a
//DIFFERENT reason says so. Cleared when it is dispatched, so the next wait is
//announced again rather than silenced by a sentence from last week.
//---------------------------------------------------------------------------

var policy = require('./policy');

module.exports = function tick(deps) {
    var d = deps || {};
    var call = d.call;
    var say = d.say;

    var workspaceOpen = d.workspaceOpen || function () { return true; };
    var machinesNow = d.machinesNow;      //async () -> [vm]
    var tasksNow = d.tasksNow;            //async () -> [task]
    var judgementsNow = d.judgementsNow;  //async () -> [judgement]
    var inFlight = d.inFlight || function () { return {}; };
    var signIns = d.signIns || function () { return null; };

    var claim = d.claim;                  //(machine, ref) — synchronous, before any await
    var runTask = d.runTask;              //(entry, machine) -> promise
    var runJudgement = d.runJudgement;    //(entry, machine) -> promise

    //WHERE A JUDGEMENT'S RECORD IS WRITTEN. A task's goes through the action
    //table; a judgement's does not have an action for this yet.
    var judging = d.judging || { update: function () {} };

    //ANYTHING THAT ARRIVED FROM OUTSIDE. The two things that turn up on their
    //own are an issue somebody filed and a pull request somebody proposed;
    //everything else in this app starts with a person or a supervisor writing it
    //down.
    //
    //ON THE QUEUE RATHER THAN THE DRAW LOOP, and every few minutes rather than
    //every few seconds — a paint function must not reach the network, and this
    //already runs whether or not a window is open, and is off until somebody
    //switches it on.
    //
    //NOT AWAITED INTO THE DISPATCH PATH. A slow GitHub is not a reason for the
    //queue to stop giving out work, so it is fired and let go.
    var watch = d.watch || function () {};

    var refOf = d.refOf || function (n) { return 'J' + n; };
    var stamp = d.stamp || function () { return new Date().toISOString(); };

    //---- what this tick remembers between ticks ---------------------------
    //
    //RE-ENTRANCY, not concurrency. A tick that overruns its interval must not
    //have a second one start inside it: the machine claim below is synchronous
    //and would still hold, but everything read before it would be read twice and
    //the second read would be of a board the first one had already changed.
    var running = false;

    //SAID ONCE, ON THE TICK AFTER IT CLOSES. A heartbeat every fifteen seconds
    //saying nothing is happening is how a log stops being read.
    var idleSaid = false;

    var waitingSaid = new Map();

    function sayWaiting(ref, message) {
        if (waitingSaid.get(ref) === message) return;
        waitingSaid.set(ref, message);
        say('queue').info(message);
    }

    async function once() {
        if (running) return { skipped: 'a tick is already running' };

        //NOTHING TO DISPATCH WHEN THERE IS NOWHERE TO DELIVER.
        //
        //Read through the store this would return an empty board and idle
        //quietly, which is the right OUTCOME reached by the wrong route: "no
        //work" and "no workspace" are different sentences, and a queue that
        //cannot tell them apart is one that would happily dispatch the moment a
        //stale file answered.
        if (!workspaceOpen()) {
            if (!idleSaid) {
                idleSaid = true;
                say('queue').info('no workspace is open — nothing is dispatched until one is');
            }
            return { skipped: 'no workspace' };
        }
        idleSaid = false;

        running = true;
        try {
            watch();

            var waiting = await whatIsWaiting();
            if (!waiting.length) return { dispatched: [], waiting: [] };

            var machines = await machinesNow();
            var said = policy.plan(waiting, machines, {
                inFlight: inFlight(),
                signIns: signIns()
            });

            said.waiting.forEach(function (w) { sayWaiting(w.ref, w.why); });

            var sent = [];
            said.dispatch.forEach(function (go) {
                //CLAIMED SYNCHRONOUSLY, BEFORE ANY AWAIT, so two ticks cannot
                //hand the same machine to two pieces of work. `plan` has already
                //taken it out of its own pool for the rest of this pass; this is
                //the claim that survives the pass.
                claim(go.machine, go.ref);

                //IT IS NOT WAITING ANY MORE, so the next time it is, that is
                //news rather than a repeat.
                waitingSaid.delete(go.ref);

                sent.push({ ref: go.ref, machine: go.machine, kind: go.entry.kind });
                start(go);
            });

            return { dispatched: sent, waiting: said.waiting.map(function (w) { return w.ref; }) };
        } finally {
            running = false;
        }
    }

    //---- what is waiting, and what the queue will not touch ----------------
    //
    //A PERSON'S WORK IS NEVER PICKED UP HERE, wherever it got its state from.
    //The queue's job is to find work nobody is doing and give it to a worker,
    //and work that says a person is doing it is not that — dispatching one rolls
    //a machine back to a snapshot and runs Claude over the top of it.
    //
    //BELT AND BRACES with the adoption rule: this is the door, and it should be
    //shut whether or not something upstream went wrong.
    //
    //A JUDGEMENT WITH NO JOB NEVER REACHES THE QUEUE, which is why ./onejudgement
    //has two endings rather than three.
    async function whatIsWaiting() {
        var tasks = (await tasksNow()) || [];
        var judgements = (await judgementsNow()) || [];

        var mine = judgements
            .filter(function (j) { return j.state === 'queued' && j.by !== 'person' && j.job; })
            .map(function (j) {
                return Object.assign({}, j, { kind: 'judgement', ref: j.ref || refOf(j.number) });
            })
            .concat(tasks
                .filter(function (t) { return t.state === 'queued' && t.worker !== 'person'; })
                .map(function (t) {
                    return Object.assign({}, t, { kind: 'task', ref: '#' + t.number });
                }));

        //ORDERED BY ./policy.order, INSIDE plan. Named here only so it is
        //obvious that this function decides WHAT is eligible and never WHO goes
        //first — one place says that, and the Queue tab reads the same one.
        return mine;
    }

    //---- and where a failure lands -----------------------------------------
    //
    //NOT AWAITED. A tick gives work out; it does not wait for it. What it must
    //do is make sure work that throws on the way up LANDS somewhere, because
    //nothing else will look at it.
    function start(go) {
        var entry = go.entry;
        var machine = go.machine;

        if (entry.kind === 'judgement') {
            runJudgement(entry, machine).catch(function (e) {
                say('queue', machine).bad(entry.ref + ' — ' + e.message);
                try {
                    judging.update(entry.id, {
                        state: 'done',
                        attempts: (entry.attempts || []).concat([
                            { machine: machine, at: stamp(), failed: e.message }
                        ])
                    });
                } catch (err) { /* the log already carries it */ }
            });
            return;
        }

        runTask(entry, machine).catch(async function (e) {
            say('queue', machine).bad('#' + entry.number + ' — ' + e.message);

            //---- A TASK WHOSE SETUP FAILED HAS TO LAND SOMEWHERE ------------
            //
            //It threw before it could be marked done, so it stayed in `given`
            //for ever: not queued, so nothing would pick it up; not done, so the
            //board showed it working with no worker anywhere; and on the next
            //restart the queue would adopt it and put its machine away all over
            //again.
            //
            //MARKED DONE RATHER THAN RE-QUEUED, deliberately. The attempt
            //happened and produced nothing, which is a true and useful thing to
            //see — and a task that re-queues itself onto a machine that just
            //failed to boot does that for ever, quietly, with nobody deciding
            //anything.
            //
            //EXCEPT WHEN THERE WAS NO IDENTITY TO GIVE IT, which is not that.
            //`plan` checks for one before the machine is claimed, so this should
            //not be reachable — and it is kept because "should not be reachable"
            //is a claim about TIMING: a sign-in can be paused by another
            //machine's run between the check and the handover. Nothing was read,
            //nothing was written and no code was even fetched, so `done` would
            //file "we learnt nothing" as the outcome of a task that never
            //started. It goes back to waiting, where the check then holds it
            //without spending anything — so this cannot become the loop the
            //paragraph above is about.
            var nothingToGiveIt = !!(e && e.noIdentity);
            try {
                await call('taskUpdate', {
                    id: entry.id,
                    task: nothingToGiveIt
                        ? { state: 'queued', machine: null, run: null }
                        : {
                            state: 'done',
                            attempts: (entry.attempts || []).concat([
                                { machine: machine, at: stamp(), failed: e.message }
                            ])
                        }
                });
                if (nothingToGiveIt) {
                    say('queue', machine).warn('#' + entry.number + ' is back in the queue — it was '
                        + 'never started, because there was no sign-in to give the machine');
                }
            } catch (err) { /* the log already carries it */ }
        });
    }

    return { once: once, whatIsWaiting: whatIsWaiting };
};
