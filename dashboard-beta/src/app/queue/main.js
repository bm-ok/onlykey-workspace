//---------------------------------------------------------------------------
//WHAT IS IN FLIGHT.
//
//WHICH MACHINE IS DOING WHAT, and nothing else. The one thing about the queue
//that must not be forgotten when the code reloads.
//
//WHY IT IS THIS SIDE OF THE LINE. The node bundle is rebuilt every time a file
//is saved, and this app is developed by saving files constantly. A queue whose
//in-flight record lived over there would forget which machine is holding which
//task every few minutes — and then hand that machine a second one, on top of a
//worker that is still running, in a repository it is still writing to. The same
//argument that already puts the window, the tray, the action table and the log
//here.
//
//---- and the clock, which used to be here ---------------------------------
//
//IT IS A CRON JOB NOW — see ../core/cron. The timer, the start/stop switch, the
//one-tick-at-a-time rule and the "nothing is registered to do a tick" warning
//were all here, and none of them were about the QUEUE: every repeating job in
//this app wants them, and there was no way to look at any of it.
//
//WHAT DID NOT MOVE IS THIS RECORD, and the line is worth being able to state: a
//clock is about time, and "which machine is busy" is a fact about the queue. The
//two happen to have needed the same lifetime, which is not the same as being the
//same thing.
//
//The two rules the switch carried came with it and are declared where the job is
//registered — see ./server.js: it comes up STOPPED, always, and only a person
//may start it.
//---------------------------------------------------------------------------

//FIFTEEN SECONDS, and the number is a judgement rather than a knob. A machine
//takes minutes to bring up and hours to work; anything finer than this is a
//process spawned to learn nothing. Kept here because the board says it out loud
//and the two must not be able to differ.
var TICK = 15000;

plugin.consumes = ['log'];
plugin.provides = ['queue'];
async function plugin(imports, register) {
    //WHICH MACHINE IS DOING WHAT. The record the whole thing turns on: a machine
    //in here is not free, and a machine wrongly out of here gets given a second
    //piece of work on top of the first.
    var busyWith = new Map();

    var queue = {
        TICK: TICK,

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

        held: function (machine) { return busyWith.get(machine) || null; },

        //HOW MANY ARE OUT, for the line a stop prints. Here rather than worked
        //out from inFlight() by the caller, because a stop that says "3 machines
        //are still working" is the difference between a switch somebody trusts
        //and one they wonder about.
        busy: function () { return busyWith.size; }
    };

    await register(null, { queue: queue });
}
module.exports = plugin;
