//---------------------------------------------------------------------------
//WAITING FOR A MACHINE, OUT LOUD.
//
//The tick spends most of its life waiting: for a machine to stop, to roll back,
//to start, to dial in, to finish a run. Every one of those is minutes, and a
//minute with nothing on screen is indistinguishable from a minute that has hung.
//
//SO WAITING SAYS SO, AND SAYS HOW LONG IT USUALLY TAKES. "waiting for it to dial
//in — 40s" is a queue working; the same line at 6 minutes, next to "it usually
//takes about 40s", is a fault, and the reader can tell which without knowing
//this app.
//
//---- everything is injected, because none of this is testable otherwise ----
//
//A SIX-MINUTE BOUND CHECKED BY WAITING SIX MINUTES is a check nobody runs, which
//is how a bound stays unverified for a year. The clock and the looking both
//arrive as arguments, so the rule can be asked about eleven minutes ago without
//eleven minutes passing — the same separation the app being ported from made
//when it pulled `stranded` out of `adopt` and turned a six-hour drill into a
//49-second check.
//---------------------------------------------------------------------------

function secs(ms) { return Math.round(ms / 1000) + 's'; }

module.exports = function waiting(deps) {
    var d = deps || {};

    var now = d.now || function () { return Date.now(); };
    var sleep = d.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

    //THE HEARTBEAT IS ITS OWN TIMER rather than a line per poll: the polls are
    //five seconds apart and a line every five seconds is a log nobody reads.
    var every = d.every || function (ms, fn) { return setInterval(fn, ms); };
    var stop = d.stop || function (t) { clearInterval(t); };

    var LOOK = d.lookEvery == null ? 5000 : d.lookEvery;
    var SAY = d.sayEvery == null ? 30000 : d.sayEvery;

    //---- saying so while it happens ----------------------------------------
    //
    //`usual` IS WHAT TURNS A DURATION INTO A JUDGEMENT. Without it a reader has
    //to know what this app considers normal; with it, the line says.
    function ticking(to, what, opts) {
        var it = opts || {};
        var usual = Number(it.usual || 0);
        var began = now();
        var said = 0;

        var timer = every(LOOK, function () {
            var gone = now() - began;
            if (gone - said < SAY) return;
            said = gone;

            if (usual && gone > usual * 2) {
                to.warn('still waiting for ' + what + ' — ' + secs(gone)
                    + ', and it usually takes about ' + secs(usual));
            } else {
                to.info('waiting for ' + what + ' — ' + secs(gone));
            }
        });

        //UNREF'D, so a wait that is still going cannot hold the process open.
        //The thing being waited for is on another machine; this is only the
        //saying.
        if (timer && typeof timer.unref === 'function') timer.unref();

        return {
            done: function () {
                stop(timer);
                var gone = now() - began;
                if (usual && gone > usual * 2) {
                    to.warn(what + ': ' + secs(gone) + ', about ' + Math.round(gone / usual)
                        + 'x the usual ' + secs(usual));
                }
                return gone;
            }
        };
    }

    //---- and waiting for it ------------------------------------------------
    //
    //`look` IS PASSED IN rather than this asking for a machine by name. What is
    //being waited on differs — a machine's state, a run's status — and a helper
    //that knew about machines could not be used for the other.
    async function settle(spec) {
        var it = spec || {};
        var to = it.to;
        var what = it.what;
        var timeout = Number(it.timeout || 0);
        var usual = Number(it.usual || 0);

        var deadline = now() + timeout;
        var tick = ticking(to, what, { usual: usual });

        try {
            for (;;) {
                var saw = await it.look();
                if (saw && it.ok(saw)) return saw;

                //CHECKED AFTER LOOKING, so a thing that was already true when
                //asked is never reported as having timed out.
                if (now() > deadline) {
                    //NAMED WITH THE ELAPSED TIME AS WELL AS THE LIMIT, because
                    //"waited 6 minutes" reads as a policy and "waited 6 minutes,
                    //having expected 40 seconds" reads as the fault it is.
                    throw new Error('Waited ' + secs(now() - deadline + timeout) + ' for ' + what
                        + ' and it did not happen'
                        + (usual ? ' — it usually takes about ' + secs(usual) : ''));
                }

                await sleep(LOOK);
            }
        } finally {
            //WHATEVER HAPPENED. A wait that threw still has a timer behind it,
            //and one left running says "waiting for it to dial in" about a
            //machine nothing is waiting for any more.
            tick.done();
        }
    }

    return { ticking: ticking, settle: settle, secs: secs };
};

module.exports.secs = secs;
