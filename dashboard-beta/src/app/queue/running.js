//---------------------------------------------------------------------------
//WAITING FOR THE WORK ITSELF.
//
//A run is DETACHED on purpose — see ../vms/dispatch. It outlives the connection
//that started it, which means everything here is watching from outside, and the
//one thing this file exists to get right follows from that:
//
//A MACHINE THAT CANNOT BE ASKED IS NOT A MACHINE THAT HAS FINISHED.
//
//This waited by polling, and a failed poll threw — straight out of here, out of
//the task, and into the `finally` that puts a machine away. So a fifteen-second
//network blip powered the machine off and rolled it back MID-RUN, while the work
//itself was perfectly fine: detached, still going, and about to be destroyed by
//the thing supervising it. Pulling the cable for one minute cost the whole task.
//
//An outage is something happening to the DASHBOARD, not to the work. Being
//unable to see the work is a reason to look again, not a reason to end it.
//
//---- but unreachable and off are different --------------------------------
//
//Patience is for a machine that has lost its network while carrying on working.
//A machine that is POWERED OFF is not working, and waiting ten minutes to admit
//that holds it out of the pool for no reason. VirtualBox can answer that without
//the guest's help, which is exactly why it is worth asking.
//---------------------------------------------------------------------------

//HOW LONG A MACHINE MAY BE OUT OF TOUCH BEFORE THIS APP STOPS WAITING.
//
//Generous on purpose: the cost of waiting too long is a machine held, and the
//cost of giving up too early is somebody's afternoon. Ten minutes is long enough
//that nothing ordinary reaches it.
//
//NAMED HERE AND ASKED THROUGH A FUNCTION, so the rule can be checked without
//waiting it out. A drill for a ten-minute bound is ten minutes of a machine
//deliberately kept off the network, per run — which is a drill nobody runs,
//which is how the property stays unchecked.
var HOW_LONG_OUT_OF_TOUCH = 10 * 60000;

//ONE PLACE SAYS HOW LONG SOMETHING TOOK. Three copies of `Math.round(ms/1000)`
//is three chances for one of them to start saying minutes.
var howLong = require('./waiting').secs;

//WHETHER A MACHINE LAST HEARD FROM AT `lostSince` HAS BEEN QUIET LONG ENOUGH.
//`now` is a parameter rather than a call to Date.now() for exactly one reason:
//it is what lets this be asked about eleven minutes ago without eleven minutes
//passing.
//`== null` RATHER THAN FALSY. A timestamp is a number, and 0 is a number — so
//`!lostSince` reads "lost at the epoch" as "never lost" and waits for ever.
//Nothing reaches that in production, where Date.now() is never 0; it reaches it
//the moment a test supplies its own clock, which is the point of having one.
function outOfTouchTooLong(lostSince, now) {
    if (lostSince == null) return false;
    return (Number(now) || 0) - Number(lostSince) > HOW_LONG_OUT_OF_TOUCH;
}

module.exports = function running(deps) {
    var d = deps || {};
    var call = d.call;
    var ticking = d.ticking;
    var now = d.now || function () { return Date.now(); };
    var sleep = d.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var secs = d.secs || howLong;

    var LOOK = d.lookEvery == null ? 15000 : d.lookEvery;

    //UNTIL THE RUN IS OVER, HOWEVER IT ENDS.
    //
    //`lost` COUNTS AS OVER. A run whose process is gone is not going to produce
    //a result, and waiting for one would hold a machine out of service for as
    //long as the timeout — which is the whole afternoon, on a task nobody is
    //going to get an answer to.
    async function waitForRun(to, machine, runId, hours) {
        var limit = hours == null ? 6 : Number(hours);
        var deadline = now() + limit * 3600000;

        //NO `usual` HERE, and that is the honest answer: a task is as long as
        //the work is, and a five-minute one and a two-hour one are both
        //ordinary. What CAN be said is how long it has been, which is what
        //somebody deciding whether to go and look actually needs.
        var tick = ticking(to, runId + ' to finish', { every: 60000 });
        //`null` RATHER THAN 0 AS THE SENTINEL. It was 0, which uses a
        //timestamp as both a value and a flag — so a clock reading zero makes
        //"lost since the epoch" indistinguishable from "never lost", and the
        //complaint repeats every poll instead of once. Date.now() is never 0,
        //which is why this was invisible until the clock became an argument.
        var lostSince = null;

        try {
            for (;;) {
                var runs = null;

                try {
                    var said = await call('vmRuns', { name: machine });
                    runs = (said && said.runs) || [];

                    //`!== null` FOR THE SAME REASON as the sentinel below: a
                    //machine lost at time zero has still been lost.
                    if (lostSince !== null) {
                        to.good(machine + ' is answering again after ' + secs(now() - lostSince)
                            + ' — the run was never in doubt, only our view of it');
                        lostSince = null;
                    }
                } catch (e) {
                    //CANNOT SEE IT. Say so once, keep waiting, and give up only
                    //when it has been out of touch long enough to be genuinely
                    //gone rather than briefly unreachable.
                    var still = null;
                    try {
                        var list = await call('vmList', {});
                        still = (list.vms || []).filter(function (v) { return v.name === machine; })[0] || null;
                    } catch (e2) { /* if even this cannot be asked, keep waiting */ }

                    //OFF IS NOT UNREACHABLE. VirtualBox answers this without the
                    //guest's help, and a powered-off machine is not working.
                    if (still && !still.running) {
                        to.warn(machine + ' is not running any more, so ' + runId + ' is over however it ended');
                        return { state: 'gone' };
                    }

                    if (lostSince === null) {
                        lostSince = now();
                        to.warn('cannot reach ' + machine + ' (' + e.message + ') — the run is detached and '
                            + 'carries on regardless; waiting for it to come back');
                    } else if (outOfTouchTooLong(lostSince, now())) {
                        to.bad(machine + ' has been unreachable for '
                            + Math.round((now() - lostSince) / 60000) + ' minutes; giving up on ' + runId);
                        return { state: 'unreachable' };
                    }

                    await sleep(LOOK);
                    continue;
                }

                var mine = runs.filter(function (r) { return r.id === runId; })[0];

                //A RUN THAT IS NO LONGER LISTED is over. The machine answered,
                //so this is not a view problem — the run is simply not there.
                if (!mine) return { state: 'gone' };
                if (mine.state !== 'running') return mine;

                if (now() > deadline) {
                    to.warn('giving up on ' + runId + ' after ' + limit + ' hours; the machine is being put away');
                    return { state: 'abandoned' };
                }

                await sleep(LOOK);
            }
        } finally {
            tick.done();
        }
    }

    return {
        waitForRun: waitForRun,
        outOfTouchTooLong: outOfTouchTooLong,
        HOW_LONG_OUT_OF_TOUCH: HOW_LONG_OUT_OF_TOUCH
    };
};

module.exports.outOfTouchTooLong = outOfTouchTooLong;
module.exports.HOW_LONG_OUT_OF_TOUCH = HOW_LONG_OUT_OF_TOUCH;
