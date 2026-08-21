//---------------------------------------------------------------------------
//THE CLOCK, AND WHAT IS IN FLIGHT.
//
//The two things about the queue that must not be forgotten when the code
//reloads, and nothing else. What to DO on a tick lives in ./server.js and is
//rebuilt on every save; this is the half that cannot be.
//
//WHY IT IS THIS SIDE OF THE LINE. The node bundle is rebuilt every time a file
//is saved, and this app is developed by saving files constantly. A queue whose
//in-flight record lived over there would forget which machine is holding which
//task every few minutes — and then hand that machine a second one, on top of a
//worker that is still running, in a repository it is still writing to. The same
//argument that already puts the window, the tray, the action table and the log
//here.
//
//AND IT COMES UP STOPPED. Always, on every start, with no setting that can
//change it and no way to arrange for it to be otherwise. This is the piece that
//gives real machines real work: it rolls one back to its base snapshot, hands it
//a credential, and runs somebody's instructions on it unattended. A thing that
//does that must be STARTED by somebody, every time, rather than being found
//already running by whoever opened the app.
//
//---- the tick is a slot, not a function this holds ------------------------
//
//The interesting half of the queue lives in the bundle that reloads. If this
//kept a reference to it, a save would leave the timer calling into a bundle that
//has been torn down — the plugins destroyed, the services gone, and a closure
//still holding all of it alive. What that looks like from outside is work
//dispatched by code that no longer exists.
//
//So ./server.js PUTS ITS TICK IN and takes it out again when it is destroyed. A
//timer that fires with an empty slot does nothing at all and says so once. The
//clock keeps running across a save; what it drives is replaced underneath it.
//---------------------------------------------------------------------------

//FIFTEEN SECONDS, and the number is a judgement rather than a knob. A machine
//takes minutes to bring up and hours to work; anything finer than this is a
//process spawned to learn nothing. Kept here because the board says it out loud
//and the two must not be able to differ.
var TICK = 15000;

plugin.consumes = ['log'];
plugin.provides = ['queue'];
async function plugin(imports, register) {
    var log = imports.log.on('queue');

    //WHICH MACHINE IS DOING WHAT. The record the whole thing turns on: a machine
    //in here is not free, and a machine wrongly out of here gets given a second
    //piece of work on top of the first.
    var busyWith = new Map();

    var timer = null;
    var tick = null;
    var ticking = false;
    var saidNoTick = false;
    var startedBy = null;
    var startedAt = null;

    //ONE TICK AT A TIME, WHATEVER THE CLOCK SAYS. A tick brings machines up and
    //waits on them, which takes longer than the interval whenever anything is
    //actually happening. Two overlapping ticks would both see the same machine
    //free and both give it something.
    async function beat() {
        if (ticking) return;
        if (!tick) {
            //A SAVE LANDED AND THE NEW BUNDLE HAS NOT PUT ITS TICK BACK, or
            //there has never been one. Said once, because the alternative is a
            //line every fifteen seconds and the alternative to that is silence
            //about a queue that has quietly stopped dispatching.
            if (!saidNoTick) {
                saidNoTick = true;
                log.warn('the queue is running but nothing is registered to do a tick — it will dispatch nothing until something is');
            }
            return;
        }
        saidNoTick = false;

        ticking = true;
        try { await tick(); }
        catch (e) {
            //A TICK THAT THREW MUST NOT STOP THE CLOCK. The next one may well
            //work — a machine that was unreachable comes back — and a queue that
            //switches itself off on one bad minute is a queue somebody finds
            //stopped hours later with no idea when.
            log.bad('the queue tick failed: ' + (e && e.message ? e.message : String(e)));
        }
        finally { ticking = false; }
    }

    var queue = {
        TICK: TICK,

        //---- the switch ----------------------------------------------------
        running: function () { return !!timer; },

        //WHO STARTED IT AND WHEN, because "why is this host handing out work"
        //is a question somebody asks after finding out that it is.
        since: function () { return timer ? { by: startedBy, at: startedAt } : null; },

        start: function (by) {
            if (timer) return false;
            startedBy = by || 'somebody';
            startedAt = new Date().toISOString();
            timer = setInterval(beat, TICK);
            //NOT IMMEDIATELY. A tick on the same turn as the press gives no
            //chance to press stop again, and starting the queue is the one act
            //here that reaches a machine.
            log.good('the queue is running — started by ' + startedBy + ', first look in ' + (TICK / 1000) + 's');
            return true;
        },

        //STOPPING DOES NOT ABANDON WHAT IS RUNNING. It stops the next thing
        //being picked up; work already given to a machine carries on, and the
        //record of it stays here so a later tick can pick it up again. A stop
        //that dropped the record would leave a machine holding a task nothing
        //knows about.
        stop: function (why) {
            if (!timer) return false;
            clearInterval(timer);
            timer = null;
            startedBy = null;
            startedAt = null;
            log.warn('the queue is stopped' + (why ? ' — ' + why : '')
                + (busyWith.size ? '. ' + busyWith.size + ' machine(s) are still working and are not interrupted.' : ''));
            return true;
        },

        //---- the tick slot -------------------------------------------------
        //
        //Handed in by the half that reloads, and taken out again on destroy —
        //see the header for what a stale one would mean.
        does: function (fn) {
            tick = fn || null;
            return function () { if (tick === fn) tick = null; };
        },

        //WHETHER ANYTHING IS REGISTERED TO DISPATCH. Different from `running`:
        //the clock can be ticking with an empty slot — that is what a save looks
        //like for a moment — and it can be armed and switched off, which is what
        //every start of this app looks like. A board that collapsed the two
        //would say "the queue is off" about a host that has no queue at all.
        armed: function () { return !!tick; },

        //---- what is in flight ---------------------------------------------
        inFlight: function () {
            var out = [];
            busyWith.forEach(function (what, machine) { out.push({ machine: machine, doing: what }); });
            return out;
        },

        //AS A LOOKUP, for the policy, which asks "is this machine busy" per row.
        doing: function () {
            var out = {};
            busyWith.forEach(function (what, machine) { out[machine] = what; });
            return out;
        },

        //CLAIMED BEFORE ANYTHING IS DONE TO THE MACHINE, and refused if it is
        //already held. This is the one place that decides a machine is taken, so
        //it is the one place that can say no — a caller that checked "is it
        //free" and then claimed would have a gap between the two.
        claim: function (machine, what) {
            if (busyWith.has(machine)) return false;
            busyWith.set(machine, what);
            return true;
        },

        release: function (machine) { return busyWith.delete(machine); },

        held: function (machine) { return busyWith.get(machine) || null; }
    };

    await register(null, { queue: queue });
}
module.exports = plugin;
