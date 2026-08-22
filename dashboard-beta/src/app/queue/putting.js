//---------------------------------------------------------------------------
//THE TWO WAYS A MACHINE LEAVES THE QUEUE'S HANDS.
//
//  putAway         back to its natural state: off, clean, holding nothing.
//  keepForLooking  left exactly as it is, because something went wrong on it
//                  and the evidence is still there.
//
//THE SECOND IS THE EXPENSIVE ONE and it is chosen deliberately: it costs a
//machine until somebody looks. The first is what happens the rest of the time.
//---------------------------------------------------------------------------

module.exports = function putting(deps) {
    var d = deps || {};
    var call = d.call;
    var settle = d.settle;
    var say = d.say;

    //HOW A MACHINE IS MARKED AS HELD. Injected rather than reached for, so this
    //file writes nothing to the register on its own — the plugin decides what
    //"held" is written through, and there is one writer rather than two.
    var keep = d.keep;
    var now = d.now || function () { return new Date().toISOString(); };

    function look(machine) {
        return async function () {
            var said = await call('vmList', {});
            return (said.vms || []).filter(function (v) { return v.name === machine; })[0] || null;
        };
    }

    //---- back to its natural state -----------------------------------------
    //
    //NEVER ALLOWED TO THROW. It runs in a `finally`, and a failure to tidy up
    //must not replace the error that caused it — losing the real reason is how a
    //machine ends up left on and nobody knowing why.
    async function putAway(machine) {
        var to = say('queue', machine);

        //TAKEN BACK WHILE THE MACHINE CAN STILL BE SPOKEN TO. The rollback below
        //would remove the file anyway, but a machine that fails to shut down
        //would then sit there holding a LIVE credential — and the point of
        //taking it back is that it stops existing on that disk, not that the
        //register stops saying so.
        try {
            await call('vmCredentialsForget', { name: machine });
        } catch (e) {
            to.info('its credential was already gone: ' + e.message);
        }

        //THE BUTTON FIRST, THEN THE PLUG.
        //
        //`vmStop` presses the ACPI power button, which is right for a machine
        //with an operating system on it and useless for one that never got that
        //far — there is nothing running to receive the press. A machine that
        //failed to boot therefore sat "running" for the whole timeout and was
        //then rolled back while still running, which fails too, and the machine
        //stayed out of the pool.
        //
        //PULLING THE PLUG IS SAFE HERE in a way it would not be elsewhere: this
        //machine is about to be rolled back to a snapshot, so an unfinished
        //write is discarded either way.
        try {
            await call('vmStop', { name: machine });
            await settle({
                to: to, what: 'it to shut down', look: look(machine),
                ok: function (v) { return !v.running; }, timeout: 45000, usual: 15000
            });
        } catch (e) {
            to.warn('it did not answer the power button; pulling the plug');
            try {
                await call('vmStop', { name: machine, force: true });
                await settle({
                    to: to, what: 'it to stop', look: look(machine),
                    ok: function (v) { return !v.running; }, timeout: 60000, usual: 5000
                });
            } catch (e2) {
                to.warn('could not stop it at all: ' + e2.message);
            }
        }

        //ROLLED BACK AT REST, AND THIS IS WHAT MAKES THE POOL WORK AT ALL.
        //
        //A machine that has finished a task still CLAIMS that task's branch, and
        //a claimed branch means "not free" — correctly, because a machine
        //somebody set up by hand must not be taken from under them. So without
        //this the queue deadlocks after exactly one task per machine: everything
        //it has ever used is permanently ineligible, and nothing says why except
        //a line in a state file.
        //
        //It is also what "clean" means when the natural state is off. Between
        //tasks a machine holds no branch, no credential and none of the last
        //worker's leavings, so the next task starts from a known disk rather
        //than from whatever the last one happened to leave.
        try {
            var vm = await look(machine)();
            if (vm && vm.baseSnapshot && !vm.running) {
                await call('vmSnapshotRestore', { name: machine, title: vm.baseSnapshot });
                to.good('off again, rolled back to "' + vm.baseSnapshot + '", free for the next task');
            } else {
                to.warn('could not roll it back, so it stays out of the pool until somebody does');
            }
        } catch (e) {
            to.warn('could not roll it back: ' + e.message);
        }
    }

    //---- or kept exactly as it is ------------------------------------------
    async function keepForLooking(machine, why) {
        var to = say('queue', machine);

        //IS IT THIS MACHINE, OR IS IT THE ROOM? The one thing worth knowing
        //before anybody goes looking, and it is cheap to ask.
        //
        //One machine falling silent while its neighbours answer means that
        //machine. But if the thing handing out addresses dies, every guest loses
        //its footing at once through no fault of its own — and sending somebody
        //into a guest to find a fault that is in the room is a wasted afternoon.
        //
        //THE ANSWER CHANGES NOTHING ABOUT WHAT IS DONE: the disk is kept either
        //way, because it is evidence either way. It changes what this SAYS, and
        //being told where to look is most of the value.
        var others = [];
        try {
            var said = await call('vmList', {});
            others = (said.vms || []).filter(function (v) { return v.name !== machine && v.running; });
        } catch (e) { /* if even this fails, say less rather than guess */ }

        var answering = others.filter(function (v) { return v.connected; });
        var alone = others.length > 0 && answering.length === 0;

        var where = !others.length
            ? 'nothing else was running, so there is nothing to compare it against'
            : alone
                ? 'and nor is ' + others.map(function (v) { return v.name; }).join(' or ')
                    + ' — every machine that is up has gone quiet, so look at the network on this host '
                    + 'before looking inside that guest'
                : 'while ' + answering.map(function (v) { return v.name; }).join(' and ')
                    + ' still answers, so it is that machine rather than the network here';

        //THE PHOTOGRAPH, while whatever is on that screen is still on it.
        var shot = null;
        try {
            var got = await call('vmScreenshot', { name: machine });
            shot = (got && (got.file || got.path)) || null;
        } catch (e) {
            to.info('could not photograph its screen: ' + e.message);
        }

        //NOT ROLLED BACK, NOT STOPPED, AND NOT ASKED FOR ITS CREDENTIAL BACK.
        //
        //Stopping it would be defensible — a disk survives a power off — and it
        //is not done, because a machine that has stopped answering is one
        //somebody may want to open a console on, and memory holds what the disk
        //does not. Taking the credential back needs the guest to answer, which
        //is the thing that is not happening; the rollback that would have
        //removed it is precisely what is being skipped, so this is said out loud
        //rather than quietly assumed.
        keep(machine, {
            why: 'kept for looking at — ' + why,
            at: now(),
            keptBy: 'the queue'
        });

        to.bad(machine + ' is kept as it is: ' + why + ' ' + where
            + '. It has NOT been rolled back, so its log and anything it never handed over are still on it'
            + (shot ? ', and its screen is photographed at ' + shot : '')
            + '. It still holds a sign-in until it is given back with vmReturn.');

        //AND WHAT TO ACTUALLY DO WITH IT, because a machine held with no idea
        //how to read it is worse than one rolled back: it costs a machine AND
        //answers nothing, which is the strongest argument for the old behaviour.
        //
        //THERE IS NO GUARANTEE OF AN ANSWER. A guest that stopped dialling out
        //may have left nothing legible anywhere, and if the screen is blank and
        //the log stops mid-sentence then the honest end of this is `vmReturn` and
        //a shrug. What is claimed is narrower: three things can be looked at that
        //could not be looked at before, and the machine is not thrown away before
        //somebody has had the chance.
        to.info('to read it: the screenshot above shows what its console said — a panic or an '
            + 'out-of-memory kill is legible there when nothing else is. It is still RUNNING, so its '
            + 'window can be opened in VirtualBox directly. When you have seen enough, "vmReturn --name '
            + machine + '" rolls it back and puts it in the pool; nothing else will touch it until you do.');

        return {
            kept: true, machine: machine, why: why, shot: shot, alone: alone,
            answering: answering.map(function (v) { return v.name; })
        };
    }

    return { putAway: putAway, keepForLooking: keepForLooking };
};
