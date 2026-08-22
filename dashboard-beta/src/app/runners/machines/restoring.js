//---------------------------------------------------------------------------
//GOING BACK TO A SNAPSHOT, AND WHAT GOES BACK WITH THE DISK.
//
//The rollback itself is one VBoxManage call. Everything here is the four facts
//this host keeps ABOUT a machine that stop being true the moment its disk
//changes, and each of them is a scar.
//
//---- before anything is touched -------------------------------------------
//
//POWERED OFF IS NOT UNLOCKED. A restore issued into that window races the
//session VirtualBox is still holding, and the machine it leaves behind boots to
//a black screen with nothing logged.
//
//AND THE CHANNEL IS DROPPED. The disk is about to become a different disk, so
//whatever session is recorded describes something that will not exist in a
//moment — and a machine stopped by pulling its power leaves one that looks
//healthy for over a minute, with commands dispatched into it going nowhere.
//
//---- and then four things go back with it ---------------------------------
//
//THE BRANCH, which is the one that is quietly wrong rather than loud. What a
//machine may push is a standing permission recorded here; restoring to a point
//taken before any workspace existed leaves a machine whose registry still names
//a branch it no longer has a copy of. Nothing fails — it can put commits on it.
//
//A SNAPSHOT THIS APP DID NOT TAKE — one made in VirtualBox directly — is not in
//the map, and that reads as `null` rather than as "leave it alone". UNKNOWN
//MEANS MAY-PUSH-NOTHING, which is recoverable in one click; the other way round
//is not.
//
//THE CREDENTIAL, and this is DERIVABLE rather than guessed: a machine holding
//one cannot be snapshotted at all, so every snapshot that exists was taken while
//it held nothing, and restoring any of them lands on a disk with no credential
//file. It has to be said or the registry claims the machine holds one for ever —
//which refuses every future snapshot and, worse, keeps it out of the queue as a
//machine needing tidying when it is already clean.
//
//AND THE MOMENT ITS DISK WENT BACK TO MATCHING A SNAPSHOT. "Has this machine
//changed since its snapshot" is answered by asking whether it has dialled in
//since — first-hand and right, until a restore, after which the old dial-in is
//still later than the snapshot was TAKEN and the machine reads as changed for
//ever. It is not: this just put the disk back, and this is the one place that
//knows.
//
//---- and the borrow, unless the restore is what the borrow is FOR ---------
//
//A borrow says "this one is mine, do not queue it". After a rollback the machine
//is on no branch, holds no credential and holds no work — every other field says
//it is free — and the borrow alone kept it out of the pool, naming work that is
//not there. A machine sat like that: `poweroff`, `claims a branch: nothing`,
//"not on a branch and not running anything", and beside it `borrowed — working
//on inspection/check1 in a terminal`.
//
//UNLESS THIS RESTORE IS WHAT MAKES THE MACHINE READY FOR THE BORROW. Everything
//above is about a rollback that ENDS work. Bringing a machine up rolls back for
//the opposite reason — to make it clean for work that has NOT started — and
//borrowing marks the machine before that, deliberately, so the queue cannot take
//it while it boots. That borrow was five seconds old and this deleted it:
//
//    20:50:11  borrowed — a drill proving a machine comes up and goes away
//    20:50:12  shutting it down so it can be made clean
//    20:50:16  rolling back to "base"
//    20:50:16  no longer borrowed — it was "a drill proving a machine…"
//
//WHY IT HID FOR SO LONG: a bring-up SKIPS the rollback when a machine is already
//clean and off, which is how machines usually sit. It only bites when one is
//borrowed while already running — somebody left it on, or a drill started it —
//and then the machine is in use and reads as free, so the queue may hand it a
//task. It fails towards the harm.
//---------------------------------------------------------------------------

module.exports = function restoring(deps) {
    var d = deps || {};

    var ours = d.ours;          //get, update
    var vbox = d.vbox;          //isOff, waitUntilUnlocked, restoreSnapshot, snapshots
    var busy = d.busy;          //during
    var channel = d.channel;    //drop
    var say = d.say;
    var now = d.now || function () { return new Date().toISOString(); };

    function serving(keepBorrow) { return keepBorrow === true || keepBorrow === 'true'; }

    async function toSnapshot(name, title, how) {
        var o = how || {};

        return await busy.during(name, 'being restored', async function () {
            var vm = ours.get(name);

            if (!(await vbox.isOff(name))) {
                throw new Error('Shut the machine down first — VirtualBox will not restore a snapshot '
                    + 'while it is running.');
            }

            //POWERED OFF IS NOT UNLOCKED.
            await vbox.waitUntilUnlocked(name);

            channel.drop(name, 'was rolled back to a snapshot');
            await vbox.restoreSnapshot(name, title);

            var was = vm.branch || null;
            var then = (vm.snapshots || {})[title];
            var branch = then === undefined ? null : then;

            var keep = serving(o.keepBorrow);
            var gaveBack = keep ? null : (vm.borrowed || null);

            var patch = { branch: branch, holdsCredential: false, cleanSince: now() };
            if (!keep) patch.borrowed = null;
            ours.update(name, patch);

            var to = say('vm', name);
            if (gaveBack) {
                to.info('no longer borrowed — it was "' + (gaveBack.why || 'taken by somebody')
                    + '", and the disk it was taken for has gone back');
            }

            //SAID ONLY WHEN IT CHANGED. A rollback that lands on the same branch
            //is the ordinary case, and a line about it every time is a line
            //nobody reads.
            if (branch !== was) {
                to.warn(branch
                    ? name + ' is back at "' + title + '" and may now push ' + branch + ', not '
                        + (was || 'nothing')
                    : name + ' is back at "' + title + '", which predates any workspace — it may push '
                        + 'nothing until it is set up again');
            }

            return Object.assign({}, await vbox.snapshots(name), { branch: branch });
        });
    }

    return { toSnapshot: toSnapshot, serving: serving };
};
