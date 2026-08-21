//---------------------------------------------------------------------------
//EVERY VBoxManage CALL IN THIS APP GOES THROUGH HERE, AND THEY GO ONE AT A TIME.
//
//VBoxSVC IS A SINGLE SERVICE WITH A SESSION MODEL, and asking it several things
//at once is not a way of getting several answers faster — it is a way of getting
//a locked-up service. That has happened: `list vms` stopped answering at all,
//`startvm` failed, and it took closing every VirtualBox process and restarting
//the service to get it back.
//
//WHAT GOT IT THERE WAS ORDINARY USE, NOT ABUSE. The window polls the machine
//list, which is four processes with two machines — `list vms`, `list runningvms`
//and a `showvminfo` each — and the command line calls the same action into the
//same process with none of the window's pacing. Two callers, no coordination
//between them, and a service that is slow precisely when it is unwell: every
//caller arriving while it struggles adds another process, for up to the two
//minutes of the default timeout, which is how a slow service becomes a stuck one.
//
//A STRICTLY SERIAL QUEUE IS THE WHOLE FIX, and the cost is stated plainly: a
//read can wait behind a write, and a write here can be five minutes — deleting a
//large disk, an unattended install. The machines panel goes stale for that long.
//That is the correct price: it is one caller waiting rather than twenty asking,
//and it is bounded, because the window's draw loop already refuses to overlap
//itself.
//
//---- and identical reads are one read -------------------------------------
//
//WITHOUT THAT, A SERIAL QUEUE JUST CONVERTS "four at once" INTO "four in a row",
//which is the same work spread thinner. `list vms` asked by the window and by
//the command line in the same second is one question, and the second caller gets
//the first one's answer.
//
//THROUGH ../../core/cached RATHER THAN A MAP OF ITS OWN. That plugin is the same
//mechanism: a clock-keyed drawer, emptied by a write. And it does something the
//map could not — two callers arriving while the FIRST IS STILL RUNNING share one
//promise, rather than the second starting its own because nothing was cached
//yet. That is the exact case here: the window and the command line asking within
//the same second, before either has answered.
//
//A WRITE EMPTIES THIS DRAWER AND ONLY THIS ONE. Anything that is not a read
//changes something, and changing something makes every remembered answer stale.
//The app-wide `stale()` would take the ref reads with it, which have nothing to
//do with VirtualBox.
//---------------------------------------------------------------------------

//COMMANDS THAT ONLY ASK. Everything else is assumed to change something, which
//is the safe direction: a new read left off this list is merely slower, while a
//write mistaken for a read leaves every panel remembering what used to be true.
function asks(args) {
    var a = args || [];
    return a[0] === 'list'
        || a[0] === 'showvminfo'
        || a[0] === 'getextradata'
        || a[0] === 'guestproperty'
        || (a[0] === 'snapshot' && a[2] === 'list');
}

//WHAT A SESSION LOCK LOOKS LIKE. VirtualBox loses races against its own session
//handling often enough that one attempt is not a real attempt.
var LOCKED = /locked|INVALID_OBJECT_STATE|is not locked|being locked/i;

//    spawn(args, opts) -> Promise<string>   the one that actually runs it
//    asked                                  a clock-keyed drawer from ../../core/cached
//    say                                    a log
module.exports = function gate(spawn, opts) {
    var o = opts || {};
    var asked = o.asked;
    var say = o.say || { warn: function () {}, info: function () {} };
    var now = o.now || Date.now;
    var sleep = o.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

    //HOW LONG A REMEMBERED ANSWER IS GOOD FOR. Long enough to collapse a burst
    //of callers arriving together, short enough that nothing observes a state it
    //could have acted on — the state watchers poll at two seconds, so none of
    //them sees an answer older than its own interval.
    var chain = Promise.resolve();
    var waiting = 0;
    //NULL RATHER THAN ZERO, so the FIRST slow call says so.
    //
    //Zero works only because a real clock is an epoch and every number is
    //already past the quiet window. Against any other clock — a test's, a
    //monotonic one — the first warning is silently swallowed, which is the one
    //warning that matters: it is the one that says the service has started
    //struggling.
    var lastSlow = null;

    //SAID WHEN IT IS SLOW, because a serial queue turns "VirtualBox is unwell"
    //into "the window has gone quiet", and those look identical from outside.
    //
    //AT MOST ONE LINE A MINUTE: a stall produces hundreds of waits and one of
    //them is the whole message.
    var SLOW = 10000;
    var QUIET_FOR = 60000;

    function queued(args, how) {
        var began = now();
        waiting++;

        //RUN WHATEVER THE ONE BEFORE DID, so a failure does not stop the queue.
        var mine = chain.then(function () {
            var held = now() - began;
            if (held > SLOW && (lastSlow === null || now() - lastSlow > QUIET_FOR)) {
                lastSlow = now();
                say.warn('VirtualBox is answering slowly — "' + args.slice(0, 2).join(' ') + '" waited '
                    + Math.round(held / 1000) + 's behind ' + (waiting - 1) + ' other call(s)');
            }
            return spawn(args, how || {});
        });

        chain = mine.then(function () {}, function () {});
        return mine.then(
            function (v) { waiting--; return v; },
            function (e) { waiting--; throw e; }
        );
    }

    function run(args, how) {
        if (!asks(args)) {
            //A WRITE. Everything remembered about VirtualBox is now a guess.
            return queued(args, how).then(
                function (v) { if (asked) asked.empty(); return v; },
                function (e) { if (asked) asked.empty(); throw e; }
            );
        }

        if (!asked) return queued(args, how);

        //A FAILURE IS NOT KEPT — see ../../core/cached. The next caller asks
        //again rather than being handed a remembered error for a second and a
        //bit.
        return asked.get(args.join(' '), function () { return queued(args, how); });
    }

    //ONE ATTEMPT IS NOT A REAL ATTEMPT, and only for the one failure that is
    //worth retrying: a session lock. Anything else is a real answer and retrying
    //it six times just takes longer to say so.
    async function retrying(fn, how) {
        var h = how || {};
        var attempts = h.attempts || 6;
        var delay = h.delay || 3000;
        var what = h.what || 'operation';
        var last;

        for (var i = 1; i <= attempts; i++) {
            try { return await fn(); }
            catch (err) {
                last = err;
                var locked = LOCKED.test(String(err.stderr || '') + String(err.message || ''));
                if (!locked || i === attempts) throw err;
                say.warn(what + ' attempt ' + i + ' hit a session lock; retrying in ' + (delay / 1000) + 's');
                await sleep(delay);
            }
        }
        throw last;
    }

    return {
        run: run,
        retrying: retrying,
        asks: asks,
        //FOR A BOARD THAT WANTS TO SAY WHY IT IS STALE.
        waiting: function () { return waiting; }
    };
};

module.exports.asks = asks;
module.exports.LOCKED = LOCKED;
