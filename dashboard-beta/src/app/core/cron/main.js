var makeSchedule = require('./schedule');

//---------------------------------------------------------------------------
//EVERYTHING THIS APP DOES ON A TIMER, IN ONE PLACE THAT CAN BE LOOKED AT.
//
//Before this there were two repeating timers in the node half and no way to see
//either: the queue's clock, and the sweep that notices a machine which has
//stopped answering. Both were doing their job. Neither could tell you when it
//last ran, whether it had failed, or that it was running at all.
//
//THE POINT IS THE MONITORING, not the scheduling. A `setInterval` is one line;
//what is hard is a repeating job that says what it did. So a job registered here
//keeps its last twenty runs, how long each took, and what any failure said — and
//Settings → Cron draws it.
//
//---- why this is main.js -------------------------------------------------
//
//THE NODE BUNDLE IS REBUILT EVERY TIME A FILE IS SAVED, and this app is
//developed by saving files constantly. A timer that lived over there would be
//torn down and rebuilt every few minutes — so anything counting in hours would
//never get there, and the record of what has run would reset while somebody was
//reading it.
//
//The same argument that already puts the window, the tray, the action table and
//the log on this side. See ../build/main.js.
//
//AND THE WORK ITSELF IS PUT IN RATHER THAN HELD — see ./schedule.js. What to DO
//lives in the bundle and is replaced; the clock keeps turning underneath it.
//---------------------------------------------------------------------------

//HOW OFTEN THE ONE TIMER LOOKS, which is not how often anything runs.
//
//ONE TIMER FOR THE WHOLE APP rather than one per job, because the interesting
//question — "what is due" — is then answered in one place against one clock,
//and a job registered while stopped needs no timer at all.
//
//A SECOND IS FINE AND THE ARITHMETIC IS WHY: this compares a few numbers and
//returns. It is not a process spawned to learn nothing, which is the shape that
//actually costs something here. The cost of a coarser beat is that a job asking
//for fifteen seconds gets fifteen-and-a-bit, and nothing here needs better.
var BEAT = 1000;

plugin.consumes = ['log'];
plugin.provides = ['cron'];
async function plugin(imports, register) {
    var schedule = makeSchedule({ say: imports.log.on });

    var beating = false;
    var timer = setInterval(async function () {
        //THE BEAT DOES NOT OVERLAP ITSELF EITHER. `schedule.beat` awaits the
        //jobs it runs, and a job that takes longer than a second would otherwise
        //have a second beat walk in behind it — which the per-job guard would
        //catch, but only after the two had already raced to read the same state.
        if (beating) return;
        beating = true;
        try { await schedule.beat(Date.now()); }
        finally { beating = false; }
    }, BEAT);

    //A TIMER MUST NOT BE THE REASON THE PROCESS IS STILL ALIVE. Quitting is
    //owned by ../lifecycle; a repeating timer that holds node open turns
    //"closing the window" into a hang with nothing on screen to explain it.
    if (timer.unref) timer.unref();

    await register(null, {
        cron: {
            BEAT: BEAT,

            //---- what a plugin does ----------------------------------------
            //
            //`add` DESCRIBES THE JOB and `does` SUPPLIES THE WORK, and they are
            //separate because the two have different lifetimes: the description
            //survives a save, the work does not.
            add: schedule.add,
            does: schedule.does,
            forget: schedule.forget,

            //---- and what a person does ------------------------------------
            start: schedule.start,
            stop: schedule.stop,

            //---- and what a person sees ------------------------------------
            list: function () { return schedule.list(Date.now()); },
            get: schedule.get,

            //FOR A DRILL AND FOR THE ONE CASE A PERSON WANTS: run it now,
            //whether or not it is due, without touching whether it is running.
            fire: function (name) { return schedule.fire(name, Date.now()); }
        }
    });
}
module.exports = plugin;
module.exports.BEAT = BEAT;
