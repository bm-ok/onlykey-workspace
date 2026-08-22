//---------------------------------------------------------------------------
//GETTING A MACHINE UP, CLEAN, AND READY TO BE TALKED TO.
//
//Three states, and the difference between them is where every wasted afternoon
//on this project has come from:
//
//  STARTED    VirtualBox has powered it on. Means almost nothing.
//  UP         its kernel is running and its console is saying so.
//  READY      it has dialled in, and the things that talk to a guest will work.
//
//---- the turn covers the first two, and not the third ---------------------
//
//WHAT TWO MACHINES FIGHT OVER IS THE SNAPSHOT RESTORE AND THE COLD KERNEL BOOT:
//disk and every core, at once. Once a kernel is up and talking, the rest is
//services starting and a network coming up, and the next machine can start into
//that quite happily.
//
//So the host is handed on as soon as this machine's console SAYS SOMETHING, and
//the wait for it to dial in — minutes later, and what actually makes it usable —
//happens outside the turn. On a queue giving work to several machines that is
//the difference between starting one a minute and starting one every three.
//
//THE CONSOLE IS THE SIGNAL because it is the machine reporting a fact, rather
//than this app guessing how long a boot takes on somebody else's hardware.
//
//---- and it all goes through the actions ----------------------------------
//
//NOT THROUGH ../vms DIRECTLY, which would be the shorter path and the wrong one.
//Every refusal those actions carry — a machine this app did not make, one that
//is already busy, one holding a credential — applies to the queue exactly as it
//applies to a person pressing the button. A second way in is a second set of
//rules, and the second set is always the one that turns out to be wrong.
//---------------------------------------------------------------------------

module.exports = function starting(deps) {
    var d = deps || {};
    var call = d.call;
    var busy = d.busy;
    var settle = d.settle;

    //HOW LONG EACH STEP GETS, AND WHAT IT USUALLY TAKES. The second number is
    //what lets a slow one read as slow rather than as a policy — see ./waiting.js.
    var STOPPING = { timeout: 120000, usual: 15000 };
    var DIALLING = { timeout: 6 * 60000, usual: 60000 };

    function look(machine) {
        return async function () {
            var said = await call('vmList', {});
            return (said.vms || []).filter(function (v) { return v.name === machine; })[0] || null;
        };
    }

    //---- started, clean, and on -------------------------------------------
    async function startItUp(to, machine) {
        var before = await look(machine)();
        if (!before) throw new Error('"' + machine + '" is gone');

        if (before.running) {
            //FORCED, because this is the start of work rather than the end of
            //it. Nothing on that machine is worth keeping — it is about to be
            //rolled back to a snapshot — and a polite shutdown of a machine
            //sitting at a login prompt is two minutes of waiting for nothing.
            to.info('shutting it down so it can be made clean');
            await call('vmStop', { name: machine, force: true });
            await settle({
                to: to, what: 'it to stop', look: look(machine),
                ok: function (v) { return !v.running; },
                timeout: STOPPING.timeout, usual: STOPPING.usual
            });
        }

        //ROLLED BACK ONLY IF IT IS NOT ALREADY THERE.
        //
        //`putAway` leaves a machine ON its base snapshot precisely so it is
        //clean for the next task, and this then restored the same snapshot again
        //five seconds later — the same operation twice, back to back, on a
        //machine VirtualBox had only just finished restoring. That is the shape
        //of a race and it produced one: a machine that started to a black screen
        //and never booted.
        //
        //THE CHECK IS CHEAP AND THE SKIP IS SAFE: `current` is what VirtualBox
        //says the machine is sitting on, not what this app believes.
        var at = await call('vmSnapshots', { name: machine });

        if (at.current === before.baseSnapshot && !before.running) {
            to.info('already clean at "' + before.baseSnapshot + '"');
        } else {
            to.info('rolling back to "' + before.baseSnapshot + '"');

            //KEEPING THE BORROW, because this rollback is the start of work
            //rather than the end of it. Without it, borrowing a machine that
            //happens to be RUNNING un-borrows it on the way up — and the queue
            //then sees a machine somebody is using as free.
            await call('vmSnapshotRestore', {
                name: machine, title: before.baseSnapshot, keepBorrow: true
            });
        }

        to.info('starting it');
        await call('vmStart', { name: machine });
    }

    //---- and up, and then ready -------------------------------------------
    async function bringUp(to, machine) {
        await busy.comingUp(machine, async function () {
            await startItUp(to, machine);

            //THE TURN ENDS WHEN THE CONSOLE SPEAKS. A machine with no console
            //capture cannot say anything, which `vmAwait` reports and does not
            //treat as an error — and this app handing the host on anyway is
            //better than holding it for a machine that will never answer.
            try {
                await call('vmAwait', { name: machine, for: 'console', seconds: 60, tries: 3 });
            } catch (e) {
                to.info('could not tell when its kernel came up (' + String(e.message).split('.')[0]
                    + ') — handing the host on anyway');
            }
        }, {
            onWait: function (other) {
                to.info('waiting for "' + other + '" to get its kernel up — one machine starts at a time on this host');
            }
        });

        //STARTED IS NOT READY, and this is outside the turn on purpose — see the
        //header. Everything that talks to a guest refuses until it has dialled
        //in, and a machine boots for a minute or two, so this is the step most
        //worth counting out loud. It was silent for five minutes once while a
        //machine sat at a cursor.
        return await settle({
            to: to, what: 'it to dial in', look: look(machine),
            ok: function (v) { return v.connected; },
            timeout: DIALLING.timeout, usual: DIALLING.usual
        });
    }

    return { bringUp: bringUp, startItUp: startItUp, STOPPING: STOPPING, DIALLING: DIALLING };
};
