//what ../../test/vms/ours-records.test.js has to be able to catch.
module.exports = {
    file: 'src/app/vms/ours/records.js',
    test: 'test/vms/ours-records.test.js',
    breaks: [
        //A machine made with tags had them written where nothing looked, and the
        //supervisor built with the box ticked was offered to the queue as an
        //ordinary runner.
        ['a machine is created with its tags left in the spec only',
            'tags: Array.isArray(s.tags) ? s.tags : [],',
            'tags: [],'],

        ['an old record is never filled in from the spec it was built from',
            'out.tags = Array.isArray(vm && vm.tags) ? vm.tags : (Array.isArray(spec.tags) ? spec.tags : []);',
            'out.tags = Array.isArray(vm && vm.tags) ? vm.tags : [];'],

        //THE FIELD'S PRESENCE, NOT ITS TRUTH. Somebody took the tags off.
        ['tags taken off on purpose come back from the spec',
            'out.tags = Array.isArray(vm && vm.tags) ? vm.tags : (Array.isArray(spec.tags) ? spec.tags : []);',
            'out.tags = (vm && vm.tags && vm.tags.length) ? vm.tags : (spec.tags || []);'],

        ['a serial deliberately set to null is treated as a missing one',
            'out.serial = (vm && vm.serial !== undefined) ? vm.serial : (spec.serial || null);',
            'out.serial = (vm && vm.serial) ? vm.serial : (spec.serial || null);'],

        ['the spec is never consulted for a serial',
            'out.serial = (vm && vm.serial !== undefined) ? vm.serial : (spec.serial || null);',
            'out.serial = (vm && vm.serial !== undefined) ? vm.serial : null;'],

        //READ-TIME. Nothing on disk is rewritten by having been looked at.
        ['filling in writes onto the record it was given',
            'var out = {};\n    for (var k in vm) if (Object.prototype.hasOwnProperty.call(vm, k)) out[k] = vm[k];',
            'var out = vm || {};'],

        //A machine that has never been set up must read as "not allowed yet"
        //rather than as a field somebody forgot.
        ['a new machine has no branch field at all',
            '        branch: null',
            '        branch: undefined'],

        ['a new machine is created already holding a base snapshot',
            'baseSnapshot: null,',
            "baseSnapshot: 'base',"],

        //Where it has got to.
        ['a machine VirtualBox has never heard of is reported by its record',
            "if (!s.live) return 'defined';",
            ''],

        ['a stale channel entry outranks the machine being gone',
            "if (!s.live) return 'defined';        //we wrote it down; VirtualBox has no such machine\n    if (s.connected) return 'connected';",
            "if (s.connected) return 'connected';\n    if (!s.live) return 'defined';"],

        ['a machine that is talking to us right now reads as merely ready',
            "if (s.connected) return 'connected';  //its agent is talking to us now",
            ''],

        ['a machine with a snapshot to reset to is not said to be ready',
            "if (v.baseSnapshot) return 'ready';   //has a snapshot to reset to",
            ''],

        ['a machine that has reported in still reads as mid-install',
            "if (v.reported) return 'online';",
            "if (v.installing) return 'installing'; if (v.reported) return 'online';"],

        ['a machine that exists but has never been heard from has no stage',
            "return 'created';                     //exists, never heard from",
            "return 'unknown';"]
    ]
};
