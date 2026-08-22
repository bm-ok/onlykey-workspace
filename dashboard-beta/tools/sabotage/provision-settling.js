//what ../../test/vms/provision-settling.test.js has to be able to catch.
module.exports = {
    file: 'src/app/vms/provision/settling.js',
    test: 'test/vms/provision-settling.test.js',
    breaks: [
        //---- what the guest says about itself ------------------------------

        //ANYTHING CAN REACH THE PORT AN INSTALL REPORTS TO.
        ['a name this app does not know is acted on rather than ignored',
            '        if (!ours.has(name)) return { ignored: true };',
            ''],

        //THE GUEST'S WORD AND THE APP'S STAGE ARE TWO FACTS. ours/store.js
        //derives `stage` on every read, so writing the guest's word there is a
        //second opinion that the next read throws away.
        ['the guest writes the field the app derives',
            '            said: stage,',
            '            stage: stage,'],

        ['what the machine said is not written down at all',
            '            said: stage,',
            ''],

        //AN INSTALL THAT IS STILL RUNNING IS NOT FINISHED.
        ['any progress report ends the install',
            "            installing: stage === 'online' ? null : vm.installing",
            '            installing: null'],

        ['nothing ends the install, so it never reads as finished',
            "            installing: stage === 'online' ? null : vm.installing",
            '            installing: vm.installing'],

        ['it never records that it heard from the machine',
            '            reported: new Date().toISOString(),',
            ''],

        //---- the first clean starting point --------------------------------

        //A SECOND SNAPSHOT OVER THE FIRST is not a tidy-up: `base` stops the
        //machine to take one, so this would power-cycle an established machine
        //every time it dialled in.
        ['a machine that already has one is snapshotted again',
            '        if (vm.baseSnapshot) return Promise.resolve({ already: true });',
            ''],

        ['a machine still being installed is snapshotted mid-install',
            '        if (vm.installing) return Promise.resolve({ installing: true });',
            ''],

        //IT IS AWAIT-ABLE ON EVERY PATH. The version this comes from returned
        //undefined here, and the `.catch` a caller wrote on it threw a
        //TypeError inside a handler that says nothing — silently killing every
        //line below it for any machine older than its first boot.
        ['the already-has-one path is not await-able',
            '        if (vm.baseSnapshot) return Promise.resolve({ already: true });',
            '        if (vm.baseSnapshot) return;'],

        ['the still-installing path is not await-able',
            '        if (vm.installing) return Promise.resolve({ installing: true });',
            '        if (vm.installing) return;'],

        //A DETACHED FAILURE THAT REJECTS LANDS NOWHERE ANYBODY READS.
        ['a snapshot that cannot be taken rejects instead of being said',
            '                base(name).then(function (r) { done(r); }, function (e) {',
            '                base(name).then(function (r) { done(r); }, function (e) { throw e; }, function (e) {'],

        ['a machine with no snapshot is not told how to get one',
            '. Take one with vmBaseSnapshot — until it has one, the queue cannot use it.',
            ''],

        //---- stopping it to take one ----------------------------------------

        //POWERED OFF IS NOT UNLOCKED. VirtualBox holds the lock for a moment
        //after the machine is down, and snapshotting into it fails.
        ['it snapshots before VirtualBox has let go of the machine',
            '            await vbox.waitUntilUnlocked(name);',
            ''],

        ['it snapshots without waiting for the machine to be off',
            '            if (!await vbox.waitUntilOff(name, { timeout: 180000 })) {',
            '            if (false) {'],

        //A MACHINE THAT WILL NOT STOP STILL HAS TO GET A STARTING POINT, or the
        //queue ignores it forever and nothing says why.
        ['one that will not shut down is left without a snapshot',
            '                try { await vbox.stop(name, true); } catch (e) { /* it may have gone on its own */ }',
            '                return { name: name, baseSnapshot: null };'],

        ['a machine that is already off is stopped anyway',
            '        if (!await vbox.isOff(name)) {',
            '        if (true) {'],

        //WHAT WAS TAKEN IS WHAT IS WRITTEN DOWN. A snapshot the register does
        //not know about is one the queue cannot put the machine back to.
        ['the snapshot is taken and not written down',
            '        ours.update(name, { baseSnapshot: what, snapshots: { [what]: null } });',
            ''],

        ['the register is told a different name from the one VirtualBox was given',
            '        await vbox.takeSnapshot(name, what,',
            "        await vbox.takeSnapshot(name, what + '-x',"]
    ]
};
