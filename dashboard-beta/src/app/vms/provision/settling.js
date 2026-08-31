//---------------------------------------------------------------------------
//WHAT HAPPENS AS A MACHINE COMES UP, which is not part of building one.
//
//./building.js makes a machine in VirtualBox and stops. Everything here runs
//LATER — while an install talks back, and at the moment a freshly built machine
//first dials in — and none of it is on the path that creates anything.
//
//NOTHING HERE WRITES TO VirtualBox EXCEPT `base`, and `base` is the one thing
//here that stops a machine. That is worth knowing before reading: the rest is
//the register being told what the machine said.
//---------------------------------------------------------------------------

module.exports = function settling(deps) {
    var d = deps || {};
    var vbox = d.vbox;
    var ours = d.ours;
    var say = d.say || function () {
        var to = { good: function () {}, warn: function () {}, info: function () {}, bad: function () {}, on: function () { return to; } };
        return to;
    };

    //HOW LONG BEFORE THE FIRST SNAPSHOT, injectable so a test does not sit for
    //five seconds — see ./settling.test.js. A bounded wait a test can drive is
    //the difference between a check that fails and one that hangs.
    var after = d.after || function (ms, fn) { return setTimeout(fn, ms); };
    var SETTLE = d.settleMs == null ? 5000 : d.settleMs;

    //---- what the guest says about itself ----------------------------------
    //
    //AN INSTALL TALKS BACK OVER HTTP, because it has no agent yet — that is the
    //whole point of this path. It is the only view of a machine between "the
    //installer started" and "it dialled in".
    //
    //A NAME THIS APP DOES NOT KNOW IS IGNORED, NOT REFUSED. Anything can reach
    //the port an install reports to; a stranger saying it is at stage "online"
    //should change nothing here and should not be an error either.
    //ASKED WITH `has`, NOT BY CATCHING `get`. ../ours/store.js throws for a name
    //it does not know, on purpose and as a boundary — a more precise answer
    //would be a way to probe what else is on this host. Catching that to turn it
    //back into a value would be reaching around the refusal.
    function report(name, stage) {
        if (!ours.has(name)) return { ignored: true };
        var vm = ours.get(name);

        say('vm', name, 'guest').good(name + ': ' + stage);

        //STORED AS `said`, NOT AS `stage`, and the rename is the fix rather than
        //a preference.
        //
        //../ours/store.js DERIVES `stage` on the way out of every read — one
        //answer to "where has this machine got to", worked out from what is
        //known rather than from what was last written. Writing the guest's word
        //into the same field put a second opinion in the record that was then
        //overwritten on every read, so it was dead weight AND a contradiction.
        //
        //It was also visible: ../../runners/machines showed
        //`'installing — ' + v.stage`, and by then `v.stage` was the derived
        //word, so a machine part-way through an install read
        //"installing — installing" instead of naming the step it was on.
        //
        //The guest's own word is worth keeping — "partitioning" is something no
        //derivation can reach — it just is not the same fact.
        //
        //`installing` IS CLEARED ONLY BY "online". Any other stage is progress
        //through an install that is still running, and clearing the flag partway
        //would make a machine look finished while its installer was still going.
        return ours.update(name, {
            reported: new Date().toISOString(),
            said: stage,
            installing: stage === 'online' ? null : vm.installing
        });
    }

    //---- the first clean starting point ------------------------------------
    //
    //A MACHINE WITH NO BASE SNAPSHOT CANNOT BE PUT AWAY CLEAN, so the queue
    //correctly never picks it up — and "the queue is ignoring my new machine"
    //looks exactly like "the queue has nothing to do". Every machine built used
    //to need somebody to remember this step, long after they started the thing
    //that needed it.
    //
    //NOT WHEN THE GUEST SAYS "ONLINE", which was the first attempt and was wrong
    //in a way worth writing down: first-boot.sh runs in the INSTALLER's
    //post-install stage, so "online" arrives while the machine is still the
    //installer, before the installed system has ever booted. Hooking it there
    //pressed the power button in the middle of an install and then raced the
    //installer's own reboot. It survived; it should not have been asked to.
    //
    //DIALLING IN IS THE HONEST SIGNAL: the installed system booted, its agent
    //started, and it reached this host. Nothing has been asked of it yet, which
    //is exactly what a base snapshot should contain.
    //
    //IT ALWAYS RETURNS A PROMISE, AND THAT PROMISE NEVER REJECTS.
    //
    //The version this comes from returned `undefined`, and a caller wrote
    //`.catch` on it. That threw a TypeError synchronously, inside a handler the
    //channel wraps in a catch that says nothing — so for every machine older
    //than its first boot, every line after that call silently never ran. It
    //surfaced only because something new was added below it.
    //
    //A function that is sometimes await-able and sometimes not is the trap. This
    //one is always await-able, so a caller cannot hold it wrongly, and a test can
    //wait for it instead of sleeping.
    function firstSnapshotIfItNeedsOne(name) {
        if (!ours.has(name)) return Promise.resolve({ ignored: true });
        var vm = ours.get(name);
        if (vm.baseSnapshot) return Promise.resolve({ already: true });

        //STILL BEING BUILT. It will dial in again when the installed system
        //boots, and that is the moment this is for.
        if (vm.installing) return Promise.resolve({ installing: true });

        //DETACHED, because taking a snapshot shuts the machine down and starts
        //it again, and this runs inside the handler that has just made the
        //machine reachable. A failure is said and changes nothing: the machine
        //is installed either way, and vmBaseSnapshot is still there to press.
        return new Promise(function (done) {
            after(SETTLE, function () {
                base(name).then(function (r) { done(r); }, function (e) {
                    say('vm', name).warn('could not take its first snapshot: ' + e.message
                        + '. Take one with vmBaseSnapshot — until it has one, the queue cannot use it.');
                    done({ failed: e.message });
                });
            });
        });
    }

    //THE FIRST SNAPSHOT, taken once and never again by this path. A person
    //pressing vmBaseSnapshot does the same thing through the same function,
    //rather than a second one that drifts from it.
    async function base(name, title) {
        var what = title || 'base';
        var to = say('vm', name);

        to.info('taking its first clean snapshot, so it can be put away and reused');

        if (!await vbox.isOff(name)) {
            await vbox.stop(name, false);
            if (!await vbox.waitUntilOff(name, { timeout: 180000 })) {
                //ASKED FIRST, PULLED SECOND. A machine that will not shut down
                //still has to be snapshotted, or it never gets a starting point
                //and the queue never touches it again.
                to.warn('it did not shut down when asked; pulling the power to snapshot it');
                try { await vbox.stop(name, true); } catch (e) { /* it may have gone on its own */ }
                await vbox.waitUntilOff(name, { timeout: 60000 });
            }
            //POWERED OFF IS NOT UNLOCKED. VirtualBox holds the lock for a moment
            //after the machine is down, and snapshotting into it fails.
            await vbox.waitUntilUnlocked(name);
        }

        await vbox.takeSnapshot(name, what, 'the machine as it was built, before anything was asked of it');
        ours.update(name, { baseSnapshot: what, snapshots: { [what]: null } });

        to.good('"' + what + '" is the point this machine will be returned to after every task');
        return { name: name, baseSnapshot: what };
    }

    return {
        report: report,
        base: base,
        firstSnapshotIfItNeedsOne: firstSnapshotIfItNeedsOne
    };
};
