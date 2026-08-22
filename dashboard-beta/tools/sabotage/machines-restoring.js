//what ../../test/runners/machines-restoring.test.js has to be able to catch.
//
//FOUR FACTS THIS HOST KEEPS ABOUT A MACHINE stop being true the moment its disk
//changes. Every break below leaves one of them behind, and the worst of them
//fails quietly: nothing errors, and the machine can push to a branch it no
//longer has a copy of.
module.exports = {
    file: 'src/app/runners/machines/restoring.js',
    test: 'test/runners/machines-restoring.test.js',
    breaks: [
        //---- before anything is touched ---------------------------------------

        ['a running machine is rolled back under itself',
            '            if (!(await vbox.isOff(name))) {',
            '            if (false) {'],

        //POWERED OFF IS NOT UNLOCKED. A restore into that window races the
        //session VirtualBox is still holding, and the machine it leaves behind
        //boots to a black screen with nothing logged.
        ['the restore races the session VirtualBox is still holding',
            '            await vbox.waitUntilUnlocked(name);',
            ''],

        //THE DISK IS ABOUT TO BECOME A DIFFERENT DISK, and a machine whose power
        //was pulled leaves a socket that looks healthy for over a minute.
        ['the channel is left pointing at a disk that no longer exists',
            "            channel.drop(name, 'was rolled back to a snapshot');",
            ''],

        ['and it is dropped after the rollback, which is a race with VirtualBox',
            "            channel.drop(name, 'was rolled back to a snapshot');\n            await vbox.restoreSnapshot(name, title);",
            "            await vbox.restoreSnapshot(name, title);\n            channel.drop(name, 'was rolled back to a snapshot');"],

        //---- what a machine may push ------------------------------------------

        //THE ONE THAT IS QUIETLY WRONG. Nothing fails; the machine can put
        //commits on a branch it has no copy of.
        ['what the machine may push does not go back with the disk',
            '            var branch = then === undefined ? null : then;',
            '            var branch = vm.branch || null;'],

        ['and it is left as it was, which is the same thing said another way',
            '            var patch = { branch: branch, holdsCredential: false, cleanSince: now() };',
            '            var patch = { holdsCredential: false, cleanSince: now() };'],

        //A SNAPSHOT THIS APP DID NOT TAKE is not in the map, and unknown must
        //mean may-push-nothing. Recoverable in one click; the other way round is
        //not.
        ['a snapshot this app did not take is read as leave-it-alone',
            '            var branch = then === undefined ? null : then;',
            '            var branch = then === undefined ? (vm.branch || null) : then;'],

        //---- the credential ----------------------------------------------------

        //EVERY SNAPSHOT THAT EXISTS was taken while the machine held nothing, so
        //restoring any of them lands on a disk with no credential file. Left
        //claimed, the registry refuses every future snapshot and keeps the
        //machine out of the queue as needing tidying when it is already clean.
        ['the registry goes on claiming it holds a credential',
            '            var patch = { branch: branch, holdsCredential: false, cleanSince: now() };',
            '            var patch = { branch: branch, cleanSince: now() };'],

        //---- and when its disk last matched a snapshot ---------------------------

        //THE OLD DIAL-IN IS STILL LATER than the snapshot was TAKEN, so without
        //this the machine reads as changed for ever.
        ['nothing records that the disk went back, so it reads as changed for ever',
            '            var patch = { branch: branch, holdsCredential: false, cleanSince: now() };',
            '            var patch = { branch: branch, holdsCredential: false };'],

        //---- and the borrow ------------------------------------------------------

        //EVERY OTHER FIELD SAYS THE MACHINE IS FREE, and the borrow alone keeps
        //it out of the pool naming work that is not there.
        ['a borrow outlives the disk it was taken for',
            '            if (!keep) patch.borrowed = null;',
            ''],

        //UNLESS THIS RESTORE IS WHAT MAKES THE MACHINE READY FOR THE BORROW. The
        //borrow is taken BEFORE the bring-up so the queue cannot take the machine
        //while it boots — and this deleted one five seconds old.
        ['a borrow taken for this very bring-up is deleted by it',
            '            var keep = serving(o.keepBorrow);',
            '            var keep = false;'],

        ['and keepBorrow off the command line is read as false',
            "    function serving(keepBorrow) { return keepBorrow === true || keepBorrow === 'true'; }",
            '    function serving(keepBorrow) { return keepBorrow === true; }'],

        ['nothing says the borrow was given back',
            "                to.info('no longer borrowed — it was \"' + (gaveBack.why || 'taken by somebody')",
            "                void ('no longer borrowed — it was \"' + (gaveBack.why || 'taken by somebody')"],

        //---- and what it says --------------------------------------------------------

        ['a change in what it may push is not said',
            '            if (branch !== was) {',
            '            if (false) {'],

        ['and it is said every time, including when nothing changed',
            '            if (branch !== was) {',
            '            if (true) {']
    ]
};
