//---------------------------------------------------------------------------
//THE SECOND TURN: WHAT A PROJECT NEEDS, ON A MACHINE THAT HAS ALREADY BOOTED.
//
//A machine is installed, dials in, and is snapshotted — see ./settling.js. That
//snapshot is the machine as it was BUILT, and for a project of any size it is
//not a machine that can do the work: no toolchain, no build inputs, none of the
//things a task would otherwise install every single time it is given one.
//
//SO THERE IS A TURN AFTER IT. The machine is started again, the project's own
//script is run, and a SECOND snapshot is taken — and that one becomes the point
//the machine returns to. Half an hour of installing is then paid once, when the
//machine is built, instead of by every task that is ever given it.
//
//---- WHY IT IS NOT PART OF THE INSTALL ------------------------------------
//
//`extra.sh` ALREADY RUNS DURING THE INSTALL and is the right place for most of
//what a project needs. What it cannot do is anything that depends on having
//BOOTED: `usermod -aG docker` and `-aG plugdev` do not apply until the next
//login, which three separate scripts in ./scripts say out loud. A toolchain
//installed there is installed by a user who is not yet in the groups it just
//joined, and finds out at the first `docker build`.
//
//This turn is the first moment those are live.
//
//---- AND WHY IT WAITS TO BE TOLD, RATHER THAN WAITING ---------------------
//
//NOTHING HERE POLLS FOR THE MACHINE TO COME BACK. `channel` can say whether a
//machine is connected but has nothing that waits for one, and a loop that
//watched for it would be a loop this app has to get right about a machine that
//may never arrive.
//
//It does not need one. Dialling in is already an EVENT — it is what started all
//of this — so the turn is left OWED on the register and picked up the next time
//the machine says hello. That also means it survives the app being restarted
//half way through, which a promise waiting in memory would not.
//
//---- WHAT THIS FILE DOES NOT KNOW ----------------------------------------
//
//THE NAME OF A PROJECT. It serves whatever the open workspace put in its own
//provision folder and never reads it. A workspace that supplies nothing gets
//the ordinary base snapshot and this turn does not happen at all — the same
//absence-is-normal that ./scripts.js `has` exists to answer.
//---------------------------------------------------------------------------

//THE TWO HALVES, ROOT AND USER, for the reason ./scripts.js gives about the
//install pair: mixing them is how a home directory ends up owned by root.
var STAGES = [
    { stage: 'afterSnapshot', root: true },
    { stage: 'afterSnapshotUser', root: false }
];

//WHAT THE SECOND SNAPSHOT IS CALLED. Named for what it holds rather than when
//it was taken — "base" is the machine as built, this is the machine set up.
var TITLE = 'set-up';

