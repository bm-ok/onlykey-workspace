//---------------------------------------------------------------------------
//WHAT VirtualBox SAYS ABOUT A MACHINE, and how to wait for it to mean it.
//
//NOTHING HERE SPAWNS ANYTHING. `run` arrives as an argument — see ./gate.js for
//why every call has to go through one place — so all of this is exercisable
//against text VirtualBox would have printed, which is the only way to test a
//parser without a hypervisor.
//---------------------------------------------------------------------------

//WHAT COUNTS AS OFF. `aborted` is a machine that died rather than one somebody
//stopped, and `saved` is one with its RAM on disk — but for the question every
//caller is really asking, which is "may I touch this", all of them are off.
var OFF = ['poweroff', 'aborted', 'saved', 'aborted-saved'];

//`"name" {uuid}` PER LINE, and parsed rather than split on whitespace: a machine
//name can contain spaces, and a name with a space in it is exactly the one that
//would silently stop being listed.
function names(text) {
    return String(text == null ? '' : text).split('\n')
        .map(function (l) { return /^"(.*)"\s+\{(.+)\}$/.exec(l.trim()); })
        .filter(Boolean)
        .map(function (m) { return { name: m[1], uuid: m[2] }; });
}

//`--machinereadable` IS key="value" PER LINE, with the quotes optional on both
//halves depending on the key. One pattern rather than a special case per field.
function fields(text) {
    var map = {};
    String(text == null ? '' : text).split('\n').forEach(function (line) {
        var m = /^"?([^"=]+)"?="?(.*?)"?$/.exec(line.trim());
        if (m) map[m[1]] = m[2];
    });
    return map;
}

module.exports = function reading(run, opts) {
    var o = opts || {};
    var now = o.now || Date.now;
    var sleep = o.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var say = o.say || { info: function () {}, warn: function () {} };

    async function listAll() {
        return names(await run(['list', 'vms'], { quiet: true }));
    }

    async function runningAll() {
        return names(await run(['list', 'runningvms'], { quiet: true }));
    }

    async function info(name) {
        return fields(await run(['showvminfo', name, '--machinereadable'], { quiet: true }));
    }

    async function exists(name) {
        return (await listAll()).some(function (v) { return v.name === name; });
    }

    //MISSING IS A STATE, not a failure. A machine that has been deleted is the
    //ordinary end of one, and every caller asking "what is it doing" would
    //otherwise have to wrap this in a try.
    async function state(name) {
        try { return (await info(name)).VMState || 'unknown'; }
        catch (e) { return 'missing'; }
    }

    async function isOff(name) {
        return OFF.indexOf(await state(name)) >= 0;
    }

    async function waitForState(name, ok, how) {
        var h = how || {};
        var deadline = now() + (h.timeout || 180000);
        var interval = h.interval || 2000;

        for (;;) {
            if (ok(await state(name))) return true;
            if (now() > deadline) return false;
            await sleep(interval);
        }
    }

    function waitUntilOff(name, how) {
        return waitForState(name, function (s) {
            //GONE COUNTS AS OFF. Waiting for a machine that was deleted while
            //this was waiting would otherwise run to the full timeout.
            return OFF.indexOf(s) >= 0 || s === 'missing';
        }, how);
    }

    //---- POWERED OFF IS NOT READY -----------------------------------------
    //
    //AND THIS IS THE WAIT EVERY CALLER THAT IS ABOUT TO TOUCH A MACHINE'S DISK
    //HAS TO DO FIRST.
    //
    //VirtualBox reports a machine as `poweroff` while it is STILL HOLDING THE
    //SESSION, and the operations that need the disk to themselves — restoring,
    //snapshotting, deleting a snapshot — are not refused during that window so
    //much as RACED. A restore issued into it has been observed to leave a
    //machine that starts to a black screen and never boots: nothing failed,
    //nothing was logged, and the disk was simply not what anybody thought.
    //
    //THE WINDOW IS A FEW SECONDS, and asking is still not enough on its own. So
    //callers wait AND retry: this closes most of it and ./gate.js's `retrying`
    //covers what is left.
    async function waitUntilUnlocked(name, how) {
        var h = how || {};
        var timeout = h.timeout || 60000;
        var deadline = now() + timeout;
        var interval = h.interval || 2000;

        for (;;) {
            var session;
            try { session = (await info(name)).SessionState || 'Unlocked'; }
            catch (e) {
                //ALREADY GONE, which is the outcome this was waiting for.
                return;
            }

            if (session === 'Unlocked') return;

            if (now() > deadline) {
                //TRIED ANYWAY RATHER THAN REFUSED. Waiting for ever on a session
                //that will not clear leaves a machine nobody can do anything
                //with; the retry above is the second line of defence, and this
                //says out loud that it is being relied on.
                say.warn('session still "' + session + '" after ' + Math.round(timeout / 1000)
                    + 's; trying anyway');
                return;
            }

            say.info('waiting for the VirtualBox session to unlock (currently "' + session + '")');
            await sleep(interval);
        }
    }

    return {
        listAll: listAll, runningAll: runningAll,
        info: info, exists: exists, state: state, isOff: isOff,
        waitForState: waitForState, waitUntilOff: waitUntilOff, waitUntilUnlocked: waitUntilUnlocked,
        OFF: OFF
    };
};

module.exports.names = names;
module.exports.fields = fields;
module.exports.OFF = OFF;
