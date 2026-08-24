//---------------------------------------------------------------------------
//WHICH MACHINE HAS BEEN GIVEN WHICH JOB. The queue's ledger, and nothing else's.
//
//---- why this is not ./doing.js, which it was ------------------------------
//
//IT WAS, AND THE FIRST JUDGEMENT THIS APP EVER DISPATCHED DEADLOCKED ON ITSELF
//IN UNDER A SECOND. The whole run is four lines of the log:
//
//    J4 "judge fix/..." -> beta-install1
//    shutting it down so it can be made clean
//    it did not answer the power button; pulling the plug
//    could not stop it at all: "beta-install1" is already J4
//
//The tick claimed the machine as `J4` for the length of the job. Then the job's
//own first act — roll the machine back to its base snapshot, which is what makes
//it clean — went through `vmStop`, which claims the same machine as "being shut
//down". Refused, correctly, by a guard doing exactly what it says: one long
//VirtualBox operation at a time. J4 was blocked by J4.
//
//TWO DIFFERENT EXCLUSIONS WERE SHARING ONE MAP, and one strictly contains the
//other, so they could never both be right:
//
//  ./doing.js  a VirtualBox operation is mid-flight and the machine is HALF-WAY
//              between two states. Seconds to twenty-five minutes. Refusing a
//              second one is the whole point, INCLUDING to the job that holds
//              the machine — that is not an exception to make, it is the rule.
//  this file   the queue has given this machine to a piece of work. Minutes to
//              hours, and it CONTAINS many of the above: bring up, run, put away.
//
//SO NOT RE-ENTRANCY, WHICH IS THE TEMPTING FIX. Letting the holder claim twice
//would let a job snapshot a machine it is also restoring, and the session-lock
//wall of COM text this app exists to avoid comes straight back. The two locks
//are both right; they are just not the same lock.
//
//THE APP BEING PORTED FROM HAS ALWAYS HAD THEM APART — `tasks/queue.js` keeps
//its own `busyWith` Map and reaches into `machines/busy` for `comingUp` alone.
//That distinction did not survive the move, and nothing here could have caught
//it: both halves are correct code, the collision only exists at run time, and it
//needs a real machine and a real job to show up at all.
//
//---- and it lives beside them, in main.js, for their reason ---------------
//
//What it holds outlives a save. See ../busy/main.js: a ledger rebuilt mid-job
//comes back EMPTY while the work goes on running in the old closure, and the
//next thing to ask is told the machine is free.
//---------------------------------------------------------------------------

module.exports = function given() {
    var to = {};   //machine name -> the job it has been given

    function whose(name) {
        return Object.prototype.hasOwnProperty.call(to, name) ? to[name] : null;
    }

    //THROWS, AND THE TICK DEPENDS ON IT THROWING. It calls this synchronously
    //before any await precisely so two ticks cannot hand one machine to two
    //pieces of work — `plan` has already taken the machine out of its own pool
    //for the rest of that pass, and this is the claim that survives the pass.
    //Reaching here means something dispatched onto a machine that was already
    //working, which is a fault rather than a race to absorb quietly.
    function give(name, job) {
        var already = whose(name);
        if (already) {
            throw new Error('"' + name + '" is already doing ' + already + '. The queue gives a machine one '
                + 'piece of work at a time — anything else runs two jobs against one workspace and one branch.');
        }
        to[name] = job;
    }

    function take(name) {
        if (!Object.prototype.hasOwnProperty.call(to, name)) return false;
        delete to[name];
        return true;
    }

    function all() {
        return Object.keys(to).map(function (name) {
            return { name: name, job: to[name] };
        });
    }

    return { whose: whose, give: give, take: take, all: all };
};