module.exports = function afterwards(deps) {
    var d = deps || {};
    var vbox = d.vbox;
    var ours = d.ours;
    var channel = d.channel;
    var scripts = d.scripts;
    var recordFor = d.recordFor;
    var baseUrl = d.baseUrl;
    var now = d.now || function () { return Date.now(); };
    var say = d.say || function () {
        var to = { good: function () {}, warn: function () {}, info: function () {}, bad: function () {} };
        return to;
    };

    //---- IS THERE ANYTHING TO DO AT ALL ---------------------------------
    function wanted(vm) {
        return STAGES.filter(function (s) { return scripts.has(vm, s.stage); });
    }

    //A MACHINE OWES A TURN once its first snapshot is taken and the workspace
    //has something to run. Written down rather than remembered, so a restart
    //between the two halves loses nothing.
    function owed(vm) { return !!(vm && vm.setupOwed); }

    //---- ONE: THE FIRST SNAPSHOT HAS JUST BEEN TAKEN --------------------
    //
    //The machine is OFF at this point — `base` shut it down to snapshot it. So
    //this only starts it and writes down that it owes a turn; everything else
    //happens when it dials in.
    async function beginAfterBase(name) {
        if (!ours.has(name)) return { ignored: true };
        var vm = ours.get(name);

        var todo = wanted(vm);
        if (!todo.length) return { none: true };

        var to = say('vm', name);
        ours.update(name, { setupOwed: true });

        to.info('starting it again to set it up for this project — ' + todo.length
            + ' script(s), and what they leave will be its new starting point');

        try {
            await vbox.start(name, 'gui');
        } catch (e) {
            //SAID, AND THE FLAG STAYS. The machine has a base snapshot and is
            //usable; what it is missing is the project's half, and a person
            //starting it by hand later will complete the turn on the dial-in.
            to.warn('could not start it to set it up: ' + e.message
                + ' — it still owes that, and will do it the next time it comes up');
            return { started: false, why: e.message };
        }

        return { started: true, todo: todo.length };
    }

    //---- TWO: IT HAS COME BACK ------------------------------------------
    async function runFor(name) {
        if (!ours.has(name)) return { ignored: true };
        var vm = ours.get(name);
        if (!owed(vm)) return { notOwed: true };

        var to = say('vm', name);
        var todo = wanted(vm);

        //IT OWED A TURN AND THERE IS NOTHING TO RUN. The workspace changed
        //under it — a script removed, or a different folder opened. Clearing
        //the debt is the honest answer; leaving it would make the machine
        //restart itself on every dial-in for ever.
        if (!todo.length) {
            ours.update(name, { setupOwed: false });
            to.info('it owed a setup turn and this workspace has no script for one any more');
            return { none: true };
        }

        var base = null;
        try { var at = await vbox.hostAddress(); if (at) base = 'https://' + at + ':' + baseUrl.PORT; }
        catch (e) { /* said below */ }

        if (!base) {
            to.warn('cannot tell it where to fetch its setup from, so it is left owing one');
            return { failed: 'no address' };
        }

        var did = [];
        for (var i = 0; i < todo.length; i++) {
            var one = todo[i];
            var file = scripts.STAGES[one.stage];

            to.info('running ' + file + ' on it');
            var r = await channel.run(name, fetchAndRun(base, file, one.root), {
                what: 'setting this machine up for the project: ' + file,
                timeout: 60 * 60 * 1000
            });

            //A FAILURE STOPS THE TURN AND LEAVES THE DEBT. Snapshotting a half
            //installed toolchain would make that the machine's starting point,
            //and every task afterwards would begin from it.
            if (r && r.code !== 0) {
                to.bad(file + ' failed on ' + name + ' (exit ' + r.code + '). It is NOT being snapshotted — '
                    + 'the machine still returns to "' + vm.baseSnapshot + '", and it still owes this turn.');
                return { failed: file, code: r.code, did: did };
            }
            did.push(file);
        }

        return await keep(name, did);
    }

    //---- THREE: AND WHAT IT LEAVES BECOMES THE STARTING POINT ------------
    async function keep(name, did) {
        var to = say('vm', name);

        to.info('putting it down to keep what it has become');
        if (!await vbox.isOff(name)) {
            await vbox.stop(name, false);
            if (!await vbox.waitUntilOff(name, { timeout: 180000 })) {
                to.warn('it did not shut down when asked; pulling the power to snapshot it');
                try { await vbox.stop(name, true); } catch (e) { /* it may have gone */ }
                await vbox.waitUntilOff(name, { timeout: 60000 });
            }
            //POWERED OFF IS NOT UNLOCKED — the same moment ./settling.js waits
            //for, and for the same reason.
            await vbox.waitUntilUnlocked(name);
        }

        await vbox.takeSnapshot(name, TITLE, 'set up for this project, on top of the machine as it was built');

        //`makeBase`, WHICH IS THE WHOLE POINT OF THE TURN. Without it the
        //machine would still return to the bare install and everything just
        //installed would be discarded by the first rollback. The bare snapshot
        //is KEPT — see ../../runners/machines/snapshotting.js.
        ours.update(name, Object.assign(
            recordFor(ours.get(name), TITLE, now(), { makeBase: true }),
            { setupOwed: false }
        ));

        to.good('"' + TITLE + '" is now the point this machine returns to — ' + did.join(', ')
            + ' ran on it, and the machine as it was built is still there underneath');

        return { name: name, baseSnapshot: TITLE, did: did };
    }

    //---- THE COMMAND THE MACHINE IS SENT --------------------------------
    //
    //FETCHED RATHER THAN SENT AS TEXT, so what runs is what the guest API
    //serves — the same rendered script, from the same search path, that an
    //install would have fetched. A copy pasted into a command would be a second
    //reading of a file that is already served.
    //
    //THE ROOT HALF GOES THROUGH `sudo -n`. The agent runs commands as the
    //machine's user; the install ran this half as root. `-n` rather than a
    //prompt, because there is no terminal here and a password prompt would hang
    //until the timeout rather than fail.
    //
    //NO BACKSLASH IN HERE. See ../../../CLAUDE.md: a shell script is the one
    //output where a halved escape is a different command that RUNS.
    function fetchAndRun(base, file, asRoot) {
        var url = base + '/provision/' + file + '?vm=${OKC_VM}';
        return [
            'set -u',
            'D=$(mktemp -d)',
            'trap "rm -rf $D" EXIT',
            'curl -fsS --cacert "${OKC_CA:-/etc/okc/ca.pem}" -u "${OKC_VM}:${OKC_TOKEN}" '
                + '-o "$D/' + file + '" "' + url + '"',
            (asRoot ? 'sudo -n bash' : 'bash') + ' "$D/' + file + '"'
        ].join('\n');
    }

    return {
        wanted: wanted,
        owed: owed,
        beginAfterBase: beginAfterBase,
        runFor: runFor,
        TITLE: TITLE
    };
};

module.exports.TITLE = TITLE;
module.exports.STAGES = STAGES;
