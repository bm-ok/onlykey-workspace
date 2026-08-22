//---------------------------------------------------------------------------
//THE MACHINES THAT ALREADY EXISTED WHEN A RULE ARRIVED.
//
//Everything here has the same shape and the same reason. A rule that only
//applies to machines built FROM NOW ON is a rule with a growing list of
//exceptions, and the exceptions are invisible: the code is right, the new
//machines are right, and the ones somebody actually uses are the old ones.
//
//---- why these are cron jobs and not a startup step ------------------------
//
//THE VERSION THIS COMES FROM RAN THEM ONCE, AT STARTUP, and said so in its own
//comment: "a machine that is up right now gets its port the next time it is off,
//and this is called again on the next start". That sentence is the whole
//argument for moving them. VirtualBox will not add a serial port to a RUNNING
//machine, so the machine that most needs one — the one that is up and doing
//something — is precisely the one a startup sweep always skips, and the repair
//then waits for somebody to restart the app.
//
//As jobs they catch it the next time it is off, whenever that is. And they
//become answerable: ../../core/cron can say when each last ran, what it found,
//and whether it is failing — which a startup step could never be asked.
//
//CHEAP WHEN THERE IS NOTHING TO DO, which is what makes running them repeatedly
//reasonable: one registry read, and no VBoxManage call at all for a machine that
//already has what the rule wants.
//---------------------------------------------------------------------------

module.exports = function repairs(deps) {
    var d = deps || {};
    var vbox = d.vbox;
    var ours = d.ours;
    var serialFor = d.serialFor;
    var say = d.say || function () {
        var to = { good: function () {}, warn: function () {}, info: function () {}, bad: function () {}, on: function () { return to; } };
        return to;
    };

    //---- every machine writes its console somewhere ------------------------
    //
    //./building.js attaches the port to anything built from now on, which leaves
    //the machines that already exist — including ones built by an earlier
    //version, which is most of them. A machine with no console is one whose boot
    //cannot be read, and that is the only view there is of a machine between
    //"the installer started" and "it dialled in".
    async function consoles() {
        //NOT AN ERROR ON A HOST WITHOUT VirtualBox. There is nothing to repair
        //and nothing wrong.
        if (!vbox.available()) return null;

        var given = [];
        var later = [];
        var all = ours.read();

        for (var i = 0; i < all.length; i++) {
            var vm = all[i];
            if (vm.serial) continue;

            var off = false;
            //NOT BUILT YET. The build will attach one, so there is nothing here
            //to fix and nothing to report.
            try { off = await vbox.isOff(vm.name); } catch (e) { continue; }

            //VirtualBox WILL NOT ADD A SERIAL PORT TO A RUNNING MACHINE. Said
            //rather than failed: this one gets its port the next time it is off,
            //and being a job rather than a startup step is what makes that a
            //promise instead of a wait for somebody to restart the app.
            if (!off) { later.push(vm.name); continue; }

            var to = say('vm', vm.name);
            try {
                //THE SAME FILE ./building.js WOULD HAVE CHOSEN, asked for rather
                //than worked out again — see serialFor there.
                var file = serialFor(vm.name);
                await vbox.setSerial(vm.name, file);
                ours.update(vm.name, { serial: file });
                given.push(vm.name);
                to.good('its console is now captured — every machine has one, and this one did not');
            } catch (e) {
                to.warn('could not capture its console: ' + e.message);
            }
        }

        //NULL WHEN NOTHING HAPPENED, so the cron board shows a job that is doing
        //something rather than only that it ran — see ../channel/server.js.
        if (!given.length && !later.length) return null;
        return { given: given, later: later };
    }

    //---- and every machine is in a pool ------------------------------------
    //
    //../provision/spec.js puts every machine built from now on in one; this is
    //for the machines that predate the idea, and for anything carried over from
    //the app this one is replacing.
    //
    //A SUPERVISOR IS LEFT ALONE, and it needs no clause of its own to stay out:
    //it carries the supervisor tag, so it is not tagless.
    //
    //THE VERSION THIS COMES FROM HAD THAT CLAUSE ANYWAY, and it was unreachable
    //— it tested for the supervisor tag AFTER returning early for any machine
    //with tags at all, so it could only ever be reached by a machine with no
    //tags, which cannot have that one. It is gone rather than kept as a
    //second guard, because a line that cannot run is a line the next reader has
    //to work out is dead.
    function pools() {
        var given = [];

        ours.read().forEach(function (vm) {
            if ((vm.tags || []).length) return;
            ours.update(vm.name, { tags: [ours.POOL] });
            given.push(vm.name);
            say('vm', vm.name).info('it carried no tag, so it is in the "' + ours.POOL
                + '" pool — every machine is in one');
        });

        return given.length ? { given: given } : null;
    }

    return { consoles: consoles, pools: pools };
};
